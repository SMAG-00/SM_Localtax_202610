// 측정 이벤트 규칙 시험 — 설계 문서 2.1·2.2·2.3과 같은 목록, 이벤트마다 정해진 칸만 받고 개인정보·원문을 담을 길이 없다 (FND-06 · GROW-01)
import fs from "node:fs";
import path from "node:path";
import { CONTENT_TYPES, FORMATS } from "@ltr/editorial";
import { describe, expect, test } from "vitest";
import { NEXT_ACTION_KEYS } from "@/lib/server/public/constants";
import { CLIENT_ENTRIES, ENTRIES, EVENT_NAMES, EVENT_SPECS, MODES, PROP_VALUES, TIERS, validateEvent } from "./events";
import { designEvents, designList } from "./test-design";

describe("설계 문서와 같은 목록", () => {
  test.each([
    ["analytics_events.name", EVENT_NAMES],
    ["analytics_events.mode", MODES],
    ["analytics_events.tier", TIERS],
    ["analytics_events.entry", ENTRIES],
  ] as const)("2.1 %s", (name, values) => {
    expect([...values]).toEqual(designList("2.1", name));
  });

  test("2.2 이벤트마다 분야 칸 규칙과 속성 칸(필수·선택)이 표와 같다 — 78종 전부", () => {
    const rows = designEvents();
    expect(rows.map((r) => r.name)).toEqual([...EVENT_NAMES]);
    for (const r of rows) {
      const spec = EVENT_SPECS[r.name as keyof typeof EVENT_SPECS];
      expect(spec.section, r.name).toBe(r.section);
      expect(
        Object.entries(spec.props).map(([name, p]) => ({ name, optional: p.optional === true })),
        r.name,
      ).toEqual(r.props);
    }
  });

  test("2.3 속성 값 목록 · 브라우저가 보내는 진입 경로", () => {
    for (const [name, values] of Object.entries(PROP_VALUES)) expect([...values], name).toEqual(designList("2.3", name));
    expect([...CLIENT_ENTRIES]).toEqual(designList("2.3", "client.entry"));
  });

  test("기사 형식·유형·다음 행동 값은 W2-a·W2-b 목록 그대로 쓴다", () => {
    const enumOf = (event: keyof typeof EVENT_SPECS, prop: string) => {
      const f = EVENT_SPECS[event].props[prop]!.field;
      return f.kind === "enum" ? [...f.values] : [];
    };
    expect(enumOf("article_viewed", "format")).toEqual([...FORMATS]);
    expect(enumOf("article_engaged", "content_type")).toEqual([...CONTENT_TYPES]);
    expect(enumOf("next_action_clicked", "action")).toEqual([...NEXT_ACTION_KEYS]);
  });

  test("어느 이벤트에도 검색어·질문 원문·계산 입력값·이메일·주소·IP·User-Agent를 담을 속성 칸이 없다", () => {
    const names = Object.values(EVENT_SPECS).flatMap((s) => Object.keys(s.props));
    const forbidden = /^(q|query|keyword|term|question|message|prompt|answer|input|inputs|amount|email|phone|address|lat|lng|ip|ua|user_agent|user_id|member_id|referrer|url)$|_(text|raw|query|input|email|address|ip)$/;
    expect(names.filter((n) => forbidden.test(n))).toEqual([]);
    // '질의 길이'(PRD-01A 12장)는 숫자 칸 — 검색어 글자를 담을 수 없다
    expect(EVENT_SPECS.search_submitted.props.query_length!.field).toEqual({ kind: "count", max: 200 });
    // 글자 값은 정해진 목록·slug·경로뿐 — 자유 글자 칸 0
    const kinds = new Set(Object.values(EVENT_SPECS).flatMap((s) => Object.values(s.props).map((p) => p.field.kind)));
    expect([...kinds].sort()).toEqual(["bool", "count", "enum", "id", "key", "path", "rank", "region", "slug", "version"]);
  });
});

