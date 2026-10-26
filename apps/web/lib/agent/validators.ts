// 검증기 V1~V6 - 결정론적, 문단 단위, AI 없음 (W12-b b2, PRD-04 6.6 · 4단계 설계 4.3·4.7).
//  V1 결론·요건 문장마다 인용 1개 이상 / V2 조문·사건번호가 인용 문서 메타에 있음 + 실시간 인용은 스냅샷·해시 / V3 숫자가 인용·계산 결과에 있음,
//  국세 금액 문장 차단 / V4 인용 조문이 기준일에 시행 중(아니면 표기) / V5 금지 표현·감면 단정·투자 추천·사칭 / V6 개인정보 가림.
// 모델 출력이 아니라 사전·규칙이 막는다. 금지 표현 사전은 도우미 것에 V5 추가분(PO 입력 자리)을 합친다.
import { ASSISTANT_FORBIDDEN_PHRASES, BASE_PERSON_NAMES, mergeForbidden } from "../assistant/forbidden";
import { maskCore } from "../assistant/mask";
import { docRefs, extractRefs, type AgentParagraph, type EvidenceDoc } from "./evidence";

export type VCode = "V1" | "V2" | "V3" | "V4" | "V5" | "V6";
export const V_CODES: readonly VCode[] = ["V1", "V2", "V3", "V4", "V5", "V6"];

/** V5 추가 낱말 - 법률 검토자가 채운다 (설계 5장 #11). 빈 칸으로 출하 */
export const V5_EXTRA_PHRASES: readonly string[] = [];
export const V5_VERSION = "2026-10-27.pending";
export const defaultForbidden = (): string[] => mergeForbidden(ASSISTANT_FORBIDDEN_PHRASES, V5_EXTRA_PHRASES);
export const defaultPersonNames = (): readonly string[] => BASE_PERSON_NAMES;

export interface ValidationContext {
  /** 기준일 YYYY-MM-DD */
  asOf: string;
  questionText: string;
  forbiddenPhrases: readonly string[];
  personNames: readonly string[];
  /** 계산 도구 결과로 허용된 금액·세율 숫자 (쉼표 뺀 글자) - W12-c가 채운다. 이 단위에서는 비어 있다 */
  allowedNumbers?: readonly string[];
}

export interface VFailure {
  code: VCode;
  paragraph: number;
  detail: string;
  /** V3 국세 금액 문장 - 재생성이 아니라 안내로 바꾼다 */
  national?: "transfer" | "inherit_gift";
}

export interface ValidationResult {
  paragraphs: AgentParagraph[];
  failures: VFailure[];
  passes: Record<VCode, boolean>;
  needsRegeneration: boolean;
  fallback: "evidence_list" | "national_guide" | null;
  national: "transfer" | "inherit_gift" | null;
}

const META_START = /^(죄송|근거가\s?부족|확인(?:할|되지)\s?수\s?없|찾지\s?못|답변드리기\s?어렵|해당\s?내용은)/u;
const sentences = (p: string): string[] => p.split(/(?<=[.!?。다요죠])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);

