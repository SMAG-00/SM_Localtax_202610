// 지역 + 주제 검색 분류 (W4 10단계 — docs/dev/W4_설계.md 1장 10단계 · 2.1 search.topic · 2.2 search_topics · 2.9 · 2.9.1, PRD-01B REG-08 · REG1-11)
//  · 주제 키 = 설계 2.1 · 씨앗 = 설계 2.2 = 마이그레이션 …45 씨앗 · 한도·이어 읽는 낱말 수 = 마이그레이션 상수
//  · 2.9 견본 표 전부(이름 목록만 — 시험용 사전, 코드는 이름표일 뿐 행정구역 코드가 아니다) · 2.9.1 표(가짜 지역 접두 99 — DB 시험 w4-search-topics와 같은 표)
//  · 주제 사전 검사(DB 트리거와 같은 규칙) · 결과 0건 제안(상위 지역·다른 표기)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CLASSIFY_MAX_SPAN,
  REGION_SUGGESTION_MAX,
  SEARCH_TOPICS,
  SEARCH_TOPIC_LIMITS,
  classifyQuery,
  classifyTerms,
  parseSearchTopics,
  regionSuggestionQueries,
  searchTopicsErrors,
  type ClassifyRegion,
  type SearchTopicDict,
} from "./search-classify";
import { SEARCH_SCREEN } from "./search-logic";
import { SETTING_SPECS } from "@/lib/admin/settings-rules";

const ROOT = path.resolve(__dirname, "../../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000045_w4_search_topics.sql"), "utf8");
const TODAY = "2026-10-22";

const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const cells = (line: string) => line.split("|").slice(1, -1).map((c) => c.trim());
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const section = (from: string, to: string) => {
  const start = DESIGN.indexOf(from);
  const end = DESIGN.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`설계 문서에 '${from}' ~ '${to}' 구간이 없다`);
  return DESIGN.slice(start, end).split("\n");
};

/** 설계 2.2 씨앗 값 */
const DESIGN_SEED = JSON.parse(cells(row("| `search_topics` |"))[1]!.match(/`(\{"acquisition_tax"[^`]+\})`/)![1]!) as unknown;
const TOPICS = parseSearchTopics(DESIGN_SEED)!;

// ── 2.9.1 사전·견본 (가짜 지역) ──
const T291 = section("#### 2.9.1", "### 2.10");
const DICT_291: ClassifyRegion[] = T291.filter((l) => /^\| `\d{10}` \| `(sido|sigungu)`/.test(l)).map((l) => {
  const [code, level, parent, name, aliases, end] = cells(l);
  const endTicks = ticks(end!);
  return {
    code: ticks(code!)[0]!,
    level: ticks(level!)[0]!,
    parent_code: ticks(parent!)[0] ?? null,
    name: ticks(name!)[0]!,
    aliases: ticks(aliases!),
    valid_from: null,
    valid_to: endTicks[0] ?? null,
  };
});
const CASES_291 = T291.filter((l) => /^\| `[^`]+` \| (`\d{10}`|—)/.test(l)).map((l) => {
  const [q, regions, topics, rest] = cells(l);
  return { q: ticks(q!)[0]!, regions: ticks(regions!), topics: ticks(topics!), rest: ticks(rest!) };
});

