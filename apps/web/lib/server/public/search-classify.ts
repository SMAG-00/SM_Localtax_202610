// 지역 + 주제 검색 분류 (W4 10단계 — PRD-01B REG-08 · REG1-11, docs/dev/W4_설계.md 1장 10단계 · 2.1 search.topic · 2.2 search_topics · 2.9 · 12장 #29) — 순수 모듈.
// DB 함수 public.search_classify(…45)와 같은 규칙이다 — 설계 2.9 견본 표(실제 이름 사전)·2.9.1 표(가짜 지역 접두 99)를 이 시험(search-classify.test.ts)과
// DB 시험(packages/db/tests/w4-search-topics.test.mjs)이 함께 지난다. 검색 결과 차례(지역 허브 첫 결과·그 지역 태그 기사)는 DB 검색 함수가 정하고,
// 여기 규칙은 화면·API가 쓴다: 분류 글자 줄 · search_submitted.region_classified · 결과 0건 제안(상위 지역·다른 표기).
//  · 낱말 = 검색어를 W2-d 4장 규칙으로 정규화·붙인 낱말(queryTerms — 앞 8개)
//  · 왼쪽부터 이웃 낱말 1~3개를 이은 정규형이 ① 오늘(한국 날짜) 유효한 지역의 이름·별칭과 같으면 지역 ② 주제 사전의 글자·별칭과 같으면 주제 —
//    긴 묶음 먼저, 같은 길이면 지역 먼저. 어디에도 없으면 남은 낱말(사전 밖 낱말 — '강릉 축제'의 '축제'는 주제 0)
//  · 지역 후보 — 시·도와 시·군·구가 함께 잡히면 그 시·도 아래 시·군·구만(없으면 모두). 둘 이상이면 하나로 정하지 않는다(동명 — 후보 모두)
import { SEARCH_LIMITS, queryTerms, squash } from "./search-normalize";

/** 주제 키 (설계 2.1 search.topic — 차례 고정, DB c_topic_keys와 같다) */
export const SEARCH_TOPICS = ["acquisition_tax", "property_tax", "inheritance_gift", "realestate_transaction", "redevelopment", "local_finance"] as const;
export type SearchTopic = (typeof SEARCH_TOPICS)[number];

/** 주제 사전 한도 (DB search_topics_guard와 같다) — 글자·별칭 글자 수, 별칭 개수, 정규형 최소 글자 */
export const SEARCH_TOPIC_LIMITS = { labelChars: 20, aliases: 20, aliasChars: 20, minKeyChars: 2 } as const;

/** 이어 읽는 이웃 낱말 수 (DB c_max_span과 같다 — '부동산 거래'·'상속·증여'·'성남시 분당구'처럼 띄어 쓴 이름·주제) */
export const CLASSIFY_MAX_SPAN = 3;

export interface SearchTopicEntry {
  /** 화면 글자 */
  label: string;
  /** 같은 주제로 읽는 다른 표기 (편집국이 더한다) */
  aliases: string[];
}
export type SearchTopicDict = Readonly<Record<SearchTopic, SearchTopicEntry>>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const chars = (s: string) => Array.from(s).length;

/**
 * 설정 search_topics 검사 — DB 트리거(…45 search_topics_guard)와 같은 규칙. 관리자 설정 화면이 같은 함수로 거른다.
 * 객체 · 주제 키 6개 정확히 · 칸은 label·aliases만 · 글자 1~20자(정규형 2글자 이상) · 별칭 0~20개·1~20자(정규형 2글자 이상) · 정규형이 같은 낱말은 사전 전체에서 한 번
 */
export function searchTopicsErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 JSON 객체여야 합니다 — { "acquisition_tax": { "label": "취득세", "aliases": [] }, … }'];
  const L = SEARCH_TOPIC_LIMITS;
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (!(SEARCH_TOPICS as readonly string[]).includes(k)) errors.push(`${k}: 주제는 ${SEARCH_TOPICS.join("·")}뿐입니다 — 주제를 더하거나 빼지 못합니다 (REG1-11)`);
  const seen = new Map<string, string>();
  const word = (where: string, text: string) => {
    const key = squash(text);
    const prev = seen.get(key);
    if (prev) errors.push(`${where}: '${text}'(정규형 ${key})는 ${prev}에도 있습니다 — 한 낱말은 한 주제에만`);
    else seen.set(key, where);
  };
  for (const topic of SEARCH_TOPICS) {
    const entry = value[topic];
    if (!isObj(entry)) {
      errors.push(`${topic}: 주제가 없습니다 — { "label": 글자, "aliases": [별칭…] }`);
      continue;
    }
    for (const k of Object.keys(entry)) if (k !== "label" && k !== "aliases") errors.push(`${topic}.${k}: 칸은 label·aliases뿐입니다`);
    const label = entry.label;
    if (typeof label !== "string" || chars(label.trim()) < 1 || chars(label.trim()) > L.labelChars || chars(squash(label)) < L.minKeyChars) {
      errors.push(`${topic}.label: 1~${L.labelChars}자이고 남는 글자(띄어쓰기·기호 뺀 것)가 ${L.minKeyChars}글자 이상이어야 합니다`);
    } else word(`${topic}.label`, label);
    const aliases = entry.aliases;
    if (!Array.isArray(aliases) || aliases.length > L.aliases) {
      errors.push(`${topic}.aliases: 0~${L.aliases}개 목록이어야 합니다`);
      continue;
    }
    aliases.forEach((a, i) => {
      if (typeof a !== "string" || chars(a.trim()) < 1 || chars(a.trim()) > L.aliasChars || chars(squash(a)) < L.minKeyChars) {
        return errors.push(`${topic}.aliases[${i}]: 1~${L.aliasChars}자이고 남는 글자가 ${L.minKeyChars}글자 이상이어야 합니다`);
      }
      word(`${topic}.aliases[${i}]`, a);
    });
  }
  return errors;
}

