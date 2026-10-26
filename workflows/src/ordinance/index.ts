// 자치법규(조례) 수집·연결 규칙 (W11-e e1~e4 - PRD-03 RDV-06 · TX-13 · AIOPS-14). AI SDK를 쓰지 않는다. DB를 직접 열지 않는다 -
// 웹 앱이 조회·저장 기능을 넘기고, 이 모듈은 관문·숫자 검사·등록 검사·개정 판정·확인일 경고 판정만 한다.
// 이 파일에 실제 조례 문장·감면율·세율은 없다.
import { pipelineGate, type GateInput, type SkipReason } from "../pipelines/gate.ts";
import { classifyChange } from "../pipelines/law/law-watch.ts";

/** 관문 - 기능 키·인증키·원천 이용 조건(ordinance_api가 allowed + 견본 계약 확인) 중 하나라도 틀리면 요청 0 */
export function ordinanceGate(input: GateInput): { run: true } | { run: false; reason: SkipReason } {
  return pipelineGate(input);
}

const NUMBER_TOKEN = /[0-9]+(?:\.[0-9]+)?/g;

function numberTokens(text: string): string[] {
  return (text.replace(/(?<=[0-9]),(?=[0-9]{3})/g, "").match(NUMBER_TOKEN) ?? []);
}

/** 요약의 모든 숫자 토큰이 원문 숫자 토큰 집합에 있는가 (DB 함수 ordinance_summary_numbers_ok와 같은 규칙 - 부분 문자열이 아니라 토큰 일치) */
export function summaryNumbersOk(summary: string, sourceText: string): boolean {
  const source = new Set(numberTokens(sourceText));
  return numberTokens(summary).every((t) => source.has(t));
}

/** 요약에서 원문에 없는 숫자 목록 (거부 메시지용 - 숫자만, 원문 글자 0) */
export function missingSummaryNumbers(summary: string, sourceText: string): string[] {
  const source = new Set(numberTokens(sourceText));
  return [...new Set(numberTokens(summary).filter((t) => !source.has(t)))];
}

export type OrdinanceKind = "urban_redevelopment" | "tax_reduction" | "tax_rate";
export const ORDINANCE_KINDS: readonly OrdinanceKind[] = ["urban_redevelopment", "tax_reduction", "tax_rate"];

export interface ManualOrdinanceInput {
  name?: string;
  regionCode?: string;
  regionLevel?: "sido" | "sigungu";
  kind?: string;
  sourceUrl?: string;
  effectiveFrom?: string;
  verifiedAt?: string;
  promulgationNo?: string;
  bodyText?: string;
  summary?: string;
}

/** 편집자 수동 등록 검사 - 이용 조건 관문과 무관하게 열려 있는 경로. 빠진 칸 이름을 돌려준다(빈 목록이면 등록 가능) */
export function validateManualOrdinance(input: ManualOrdinanceInput): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const has = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  if (!has(input.name)) problems.push("name");
  if (!has(input.regionCode)) problems.push("regionCode");
  if (!ORDINANCE_KINDS.includes(input.kind as OrdinanceKind)) problems.push("kind");
  else if (input.regionLevel && (input.kind === "urban_redevelopment") !== (input.regionLevel === "sido")) problems.push("kind_level");
  if (!has(input.sourceUrl) || !/^https?:\/\/[^\s]+$/i.test(input.sourceUrl!.trim())) problems.push("sourceUrl");
  if (!has(input.effectiveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom!)) problems.push("effectiveFrom");
  if (!has(input.verifiedAt)) problems.push("verifiedAt");
  if (!has(input.promulgationNo)) problems.push("promulgationNo");
  if (!has(input.bodyText)) problems.push("bodyText");
  if (has(input.summary) && has(input.bodyText) && !summaryNumbersOk(input.summary!, input.bodyText!)) problems.push("summary_numbers");
  return { ok: problems.length === 0, problems };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayNumber(d: Date): number {
  return Math.floor((d.getTime() + KST_OFFSET_MS) / 86_400_000);
}

/** 확인일 경과 일수(한국 날짜 차) - DB 함수 stale_days와 같다 */
export function staleDays(verifiedAt: Date, now: Date): number {
  return kstDayNumber(now) - kstDayNumber(verifiedAt);
}

/** 경고 판정 - 일수가 한도를 넘을 때만 (한도 90: 90일째 경고 없음, 91일째 경고). 한도가 없으면 경고 계산 0 */
export function isStale(verifiedAt: Date, now: Date, limitDays: number | null | undefined): boolean {
  if (typeof limitDays !== "number" || !Number.isFinite(limitDays)) return false;
  return staleDays(verifiedAt, now) > limitDays;
}

export interface OrdinanceTarget {
  lawId: number;
  name: string;
  prev: { promulgationNo: string | null; effectiveOn: string | null; bodyHash: string | null } | null;
}
export interface OrdinanceLookup {
  promulgationNo: string;
  effectiveOn: string;
  bodyHash: string;
}
export type OrdinanceChange = "first_seen" | "revision" | "body_only" | "unchanged";
export interface OrdinanceOutcome {
  lawId: number;
  change?: OrdinanceChange;
  /** 개정(시행일·공포번호 변경)만 검수 항목(ordinance_change) 1건 - 해시만 바뀐 것은 만들지 않는다 */
  review?: boolean;
  error?: string;
}

/** 조례 수집 한 바퀴 - 관문이 닫혀 있으면 lookup을 한 번도 부르지 않는다(요청 0). 한 건의 오류는 나머지를 멈추지 않는다 */
export async function collectOrdinances(input: {
  gate: GateInput;
  targets: OrdinanceTarget[];
  lookup: (t: OrdinanceTarget) => Promise<OrdinanceLookup>;
}): Promise<{ skipped?: SkipReason; requests: number; outcomes: OrdinanceOutcome[] }> {
  const gate = ordinanceGate(input.gate);
  if (!gate.run) return { skipped: gate.reason, requests: 0, outcomes: [] };
  const outcomes: OrdinanceOutcome[] = [];
  let requests = 0;
  for (const t of input.targets) {
    requests += 1;
    try {
      const got = await input.lookup(t);
      if (!t.prev) {
        outcomes.push({ lawId: t.lawId, change: "first_seen", review: false });
        continue;
      }
      const c = classifyChange({
        dateChanged: t.prev.effectiveOn !== got.effectiveOn,
        promulgationChanged: t.prev.promulgationNo !== got.promulgationNo,
        bodyChanged: t.prev.bodyHash !== got.bodyHash,
      });
      outcomes.push({ lawId: t.lawId, change: c.changed ? "revision" : c.bodyOnly ? "body_only" : "unchanged", review: c.changed });
    } catch (e) {
      outcomes.push({ lawId: t.lawId, error: e instanceof Error ? e.message.slice(0, 200) : "lookup_failed" });
    }
  }
  return { requests, outcomes };
}