// ── 2.9 견본 (실제 이름 — 이름 목록만 쓰는 시험용 사전. 코드 자리는 이름표) ──
const sido = (code: string, name: string, aliases: string[]): ClassifyRegion => ({ code, level: "sido", parent_code: null, name, aliases, valid_from: null, valid_to: null });
const gu = (code: string, parent: string, name: string, aliases: string[]): ClassifyRegion => ({ code, level: "sigungu", parent_code: parent, name, aliases, valid_from: null, valid_to: null });
const NAMED: ClassifyRegion[] = [
  sido("S-seoul", "서울특별시", ["서울"]),
  sido("S-gyeongbuk", "경상북도", ["경북"]),
  sido("S-gangwon", "강원특별자치도", ["강원", "강원도"]),
  sido("S-gyeongnam", "경상남도", ["경남"]),
  gu("G-seongdong", "S-seoul", "성동구", []),
  gu("G-gyeongju", "S-gyeongbuk", "경주시", ["경주"]),
  gu("G-gangneung", "S-gangwon", "강릉시", ["강릉"]),
  gu("G-goseong-gw", "S-gangwon", "고성군", []),
  gu("G-goseong-gn", "S-gyeongnam", "고성군", []),
];
const CASES_29 = section("### 2.9 ", "실제 DB 시험(2단계 뒤)")
  .filter((l) => /^\| `[^`]+` \| /.test(l))
  .map((l) => {
    const [q, region, topic] = cells(l);
    const count = region!.startsWith("없음") ? 0 : Number(region!.match(/(\d+)/)![1]);
    const name = region!.startsWith("후보") || count === 0 ? null : region!.split(" ")[0]!;
    return { q: ticks(q!)[0]!, count, name, topic: ticks(topic!).find((t) => (SEARCH_TOPICS as readonly string[]).includes(t)) ?? null };
  });

describe("설계 문서·마이그레이션과 같은 값", () => {
  test("주제 키 = 2.1 search.topic (차례 고정) = DB c_topic_keys · 트리거 c_keys", () => {
    expect([...SEARCH_TOPICS]).toEqual(ticks(cells(row("| search.topic ("))[1]!));
    for (const name of ["c_topic_keys", "c_keys"]) {
      const m = MIGRATION.match(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]+)\\]`))!;
      expect([...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), name).toEqual([...SEARCH_TOPICS]);
    }
  });

  test("씨앗 = 설계 2.2 = 마이그레이션 …45 씨앗, 검사를 지난다 — 주제 글자 6개(취득세·재산세·상속·증여·부동산 거래·재개발·재건축·지방재정)", () => {
    const seeded = JSON.parse(MIGRATION.match(/\('search_topics',\s*'([^']+)'::jsonb/)![1]!);
    expect(seeded).toEqual(DESIGN_SEED);
    expect(searchTopicsErrors(DESIGN_SEED)).toEqual([]);
    expect(SEARCH_TOPICS.map((t) => TOPICS[t].label)).toEqual(["취득세", "재산세", "상속·증여", "부동산 거래", "재개발·재건축", "지방재정"]);
    // 별칭 씨앗은 '·'로 두 낱말을 묶은 두 주제의 각 낱말뿐 (PRD 예 '재건축 → 재개발')
    expect(SEARCH_TOPICS.filter((t) => TOPICS[t].aliases.length > 0).map((t) => [t, TOPICS[t].aliases])).toEqual([
      ["inheritance_gift", ["상속", "증여"]],
      ["redevelopment", ["재개발", "재건축"]],
    ]);
  });

  test("한도·이어 읽는 낱말 수 = 마이그레이션 상수 (트리거 · search_classify)", () => {
    const num = (name: string) => Number(MIGRATION.match(new RegExp(`${name} constant integer := (\\d+);`))![1]);
    expect([num("c_label_chars"), num("c_aliases"), num("c_alias_chars"), num("c_min_key")]).toEqual([
      SEARCH_TOPIC_LIMITS.labelChars,
      SEARCH_TOPIC_LIMITS.aliases,
      SEARCH_TOPIC_LIMITS.aliasChars,
      SEARCH_TOPIC_LIMITS.minKeyChars,
    ]);
    expect(num("c_max_span")).toBe(CLASSIFY_MAX_SPAN);
    expect(REGION_SUGGESTION_MAX).toBe(SEARCH_SCREEN.suggestions);
  });
});

describe("2.9 견본 표 전부 (이름 목록만 — REG-08 · REG1-11)", () => {
  test("견본 7줄을 모두 읽었다", () => expect(CASES_29.map((c) => c.q)).toEqual(["성동구 재개발", "경주 취득세", "성동구 재건축", "성동구", "강릉 축제", "고성군 재산세", "취득세"]));

  for (const c of CASES_29) {
    test(`'${c.q}' → 지역 ${c.count === 0 ? "없음" : c.name ? `${c.name} 1` : `후보 ${c.count}`} · 주제 ${c.topic ?? "없음"}`, () => {
      const cls = classifyQuery(c.q, NAMED, TOPICS, TODAY);
      expect(cls.regions).toHaveLength(c.count);
      const names = cls.regions.map((code) => NAMED.find((r) => r.code === code)!.name);
      if (c.name) expect(names).toEqual([c.name]);
      if (c.count > 1) expect(new Set(names).size).toBe(1); // 동명 — 하나로 단정 0, 같은 이름의 후보 모두
      expect(cls.topics).toEqual(c.topic ? [c.topic] : []);
    });
  }

  test("'강릉 축제' — '축제'는 사전 밖이라 주제 0, 남은 낱말로 남는다 (관광 결과를 만들지 않는다)", () => {
    expect(classifyQuery("강릉 축제", NAMED, TOPICS, TODAY)).toMatchObject({ topics: [], rest: ["축제"], others: ["축제"] });
  });

  test("시·도 + 동명 시·군·구 → 그 시·도 아래 하나로 ('강원 고성군 재산세'), 시·도가 맞지 않으면 모두 후보 ('서울 고성군')", () => {
    expect(classifyQuery("강원 고성군 재산세", NAMED, TOPICS, TODAY).regions).toEqual(["G-goseong-gw"]);
    expect(classifyQuery("서울 고성군", NAMED, TOPICS, TODAY).regions).toEqual(["G-goseong-gn", "G-goseong-gw", "S-seoul"]);
  });
});

