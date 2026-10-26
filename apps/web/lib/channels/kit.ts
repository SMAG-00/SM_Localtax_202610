// 채널 배포 키트의 순수 규칙 (W12-h CH-01 - docs/dev/W12-h_설계.md). DB·네트워크를 읽지 않는다. 외부 채널 게시 호출 0 - 게시는 사람이 하고 이 파일은 묶음 만들기·검사만 한다.
//  · 채널 목록은 W12-f 원고 생성(workflows/src/ops/editorial-ai.ts CHANNELS)·DB 제약 180과 같은 값이다 (시험이 대조)
//  · 키트 묶음: 승인된 원고만(상태 검사), 채널마다 원고 + 대체 텍스트 목록 + UTM 링크
//  · UTM 검사: utm_source = 채널, utm_campaign = 기사 slug (둘 다 코드가 만든 링크 모양)

export const CHANNEL_KEYS = ["brief", "cardnews", "shorts", "naver_blog", "naver_post"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHECKLIST_KEYS = ["source_noted", "ai_notice", "alt_text", "not_ad"] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  source_noted: "출처 표기를 확인했습니다",
  ai_notice: "AI 활용 표기를 확인했습니다",
  alt_text: "이미지 대체 텍스트를 확인했습니다",
  not_ad: "광고가 아님을 확인했습니다",
};

export const KIT_STATUSES = ["approved", "published"] as const;

export interface KitDraft {
  review_item_id: number;
  channel: string;
  text: string;
  article_url: string;
  article_version?: number;
  posted?: boolean;
  status?: string;
}

export interface KitBundle {
  channel: ChannelKey;
  label: string;
  reviewItemId: number;
  text: string;
  articleUrl: string;
  altTexts: string[];
  posted: boolean;
}

/** 승인된 원고만 채널별 묶음으로. status가 주어졌는데 승인 상태가 아니면 뺀다 (DB 함수가 이미 거르지만 이중 방어), 채널당 가장 새 원고 하나 */
export function buildKit(drafts: readonly KitDraft[], altTexts: readonly string[], labels: Record<ChannelKey, string>): KitBundle[] {
  const byChannel = new Map<ChannelKey, KitDraft>();
  for (const d of drafts) {
    if (!(CHANNEL_KEYS as readonly string[]).includes(d.channel)) continue;
    if (d.status !== undefined && !(KIT_STATUSES as readonly string[]).includes(d.status)) continue;
    if (typeof d.text !== "string" || d.text.trim() === "") continue;
    const ch = d.channel as ChannelKey;
    const prev = byChannel.get(ch);
    if (!prev || d.review_item_id > prev.review_item_id) byChannel.set(ch, d);
  }
  return CHANNEL_KEYS.flatMap((ch) => {
    const d = byChannel.get(ch);
    return d ? [{ channel: ch, label: labels[ch], reviewItemId: d.review_item_id, text: d.text, articleUrl: d.article_url, altTexts: [...altTexts], posted: !!d.posted }] : [];
  });
}

export interface UtmCheck {
  ok: boolean;
  problems: string[];
}

/** 링크의 UTM 모양 - utm_source는 채널, utm_campaign은 기사 slug(인코딩 허용). 다른 utm 값은 등록 값(owned)만 */
export function checkUtm(url: string, channel: string, slug: string): UtmCheck {
  const problems: string[] = [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, problems: ["주소 형식이 아닙니다"] };
  }
  if (u.protocol !== "https:") problems.push("https 주소가 아닙니다");
  if (u.searchParams.get("utm_source") !== channel) problems.push("utm_source가 채널과 다릅니다");
  if (u.searchParams.get("utm_campaign") !== slug) problems.push("utm_campaign이 기사 slug와 다릅니다");
  if (u.searchParams.get("utm_medium") !== "owned") problems.push("utm_medium이 owned가 아닙니다");
  return { ok: problems.length === 0, problems };
}

/** 키트 내려받기 텍스트 - 채널마다 구분선 + 원고 + 링크 + 대체 텍스트. 이 파일이 만드는 글자는 구분용 머리글뿐이다 */
export function kitText(slug: string, bundles: readonly KitBundle[]): string {
  const parts = bundles.map((b) => [`## ${b.label} (${b.channel})`, "", b.text, "", `링크: ${b.articleUrl}`, ...(b.altTexts.length > 0 ? ["", "대체 텍스트:", ...b.altTexts.map((a, i) => `${i + 1}. ${a}`)] : [])].join("\n"));
  return [`# 채널 배포 키트 - ${slug}`, "", ...parts.flatMap((p) => [p, "", "---", ""])].join("\n");
}

export interface PostInput {
  postedUrl: string;
  checklist: Record<string, unknown>;
}

/** 게시 기록 입력 검사 - 체크리스트 4칸 모두 true, 게시 링크는 https(인증키 변수 없음) */
export function parsePost(raw: { postedUrl?: unknown; checklist?: unknown }): { ok: true; value: { postedUrl: string; checklist: Record<ChecklistKey, true> } } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const url = typeof raw.postedUrl === "string" ? raw.postedUrl.trim() : "";
  if (!/^https:\/\/[^\s]+$/i.test(url) || /[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key|token)=/i.test(url)) errors.push("postedUrl: https 주소여야 하고 인증키 변수가 없어야 합니다");
  const cl = raw.checklist && typeof raw.checklist === "object" && !Array.isArray(raw.checklist) ? (raw.checklist as Record<string, unknown>) : {};
  for (const k of CHECKLIST_KEYS) if (cl[k] !== true) errors.push(`checklist.${k}: ${CHECKLIST_LABELS[k]}`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { postedUrl: url, checklist: { source_noted: true, ai_notice: true, alt_text: true, not_ad: true } } };
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** 측정 이벤트 channel_landing_viewed 속성 - 이벤트 규칙(slug 형식: 소문자·숫자·하이픈)에 맞게 바꾼다. 밑줄은 하이픈, 기사 slug가 형식 밖이면 article-<번호> */
export function channelLandingProps(channel: string, articleId: number, slug: string): { utm_source: string; utm_campaign: string } {
  return { utm_source: channel.replace(/_/g, "-"), utm_campaign: SLUG.test(slug) && slug.length <= 100 ? slug : `article-${articleId}` };
}
