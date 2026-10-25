// 측정 이벤트 이름·속성 규칙 (FND-06 · GROW-01 · PRD-01A 12장) — docs/dev/W2-c_설계.md 2.1·2.2·2.3과 같다 (시험 events.test.ts가 설계 문서를 읽어 대조한다).
// 순수 모듈 — 수집 API(서버)가 받은 본문을 이 규칙으로만 검사한다. 이벤트마다 정해진 속성 칸만 받고, 검색어·질문 원문·계산 입력값·이메일·주소를 담을 칸은 없다.
import { CONTENT_TYPES, FORMATS, detectPii } from "@ltr/editorial";
import { NEXT_ACTION_KEYS, SECTION_KEYS, type SectionKey } from "@/lib/server/public/constants";

/** 이벤트 이름 82종 (PRD-01A 12장 19종 + W3 10단계 3종 + W4 24단계 7종 + W8 2종 + W10 34종 + W10-i 4종 + W11 13종 — DB check 제약 analytics_events.name과 같다) */
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
  // W4 24단계 (docs/dev/W4_설계.md 2.5) — 지역 허브 열람 · 지역 기사·공식 자료 열기 · 지역 → 세금/부동산 이동 · 프로젝트·개발방법 열람
  "region_viewed",
  "regional_news_opened",
  "regional_source_opened",
  "region_to_tax_clicked",
  "region_to_realestate_clicked",
  "project_viewed",
  "dev_method_viewed",
  // W8 2단계 (docs/dev/W8_설계.md 2장) — 자사 상품·스토어 카드 누름 · 주문 링크/문의 누름
  "product_clicked",
  "order_link_clicked",
  // W10 0차 (PRD-02 11장 · 2단계 설계 2.3) - 계산기·감면·환급·위택스·법령·해석 DB·브리핑·알림·결제 측정. 입력값·금액·이메일·카드 칸 없음
  "calc_started",
  "calc_completed",
  "calc_step_viewed",
  "calc_step_left",
  "calc_compared",
  "calc_compare_gated",
  "reduction_shown",
  "reduction_expanded",
  "refund_diagnosed",
  "wetax_handoff",
  "external_calculator_opened",
  "calc_offline_used",
  "calendar_exported",
  "accuracy_viewed",
  "content_to_tool",
  "law_viewed",
  "related_panel_opened",
  "case_viewed",
  "brief_subscribe_viewed",
  "brief_subscribed",
  "brief_confirmed",
  "brief_opened",
  "brief_unsubscribed",
  "brief_link_visited",
  "review_decided",
  "sm_calculator_opened",
  "amendment_alert_subscribed",
  "amendment_alert_sent",
  "paywall_viewed",
  "subscription_started",
  "subscription_cancelled",
  "order_paid",
  "certificate_issued",
  "training_quote_requested",
  // W10-i (docs/dev/W10-i_설계.md 3장) - 바로가기 클릭 · 이번 주 재테크 포인트 열람 · 캠페인 랜딩 열람 · 캠페인 버튼 클릭. 캠페인 태그는 등록 값만, 클릭 ID·자유 글자 칸 없음
  "shortcut_clicked",
  "realestate_weekly_viewed",
  "campaign_landing_viewed",
  "campaign_cta_clicked",
  // W11 0차 (PRD-03 12장 · 3단계 설계 2.1) - 가이드·판정·총비용·상속증여 다음 확인·정비 단계/구역·쟁점 지도·조례·기관 문의·리포트·좌석 측정. 입력값·금액·기관명·이메일 칸 없음
  "guide_viewed",
  "determination_completed",
  "total_cost_started",
  "total_cost_completed",
  "family_next_check_opened",
  "step_viewed",
  "zone_viewed",
  "issue_map_viewed",
  "issue_map_source_opened",
  "ordinance_viewed",
  "institution_inquiry_sent",
  "premium_report_viewed",
  "org_seat_invited",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const MODES = ["general", "expert"] as const;
