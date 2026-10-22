// 지자체 허브 블록 (W4 4단계 — LG-08 · REG1-02 · REG-06 · REG-10) — 순수 모듈 (시험 region-hub-logic.test.ts).
// docs/dev/W4_설계.md 1장 4단계 · 2.1(local_hub.block) · 2.2(local_block_fields) · 2.3 · 2.8:
//  · 블록 다섯 자리는 코드 고정 — ① 금주 핫뉴스 ② 지방세·지방재정 ③ 부동산·개발 ④ 행사안내 ⑤ 공식 자료/해설. 순서를 바꾸는 설정 0
//  · ①④는 W6(기능 키 weekly_digest·local_events) — W4에서는 키가 켜져도 그리는 것 0
//  · ②③에 담는 편집 분야는 설정 local_block_fields (REG1-02 초기값 — DB 트리거와 같은 검사). 모양이 틀리면 닫힌 쪽(블록 ②③ 0)
//  · 분야 필터 ?topic= — 고른 분야를 담는 블록에 그 분야 기사만, 그 분야를 담지 않는 기사 블록은 0. 목록 밖 값은 전체
//  · 시·군·구 블록이 0건이면 상위 시·도 기사 + "○○ 기사가 없어 ○○ 기사를 보입니다", 상위도 0이면 0건 문장 (빈 카드·'준비 중' 0)
//  · ⑤ 공식 자료/해설 (9단계) — 검수 공식 자료 카드(≤ 6, 묶음 '공식 자료 원문') + 감수 해설(≤ 3, 묶음 '감수 해설'). 둘 다 0이면 블록째 0건 문장(2.8).
//    분야 필터와 상관없이 그대로(4단계 #37). 고르는 규칙은 region-official-logic.ts
//  · 데이터 출처 줄 — 블록에 공식 자료 카드가 있으면 "출처 ○○ · 기준일 · 정보 확인일"(가장 이른 기준일·확인일), 0이면 "출처 편집국" + 블록 기사의 최신 발행일
import type { LocalTopic } from "@ltr/ui";
import type { ArticleListItem } from "./cards";
import { LIMITS, LOCAL_TOPICS } from "./constants";
import type { ProjectCard } from "./project-logic";
import type { SupplyCard } from "./supply-logic";
import { issuerSummary, type RegionOfficialCard } from "./region-official-logic";

/** 블록 다섯 자리 (설계 2.1 local_hub.block — 순서 고정) */
export const LOCAL_HUB_BLOCKS = ["weekly", "local_tax", "realestate", "events", "official"] as const;
export type LocalHubBlock = (typeof LOCAL_HUB_BLOCKS)[number];

/** 블록 글자 (설계 2.1 local_hub.block 글자 — 화면 블록 제목, @ltr/ui LocalHubBlocks와 같다) */
export const LOCAL_HUB_BLOCK_LABELS: Readonly<Record<LocalHubBlock, string>> = {
  weekly: "금주 핫뉴스",
  local_tax: "지방세·지방재정",
  realestate: "부동산·개발",
  events: "행사안내",
  official: "공식 자료/해설",
};

/** 편집 분야 기사를 담는 블록 — 설정 local_block_fields의 칸 */
export const ARTICLE_BLOCKS = ["local_tax", "realestate"] as const;
export type ArticleBlock = (typeof ARTICLE_BLOCKS)[number];

export type LocalBlockFields = Readonly<Record<ArticleBlock, readonly LocalTopic[]>>;

const EDITORIAL_FIELDS: readonly LocalTopic[] = LOCAL_TOPICS.map((t) => t.topic);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 설정 local_block_fields 검사 — DB 트리거(…40 local_block_fields_guard)와 같은 규칙. 관리자 설정 화면이 같은 함수로 거른다.
 * 객체 · 칸은 local_tax·realestate 둘 다 · 블록마다 편집 분야 1개 이상 · 같은 값 두 번 0 · 한 편집 분야는 한 블록에만
 */
