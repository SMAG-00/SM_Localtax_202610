// 개발방법 비교 관리 규칙 (W4 18단계 — docs/dev/W4_설계.md 1장 18단계 · 2.1 · 2.11 · 2.13 · 12장 #151~, PRD-01B PR-09 · PR-10 · PR-11)
// 방법 내용·비교 항목 글·숫자 요건 값은 모두 시험용 가짜다(실제 요건 값·법령 조건 0). DB 트리거(마이그레이션 …52)와 같은 규칙인지는 DB 시험 w4-dev-methods.test.mjs가 같은 견본으로 본다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEV_METHOD_ITEMS,
  DEV_METHOD_ITEM_LABELS,
  DEV_METHOD_KINDS,
  DEV_METHOD_REVIEW_STATUSES,
  DEV_METHOD_SLUGS,
  PLACEHOLDER_WORDS,
  RANK_WORDS,
  REQUIREMENT_NUMBER_RE,
  contentWarnings,
  devMethodsEnableErrors,
  forbiddenHit,
  isPlaceholder,
  methodWarnings,
  parseCompareDraft,
  parseFactInput,
  parseMethodDraft,
  parseReview,
  rankKeyErrors,
  sameFactContent,
  sameMethodContent,
  type DevMethodFactRow,
  type DevMethodReadiness,
} from "./dev-method-rules";