export type Mode = (typeof MODES)[number];
/** 회원 등급 — 비회원·일반·프리미엄·기관 좌석 (PRD-00 6장, 설계 9장 #12) */
export const TIERS = ["guest", "basic", "premium", "institution"] as const;
export type Tier = (typeof TIERS)[number];
/** 진입 경로 (PRD-00 13장 + 그 밖의 사이트 — 설계 9장 #6) */
export const ENTRIES = ["search", "ai_answer_engine", "naver", "brief", "assistant", "experts", "tax_lens", "campaign", "direct", "referral"] as const;
export type Entry = (typeof ENTRIES)[number];
/** 브라우저가 정해 보내도 되는 진입 경로 — 사이트 안 출발점만. 바깥 진입 경로(검색·네이버·AI)는 서버가 리퍼러로 정한다 */
export const CLIENT_ENTRIES = ["assistant", "experts", "tax_lens", "campaign"] as const satisfies readonly Entry[];

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
  "calculator_card_clicked.card": ["acquisition", "property_tax", "transfer", "registration", "comprehensive", "inheritance_gift", "wetax", "nts", "nts_guide", "law_info_center", "edu"],
  "calculator_card_clicked.screen": ["calc", "situation", "inheritance_gift", "project", "region_hub", "dev_method"],
  "amendment_viewed.stage": ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"],
  "interpretation_viewed.doc_type": ["ruling", "circular", "interpretation", "tribunal", "case"],
  // W4 24단계 — 행정구역 단계 = region.level · 편집 분야 = editorial_field · 자료 종류 = official_source_type(허용) · 개발방법 키 = dev_method.slug (W4 설계 2.1)
  "region_viewed.level": ["sido", "sigungu"],
  "regional_news_opened.field": ["local_tax", "realestate", "local_finance", "urban_policy"],
  "regional_source_opened.source_type": ["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"],
  "region_to_tax_clicked.target": ["situation", "explainer", "official_source"],
  "region_to_realestate_clicked.target": ["project", "project_list", "supply", "supply_list"],
  // W8 2단계 — 위치는 product_links.placement(article·home) + 스토어 목록, 주문 방식은 products.order_mode (설계 W8 2장)
  "product_clicked.placement": ["article", "home", "store"],
  "order_link_clicked.placement": ["article", "home", "store"],
  "order_link_clicked.mode": ["existing_channel", "request_form"],
  "dev_method_viewed.method": ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"],
  // W10 0차 - PRD-02 11장 이벤트 속성의 값 목록 (W2-c 설계 2.3)
  // W10-i - 바로가기 위치·도착 키(HEADER_SHORTCUTS)와 캠페인 버튼 종류
  "shortcut.placement": ["header", "home"],
  "shortcut.key": ["calc", "expert_request", "brief_weekly", "realestate_weekly"],
  "campaign.cta": ["primary", "secondary"],
  "calc.tool": ["acquisition", "holding", "refund", "compare"],
  "calc.input_mode": ["wizard", "form"],
  "calc.entry_path": ["home_card", "hub", "article", "tax_lens", "search", "region_hub", "assistant", "direct", "shortcut", "campaign"],
  "calc.screen": ["calc_index", "acquisition_result", "holding_result", "refund_result", "situation", "region_hub"],
  "calc.tax_kind": ["acquisition", "property", "comprehensive", "vehicle", "refund"],
  "link.state": ["ok", "fallback"],
  "accuracy.via": ["badge", "hub"],
  "view.duration_band": ["under_10", "10_to_30", "over_30"],
  "content.kind": ["article", "tax_lens", "solution_case", "glossary", "situation", "search", "region_hub"],
  "law.view": ["single", "three"],
  "panel.tab": ["law", "ruling", "circular", "interpretation", "tribunal", "case"],
  "panel.place": ["law_view", "three_view"],
  "case.doc_type": ["ruling", "circular", "interpretation", "tribunal", "case"],
  "case.origin": ["search", "panel", "article"],
  "brief.route": ["page", "article", "home", "footer", "assistant"],
  "brief.unsubscribe_route": ["mail_link", "manage"],
  "tenure.band": ["under_30", "30_to_90", "over_90"],
  "review.result": ["approved", "rejected", "held"],
  "review.duration_band": ["under_15", "15_to_60", "over_60"],
  "amendment_alert_sent.stage": ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"],
  "paywall.content_type": ["digital_edition", "archive", "deep_commentary", "premium_brief"],
  "paywall.via": ["article", "column", "brief", "search", "ai_search", "naver", "assistant", "expert_profile"],
  "billing.period": ["monthly", "yearly"],
  "order.product_kind": ["digital", "print", "course", "seminar"],
  "training.org_type": ["public", "corporate", "association", "other"],
  // W11 0차 - PRD-03 12장 이벤트 속성의 값 목록 (W2-c 설계 2.3). 판정 종류는 판정표 kind(마이그레이션 112), 쟁점 관계는 issue_graphs relation, 조례 종류는 ordinance_links.kind
  "guide.hub": ["realestate_tax", "trust", "redevelopment", "finance_tax"],
  "guide.tax_scope": ["local", "national", "both"],
  "determination.kind": ["house_count", "trust_taxpayer", "redevelopment_right", "house_count_inheritance", "house_count_gift", "redevelopment_tax", "trust_acquisition"],
  "total_cost.entry_path": ["realestate_tax", "calc_index", "article", "situation", "direct"],
  "family_next.from": ["guide_page", "situation_page", "acquisition_result"],
  "family_next.target": ["house_count", "holding_tax", "transfer_guide"],
  "zone.entry": ["dev_method_compare", "local_hub_block"],
  "issue_map.entry": ["hub", "guide", "case_list", "direct"],
  "issue_map.relation": ["delegation", "mutatis", "requirement", "precedent"],
  "ordinance.kind": ["urban_redevelopment", "tax_reduction", "tax_rate"],
  "ordinance.entry": ["local_hub", "tax_hub", "realestate_hub"],
  "institution.org_type": ["local_government", "tax_firm", "financial_institution"],
} as const satisfies Record<string, readonly string[]>;

