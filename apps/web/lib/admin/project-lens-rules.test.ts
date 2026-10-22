// 단계별 「지방세로 읽기」 템플릿 입력 검사 (W4 16단계 — docs/dev/W4_설계.md 1장 16단계 · 2.1 · 2.3 · 12장 #129~, PRD-01B PR-08 · CORE-01)
// 사업 유형·단계·문구는 '시험용' 가짜다 (설계 8장) — 세무 문장·세율·금액 0.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  LENS_LIMITS,
  LENS_LINK_KINDS,
  LENS_OPS,
  LENS_REVIEW_STATUSES,
  LENS_URL_RE,
  lensBoard,
  lensFormValues,
  lensRequestBody,
  lensState,
  lensWarnings,
  parseLensDraft,
  parseLensReview,
  sameLensContent,
  splitLensLines,
  type StageLensRow,
} from "./project-lens-rules";
import { errorsByField } from "./project-rules";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W4_설계.md"), "utf8");
const codes = (prefix: string) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  expect(l, prefix).toBeTruthy();
  return [...l!.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
};
const MIGRATION = fs.readFileSync(path.resolve(__dirname, "../../../../packages/db/supabase/migrations/20261023000050_w4_project_lenses.sql"), "utf8");

const TYPES = { siheom_pl: { label: "시험용 정비" } };
const LISTS = {
  siheom_pl: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "plan", label: "시험용 계획인가" },
  ],
};
const PHRASES = ["절세 보장", "수익 보장"];
const ctx = { types: TYPES, lists: LISTS, forbiddenPhrases: PHRASES };
const body = (over: Record<string, unknown> = {}) => ({
  op: "draft",
  project_type: "siheom_pl",
  stage: "zone",
  topics: ["시험용 세목"],
  points: ["시험용 포인트 하나"],
  links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }],
  base_date: "2026-01-01",
  ...over,
});
const errorsOf = (over: Record<string, unknown>) => {
  const r = parseLensDraft(body(over), ctx);
  return r.ok ? [] : r.errors;
};
const fields = (errors: string[]) => Object.keys(errorsByField(errors)).sort();

describe("값 — 2.1 · 2.3 · DB 트리거와 같은 한도", () => {
  test("review_status · 링크 종류 = 설계 2.1, op 2종", () => {
    expect([...LENS_REVIEW_STATUSES]).toEqual(codes("| project_stage_lens.review_status |"));
    expect([...LENS_LINK_KINDS]).toEqual(codes("| project_stage_lens.link_kind"));
    expect([...LENS_OPS]).toEqual(["draft", "review"]);
  });
  test("한도 = 마이그레이션 …50 트리거 숫자 (세목 5·20자 · 포인트 1~3·120자 · 링크 3·이름 40·주소 300)", () => {
    expect(LENS_LIMITS).toEqual({ topics: 5, topicChars: 20, pointsMin: 1, pointsMax: 3, pointChars: 120, links: 3, labelChars: 40, urlChars: 300 });
    expect(MIGRATION).toContain("jsonb_array_length(v_lens -> 'topics') not between 1 and 5");
    expect(MIGRATION).toContain("char_length(btrim(v_item #>> '{}')) not between 1 and 20");
    expect(MIGRATION).toContain("if v_n < 1 or v_n > 3 then");
    expect(MIGRATION).toContain("char_length(btrim(v_item #>> '{}')) not between 1 and 120");
    expect(MIGRATION).toContain("jsonb_array_length(v_lens -> 'links') not between 1 and 3");
    expect(MIGRATION).toContain("char_length(btrim(v_item ->> 'label')) not between 1 and 40");
    expect(MIGRATION).toContain("char_length(v_item ->> 'url') > 300");
    expect(MIGRATION).toContain(`not in (${LENS_LINK_KINDS.map((k) => `'${k}'`).join(", ")})`);
  });
  test("사이트 안 주소 — /로 시작 · 쿼리 받음 · 바깥·//·#·공백 0", () => {
    for (const ok of ["/tax", "/news/siheom-a", "/experts?field=siheom", "/store/siheom"]) expect(LENS_URL_RE.test(ok), ok).toBe(true);
    for (const bad of ["https://gasang.example", "//gasang.example", "/tax#a", "/tax a", "tax", "/"]) expect(LENS_URL_RE.test(bad), bad).toBe(false);
  });
});