const ROOT = path.resolve(__dirname, "../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const PRD01B = fs.readFileSync(path.join(ROOT, "docs", "PRD", "PRD-01B_1단계_4대분야_콘텐츠.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000052_w4_dev_methods.sql"), "utf8");
const RANK_SCRIPT = fs.readFileSync(path.join(ROOT, "packages", "db", "scripts", "check-rank-fields.mjs"), "utf8");
const lines = DESIGN.split("\n");
const row = (prefix: string) => {
  const line = lines.find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const codes = (prefix: string) => ticks(row(prefix).split("|")[2]!);

/** 시험용 사전 — 2.11 낱말 + 감면 단정 (운영 값은 settings forbidden_phrases) */
const PHRASES = ["방식이 유리", "방식을 추천", "추천 방식", "가장 좋은 방식", "이 구역에 맞는 방식", "유리합니다", "감면 보장"];
const LENS = { topics: ["시험용 세목"], points: ["시험용 포인트"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }], base_date: "2026-01-01" };
const METHOD = { op: "method", slug: "redevelopment", legal_basis_name: "시험용 근거 법령", summary: "시험용 한 줄 설명", steps: ["시험용 첫 단계", "시험용 둘째 단계"] };
const FACT = {
  op: "fact",
  slug: "trust",
  fact_key: "siheom_req",
  label: "시험용 요건",
  value: "시험용 99",
  unit: "시험용 단위",
  law_ref: "시험용 조문",
  reference_date: "2026-01-01",
  source_url: "https://gasang.example/dm/law-a",
  snapshot_payload: "시험용 근거 원문",
};
const fields = (errors: string[]) => errors.map((e) => e.split(":")[0]);

describe("값 = 설계 2.1 · 2.13 · DB 마이그레이션 …52 · PRD 화면 초안", () => {
  test("slug·종류·비교 항목·감수 상태·자리 채움 = 2.1 줄", () => {
    expect([...DEV_METHOD_SLUGS]).toEqual(codes("| dev_method.slug "));
    expect([...DEV_METHOD_KINDS]).toEqual(codes("| dev_method.kind "));
    expect([...DEV_METHOD_ITEMS]).toEqual(codes("| dev_method.compare_item "));
    expect([...DEV_METHOD_REVIEW_STATUSES]).toEqual(codes("| dev_method.review_status "));
    expect([...PLACEHOLDER_WORDS]).toEqual(codes("| dev_method.placeholder "));
  });

  test("DB 값 목록·자리 채움 목록·고정 순서가 같은 글", () => {
    expect(MIGRATION).toContain(`slug in (${DEV_METHOD_SLUGS.map((s) => `'${s}'`).join(", ")})`);
    expect(MIGRATION).toContain(`item in (${DEV_METHOD_ITEMS.map((s) => `'${s}'`).join(", ")})`);
    expect(MIGRATION).toContain(`in ('', ${PLACEHOLDER_WORDS.map((s) => `'${s}'`).join(", ")})`);
    expect(MIGRATION).toContain(`sort = array_position(array[${DEV_METHOD_SLUGS.map((s) => `'${s}'`).join(", ")}]::text[], slug)`);
  });

  test("비교 항목 글자 = PRD-01B 3.2 화면 초안 '비교 항목' 줄(숫자 요건의 '(기준일)'은 칸 표시)", () => {
    const prd = PRD01B.split("\n").find((l) => l.startsWith("비교 항목 "));
    expect(prd).toBeTruthy();
    const labels = prd!
      .replace(/^비교 항목\s+/, "")
      .split(" · ")
      .map((s) => s.replace(/\(기준일\)/, "").trim());
    expect(DEV_METHOD_ITEMS.map((i) => DEV_METHOD_ITEM_LABELS[i])).toEqual(labels);
  });

  test("점수·순위 사전 = 2.13 줄 = DB 검사 스크립트", () => {
    const head = lines.findIndex((l) => l.startsWith("### 2.13 "));
    const body = lines.slice(head + 1).find((l) => l.startsWith("낱말("))!;
    expect([...RANK_WORDS]).toEqual(ticks(body.split("판정 방식")[0]!));
    expect(RANK_SCRIPT).toContain(`Object.freeze([${RANK_WORDS.map((w) => `"${w}"`).join(", ")}])`);
  });
});

describe("자리 채움·숫자 요건 표현·금지 표현 (DB 시험과 같은 견본)", () => {
  test.each([
    ["확인 중", true],
    ["준비중", true],
    ["미정", true],
    [" - ", true],
    ["TBD", true],
    ["추후 확인", true],
    ["(검토 중)", true],
    ["준비 중…", true],
    ["", true],
    ["시험용 확인 중인 내용을 설명한다", false],
    ["시험용 사업 주체", false],
  ] as const)("isPlaceholder(%j) = %s", (text, want) => expect(isPlaceholder(text)).toBe(want));

  test.each([
    ["시험용 99% 이상 3분의 2", true],
    ["시험용 99㎡ 이상", true],
    ["시험용 12개월", true],
    ["시험용 30일 이내", true],
    ["시험용 99세대", true],
    ["시험용 3년 이내", true],
    ["시험용 2026년 설명", false],
    ["시험용 3평가", false],
    ["시험용 절차 설명", false],
  ] as const)("숫자 요건 표현 %j = %s", (text, want) => expect(REQUIREMENT_NUMBER_RE.test(text)).toBe(want));

  test("DB 식과 같은 단위 목록", () => {
    expect(MIGRATION).toContain("(%|％|퍼센트|㎡|제곱미터|평(?![가균일등])|개월|세대|분의|일[[:space:]]*이내|년[[:space:]]*(이내|이상|이하|미만|초과))");
  });

  test("금지 표현 — NFC·공백 정리 뒤 일부 일치, 빈 낱말 무시", () => {
    expect(forbiddenHit(["시험용 방식이 유리합니다"], PHRASES)).toBe("방식이 유리");
    expect(forbiddenHit(["시험용  방식이   유리"], PHRASES)).toBe("방식이 유리");
    expect(forbiddenHit(["시험용 방식의 절차를 설명한다"], PHRASES)).toBeNull();
    expect(forbiddenHit([null, "x"], ["", " "])).toBeNull();
  });

  test("점수·순위·추천 칸 이름 422 (밑줄·대소문자 무시)", () => {
    expect(fields(rankKeyErrors({ score: 1, Method_Rank: 2, slug: "x", re_commend: true, 순위: 1 }))).toEqual(["score", "Method_Rank", "re_commend", "순위"]);
    expect(rankKeyErrors({ sort: 1, summary: "x" })).toEqual([]);
  });
});

describe("방법 내용 초안 parseMethodDraft", () => {
  test("맞는 초안 — 칸 정리, 박스 없음 = null, 절차는 줄 글도 받는다", () => {
    const r = parseMethodDraft({ ...METHOD, steps: "시험용 첫 단계\n\n 시험용 둘째 단계 " }, PHRASES);
    expect(r).toEqual({ ok: true, value: { slug: "redevelopment", content: { legal_basis_name: "시험용 근거 법령", summary: "시험용 한 줄 설명", steps: ["시험용 첫 단계", "시험용 둘째 단계"], lens: null } } });
    const withLens = parseMethodDraft({ ...METHOD, legal_basis_name: "", lens: LENS }, PHRASES);
    expect(withLens.ok && withLens.value.content).toMatchObject({ legal_basis_name: null, lens: LENS });
  });

  test("칸마다 422 — 방법·설명·절차 한도·자리 채움·금지 표현('○○ 방식이 유리합니다')·모르는 칸·점수 칸", () => {
    const r = parseMethodDraft(
      {
        op: "method",
        slug: "siheom",
        summary: "시험용 방식이 유리합니다",
        steps: ["시험용 단계", "시험용 단계", "확인 중", "가".repeat(61)],
        legal_basis_name: "가".repeat(121),
        score: 5,
        extra: 1,
      },
      PHRASES,
    );
    expect(r.ok).toBe(false);
    const errors = r.ok ? [] : r.errors;
    expect(fields(errors)).toEqual(["score", "extra", "slug", "legal_basis_name", "summary", "steps[1]", "steps[2]", "steps[3]"]);
    expect(errors.find((e) => e.startsWith("summary:"))).toContain("PR-11");
    expect(errors.find((e) => e.startsWith("steps[2]:"))).toContain("자리 채움");
    expect(errors.find((e) => e.startsWith("score:"))).toContain("점수·순위·추천 칸은 받지 않습니다");
  });

  test("필수 — 설명·절차 빈 값 / 절차 0개·16개", () => {
    const r = parseMethodDraft({ op: "method", slug: "trust", summary: " ", steps: [] }, PHRASES);
    expect(r.ok ? [] : fields(r.errors)).toEqual(["summary", "steps"]);
    const many = parseMethodDraft({ ...METHOD, steps: Array.from({ length: 16 }, (_, i) => `시험용 ${i}`) }, PHRASES);
    expect(many.ok ? [] : many.errors).toEqual(["steps: 절차 단계는 15개까지입니다 (지금 16개)"]);
  });

  test("박스 — 16단계와 같은 한도·문장, 칸 이름 앞에 lens. (포인트 4줄·계산기·세액·금지 표현·모르는 칸)", () => {
    const r = parseMethodDraft(
      { ...METHOD, lens: { ...LENS, points: ["시험용 1", "시험용 2", "시험용 세금 100만 원", "생애 첫 주택이면 감면 보장"], links: [{ kind: "calculator", label: "시험용", url: "/calc" }], extra: 1 } },
      PHRASES,
    );
    expect(r.ok).toBe(false);
    const errors = r.ok ? [] : r.errors;
    expect(errors.every((e) => e.startsWith("lens."))).toBe(true);
    expect(fields(errors)).toEqual(expect.arrayContaining(["lens.extra", "lens.points", "lens.links[0]", "lens.points[2]", "lens.points[3]"]));
  });

  test("경고 — 숫자 요건 표현은 저장하고 알린다", () => {
    const r = parseMethodDraft({ ...METHOD, summary: "시험용 99% 이상" }, PHRASES);
    expect(r.ok).toBe(true);
    expect(r.ok && methodWarnings(r.value.content)).toEqual([expect.stringContaining("PR-10 저장 경고")]);
    expect(contentWarnings("body", ["시험용 2026년"])).toEqual([]);
  });

  test("같은 내용 — 박스 칸 순서가 달라도 같다, 글이 다르면 다르다", () => {
    const r = parseMethodDraft({ ...METHOD, lens: LENS }, PHRASES);
    if (!r.ok) throw new Error("초안");
    const stored = { legal_basis_name: "시험용 근거 법령", summary: "시험용 한 줄 설명", steps: ["시험용 첫 단계", "시험용 둘째 단계"], lens: { base_date: "2026-01-01", links: LENS.links, points: LENS.points, topics: LENS.topics } };
    expect(sameMethodContent(stored, r.value.content)).toBe(true);
    expect(sameMethodContent({ ...stored, summary: "시험용 다른 설명" }, r.value.content)).toBe(false);
  });
});

describe("비교 항목 parseCompareDraft", () => {
  test("맞는 칸 · 2.1 밖 항목 · 빈 글·자리 채움·301자·금지 표현 · 점수 칸", () => {
    expect(parseCompareDraft({ op: "compare", slug: "public", item: "actor", body: " 시험용 사업 주체 " }, PHRASES)).toEqual({ ok: true, value: { slug: "public", item: "actor", body: "시험용 사업 주체" } });
    for (const [body, want] of [
      ["", "body: 비교 항목 글"],
      ["확인 중", "자리 채움"],
      ["가".repeat(301), "300자 이하"],
      ["시험용 방식을 추천합니다", "PR-11"],
    ] as const) {
      const r = parseCompareDraft({ op: "compare", slug: "public", item: "actor", body }, PHRASES);
      expect(r.ok ? "" : r.errors.join(" | ")).toContain(want);
    }
    const bad = parseCompareDraft({ op: "compare", slug: "public", item: "score", body: "시험용", rating: 1 }, PHRASES);
    expect(bad.ok ? [] : fields(bad.errors)).toEqual(["rating", "item"]);
  });
});

describe("숫자 요건 사실 행 parseFactInput", () => {
  test("첫 판 — 원문 글자 붙여 넣기, 단위 없어도 된다", () => {
    const r = parseFactInput({ ...FACT, unit: "" }, PHRASES);
    expect(r.ok && r.value).toMatchObject({ slug: "trust", fact_key: "siheom_req", unit: null, snapshot_id: null, snapshot_payload: "시험용 근거 원문", supersedes_id: null, reason: null });
  });

  test("칸마다 422 — 기준일·근거 원문·스냅샷 둘 다·열쇠 형식·자리 채움·금지 표현·순위 칸", () => {
    const r = parseFactInput(
      { ...FACT, fact_key: "Siheom-Req", value: "확인 중", label: "시험용 방식이 유리", reference_date: "2026-02-30", source_url: "gasang.example", snapshot_id: 3, rank_order: 1 },
      PHRASES,
    );
    expect(r.ok ? [] : fields(r.errors)).toEqual(["rank_order", "fact_key", "label", "value", "reference_date", "source_url", "snapshot_payload"]);
    const none = parseFactInput({ ...FACT, snapshot_payload: undefined }, PHRASES);
    expect(none.ok ? "" : none.errors.join(" | ")).toContain("근거 원본 스냅샷");
  });

  test("새 판은 사유 필수 · 첫 판에 사유 0 · 앞 판 번호 형식", () => {
    expect(parseFactInput({ ...FACT, supersedes_id: 7 }, PHRASES).ok).toBe(false);
    const v2 = parseFactInput({ ...FACT, supersedes_id: "7", reason: "시험용 고친 사유" }, PHRASES);
    expect(v2.ok && [v2.value.supersedes_id, v2.value.reason]).toEqual([7, "시험용 고친 사유"]);
    const first = parseFactInput({ ...FACT, reason: "시험용" }, PHRASES);
    expect(first.ok ? [] : first.errors).toEqual(["reason: 사유는 고치는 판(supersedes_id)에만 적습니다 — 첫 판은 사유 없이"]);
    expect(parseFactInput({ ...FACT, supersedes_id: "x", reason: "시험용" }, PHRASES).ok).toBe(false);
  });

  test("같은 내용 판정 — 글·기준일·주소가 같으면 같다", () => {
    const r = parseFactInput(FACT, PHRASES);
    if (!r.ok) throw new Error("사실 행");
    const latest = { id: 1, method_id: 5, fact_key: "siheom_req", label: "시험용 요건", value: "시험용 99", unit: "시험용 단위", law_ref: "시험용 조문", reference_date: "2026-01-01", source_url: FACT.source_url } as DevMethodFactRow;
    expect(sameFactContent(latest, r.value)).toBe(true);
    expect(sameFactContent({ ...latest, reference_date: "2026-06-01" }, r.value)).toBe(false);
  });
});

describe("서명 요청 parseReview", () => {
  test("방법·비교 항목은 읽은 초안 시각, 사실 행은 판 번호", () => {
    expect(parseReview({ op: "review", target: "method", slug: "trust", drafted_at: "2026-10-23T01:00:00Z" })).toEqual({ ok: true, value: { target: "method", slug: "trust", draftedAt: "2026-10-23T01:00:00Z" } });
    expect(parseReview({ op: "review", target: "compare", slug: "trust", item: "actor", drafted_at: "2026-10-23T01:00:00Z" }).ok).toBe(true);
    expect(parseReview({ op: "review", target: "fact", slug: "trust", fact_id: 9 })).toEqual({ ok: true, value: { target: "fact", slug: "trust", factId: 9 } });
    const bad = parseReview({ op: "review", target: "compare", slug: "trust", item: "score" });
    expect(bad.ok ? [] : fields(bad.errors)).toEqual(["drafted_at", "item"]);
    expect(parseReview({ op: "review", target: "fact", slug: "trust" }).ok).toBe(false);
    expect(parseReview({ op: "review", target: "all", slug: "trust" }).ok).toBe(false);
  });
});

describe("기능 키 dev_methods 켜기 devMethodsEnableErrors (2.4 — DB 트리거와 같은 조건)", () => {
  const ready = (slug: string, sort: number): DevMethodReadiness => ({ slug, sort, method_signed: true, compare_unsigned: [], ready: true });
  test("7개 모두 준비 → 사유 0 · 하나라도 아니면 방법마다 사유(서명·빈 칸 글자) · 행이 없으면 사유", () => {
    const all = DEV_METHOD_SLUGS.map((s, i) => ready(s, i + 1));
    expect(devMethodsEnableErrors(all)).toEqual([]);
    const one = all.map((r) => (r.slug === "renewal" ? { ...r, ready: false, method_signed: false, compare_unsigned: ["tax_issues", "actor"] } : r));
    const errors = devMethodsEnableErrors(one);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("feature_flags.dev_methods: renewal — 방법 내용 세무 감수 서명 없음 · 비교 항목 서명 전·빈 칸: 지방세 쟁점·사업 주체");
    expect(devMethodsEnableErrors(all.slice(0, 6))).toEqual(["feature_flags.dev_methods: rapid-planning — 방법 행이 없습니다"]);
  });
});
