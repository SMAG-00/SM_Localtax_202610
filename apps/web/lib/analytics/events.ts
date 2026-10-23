// 측정 이벤트 이름·속성 규칙 (FND-06 · GROW-01 · PRD-01A 12장) — docs/dev/W2-c_설계.md 2.1·2.2·2.3과 같다 (시험 events.test.ts가 설계 문서를 읽어 대조한다).
// 순수 모듈 — 수집 API(서버)가 받은 본문을 이 규칙으로만 검사한다. 이벤트마다 정해진 속성 칸만 받고, 검색어·질문 원문·계산 입력값·이메일·주소를 담을 칸은 없다.
import { CONTENT_TYPES, FORMATS, detectPii } from "@ltr/editorial";
import { NEXT_ACTION_KEYS, SECTION_KEYS, type SectionKey } from "@/lib/server/public/constants";

/** 이벤트 이름 22종 (PRD-01A 12장 19종 + W3 10단계 3종 — DB check 제약 analytics_events.name과 같다) */
export const EVENT_NAMES = [
  "home_entry_clicked",
  "hub_viewed",
  "article_viewed",
  "article_engaged",
  "article_shared",
  "search_submitted",
  "glossary_opened",
  "situation_card_clicked",
  "next_action_clicked",
  "hot_article_clicked",
  "popular_article_clicked",
  "video_played",
  "partner_content_viewed",
  "signup_completed",
  "brief_preregistered",
  "inquiry_submitted",
  "policy_page_viewed",
  "redirect_hit",
  "not_found_viewed",
  // W3 10단계 (docs/dev/W3_설계.md 2.5) — 바깥 연결 카드 누름 · 트래커 상세 열람 · 해석 해설 열람
  "calculator_card_clicked",
  "amendment_viewed",
  "interpretation_viewed",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const MODES = ["general", "expert"] as const;
export type Mode = (typeof MODES)[number];
/** 회원 등급 — 비회원·일반·프리미엄·기관 좌석 (PRD-00 6장, 설계 9장 #12) */
export const TIERS = ["guest", "basic", "premium", "institution"] as const;
export type Tier = (typeof TIERS)[number];
/** 진입 경로 (PRD-00 13장 + 그 밖의 사이트 — 설계 9장 #6) */
export const ENTRIES = ["search", "ai_answer_engine", "naver", "brief", "assistant", "experts", "tax_lens", "direct", "referral"] as const;
export type Entry = (typeof ENTRIES)[number];
/** 브라우저가 정해 보내도 되는 진입 경로 — 사이트 안 출발점만. 바깥 진입 경로(검색·네이버·AI)는 서버가 리퍼러로 정한다 */
export const CLIENT_ENTRIES = ["assistant", "experts", "tax_lens"] as const satisfies readonly Entry[];

/** 속성 값 목록 (설계 2.3) */
export const PROP_VALUES = {
  "article_shared.channel": ["native_share", "copy_link"],
  "situation_card_clicked.position": ["hub", "search_empty", "inheritance_gift"],
  "next_action_clicked.screen": ["article", "situation"],
  "popular_article_clicked.position": ["sidebar", "list"],
  "policy_page_viewed.policy": ["editorial_policy", "ethics", "corrections", "ad_policy", "privacy"],
  "inquiry_submitted.kind": ["tip", "subscription", "advertising", "reader_submission", "correction", "product", "assistant_report"],
  "hub_viewed.topic": ["local_tax", "realestate", "local_finance", "urban_policy"],
  // W3 10단계 — 카드 키는 official_links.key 시드(마이그레이션 …32 — DB 시험 w3-search-measure가 대조), 단계는 W2-a amendment_event.stage, 원문 유형은 legal_doc.doc_type
  "calculator_card_clicked.card": ["acquisition", "property_tax", "transfer", "registration", "comprehensive", "inheritance_gift", "wetax", "nts"],
  "calculator_card_clicked.screen": ["calc", "situation"],
  "amendment_viewed.stage": ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"],
  "interpretation_viewed.doc_type": ["ruling", "circular", "interpretation", "tribunal", "case"],
} as const satisfies Record<string, readonly string[]>;

type Field =
  | { kind: "id" }
  | { kind: "count"; max: number }
  | { kind: "rank" }
  | { kind: "bool" }
  | { kind: "slug" }
  | { kind: "path" }
  | { kind: "enum"; values: readonly string[] };

interface PropSpec {
  field: Field;
  optional?: true;
}

export type SectionRule = "required" | "optional" | "none";

export interface EventSpec {
  section: SectionRule;
  props: Readonly<Record<string, PropSpec>>;
}

const id: PropSpec = { field: { kind: "id" } };
const rank: PropSpec = { field: { kind: "rank" } };
const bool: PropSpec = { field: { kind: "bool" } };
const path: PropSpec = { field: { kind: "path" } };
const count = (max: number): PropSpec => ({ field: { kind: "count", max } });
const oneOf = (values: readonly string[], optional = false): PropSpec => ({ field: { kind: "enum", values }, ...(optional ? { optional: true as const } : {}) });
const articleProps = { article_id: id, format: oneOf(FORMATS), content_type: oneOf(CONTENT_TYPES) };

/** 이벤트마다 분야 칸 규칙과 속성 칸 (설계 2.2) */
export const EVENT_SPECS: Readonly<Record<EventName, EventSpec>> = {
  home_entry_clicked: { section: "required", props: {} },
  hub_viewed: { section: "required", props: { topic: oneOf(PROP_VALUES["hub_viewed.topic"], true), category: { field: { kind: "slug" }, optional: true } } },
  article_viewed: { section: "required", props: articleProps },
  article_engaged: { section: "required", props: articleProps },
  article_shared: { section: "required", props: { article_id: id, channel: oneOf(PROP_VALUES["article_shared.channel"]) } },
  search_submitted: { section: "optional", props: { query_length: count(200), result_count: count(10_000), result_type_count: count(20), region_classified: bool } },
  glossary_opened: { section: "optional", props: { term_id: id } },
  situation_card_clicked: { section: "required", props: { situation: { field: { kind: "slug" } }, position: oneOf(PROP_VALUES["situation_card_clicked.position"]) } },
  next_action_clicked: { section: "optional", props: { action: oneOf(NEXT_ACTION_KEYS), screen: oneOf(PROP_VALUES["next_action_clicked.screen"]) } },
  hot_article_clicked: { section: "optional", props: { article_id: id, rank, pinned: bool } },
  popular_article_clicked: { section: "optional", props: { article_id: id, rank, position: oneOf(PROP_VALUES["popular_article_clicked.position"]) } },
  video_played: { section: "required", props: { article_id: id } },
  partner_content_viewed: { section: "optional", props: { partner_id: id, article_id: id } },
  signup_completed: { section: "none", props: { interest_count: count(20), region_count: count(20) } },
  brief_preregistered: { section: "optional", props: { from_path: path } },
  inquiry_submitted: { section: "none", props: { kind: oneOf(PROP_VALUES["inquiry_submitted.kind"]) } },
  policy_page_viewed: { section: "none", props: { policy: oneOf(PROP_VALUES["policy_page_viewed.policy"]) } },
  redirect_hit: { section: "none", props: { from_path: path, to_path: path } },
  not_found_viewed: { section: "none", props: { path } },
  calculator_card_clicked: {
    section: "optional",
    props: { card: oneOf(PROP_VALUES["calculator_card_clicked.card"]), screen: oneOf(PROP_VALUES["calculator_card_clicked.screen"]), rank },
  },
  amendment_viewed: { section: "required", props: { amendment_id: id, stage: oneOf(PROP_VALUES["amendment_viewed.stage"], true) } },
  interpretation_viewed: { section: "required", props: { article_id: id, doc_type: oneOf(PROP_VALUES["interpretation_viewed.doc_type"]) } },
};

export const isEventName = (v: unknown): v is EventName => typeof v === "string" && (EVENT_NAMES as readonly string[]).includes(v);
const isSection = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);