describe("2.9.1 같은 규칙 표 (DB search_classify와 같은 견본 — 가짜 지역 접두 99)", () => {
  test("사전 8줄·견본 15줄을 읽었다 · 견본 검색어에 한 글자 낱말이 없다(DB 시험은 띄어쓰기로 나눈다)", () => {
    expect(DICT_291).toHaveLength(8);
    expect(CASES_291).toHaveLength(15);
    for (const c of CASES_291) expect(c.q.split(/[\s·]+/u).every((w) => Array.from(w).length >= 2), c.q).toBe(true);
  });

  for (const c of CASES_291) {
    test(`'${c.q}' → 지역 ${c.regions.join("·") || "—"} · 주제 ${c.topics.join("·") || "—"} · 남은 ${c.rest.join("·") || "—"}`, () => {
      const cls = classifyQuery(c.q, DICT_291, TOPICS, TODAY);
      expect({ regions: cls.regions, topics: cls.topics, rest: cls.rest }).toEqual({ regions: c.regions, topics: c.topics, rest: c.rest });
    });
  }

  test("낱말을 직접 넘겨도 같다 — 칸마다 다시 정규화, 빈 것은 빼고 앞 8개", () => {
    expect(classifyTerms(["시험가람구", " ", "재 개발"], DICT_291, TOPICS, TODAY)).toMatchObject({ regions: ["9901100000"], topics: ["redevelopment"], rest: [] });
    const many = classifyTerms(["가나", "다라", "마바", "사아", "자차", "카타", "파하", "거너", "시험가람구"], DICT_291, TOPICS, TODAY);
    expect(many.terms).toHaveLength(8);
    expect(many.regions).toEqual([]); // 아홉째 낱말은 읽지 않는다
  });

  test("폐지 지역 — 폐지일 당일까지는 후보, 다음 날 0 (한국 날짜)", () => {
    expect(classifyQuery("시험폐지구", DICT_291, TOPICS, "2020-12-31").regions).toEqual(["9901600000"]);
    expect(classifyQuery("시험폐지구", DICT_291, TOPICS, "2021-01-01").regions).toEqual([]);
  });

  test("주제 사전이 없거나 모양이 틀리면 주제 0 — 지역 분류는 그대로", () => {
    expect(classifyQuery("시험가람구 재개발", DICT_291, null, TODAY)).toMatchObject({ regions: ["9901100000"], topics: [], rest: ["재개발"] });
    expect(parseSearchTopics({ ...(DESIGN_SEED as object), tourism: { label: "축제", aliases: [] } })).toBeNull();
  });

  test("별칭을 더하면 다음 분류부터 — '축제'를 지방재정 별칭으로 넣으면 '시험누리 축제' → local_finance", () => {
    const seed = DESIGN_SEED as Record<string, { label: string; aliases: string[] }>;
    const edited = parseSearchTopics({ ...seed, local_finance: { label: "지방재정", aliases: ["축제"] } }) as SearchTopicDict;
    expect(classifyQuery("시험누리 축제", DICT_291, edited, TODAY)).toMatchObject({ regions: ["9901200000"], topics: ["local_finance"], rest: [] });
  });
});