/** 설정 값 → 주제 사전. 없거나 모양이 틀리면 null — 주제를 분류하지 않는다(지역 분류는 그대로) */
export function parseSearchTopics(value: unknown): SearchTopicDict | null {
  if (searchTopicsErrors(value).length) return null;
  const v = value as Record<SearchTopic, SearchTopicEntry>;
  return Object.fromEntries(SEARCH_TOPICS.map((t) => [t, { label: v[t].label, aliases: [...v[t].aliases] }])) as unknown as SearchTopicDict;
}

/** 분류에 쓰는 지역 행 (regions 공개 칸 — RegionRow와 같은 모양) */
export interface ClassifyRegion {
  code: string;
  parent_code: string | null;
  level: string;
  name: string;
  aliases: readonly string[];
  valid_from: string | null;
  valid_to: string | null;
}

export interface QueryClassification {
  /** 분류한 낱말 (정규형 — 앞 8개) */
  terms: string[];
  /** 지역 후보 코드 (코드 차례) — 하나면 그 지역으로 분류, 둘 이상이면 동명·여러 지역(하나로 정하지 않는다), 0이면 지역 없음 */
  regions: string[];
  /** 지역으로 읽은 낱말 정규형 (다른 표기 제안에서 뺀다) */
  regionKeys: string[];
  /** 주제 (검색어 차례, 겹침 0) */
  topics: SearchTopic[];
  /** 지역·주제가 아닌 낱말 */
  rest: string[];
  /** 지역이 아닌 낱말 — 주제 낱말과 남은 낱말을 검색어 차례대로 (제안 검색어의 뒷부분) */
  others: string[];
}

const validOn = (r: ClassifyRegion, today: string) => (r.valid_from === null || r.valid_from <= today) && (r.valid_to === null || r.valid_to >= today);
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 낱말 → 분류 (DB search_classify와 같은 규칙). 낱말은 칸마다 다시 정규화하고 빈 것은 빼고 앞 8개 */
export function classifyTerms(rawTerms: readonly string[], regions: readonly ClassifyRegion[], topics: SearchTopicDict | null, today: string): QueryClassification {
  const terms = rawTerms
    .map((t) => squash(t))
    .filter((t) => t !== "")
    .slice(0, SEARCH_LIMITS.maxTerms);
  const live = regions.filter((r) => validOn(r, today));
  const regionKeysOf = new Map(live.map((r) => [r.code, new Set([r.name, ...r.aliases].map(squash).filter((k) => k !== ""))]));
  const topicWords: [string, SearchTopic][] = topics
    ? SEARCH_TOPICS.flatMap((t) => [...new Set([topics[t].label, ...topics[t].aliases].map(squash).filter((k) => k !== ""))].map((k): [string, SearchTopic] => [k, t]))
    : [];

  const matched: string[] = [];
  const regionKeys: string[] = [];
  const found: SearchTopic[] = [];
  const rest: string[] = [];
  const others: string[] = [];
  let i = 0;
  while (i < terms.length) {
    let hit = false;
    for (let len = Math.min(CLASSIFY_MAX_SPAN, terms.length - i); len >= 1; len--) {
      const span = terms.slice(i, i + len);
      const key = span.join("");
      const codes = live.filter((r) => regionKeysOf.get(r.code)!.has(key)).map((r) => r.code);
      if (codes.length > 0) {
        matched.push(...codes);
        regionKeys.push(key);
        i += len;
        hit = true;
        break;
      }
      const topic = topicWords.find(([w]) => w === key)?.[1];
      if (topic) {
        if (!found.includes(topic)) found.push(topic);
        others.push(...span);
        i += len;
        hit = true;
        break;
      }
    }
    if (!hit) {
      rest.push(terms[i]!);
      others.push(terms[i]!);
      i += 1;
    }
  }

  // 지역 후보 — 시·도와 시·군·구가 함께 잡히면 그 시·도 아래 시·군·구만 (없으면 모두)
  const rows = new Map(live.map((r) => [r.code, r]));
  const uniq = [...new Set(matched)];
  const sido = uniq.filter((c) => rows.get(c)!.level === "sido");
  const gu = uniq.filter((c) => rows.get(c)!.level === "sigungu");
  const narrow = sido.length > 0 ? gu.filter((c) => sido.includes(rows.get(c)!.parent_code ?? "")) : [];
  const candidates = (narrow.length > 0 ? narrow : [...sido, ...gu]).sort(byCode);
  return { terms, regions: candidates, regionKeys, topics: found, rest, others };
}