export function localBlockFieldsErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 JSON 객체여야 합니다 — { "local_tax": [...], "realestate": [...] }'];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (!(ARTICLE_BLOCKS as readonly string[]).includes(k)) errors.push(`${k}: 블록은 local_tax(지방세·지방재정)·realestate(부동산·개발)만 씁니다 — 블록 순서는 설정이 아닙니다 (LG-08)`);
  const seen = new Map<string, ArticleBlock>();
  for (const block of ARTICLE_BLOCKS) {
    const list = value[block];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${block}: 편집 분야가 1개 이상 필요합니다`);
      continue;
    }
    list.forEach((f, i) => {
      if (typeof f !== "string" || !(EDITORIAL_FIELDS as readonly string[]).includes(f)) return errors.push(`${block}[${i}]: ${EDITORIAL_FIELDS.join("·")} 중 하나여야 합니다`);
      if (seen.has(f)) return errors.push(`${block}[${i}]: 편집 분야 ${f}는 한 블록에 한 번만 씁니다 (지금 ${seen.get(f)}에도 있음)`);
      seen.set(f, block);
    });
  }
  return errors;
}

/** 설정 값 → 블록별 편집 분야. 없거나 모양이 틀리면 null — 기사 블록 ②③을 그리지 않는다(닫힌 쪽) */
export function parseLocalBlockFields(value: unknown): LocalBlockFields | null {
  if (localBlockFieldsErrors(value).length) return null;
  const v = value as Record<ArticleBlock, LocalTopic[]>;
  return { local_tax: [...v.local_tax], realestate: [...v.realestate] };
}

/** 블록이 담을 편집 분야 — 전체 보기면 대응 그대로, 분야를 고르면 그 분야가 대응에 있을 때 그 분야 하나(아니면 0 → 블록 0) */
export function blockTopics(fields: LocalBlockFields, block: ArticleBlock, topic: LocalTopic | null): LocalTopic[] {
  if (topic === null) return [...fields[block]];
  return fields[block].includes(topic) ? [topic] : [];
}

/** 블록에 담을 기사 — 지자체뉴스 분야이고 편집 분야가 블록 대응 안인 기사만, 블록마다 LIMITS.localBlock장 (대응 밖 기사 0) */
export function pickBlock(items: readonly ArticleListItem[], topics: readonly string[]): ArticleListItem[] {
  return items.filter((a) => a.section === "local" && a.editorialField !== null && topics.includes(a.editorialField)).slice(0, LIMITS.localBlock);
}

/** 대체 표시 문장 (설계 1장 4단계 "○○ 기사가 없어 ○○ 기사를 보입니다" — REG-06) */
export function fallbackNotice(from: string, to: string): string {
  return `${from} 기사가 없어 ${to} 기사를 보입니다`;
}

/** 0건 문장 — 상위 지역에도 기사가 없을 때 (빈 카드·'준비 중' 0 — REG1-02). 분야를 골랐으면 그 분야 이름으로 */
export function blockEmptyText(block: ArticleBlock | "official", topic: LocalTopic | null): string {
  if (block === "official") return "아직 확인된 공식 자료·감수 해설이 없습니다.";
  const name = topic ? (LOCAL_TOPICS.find((t) => t.topic === topic)?.label ?? LOCAL_HUB_BLOCK_LABELS[block]) : LOCAL_HUB_BLOCK_LABELS[block];
  return `아직 공개된 ${name} 기사가 없습니다.`;
}

export interface RegionHubBlock {
  key: Exclude<LocalHubBlock, "weekly" | "events">;
  title: string;
  /** 보이는 기사 카드 — 0이면 empty 문장. ⑤는 감수 해설 */
  items: ArticleListItem[];
  /** ⑤ 검수 공식 자료 카드 (기사 블록은 빈 목록) */
  sources: RegionOfficialCard[];
  /** ③ 프로젝트 카드 (W4 15단계 — 다른 블록은 빈 목록, 기능 키가 꺼지면 빈 목록) */
  projects: ProjectCard[];
  /** ③ 프로젝트가 더 있으면 목록(지역 거르개) 주소 */
  projectsMore: string | null;
  /** ③ 분양 정보 카드 (W4 17단계 — 청약 마감 전 항목, 다른 블록은 빈 목록, 기능 키 supply_notices가 꺼지면 빈 목록) */
  supply: SupplyCard[];
  /** ③ 분양 정보가 더 있으면 목록(지역 거르개) 주소 */
  supplyMore: string | null;
  /** 상위 시·도 기사를 보이는 중 — 그 사실 문장 */
  fallbackNotice: string | null;
  /** 0건 문장 */
  empty: string | null;
}

export type BlockArticles = Partial<Record<ArticleBlock, readonly ArticleListItem[]>>;

/** ③ 프로젝트 카드 — 그 지역 범위의 공개 프로젝트(12장 #120) */
export interface RegionProjects {
  cards: readonly ProjectCard[];
  more: string | null;
}

/** ③ 분양 정보 카드 — 그 지역 범위의 청약 마감 전 공개 항목(W4 17단계 · 12장 #143) */
export interface RegionSupply {
  cards: readonly SupplyCard[];
  more: string | null;
}

/**
 * 지역 허브 블록 (②③⑤ — ①④는 W6). 시·도 허브는 sigunguName = null(대체 표시 없음).
 *  · own = 그 지역 범위 기사(시·도 = 자기 + 하위 태그, 시·군·구 = 자기 태그 — 12장 #26), parent = 상위 시·도 범위 기사(시·군·구 허브만)
 *  · fields가 null(설정을 읽지 못함·모양 틀림)이면 기사 블록 0 — ⑤만
 */
export function regionHubBlocks(input: {
  fields: LocalBlockFields | null;
  topic: LocalTopic | null;
  sidoName: string;
  sigunguName: string | null;
  own: BlockArticles;
  parent: BlockArticles;
  /** ⑤ 검수 공식 자료 카드·감수 해설 — 없으면 0건 문장 */
  official?: { cards: readonly RegionOfficialCard[]; explainers: readonly ArticleListItem[] };
  /** ③ 프로젝트 카드 (W4 15단계) — 상위 시·도 대체 없음(그 지역 범위만) */
  projects?: RegionProjects;
  /** ③ 분양 정보 카드 (W4 17단계) — 상위 시·도 대체 없음(그 지역 범위만) */
  supply?: RegionSupply;
}): RegionHubBlock[] {
  const out: RegionHubBlock[] = [];
  if (input.fields) {
    for (const block of ARTICLE_BLOCKS) {
      const topics = blockTopics(input.fields, block, input.topic);
      if (topics.length === 0) continue; // 고른 분야를 담지 않는 블록 — 블록 0 (다른 분야 기사 0)
      const own = pickBlock(input.own[block] ?? [], topics);
      const parent = input.sigunguName !== null && own.length === 0 ? pickBlock(input.parent[block] ?? [], topics) : [];
      const items = own.length ? own : parent;
      const projects = block === "realestate" ? [...(input.projects?.cards ?? [])] : [];
      const supply = block === "realestate" ? [...(input.supply?.cards ?? [])] : [];
      out.push({
        key: block,
        title: LOCAL_HUB_BLOCK_LABELS[block],
        items,
        sources: [],
        projects,
        projectsMore: projects.length ? (input.projects?.more ?? null) : null,
        supply,
        supplyMore: supply.length ? (input.supply?.more ?? null) : null,
        fallbackNotice: own.length === 0 && parent.length > 0 ? fallbackNotice(input.sigunguName!, input.sidoName) : null,
        empty: items.length === 0 ? blockEmptyText(block, input.topic) : null,
      });
    }
  }
  // ⑤ 공식 자료/해설 — 검수 공식 자료 카드 + 감수 해설. 둘 다 0이면 블록째 0건 문장 (2.8)
  const sources = [...(input.official?.cards ?? [])];
  const explainers = [...(input.official?.explainers ?? [])];
  out.push({
    key: "official",
    title: LOCAL_HUB_BLOCK_LABELS.official,
    items: explainers,
    sources,
    projects: [],
    projectsMore: null,
    supply: [],
    supplyMore: null,
    fallbackNotice: null,
    empty: sources.length || explainers.length ? null : blockEmptyText("official", input.topic),
  });
  return out;
}

/** 그 지역 범위에 고른 분야 기사가 있는가 — 분야를 골랐는데 0이면 그 주소는 noindex (CAT-02 '빈 목록 색인 0') */
export function topicHasOwnArticles(fields: LocalBlockFields | null, topic: LocalTopic, own: BlockArticles): boolean {
  if (!fields) return false;
  return ARTICLE_BLOCKS.some((b) => blockTopics(fields, b, topic).length > 0 && pickBlock(own[b] ?? [], [topic]).length > 0);
}

/** 데이터 출처 줄 — 편집국 기사만(최신 발행일) 또는 공식 자료(가장 이른 기준일·확인일) */
export type RegionSourceLine =
  | {
      source: string;
      /** 블록 기사의 최신 발행일 (한국 날짜) — 기사도 0이면 null */
      latestPublished: string | null;
    }
  | {
      source: string;
      /** 블록에 쓰인 공식 자료 중 가장 이른 기준일 */
      baseDate: string;
      /** 블록에 쓰인 공식 자료 중 가장 이른 확인일 (REG-10 '정보 확인일') */
      checkedAt: string;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const earliest = (dates: readonly string[]) => dates.reduce((a, b) => (b < a ? b : a));

/** 데이터 출처 줄 (REG-10 · 2.8) — 공식 자료 카드가 있으면 그 발표기관·가장 이른 기준일·확인일, 없으면 편집국 + 블록 기사의 최신 발행일 */
export function regionSourceLine(blocks: readonly RegionHubBlock[]): RegionSourceLine {
  return sourceLineOf(
    blocks.flatMap((b) => b.sources),
    blocks.flatMap((b) => b.items),
  );
}

/** 데이터 출처 줄 — 화면에 쓰인 공식 자료 카드와 기사 카드로 (지역 허브·/local 전국 화면이 같은 규칙) */
export function sourceLineOf(cards: readonly RegionOfficialCard[], items: readonly Pick<ArticleListItem, "publishedOn">[]): RegionSourceLine {
  if (cards.length) {
    return { source: issuerSummary(cards), baseDate: earliest(cards.map((c) => c.referenceDate)), checkedAt: earliest(cards.map((c) => c.verifiedOn)) };
  }
  const dates = items.map((a) => a.publishedOn).filter((d) => ISO_DATE.test(d));
  return { source: "편집국", latestPublished: dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null };
}

export interface LocalBlocks {
  /** ② 지방세·지방재정 */
  localTax: ArticleListItem[];
  /** ③ 부동산·개발 */
  realEstate: ArticleListItem[];
  /** ⑤ 공식 자료/해설 (W4 9단계 — 전국 검수 공식 자료·감수 해설). 둘 다 0이면 null — /local은 0건 블록을 숨긴다 */
  official: { cards: RegionOfficialCard[]; explainers: ArticleListItem[] } | null;
}

/**
 * 지자체뉴스 허브(/local — W2-b · W4 9단계 전국 화면) 블록 ②③⑤ — ②③은 대응 설정의 편집 분야 기사만, 블록마다 4장(설정이 없으면 ②③ 0 — 닫힌 쪽),
 * ⑤는 검수 공식 자료·감수 해설(있을 때만). 셋 다 0건이면 null (블록 자리째 없다)
 */
export function localBlocks(
  fields: LocalBlockFields | null,
  localTax: readonly ArticleListItem[],
  realEstate: readonly ArticleListItem[],
  official?: { cards: readonly RegionOfficialCard[]; explainers: readonly ArticleListItem[] } | null,
): LocalBlocks | null {
  const blocks: LocalBlocks = {
    localTax: fields ? pickBlock(localTax, fields.local_tax) : [],
    realEstate: fields ? pickBlock(realEstate, fields.realestate) : [],
    official: official && (official.cards.length || official.explainers.length) ? { cards: [...official.cards], explainers: [...official.explainers] } : null,
  };
  return blocks.localTax.length || blocks.realEstate.length || blocks.official ? blocks : null;
}