/** 맨 위 칸 — 이 밖의 칸은 400 */
export const BODY_KEYS = ["name", "section", "entry", "mode", "props", "referrer"] as const;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 100;
/** 경로 — `/`로 시작, 쿼리(?)·조각(#)·공백 없음. 한글 slug는 % 인코딩으로 온다 */
const PATH = /^\/[A-Za-z0-9/_.~%-]*$/;
const PATH_MAX = 200;
const RANK_MAX = 100;
/** 리퍼러 — 호스트 이름만 (소문자·숫자·점·하이픈) */
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function fieldError(field: Field, v: unknown): string | null {
  switch (field.kind) {
    case "id":
      return Number.isSafeInteger(v) && (v as number) >= 1 ? null : "1 이상 정수여야 합니다";
    case "count":
      return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= field.max ? null : `0~${field.max} 정수여야 합니다`;
    case "rank":
      return Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= RANK_MAX ? null : `1~${RANK_MAX} 정수여야 합니다`;
    case "bool":
      return typeof v === "boolean" ? null : "true/false여야 합니다";
    case "slug":
      return typeof v === "string" && v.length <= SLUG_MAX && SLUG.test(v) ? null : `영문 소문자·숫자·'-' ${SLUG_MAX}자 이하여야 합니다`;
    case "enum":
      return typeof v === "string" && field.values.includes(v) ? null : `${field.values.join("·")} 중 하나여야 합니다`;
    case "path": {
      if (typeof v !== "string" || v.length > PATH_MAX || !PATH.test(v)) return `'/'로 시작하는 ${PATH_MAX}자 이하 경로여야 합니다 (쿼리·조각 없음)`;
      let decoded: string;
      try {
        decoded = decodeURIComponent(v);
      } catch {
        return "경로의 % 인코딩이 틀렸습니다";
      }
      // 주소창에 사람이 넣은 개인정보(이메일·전화·주민등록번호·주소)가 경로에 섞여 오면 받지 않는다
      return detectPii(decoded.replaceAll("/", " ")).length === 0 && !decoded.includes("@") ? null : "개인정보로 보이는 글자가 있습니다";
    }
  }
}