const NATIONAL_TRANSFER = /(양도소득세|양도세|양도소득분)/u;
const NATIONAL_INHERIT_GIFT = /(상속세|증여세)/u;
const AMOUNT_WORD = /(세액|납부|내야|산출|합계|환급)/u;
const MONEY = /[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:만\s?원|억\s?원|천\s?원|원|%|퍼센트|배)/gu;
const NUMBER_PART = /[0-9][0-9,]*(?:\.[0-9]+)?/u;
const IN_FORCE_NOTE = /(시행\s?예정|폐지|개정\s?전|종전|구법|개정되기\s?전|시행되기\s?전)/u;
const BENEFIT_ASSERT = /(감면|비과세|면제)\s?(?:대상)?\s?(?:입니다|이에요|됩니다|받습니다|받으실\s?수\s?있습니다)/u;
const ILLEGAL_ASSERT = /(위법합니다|불법입니다|위반입니다|탈세입니다)/u;
const FIRST_PERSON = /(?:^|[\s,.;:"'“‘(])(저는|제가|저의|나는|내가|제\s?견해|제\s?생각)/u;

const digits = (s: string) => s.replace(/,/gu, "");

const inForce = (d: EvidenceDoc, asOf: string): boolean => d.validFrom <= asOf && (d.validTo === null || d.validTo > asOf);

/** 실시간 원문은 스냅샷이 저장되고 해시가 맞을 때만 인용으로 인정 */
const liveValid = (d: EvidenceDoc): boolean => !d.isLive || (d.snapshotId !== null && d.snapshotOk);

export function validateParagraphs(input: readonly AgentParagraph[], ctx: ValidationContext): ValidationResult {
  const failures: VFailure[] = [];
  const kept: AgentParagraph[] = [];
  let firstDropped = false;
  let national: ValidationResult["national"] = null;
  const forbidden = ctx.forbiddenPhrases;

  input.forEach((p, i) => {
    let text = p.text.trim();
    if (text === "") return;
    const fail = (code: VCode, detail: string, extra: Partial<VFailure> = {}) => failures.push({ code, paragraph: i, detail, ...extra });

    // V2(a) - 스냅샷 없는 실시간 인용은 지운다
    const cited = p.cited.filter(liveValid);
    if (cited.length !== p.cited.length) fail("V2", `스냅샷 없는 실시간 인용 ${p.cited.length - cited.length}건 제거`);

    // V6 - 개인정보 모양은 가린다 (통과하되 기록)
    const masked = maskCore(text);
    if (masked.kinds.length > 0) {
      fail("V6", `개인정보 모양 ${masked.kinds.length}개 가림`);
      text = masked.text;
    }

    // V2(b) - 본문의 조문·사건번호가 인용 문서 메타에 있다
    const metaRefs = new Set(cited.flatMap(docRefs));
    const stray = extractRefs(text).filter((r) => !metaRefs.has(r));
    if (stray.length > 0) fail("V2", `인용 메타에 없는 번호 ${stray.slice(0, 3).join(", ")}`);

    // V3 - 국세 금액 문장, 근거 없는 금액·세율 숫자
    for (const s of sentences(text)) {
      const kind = NATIONAL_TRANSFER.test(s) ? "transfer" : NATIONAL_INHERIT_GIFT.test(s) ? "inherit_gift" : null;
      if (kind && (MONEY.test(s) || AMOUNT_WORD.test(s) && NUMBER_PART.test(s))) {
        fail("V3", "국세 금액 문장", { national: kind });
        national = national ?? kind;
      }
      MONEY.lastIndex = 0;
    }
    // 숫자는 부분 글자가 아니라 한 덩어리로 대조한다 (12345 안의 5를 근거로 보지 않는다)
    const pool = new Set((digits(`${cited.map((d) => d.content).join(" ")} ${ctx.questionText} ${(ctx.allowedNumbers ?? []).join(" ")}`).match(/[0-9]+(?:\.[0-9]+)?/gu) ?? []));
    const unsupported = [...text.matchAll(MONEY)].map((m) => NUMBER_PART.exec(m[0])?.[0] ?? "").filter((n) => n !== "" && !pool.has(digits(n)));
    if (unsupported.length > 0) fail("V3", `인용·계산 결과에 없는 금액·세율 ${unsupported.slice(0, 3).join(", ")}`);

    // V4 - 인용 조문이 기준일에 시행 중이거나 표기가 있다
    const outOfForce = cited.filter((d) => d.sourceType === "law_article" && !inForce(d, ctx.asOf));
    if (outOfForce.length > 0 && !IN_FORCE_NOTE.test(text)) fail("V4", `기준일에 시행 중이 아닌 조문 ${outOfForce.length}건 인용`);

    // V5 - 금지 표현 · 감면 단정 · 단정적 위법 판단 · 사칭
    const hit = forbidden.find((f) => f !== "" && text.includes(f));
    if (hit) fail("V5", `금지 표현 '${hit}'`);
    if (BENEFIT_ASSERT.test(text)) fail("V5", "감면·비과세 해당 단정");
    if (ILLEGAL_ASSERT.test(text)) fail("V5", "단정적 위법 판단");
    if (ctx.personNames.some((n) => n !== "" && text.includes(n)) && FIRST_PERSON.test(text)) fail("V5", "실존 인물 이름과 1인칭 서술");

    // V1 - 결론·요건 문장은 인용 1개 이상
    const isMeta = META_START.test(text) || Array.from(text).length < 12;
    if (cited.length === 0 && !isMeta) {
      fail("V1", "인용 없는 진술");
      if (i === 0) firstDropped = true; // 결론이 인용이 없으면 재생성
      return; // 그 문단은 내보내지 않는다
    }
    kept.push({ text, cited });
  });

  const passes = Object.fromEntries(V_CODES.map((c) => [c, !failures.some((f) => f.code === c)])) as Record<VCode, boolean>;
  const blockingCodes: VCode[] = ["V2", "V3", "V4", "V5"];
  const blocking = failures.some((f) => blockingCodes.includes(f.code)) || firstDropped || kept.length === 0;
  return {
    paragraphs: blocking ? [] : kept,
    failures,
    passes,
    needsRegeneration: blocking && national === null,
    fallback: national ? "national_guide" : blocking ? "evidence_list" : null,
    national,
  };
}