/** 검색어 → 분류 (낱말은 queryTerms — 검색 함수가 쓴 붙인 낱말) */
export function classifyQuery(q: string, regions: readonly ClassifyRegion[], topics: SearchTopicDict | null, today: string): QueryClassification {
  return classifyTerms(queryTerms(q).terms, regions, topics, today);
}

/** 제안 검색어 — 종류마다 앞 몇 개 (W2-d 2.4 screen.suggestions와 같다) */
export const REGION_SUGGESTION_MAX = 3;

export interface RegionSuggestionQueries {
  /** 상위 지역 — 시·군·구 후보는 그 시·도, 그다음 지역을 뺀 검색어(전국). 시·도 후보는 전국만 */
  upper: string[];
  /** 다른 표기 — 시·군·구는 '시·도 줄임 이름 + 이름'(동명이면 이것이 후보를 가른다), 그다음 쓰지 않은 이름·별칭 */
  spellings: string[];
}

/**
 * 결과 0건 제안 (REG1-11 '결과 0건은 상위 지역·다른 표기·상황 카드를 제안한다') — 지역 후보가 있을 때. 상황 카드는 화면이 공개 상황에서 고른다.
 * 제안은 지금 검색어와 정규형이 다르고 서로 겹치지 않는 것만, 종류마다 앞 REGION_SUGGESTION_MAX개
 */
export function regionSuggestionQueries(cls: QueryClassification, regions: readonly ClassifyRegion[], today: string, q: string): RegionSuggestionQueries {
  const rows = new Map(regions.filter((r) => validOn(r, today)).map((r) => [r.code, r]));
  const tail = cls.others.join(" ");
  const own = squash(q);
  const pick = (queries: string[]) => {
    const seen = new Set<string>([own]);
    const out: string[] = [];
    for (const x of queries) {
      const text = x.trim();
      const key = squash(text);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= REGION_SUGGESTION_MAX) break;
    }
    return out;
  };
  const withTail = (head: string) => (tail ? `${head} ${tail}` : head);
  const candidates = cls.regions.flatMap((c) => rows.get(c) ?? []);

  const upper: string[] = [];
  for (const r of candidates) {
    const parent = r.level === "sigungu" && r.parent_code ? rows.get(r.parent_code) : undefined;
    if (parent) upper.push(withTail(parent.name));
  }
  if (tail) upper.push(tail);

  const used = new Set(cls.regionKeys);
  const lists = candidates.map((r) => {
    const parent = r.level === "sigungu" && r.parent_code ? rows.get(r.parent_code) : undefined;
    const names = [r.name, ...r.aliases].filter((n) => !used.has(squash(n)));
    return [...(parent ? [`${parent.aliases[0] ?? parent.name} ${r.name}`] : []), ...names].map(withTail);
  });
  // 후보마다 한 개씩 번갈아 — 동명이면 앞 제안들이 후보를 가르는 표기다
  const spellings: string[] = [];
  for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length) spellings.push(l[k]!);
  return { upper: pick(upper), spellings: pick(spellings) };
}

/** 검색 결과에 붙는 분류 (화면 분류 줄 · API `classification` · search_submitted.region_classified · 결과 0건 제안) */
export interface SearchClassification {
  /** 지역 후보 (코드 차례) — 하나면 그 지역, 둘 이상이면 동명·여러 지역 */
  regions: { code: string; name: string; level: "sido" | "sigungu"; parentName: string | null }[];
  /** 주제 (화면 글자는 설정 search_topics) */
  topics: { key: SearchTopic; label: string }[];
  /** 지역 후보가 둘 이상 — 하나로 정하지 않았다 (12장 #29) */
  ambiguous: boolean;
  /** 결과 0건 제안 검색어 — 상위 지역 */
  upper: string[];
  /** 결과 0건 제안 검색어 — 다른 표기 */
  spellings: string[];
}

/** 검색어 → 결과에 붙는 분류 (지역 행·주제 사전은 공개 데이터 — 서버가 읽는다) */
export function describeClassification(q: string, regions: readonly ClassifyRegion[], topics: SearchTopicDict | null, today: string): SearchClassification {
  const cls = classifyQuery(q, regions, topics, today);
  const rows = new Map(regions.map((r) => [r.code, r]));
  const found = cls.regions.flatMap((code): SearchClassification["regions"] => {
    const r = rows.get(code);
    const level = r?.level === "sido" || r?.level === "sigungu" ? r.level : null;
    if (!r || !level) return [];
    return [{ code, name: r.name, level, parentName: r.parent_code ? (rows.get(r.parent_code)?.name ?? null) : null }];
  });
  const s = regionSuggestionQueries(cls, regions, today, q);
  return {
    regions: found,
    topics: topics ? cls.topics.map((key) => ({ key, label: topics[key].label })) : [],
    ambiguous: found.length > 1,
    upper: s.upper,
    spellings: s.spellings,
  };
}