describe("주제 사전 검사 (DB 트리거 search_topics_guard와 같은 규칙)", () => {
  const seed = DESIGN_SEED as Record<string, { label: string; aliases: string[] }>;
  const withTopic = (t: string, v: unknown) => ({ ...seed, [t]: v });
  const BAD: [string, unknown, RegExp][] = [
    ["객체가 아님", ["취득세"], /JSON 객체/],
    ["주제 하나 빠짐", Object.fromEntries(Object.entries(seed).filter(([k]) => k !== "local_finance")), /local_finance: 주제가 없습니다/],
    ["모르는 주제", { ...seed, tourism: { label: "축제", aliases: [] } }, /tourism: 주제는/],
    ["모르는 칸", withTopic("property_tax", { label: "재산세", aliases: [], note: "x" }), /property_tax\.note: 칸은/],
    ["빈 글자", withTopic("property_tax", { label: "  ", aliases: [] }), /property_tax\.label/],
    ["글자 21자", withTopic("property_tax", { label: "가".repeat(21), aliases: [] }), /property_tax\.label/],
    ["한 글자 글자", withTopic("property_tax", { label: "세", aliases: [] }), /property_tax\.label/],
    ["별칭이 목록 아님", withTopic("property_tax", { label: "재산세", aliases: "보유세" }), /property_tax\.aliases: 0~20개/],
    ["별칭 21개", withTopic("property_tax", { label: "재산세", aliases: Array.from({ length: 21 }, (_, i) => `별칭${i}번`) }), /property_tax\.aliases: 0~20개/],
    ["한 글자 별칭", withTopic("property_tax", { label: "재산세", aliases: ["세"] }), /property_tax\.aliases\[0\]/],
    ["글자가 아닌 별칭", withTopic("property_tax", { label: "재산세", aliases: [3] }), /property_tax\.aliases\[0\]/],
    ["다른 주제와 같은 낱말", withTopic("property_tax", { label: "재산세", aliases: ["취득 세"] }), /정규형 취득세.*acquisition_tax\.label/],
    ["같은 주제 안 두 번", withTopic("property_tax", { label: "재산세", aliases: ["재산 세"] }), /한 낱말은 한 주제에만/],
  ];
  for (const [name, value, error] of BAD) test(`거부 — ${name}`, () => expect(searchTopicsErrors(value).join("\n")).toMatch(error));

  test("운영 설정 화면 검사(SETTING_SPECS.search_topics)가 같은 함수 — 씨앗은 지나고 틀린 값은 같은 사유", () => {
    expect(SETTING_SPECS.search_topics!.check(DESIGN_SEED, DESIGN_SEED)).toEqual([]);
    for (const [, value] of BAD) expect(SETTING_SPECS.search_topics!.check(value, DESIGN_SEED)).toEqual(searchTopicsErrors(value));
  });

  test("받는 값 — 글자 20자·별칭 20개·별칭 20자, 띄어쓰기만 다른 낱말은 같은 낱말", () => {
    expect(searchTopicsErrors(withTopic("property_tax", { label: "가".repeat(20), aliases: Array.from({ length: 20 }, (_, i) => `별칭${i}번${"나".repeat(14)}`) }))).toEqual([]);
    expect(searchTopicsErrors(withTopic("property_tax", { label: "재산세", aliases: ["보유세", "주택 재산세"] }))).toEqual([]);
  });
});

describe("결과 0건 제안 — 상위 지역·다른 표기 (REG1-11)", () => {
  const suggest = (q: string, dict = DICT_291) => regionSuggestionQueries(classifyQuery(q, dict, TOPICS, TODAY), dict, TODAY, q);

  test("시·군·구 + 주제 → 상위 = 시·도 + 주제 · 주제만(전국), 다른 표기 = 시·도 줄임 이름 + 이름 (쓴 이름은 뺀다)", () => {
    expect(suggest("시험가람구 재개발")).toEqual({ upper: ["시험용 분류도 재개발", "재개발"], spellings: ["분류도 시험가람구 재개발"] });
  });

  test("짧은 별칭으로 찾으면 다른 표기에 공식 이름 — 쓴 별칭은 뺀다", () => {
    expect(suggest("시험누리 취득세")).toEqual({ upper: ["시험용 분류도 취득세", "취득세"], spellings: ["분류도 시험누리시 취득세", "시험누리시 취득세"] });
  });

  test("시·도 + 주제 → 상위 = 주제만(전국), 다른 표기 = 공식 이름", () => {
    expect(suggest("분류도 취득세")).toEqual({ upper: ["취득세"], spellings: ["시험용 분류도 취득세"] });
  });

  test("지역명만 → 상위 = 시·도, 다른 표기 = 시·도 줄임 이름 + 이름", () => {
    expect(suggest("시험가람구")).toEqual({ upper: ["시험용 분류도"], spellings: ["분류도 시험가람구"] });
  });

  test("동명 → 다른 표기가 후보를 가른다 ('경남 고성군 재산세'·'강원 고성군 재산세'), 상위는 각 시·도 + 전국 — 종류마다 3개까지", () => {
    expect(suggest("고성군 재산세", NAMED)).toEqual({ upper: ["경상남도 재산세", "강원특별자치도 재산세", "재산세"], spellings: ["경남 고성군 재산세", "강원 고성군 재산세"] });
    const many = [sido("S-a", "가도", ["가"]), ...["G-1", "G-2", "G-3", "G-4"].map((c, i) => gu(c, "S-a", "중앙구", [`중앙${i}`]))];
    const s = regionSuggestionQueries(classifyQuery("중앙구 취득세", many, TOPICS, TODAY), many, TODAY, "중앙구 취득세");
    expect(s.spellings).toHaveLength(REGION_SUGGESTION_MAX);
    expect(s.upper).toEqual(["가도 취득세", "취득세"]);
  });

  test("지역 후보가 없으면 제안 0 · 지금 검색어와 정규형이 같은 제안 0", () => {
    expect(suggest("취득세")).toEqual({ upper: [], spellings: [] });
    const s = suggest("분류도 시험가람구 재개발");
    expect(s.spellings.map((x) => x.replace(/\s/g, ""))).not.toContain("분류도시험가람구재개발");
  });
});