describe("초안 입력 검사 (parseLensDraft)", () => {
  test("정상 — 1줄·3줄 저장, 앞뒤 공백 정리, 줄 글(한 줄에 하나)도 받는다", () => {
    const one = parseLensDraft(body(), ctx);
    expect(one).toEqual({ ok: true, value: { projectType: "siheom_pl", stage: "zone", lens: { topics: ["시험용 세목"], points: ["시험용 포인트 하나"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }], base_date: "2026-01-01" } } });
    const three = parseLensDraft(body({ points: " 시험용 하나 \n\n시험용 둘\r\n시험용 셋 ", topics: "시험용 세목 가\n시험용 세목 나" }), ctx);
    expect(three.ok && three.value.lens.points).toEqual(["시험용 하나", "시험용 둘", "시험용 셋"]);
    expect(three.ok && three.value.lens.topics).toEqual(["시험용 세목 가", "시험용 세목 나"]);
  });
  test("포인트 0줄·4줄 거부 (CORE-01) · 빈 줄 · 121자", () => {
    expect(errorsOf({ points: [] })).toEqual(["points: 핵심 포인트는 1~3줄입니다 (지금 0줄 — CORE-01)"]);
    expect(errorsOf({ points: ["시험용 1", "시험용 2", "시험용 3", "시험용 4"] })).toEqual(["points: 핵심 포인트는 1~3줄입니다 (지금 4줄 — CORE-01)"]);
    expect(errorsOf({ points: ["시험용", " "] })).toEqual(["points[1]: 빈 줄은 저장하지 않습니다"]);
    expect(errorsOf({ points: ["가".repeat(121)] })).toEqual(["points[0]: 줄은 120자 이하입니다 (지금 121자)"]);
    expect(errorsOf({ points: ["가".repeat(120)] })).toEqual([]);
  });
  test("세목 0개·6개·같은 세목·21자 거부", () => {
    expect(errorsOf({ topics: [] })).toEqual(["topics: 관련 세목을 1개 이상 적어 주세요 (CORE-01)"]);
    expect(errorsOf({ topics: ["가", "나", "다", "라", "마", "바"] })).toEqual(["topics: 관련 세목은 5개까지입니다 (지금 6개)"]);
    expect(errorsOf({ topics: ["시험용", "시험용"] })).toEqual(["topics[1]: 관련 세목 ‘시험용’가 두 번 있습니다"]);
    expect(errorsOf({ topics: ["가".repeat(21)] })).toEqual(["topics[0]: 관련 세목은 20자 이하입니다 (지금 21자)"]);
  });
  test("링크 0개 거부 · 계산기 종류 거부(SM 카드가 붙는다) · 바깥 주소 · 같은 종류 · 4개 · 이름 없음", () => {
    expect(errorsOf({ links: [] })).toEqual(["links: 해설·도서·전문가 링크를 1개 이상 넣어 주세요 (CORE-01)"]);
    expect(errorsOf({ links: [{ kind: "calculator", label: "시험용 계산기", url: "/calc" }] })).toEqual([
      "links[0]: 계산기 링크는 적지 않습니다 — SM 취득세 카드(바깥 연결 설정)가 박스 옆에 붙습니다 (TX-01)",
    ]);
    expect(errorsOf({ links: [{ kind: "explainer", label: "시험용", url: "https://gasang.example/x" }] })).toEqual(["links[0]: 사이트 안 주소(/로 시작 — 바깥 주소·//·#·공백 0, 300자까지)여야 합니다"]);
    expect(
      errorsOf({
        links: [
          { kind: "explainer", label: "시험용 1", url: "/tax" },
          { kind: "explainer", label: "시험용 2", url: "/tax/columns" },
        ],
      }),
    ).toEqual(["links[1]: 해설 링크가 두 번 있습니다 (종류마다 하나)"]);
    const four = errorsOf({ links: ["explainer", "book", "expert", "book"].map((kind, i) => ({ kind, label: `시험용 ${i}`, url: "/tax" })) });
    expect(four[0]).toBe("links: 링크는 3개까지입니다 (종류마다 하나)");
    expect(errorsOf({ links: [{ kind: "book", label: "", url: "/store/siheom" }] })).toEqual(["links[0]: 링크 이름은 1~40자입니다"]);
    expect(errorsOf({ links: [{ kind: "manual", label: "시험용", url: "/tax" }] })).toEqual(["links[0]: 종류는 explainer·book·expert 중 하나입니다"]);
  });
  test("세액 표현(숫자 + 원) 거부 — 포인트·세목·링크 이름 · '원문'은 금액 아님 · 금지 표현(감면 단정) 거부", () => {
    expect(errorsOf({ points: ["시험용 세액은 300만 원입니다"] })).toEqual(["points[0]: 세액을 쓰지 않습니다 — ‘300만 원’을 빼 주세요"]);
    expect(errorsOf({ topics: ["시험용 1,000원"] })).toEqual(["topics[0]: 세액을 쓰지 않습니다 — ‘1,000원’을 빼 주세요"]);
    expect(errorsOf({ links: [{ kind: "explainer", label: "시험용 2억원", url: "/tax" }] })).toEqual(["links[0]: 세액을 쓰지 않습니다 — ‘2억원’을 빼 주세요"]);
    expect(errorsOf({ points: ["시험용 원문 3건을 봅니다"] })).toEqual([]);
    expect(errorsOf({ points: ["시험용  절세   보장 문장"] })).toEqual(["points[0]: 금지 표현 ‘절세 보장’ — 감면 해당 여부를 단정하지 않습니다"]);
  });
  test("유형·단계는 설정 안 · 기준일 · 가격 칸 이름 422 · 빈 요청은 칸마다", () => {
    expect(errorsOf({ project_type: "siheom_zz" })).toEqual(["project_type: 단계 목록이 있는 사업 유형이어야 합니다 (운영 설정 project_types·project_stage_lists)"]);
    expect(errorsOf({ stage: "build" })).toEqual(["stage: 사업 유형 siheom_pl의 단계 목록에 있는 단계여야 합니다"]);
    expect(errorsOf({ base_date: "2026-02-30" })).toEqual(["base_date: 법령 기준일(YYYY-MM-DD)이 필요합니다"]);
    expect(fields(errorsOf({ expected_return: 1, sale_price: 2 }))).toEqual(["expected_return", "sale_price"]);
    const empty = parseLensDraft({ op: "draft" }, ctx);
    expect(empty.ok).toBe(false);
    expect(fields(empty.ok ? [] : empty.errors)).toEqual(["base_date", "links", "points", "project_type", "topics"]);
    expect(parseLensDraft(body(), { ...ctx, types: null }).ok).toBe(false);
  });
  test("숫자 + % — 저장(오류 0) + 경고 1 (PR-05), 없으면 0", () => {
    const r = parseLensDraft(body({ points: ["시험용 비율 4% 확인"] }), ctx);
    expect(r.ok).toBe(true);
    expect(r.ok && lensWarnings(r.value.lens)).toEqual(["lens: 숫자와 % 표현이 있습니다 — 저장은 됩니다. 세율·비율은 감수된 기사에서만 씁니다 (PR-05 저장 경고)"]);
    const plain = parseLensDraft(body(), ctx);
    expect(plain.ok && lensWarnings(plain.value.lens)).toEqual([]);
  });
});