type Field =
  | { kind: "id" }
  | { kind: "count"; max: number }
  | { kind: "rank" }
  | { kind: "bool" }
  | { kind: "slug" }
  | { kind: "path" }
  | { kind: "region" }
  | { kind: "key" }
  | { kind: "version" }
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
/** 지역 코드 — regions.code (법정동코드 10자리) */
const region: PropSpec = { field: { kind: "region" } };
/** 설정 키 — 프로젝트 사업 유형·단계 (영문 소문자로 시작, 소문자·숫자·_ 2~40자) */
const key: PropSpec = { field: { kind: "key" } };
/** 룰셋·판정표 버전 - YYYY.NN (RULE-01) */
const version: PropSpec = { field: { kind: "version" } };
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
  region_viewed: { section: "required", props: { region_code: region, level: oneOf(PROP_VALUES["region_viewed.level"]) } },
  regional_news_opened: { section: "required", props: { region_code: region, field: oneOf(PROP_VALUES["regional_news_opened.field"]) } },
  regional_source_opened: { section: "required", props: { region_code: region, source_type: oneOf(PROP_VALUES["regional_source_opened.source_type"]) } },
  region_to_tax_clicked: { section: "required", props: { region_code: region, target: oneOf(PROP_VALUES["region_to_tax_clicked.target"]) } },
  region_to_realestate_clicked: { section: "required", props: { region_code: region, target: oneOf(PROP_VALUES["region_to_realestate_clicked.target"]) } },
  project_viewed: { section: "required", props: { region_code: region, project_type: key, stage: key } },
  product_clicked: { section: "optional", props: { product_id: id, placement: oneOf(PROP_VALUES["product_clicked.placement"]), article_id: { ...id, optional: true } } },
  order_link_clicked: {
    section: "optional",
    props: { product_id: id, placement: oneOf(PROP_VALUES["order_link_clicked.placement"]), mode: oneOf(PROP_VALUES["order_link_clicked.mode"]), article_id: { ...id, optional: true } },
  },
  dev_method_viewed: { section: "required", props: { method: oneOf(PROP_VALUES["dev_method_viewed.method"]) } },
  calc_started: { section: "optional", props: { tool: oneOf(PROP_VALUES["calc.tool"]), input_mode: oneOf(PROP_VALUES["calc.input_mode"]), entry_path: oneOf(PROP_VALUES["calc.entry_path"]) } },
  calc_completed: { section: "optional", props: { tool: oneOf(PROP_VALUES["calc.tool"]), input_mode: oneOf(PROP_VALUES["calc.input_mode"]), entry_path: oneOf(PROP_VALUES["calc.entry_path"]), elapsed_sec: count(3600) } },
  calc_step_viewed: { section: "optional", props: { tool: oneOf(PROP_VALUES["calc.tool"]), step: count(50), unsure: bool } },
  calc_step_left: { section: "optional", props: { tool: oneOf(PROP_VALUES["calc.tool"]), step: count(50), unsure: bool } },
  calc_compared: { section: "optional", props: { condition_count: count(10) } },
  calc_compare_gated: { section: "optional", props: {  } },
  reduction_shown: { section: "optional", props: { reduction_id: key, table_version: version } },
  reduction_expanded: { section: "optional", props: { reduction_id: key, table_version: version } },
  refund_diagnosed: { section: "optional", props: { high_count: count(10), check_count: count(10), low_count: count(10) } },
  wetax_handoff: { section: "optional", props: { from_screen: oneOf(PROP_VALUES["calc.screen"]), tax_kind: oneOf(PROP_VALUES["calc.tax_kind"]), wetax_menu: key } },
  external_calculator_opened: { section: "optional", props: { from_screen: oneOf(PROP_VALUES["calc.screen"]), link_state: oneOf(PROP_VALUES["link.state"]) } },
  calc_offline_used: { section: "optional", props: { tool: oneOf(PROP_VALUES["calc.tool"]), ruleset_version: version } },
  calendar_exported: { section: "optional", props: { year: count(2100), item_count: count(500) } },
  accuracy_viewed: { section: "optional", props: { via: oneOf(PROP_VALUES["accuracy.via"]) } },
  content_to_tool: { section: "optional", props: { content_kind: oneOf(PROP_VALUES["content.kind"]), tool: oneOf(PROP_VALUES["calc.tool"]), region_code: { ...region, optional: true as const } } },
  law_viewed: { section: "optional", props: { law_id: id, as_of_used: bool, view: oneOf(PROP_VALUES["law.view"]), duration_band: oneOf(PROP_VALUES["view.duration_band"]) } },
  related_panel_opened: { section: "optional", props: { tab: oneOf(PROP_VALUES["panel.tab"]), place: oneOf(PROP_VALUES["panel.place"]) } },
  case_viewed: { section: "optional", props: { doc_type: oneOf(PROP_VALUES["case.doc_type"]), origin: oneOf(PROP_VALUES["case.origin"]), duration_band: oneOf(PROP_VALUES["view.duration_band"]) } },
  brief_subscribe_viewed: { section: "none", props: { route: oneOf(PROP_VALUES["brief.route"]) } },
  brief_subscribed: { section: "none", props: { route: oneOf(PROP_VALUES["brief.route"]) } },
  brief_confirmed: { section: "none", props: { route: oneOf(PROP_VALUES["brief.route"]) } },
  shortcut_clicked: { section: "none", props: { placement: oneOf(PROP_VALUES["shortcut.placement"]), shortcut: oneOf(PROP_VALUES["shortcut.key"]) } },
  realestate_weekly_viewed: { section: "none", props: { issue_id: id } },
  campaign_landing_viewed: { section: "none", props: { campaign: { field: { kind: "slug" } }, source: { field: { kind: "slug" } }, medium: { field: { kind: "slug" } } } },
  campaign_cta_clicked: { section: "none", props: { campaign: { field: { kind: "slug" } }, cta: oneOf(PROP_VALUES["campaign.cta"]), destination: oneOf(PROP_VALUES["shortcut.key"]) } },
  brief_opened: { section: "none", props: {  } },
  brief_unsubscribed: { section: "none", props: { route: oneOf(PROP_VALUES["brief.unsubscribe_route"]), tenure_band: oneOf(PROP_VALUES["tenure.band"]) } },
  brief_link_visited: { section: "none", props: { issue_id: id, corner: key } },
  review_decided: { section: "none", props: { job: key, duration_band: oneOf(PROP_VALUES["review.duration_band"]), result: oneOf(PROP_VALUES["review.result"]) } },
  sm_calculator_opened: { section: "optional", props: { from_screen: oneOf(PROP_VALUES["calc.screen"]), tax_kind: oneOf(PROP_VALUES["calc.tax_kind"]), link_state: oneOf(PROP_VALUES["link.state"]) } },
  amendment_alert_subscribed: { section: "optional", props: { tax_count: count(20), item_count: count(50) } },
  amendment_alert_sent: { section: "optional", props: { stage: oneOf(PROP_VALUES["amendment_alert_sent.stage"]) } },
  paywall_viewed: { section: "optional", props: { content_type: oneOf(PROP_VALUES["paywall.content_type"]), via: oneOf(PROP_VALUES["paywall.via"]) } },
  subscription_started: { section: "none", props: { product_id: id, period: oneOf(PROP_VALUES["billing.period"]), via: oneOf(PROP_VALUES["paywall.via"]) } },
  subscription_cancelled: { section: "none", props: { product_id: id, tenure_band: oneOf(PROP_VALUES["tenure.band"]) } },
  order_paid: { section: "none", props: { product_kind: oneOf(PROP_VALUES["order.product_kind"]), via: oneOf(PROP_VALUES["paywall.via"]) } },
  certificate_issued: { section: "none", props: { course_id: id } },
  training_quote_requested: { section: "none", props: { org_type: oneOf(PROP_VALUES["training.org_type"]) } },
  guide_viewed: { section: "optional", props: { hub: oneOf(PROP_VALUES["guide.hub"]), topic: key, tax_scope: oneOf(PROP_VALUES["guide.tax_scope"]) } },
  determination_completed: { section: "optional", props: { kind: oneOf(PROP_VALUES["determination.kind"]) } },
  total_cost_started: { section: "optional", props: { entry_path: oneOf(PROP_VALUES["total_cost.entry_path"]) } },
  total_cost_completed: { section: "optional", props: { entry_path: oneOf(PROP_VALUES["total_cost.entry_path"]), compare_used: bool } },
  family_next_check_opened: { section: "optional", props: { from_screen: oneOf(PROP_VALUES["family_next.from"]), target: oneOf(PROP_VALUES["family_next.target"]) } },
  step_viewed: { section: "optional", props: { stage: key } },
  zone_viewed: { section: "optional", props: { region_code: region, project_type: key, entry: oneOf(PROP_VALUES["zone.entry"]) } },
  issue_map_viewed: { section: "optional", props: { issue: { field: { kind: "slug" } }, entry: oneOf(PROP_VALUES["issue_map.entry"]) } },
  issue_map_source_opened: { section: "optional", props: { issue: { field: { kind: "slug" } }, law_id: id, relation: oneOf(PROP_VALUES["issue_map.relation"]) } },
  ordinance_viewed: { section: "optional", props: { region_code: region, kind: oneOf(PROP_VALUES["ordinance.kind"]), entry: oneOf(PROP_VALUES["ordinance.entry"]) } },
  institution_inquiry_sent: { section: "none", props: { product_id: id, org_type: oneOf(PROP_VALUES["institution.org_type"]) } },
  premium_report_viewed: { section: "none", props: { report_id: id, seated: bool } },
  org_seat_invited: { section: "none", props: { org_type: oneOf(PROP_VALUES["institution.org_type"]) } },
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
const REGION_CODE = /^[0-9]{10}$/;
const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const VERSION = /^[0-9]{4}\.[0-9]{2}$/;
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
    case "region":
      return typeof v === "string" && REGION_CODE.test(v) ? null : "지역 코드(숫자 10자리)여야 합니다";
    case "key":
      return typeof v === "string" && KEY.test(v) ? null : "영문 소문자로 시작하는 소문자·숫자·'_' 2~40자 키여야 합니다";
    case "version":
      return typeof v === "string" && VERSION.test(v) ? null : "버전(YYYY.NN)이어야 합니다";
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
