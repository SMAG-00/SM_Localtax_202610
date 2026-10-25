// 캠페인 랜딩 입력 검사 (GROW-03·04) - 순수 함수 (시험 input.test.ts). DB 제약(marketing 마이그레이션 105 campaign_landings)과 같은 규칙을 먼저 알려 준다
import { CALC_TOOLS } from "./destination";
import { CAMPAIGN_CHANNELS, CAMPAIGN_TARGETS, type CampaignChannel, type CampaignTarget } from "./channels";

export const CAMPAIGN_KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const RESERVED_KEYS = ["admin", "api", "go"] as const;
export const TITLE_MAX = 30;
export const BODY_MAX = 120;

export interface CampaignInput {
  campaignKey: string;
  title: string;
  body: string;
  primaryTarget: CampaignTarget;
  secondaryTarget: CampaignTarget | null;
  primaryTool: (typeof CALC_TOOLS)[number] | null;
  channel: CampaignChannel;
  startsAt: string;
  endsAt: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function parseCampaignInput(raw: Record<string, unknown>): { ok: true; value: CampaignInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const key = str(raw.campaignKey);
  if (!CAMPAIGN_KEY.test(key)) errors.push("campaignKey: 소문자·숫자·'-' 2~40자여야 합니다");
  else if ((RESERVED_KEYS as readonly string[]).includes(key)) errors.push(`campaignKey: '${key}'은 예약된 이름입니다`);
  const title = str(raw.title);
  if (title.length < 1 || title.length > TITLE_MAX) errors.push(`title: 1~${TITLE_MAX}자여야 합니다`);
  const body = str(raw.body);
  if (body.length < 1 || body.length > BODY_MAX) errors.push(`body: 1~${BODY_MAX}자여야 합니다`);
  const primary = str(raw.primaryTarget);
  if (!(CAMPAIGN_TARGETS as readonly string[]).includes(primary)) errors.push("primaryTarget: 도착은 계산기·상담 요청·법령 해석·재테크 포인트 중 하나여야 합니다");
  // 보조 링크는 1개까지 - 목록으로 오면 거부
  let secondary: string | null = null;
  if (Array.isArray(raw.secondaryTarget)) errors.push("secondaryTarget: 보조 링크는 1개까지입니다");
  else if (raw.secondaryTarget !== null && raw.secondaryTarget !== undefined && str(raw.secondaryTarget) !== "") {
    secondary = str(raw.secondaryTarget);
    if (!(CAMPAIGN_TARGETS as readonly string[]).includes(secondary)) errors.push("secondaryTarget: 도착 4개 중 하나여야 합니다");
    else if (secondary === primary) errors.push("secondaryTarget: 주 버튼과 같은 도착은 쓸 수 없습니다");
  }
  const toolRaw = str(raw.primaryTool);
  let tool: CampaignInput["primaryTool"] = null;
  if (toolRaw !== "") {
    if (primary !== "calc") errors.push("primaryTool: 도구 지정은 도착이 계산기일 때만 쓸 수 있습니다");
    else if (!(CALC_TOOLS as readonly string[]).includes(toolRaw)) errors.push("primaryTool: 취득세·재산세·환급 진단 중 하나여야 합니다");
    else tool = toolRaw as CampaignInput["primaryTool"];
  }
  const channel = str(raw.channel) || "other";
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) errors.push("channel: search·sns·display·email·other 중 하나여야 합니다");
  const s = Date.parse(str(raw.startsAt));
  const e = Date.parse(str(raw.endsAt));
  if (!Number.isFinite(s)) errors.push("startsAt: 시작 시각을 확인하세요");
  if (!Number.isFinite(e)) errors.push("endsAt: 끝 시각을 확인하세요");
  if (Number.isFinite(s) && Number.isFinite(e) && s >= e) errors.push("endsAt: 끝은 시작보다 뒤여야 합니다");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      campaignKey: key,
      title,
      body,
      primaryTarget: primary as CampaignTarget,
      secondaryTarget: secondary as CampaignTarget | null,
      primaryTool: tool,
      channel: channel as CampaignChannel,
      startsAt: new Date(s).toISOString(),
      endsAt: new Date(e).toISOString(),
    },
  };
}

/** 집계 표시 - 5건 미만은 숫자를 가린다 (개인 식별 방지, GROW-05) */
export const SMALL_COUNT = 5;
export function maskSmallCount(n: number): string {
  return n < SMALL_COUNT ? `${SMALL_COUNT}건 미만` : String(n);
}