const row = (over: Partial<StageLensRow> = {}): StageLensRow => ({
  project_type: "siheom_pl",
  stage: "zone",
  lens: { topics: ["시험용 세목"], points: ["시험용 포인트 하나"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }], base_date: "2026-01-01" },
  drafted_by: "user:a",
  drafted_at: "2026-10-23T01:00:00.123456+00:00",
  reviewed_by: null,
  reviewed_at: null,
  review_status: "draft",
  ...over,
});

describe("상태·판·폼", () => {
  test("같은 내용 — 서명 칸은 보지 않는다, 한 글자라도 다르면 다름", () => {
    const r = row();
    expect(sameLensContent(r.lens, { ...r.lens })).toBe(true);
    expect(sameLensContent(r.lens, { ...r.lens, points: ["시험용 포인트 둘"] })).toBe(false);
    expect(sameLensContent(r.lens, { ...r.lens, base_date: "2026-01-02" })).toBe(false);
    expect(sameLensContent(null, r.lens)).toBe(false);
  });
  test("서명 요청 — 유형·단계·읽은 초안 시각 필수", () => {
    expect(parseLensReview({ project_type: "siheom_pl", stage: "zone", drafted_at: "2026-10-23T01:00:00.123456+00:00" })).toEqual({
      ok: true,
      value: { projectType: "siheom_pl", stage: "zone", draftedAt: "2026-10-23T01:00:00.123456+00:00" },
    });
    const bad = parseLensReview({});
    expect(fields(bad.ok ? [] : bad.errors)).toEqual(["drafted_at", "project_type", "stage"]);
  });
  test("판 — 유형마다 단계 목록 차례, 템플릿 없음·초안·서명·재감수 필요 상태", () => {
    const board = lensBoard(TYPES, LISTS, [row({ stage: "plan", review_status: "rereview_needed" })]);
    expect(board).toEqual([
      {
        key: "siheom_pl",
        label: "시험용 정비",
        stages: [
          { key: "zone", label: "시험용 구역지정", state: "none", row: null },
          { key: "plan", label: "시험용 계획인가", state: "rereview_needed", row: row({ stage: "plan", review_status: "rereview_needed" }) },
        ],
      },
    ]);
    expect(lensBoard(TYPES, LISTS, [], "siheom_zz")).toEqual([]);
    expect(lensBoard(null, LISTS, [])).toEqual([]);
    expect(lensState(null)).toBe("none");
    expect(lensState(row({ review_status: "reviewed", reviewed_by: "user:b", reviewed_at: "2026-10-23T02:00:00Z" }))).toBe("reviewed");
  });
  test("폼 값 ↔ 요청 본문 — 이름·주소가 빈 링크 줄은 보내지 않는다, 4번째 줄은 화면이 센다", () => {
    const f = lensFormValues(row());
    expect(f.topics).toBe("시험용 세목");
    expect(f.links.explainer).toEqual({ label: "시험용 해설", url: "/tax" });
    expect(f.links.book).toEqual({ label: "", url: "" });
    expect(lensRequestBody("siheom_pl", "zone", f)).toEqual(body());
    expect(lensFormValues(null)).toEqual({ topics: "", points: "", base_date: "", links: { explainer: { label: "", url: "" }, book: { label: "", url: "" }, expert: { label: "", url: "" } } });
    expect(splitLensLines("시험용 1\n시험용 2\n\n시험용 3\n시험용 4")).toHaveLength(4);
  });
});