describe("W3 10단계 이벤트 3종 (docs/dev/W3_설계.md 2.5)", () => {
  const W3 = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W3_설계.md"), "utf8");
  const w3Row = (prefix: string) => {
    const line = W3.split("\n").find((l) => l.startsWith(`| ${prefix}`));
    if (!line) throw new Error(`W3 설계 2.1에 '${prefix}' 줄이 없다`);
    return [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  };

  test("값 목록이 W3 설계 2.1 표와 같다 — 단계 = amendment_event.stage, 원문 유형 = legal_doc.doc_type (카드 키는 DB 시드와 대조 — DB 시험 w3-search-measure)", () => {
    expect([...PROP_VALUES["amendment_viewed.stage"]]).toEqual(w3Row("amendment_event.stage"));
    expect([...PROP_VALUES["interpretation_viewed.doc_type"]]).toEqual(w3Row("legal_doc.doc_type"));
  });

  test("calculator_card_clicked — 카드 키·화면·차례만 받고, 분야는 선택(/calc는 없음·상황 페이지는 그 분야)", () => {
    expect(validateEvent({ name: "calculator_card_clicked", props: { card: "acquisition", screen: "calc", rank: 1 } })).toMatchObject({
      ok: true,
      event: { section: null, props: { card: "acquisition", screen: "calc", rank: 1 } },
    });
    expect(validateEvent({ name: "calculator_card_clicked", section: "realestate", props: { card: "inheritance_gift", screen: "situation", rank: 1 } }).ok).toBe(true);
    expect(validateEvent({ name: "calculator_card_clicked", props: { card: "nts", screen: "calc", rank: 100 } }).ok).toBe(true);
  });

  test("calculator_card_clicked — 주소·검색어·입력값·표식 값을 담을 길이 없다: 목록 밖 카드 키·주소 모양 키·모르는 칸·차례 0/101·화면 밖 값은 400", () => {
    const bad = (props: Record<string, unknown>) => validateEvent({ name: "calculator_card_clicked", props }).ok;
    expect(bad({ card: "https://sm.example/calc?x=MARKER", screen: "calc", rank: 1 })).toBe(false);
    expect(bad({ card: "marker_value", screen: "calc", rank: 1 })).toBe(false);
    expect(bad({ card: "acquisition", screen: "calc", rank: 1, q: "MARKER" })).toBe(false);
    expect(bad({ card: "acquisition", screen: "calc", rank: 1, url: "https://sm.example" })).toBe(false);
    expect(bad({ card: "acquisition", screen: "calc", rank: 1, input: "MARKER" })).toBe(false);
    expect(bad({ card: "acquisition", screen: "calc", rank: 0 })).toBe(false);
    expect(bad({ card: "acquisition", screen: "calc", rank: 101 })).toBe(false);
    expect(bad({ card: "acquisition", screen: "home", rank: 1 })).toBe(false);
    expect(bad({ card: "acquisition", rank: 1 })).toBe(false);
  });

  test("amendment_viewed — 분야 필수·개정안 번호, 단계는 선택(기록 없는 개정안) · interpretation_viewed — 분야 필수·기사 번호·원문 유형", () => {
    expect(validateEvent({ name: "amendment_viewed", section: "tax", props: { amendment_id: 3, stage: "pre_notice" } }).ok).toBe(true);
    expect(validateEvent({ name: "amendment_viewed", section: "tax", props: { amendment_id: 3 } }).ok).toBe(true);
    expect(validateEvent({ name: "amendment_viewed", props: { amendment_id: 3 } }).ok).toBe(false);
    expect(validateEvent({ name: "amendment_viewed", section: "tax", props: { amendment_id: 3, stage: "rumor" } }).ok).toBe(false);
    expect(validateEvent({ name: "amendment_viewed", section: "tax", props: { amendment_id: "reform-2026" } }).ok).toBe(false);
    expect(validateEvent({ name: "interpretation_viewed", section: "tax", props: { article_id: 9, doc_type: "case" } }).ok).toBe(true);
    expect(validateEvent({ name: "interpretation_viewed", section: "tax", props: { article_id: 9 } }).ok).toBe(false);
    expect(validateEvent({ name: "interpretation_viewed", section: "tax", props: { article_id: 9, doc_type: "memo" } }).ok).toBe(false);
  });
});

const ARTICLE = { article_id: 12, format: "general", content_type: "explainer" };

describe("validateEvent — 받는 것", () => {
  test("기사 열람: 이름·분야·속성만 → 그대로, 모드는 일반, 리퍼러 호스트는 분류용으로 넘긴다", () => {
    expect(validateEvent({ name: "article_viewed", section: "tax", props: ARTICLE, referrer: "www.google.com" })).toEqual({
      ok: true,
      event: { name: "article_viewed", section: "tax", entry: null, mode: "general", props: ARTICLE, referrer: "www.google.com" },
    });
  });

  test("분야 없는 이벤트·선택 칸 생략·사이트 안 진입 경로·전문가 모드", () => {
    const r = validateEvent({ name: "inquiry_submitted", props: { kind: "correction" }, entry: "tax_lens", mode: "expert" });
    expect(r).toEqual({ ok: true, event: { name: "inquiry_submitted", section: null, entry: "tax_lens", mode: "expert", props: { kind: "correction" }, referrer: null } });
    expect(validateEvent({ name: "hub_viewed", section: "local" })).toMatchObject({ ok: true, event: { props: {} } });
    expect(validateEvent({ name: "hub_viewed", section: "local", props: { topic: "local_tax" } })).toMatchObject({ ok: true, event: { props: { topic: "local_tax" } } });
    expect(validateEvent({ name: "search_submitted", props: { query_length: 0, result_count: 10_000, result_type_count: 20, region_classified: false } }).ok).toBe(true);
  });

  test("경계값 — 번호 1·순위 1과 100·개수 0과 상한·경로 200자", () => {
    expect(validateEvent({ name: "popular_article_clicked", props: { article_id: 1, rank: 1, position: "list" } }).ok).toBe(true);
    expect(validateEvent({ name: "popular_article_clicked", props: { article_id: 1, rank: 100, position: "sidebar" } }).ok).toBe(true);
    expect(validateEvent({ name: "signup_completed", props: { interest_count: 20, region_count: 0 } }).ok).toBe(true);
    expect(validateEvent({ name: "not_found_viewed", props: { path: `/${"a".repeat(199)}` } }).ok).toBe(true);
    expect(validateEvent({ name: "not_found_viewed", props: { path: "/news/%EC%B7%A8%EB%93%9D%EC%84%B8" } }).ok).toBe(true);
  });
});

const errorsOf = (body: unknown) => {
  const r = validateEvent(body);
  return r.ok ? [] : r.errors;
};

describe("validateEvent — 400이 되는 것", () => {
  test.each([
    ["JSON 객체가 아님", [1], "본문: JSON 객체여야 합니다"],
    ["없는 이벤트 이름", { name: "page_view" }, "name: 정해진 이벤트 이름이 아닙니다"],
    ["대문자 이름", { name: "ARTICLE_VIEWED" }, "name: 정해진 이벤트 이름이 아닙니다"],
    ["분야가 필요한 이벤트에 분야 없음", { name: "hub_viewed" }, "section: 이 이벤트는 분야가 필요합니다"],
    ["분야 없는 이벤트에 분야", { name: "signup_completed", section: "tax", props: { interest_count: 1, region_count: 1 } }, "section: 이 이벤트는 분야를 받지 않습니다"],
    ["없는 분야", { name: "hub_viewed", section: "travel" }, "section: tax·realestate·finance·local 중 하나여야 합니다"],
    ["바깥 진입 경로를 브라우저가 정함", { name: "hub_viewed", section: "tax", entry: "ai_answer_engine" }, "entry: 사이트 안 출발점(assistant·experts·tax_lens)만 보낼 수 있습니다"],
    ["없는 모드", { name: "hub_viewed", section: "tax", mode: "pro" }, "mode: general·expert 중 하나여야 합니다"],
    ["리퍼러에 경로", { name: "hub_viewed", section: "tax", referrer: "www.google.com/search?q=취득세" }, "referrer: 호스트 이름만 보냅니다 (소문자·경로 없음)"],
    ["리퍼러 대문자", { name: "hub_viewed", section: "tax", referrer: "WWW.GOOGLE.COM" }, "referrer: 호스트 이름만 보냅니다 (소문자·경로 없음)"],
    ["맨 위 모르는 칸 (시각을 보내도 받지 않는다)", { name: "hub_viewed", section: "tax", occurred_at: "2026-01-01" }, "occurred_at: 모르는 칸입니다"],
    ["props 배열", { name: "hub_viewed", section: "tax", props: [] }, "props: JSON 객체여야 합니다"],
  ])("%s", (_label, body, message) => {
    expect(errorsOf(body)).toContain(message);
  });

  test("속성 — 필수 빠짐·모르는 칸(검색어·이메일·User-Agent)·틀린 모양", () => {
    expect(errorsOf({ name: "article_viewed", section: "tax", props: { article_id: 1, format: "general" } })).toEqual(["props.content_type: 필요합니다"]);
    for (const extra of ["query", "q", "email", "user_agent", "ip", "title"]) {
      expect(errorsOf({ name: "article_viewed", section: "tax", props: { ...ARTICLE, [extra]: "x" } })).toEqual([`props.${extra}: 이 이벤트가 받지 않는 칸입니다`]);
    }
    expect(errorsOf({ name: "search_submitted", props: { query_length: 4, result_count: 0, result_type_count: 0, region_classified: false, query: "취득세" } })).toEqual([
      "props.query: 이 이벤트가 받지 않는 칸입니다",
    ]);
    expect(errorsOf({ name: "article_viewed", section: "tax", props: { ...ARTICLE, article_id: 0 } })).toEqual(["props.article_id: 1 이상 정수여야 합니다"]);
    expect(errorsOf({ name: "article_viewed", section: "tax", props: { ...ARTICLE, article_id: "12" } })).toEqual(["props.article_id: 1 이상 정수여야 합니다"]);
    expect(errorsOf({ name: "article_viewed", section: "tax", props: { ...ARTICLE, article_id: 1.5 } })).toEqual(["props.article_id: 1 이상 정수여야 합니다"]);
    expect(errorsOf({ name: "article_viewed", section: "tax", props: { ...ARTICLE, format: "podcast" } })).toEqual(["props.format: general·cardnews·infographic·video·photo 중 하나여야 합니다"]);
    expect(errorsOf({ name: "popular_article_clicked", props: { article_id: 1, rank: 101, position: "list" } })).toEqual(["props.rank: 1~100 정수여야 합니다"]);
    expect(errorsOf({ name: "popular_article_clicked", props: { article_id: 1, rank: 0, position: "list" } })).toEqual(["props.rank: 1~100 정수여야 합니다"]);
    expect(errorsOf({ name: "signup_completed", props: { interest_count: 21, region_count: -1 } })).toEqual(["props.interest_count: 0~20 정수여야 합니다", "props.region_count: 0~20 정수여야 합니다"]);
    expect(errorsOf({ name: "hot_article_clicked", props: { article_id: 1, rank: 1, pinned: "yes" } })).toEqual(["props.pinned: true/false여야 합니다"]);
    expect(errorsOf({ name: "situation_card_clicked", section: "tax", props: { situation: "Car Sold", position: "hub" } })).toEqual(["props.situation: 영문 소문자·숫자·'-' 100자 이하여야 합니다"]);
  });

  test("경로 칸 — 쿼리·조각·201자·개인정보 모양(이메일·전화·주민등록번호)은 거부, 글자는 되풀이하지 않는다", () => {
    const PATH_ERR = "props.path: '/'로 시작하는 200자 이하 경로여야 합니다 (쿼리·조각 없음)";
    expect(errorsOf({ name: "not_found_viewed", props: { path: "/search?q=취득세" } })).toEqual([PATH_ERR]);
    expect(errorsOf({ name: "not_found_viewed", props: { path: "/news/a#x" } })).toEqual([PATH_ERR]);
    expect(errorsOf({ name: "not_found_viewed", props: { path: "news/a" } })).toEqual([PATH_ERR]);
    expect(errorsOf({ name: "not_found_viewed", props: { path: `/${"a".repeat(200)}` } })).toEqual([PATH_ERR]);
    expect(errorsOf({ name: "not_found_viewed", props: { path: "/u/hong@example.com" } })).toEqual([PATH_ERR]);
    for (const path of ["/u/hong%40example.com", "/call/010-1234-5678", "/id/900101-1234567"]) {
      const errors = errorsOf({ name: "not_found_viewed", props: { path } });
      expect(errors, path).toEqual(["props.path: 개인정보로 보이는 글자가 있습니다"]);
      expect(errors.join(" ")).not.toContain(path.slice(3));
    }
    expect(errorsOf({ name: "not_found_viewed", props: { path: "/news/%E0%A4%A" } })).toEqual(["props.path: 경로의 % 인코딩이 틀렸습니다"]);
  });

  test("오류 문장에 받은 값을 되풀이하지 않는다 (모르는 칸 이름은 40자까지만)", () => {
    const long = `x${"y".repeat(100)}`;
    const errors = errorsOf({ name: "hub_viewed", section: "tax", [long]: 1, props: { [long]: 1 } });
    expect(errors).toEqual([`${long.slice(0, 40)}: 모르는 칸입니다`, `props.${long.slice(0, 40)}: 이 이벤트가 받지 않는 칸입니다`]);
  });
});