export interface ValidEvent {
  name: EventName;
  section: SectionKey | null;
  /** 브라우저가 보낸 사이트 안 진입 경로 (없으면 null — 서버가 세션 진입 경로를 쓴다) */
  entry: (typeof CLIENT_ENTRIES)[number] | null;
  mode: Mode;
  props: Record<string, string | number | boolean>;
  /** 리퍼러 호스트 — 진입 경로 분류에만 쓰고 저장하지 않는다 */
  referrer: string | null;
}

export type EventCheck = { ok: true; event: ValidEvent } | { ok: false; errors: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 받은 본문(JSON 값) 검사 — 틀린 칸마다 "칸: 문장" (받은 값은 문장에 되풀이하지 않는다) */
export function validateEvent(body: unknown): EventCheck {
  if (!isPlainObject(body)) return { ok: false, errors: ["본문: JSON 객체여야 합니다"] };
  const errors: string[] = [];
  for (const k of Object.keys(body)) if (!(BODY_KEYS as readonly string[]).includes(k)) errors.push(`${k.slice(0, 40)}: 모르는 칸입니다`);
  const name = body.name;
  if (!isEventName(name)) return { ok: false, errors: [...errors, "name: 정해진 이벤트 이름이 아닙니다"] };
  const spec = EVENT_SPECS[name];

  let section: SectionKey | null = null;
  if (body.section === undefined || body.section === null) {
    if (spec.section === "required") errors.push("section: 이 이벤트는 분야가 필요합니다");
  } else if (spec.section === "none") errors.push("section: 이 이벤트는 분야를 받지 않습니다");
  else if (!isSection(body.section)) errors.push(`section: ${SECTION_KEYS.join("·")} 중 하나여야 합니다`);
  else section = body.section;

  let entry: ValidEvent["entry"] = null;
  if (body.entry !== undefined && body.entry !== null) {
    if (typeof body.entry === "string" && (CLIENT_ENTRIES as readonly string[]).includes(body.entry)) entry = body.entry as ValidEvent["entry"];
    else errors.push(`entry: 사이트 안 출발점(${CLIENT_ENTRIES.join("·")})만 보낼 수 있습니다`);
  }

  let mode: Mode = "general";
  if (body.mode !== undefined && body.mode !== null) {
    if (typeof body.mode === "string" && (MODES as readonly string[]).includes(body.mode)) mode = body.mode as Mode;
    else errors.push(`mode: ${MODES.join("·")} 중 하나여야 합니다`);
  }

  let referrer: string | null = null;
  if (body.referrer !== undefined && body.referrer !== null) {
    if (typeof body.referrer === "string" && HOST.test(body.referrer)) referrer = body.referrer;
    else errors.push("referrer: 호스트 이름만 보냅니다 (소문자·경로 없음)");
  }

  const props: Record<string, string | number | boolean> = {};
  const raw = body.props === undefined || body.props === null ? {} : body.props;
  if (!isPlainObject(raw)) errors.push("props: JSON 객체여야 합니다");
  else {
    for (const k of Object.keys(raw)) if (!Object.hasOwn(spec.props, k)) errors.push(`props.${k.slice(0, 40)}: 이 이벤트가 받지 않는 칸입니다`);
    for (const [k, p] of Object.entries(spec.props)) {
      const v = raw[k];
      if (v === undefined || v === null) {
        if (!p.optional) errors.push(`props.${k}: 필요합니다`);
        continue;
      }
      const problem = fieldError(p.field, v);
      if (problem) errors.push(`props.${k}: ${problem}`);
      else props[k] = v as string | number | boolean;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, event: { name, section, entry, mode, props, referrer } };
}
