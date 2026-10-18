// 상황 카드 규칙 (UX-05 · FAM-02) — '먼저 확인할 것' 2·3·4개 경계, 허브 5번째 카드 거부, 감수 대상 칸 판정, 폼 → 본문
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ALIASES_MAX,
  ALIAS_CHARS_MAX,
  CHECKLIST_NOTICE,
  FIELD,
  changesReviewedFields,
  checksErrors,
  emptyCheck,
  emptySituationForm,
  hubOrderPlan,
  hubSlotError,
  nextFreeSlot,
  parseHubOrder,
  parseSituationCreate,
  parseSituationPatch,
  situationFormToBody,
  situationToForm,
  type SituationForm,
} from "./situation-rules";

const rowLike = {
  slug: "car-sold",
  section: "tax",
  title: "차를 팔았어요",
  subtitle: null,
  pictogram: "car-sold",
  checks: [{ title: "a" }, { title: "b" }, { title: "c" }],
  checklist: null,
  mistakes: [],
  article_ids: [],
  solved_case_ids: [],
  glossary_ids: [],
  tool_links: [],
  region_select: false,
};
const checks = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `확인 ${i + 1}` }));
const create = (over: Record<string, unknown> = {}) => ({ slug: "car-sold", section: "tax", title: "차를 팔았어요·폐차했어요", pictogram: "car-sold", checks: checks(3), ...over });

describe("먼저 확인할 것 — 정확히 3개 (UX-05 '2개·4개는 발행되지 않는다')", () => {
  test.each([
    [0, false],
    [2, false],
    [3, true],
    [4, false],
  ])("%s개 → 저장 %s", (n, ok) => {
    expect(checksErrors(checks(n)).length === 0).toBe(ok);
    expect(parseSituationCreate(create({ checks: checks(n) })).ok).toBe(ok);
  });

  test("거부 문장에 지금 개수를 밝힌다", () => {
    expect(checksErrors(checks(2))[0]).toContain("지금 2개");
    expect(checksErrors(checks(4))[0]).toContain("지금 4개");
  });

  test("항목마다 제목 필수 — 빈 제목·모르는 칸·목록이 아닌 값 거부", () => {
    expect(checksErrors([{ title: "a" }, { title: " " }, { title: "c" }])).toEqual(["situation.checks[1].title: 확인할 것 2의 제목이 비었습니다"]);
    expect(checksErrors([{ title: "a" }, { title: "b", link: "/x" }, { title: "c" }])).toEqual(["situation.checks[1].link: 모르는 칸입니다"]);
    expect(checksErrors("세 개")).toHaveLength(1);
  });

  test("고치기에서도 같다 — 4개면 422, 3개는 앞뒤 공백을 지우고 때·할 일은 있을 때만", () => {
    expect(parseSituationPatch({ checks: checks(4) }).ok).toBe(false);
    const r = parseSituationPatch({ checks: [{ title: " 연세액 ", when: " 판 날 ", note: "" }, { title: "말소일" }, { title: "환급 계좌", note: "통장 사본" }] });
    expect(r.ok && r.value.content.checks).toEqual([{ title: "연세액", when: "판 날" }, { title: "말소일" }, { title: "환급 계좌", note: "통장 사본" }]);
  });
});

describe("만들기 본문 (UX-05 · FAM-02)", () => {
  test("필수 — 주소·분야·상황 한 문장·픽토그램·먼저 확인할 것 3개. 나머지는 기본값", () => {
    const r = parseSituationCreate(create());
    expect(r).toEqual({
      ok: true,
      value: {
        slug: "car-sold",
        section: "tax",
        title: "차를 팔았어요·폐차했어요",
        subtitle: null,
        pictogram: "car-sold",
        checks: checks(3),
        checklist: null,
        mistakes: [],
        article_ids: [],
        solved_case_ids: [],
        glossary_ids: [],
        tool_links: [],
        region_select: false,
        aliases: [],
        sort: 0,
      },
    });
  });

  test("분야 없이 저장할 수 없다 · 모르는 분야·픽토그램·주소 형식 거부", () => {
    for (const over of [{ section: undefined }, { section: "tourism" }, { pictogram: "festival" }, { slug: "Car Sold" }, { slug: "../x" }]) {
      expect(parseSituationCreate(create(over)).ok).toBe(false);
    }
    const noSection = parseSituationCreate(create({ section: undefined }));
    expect(!noSection.ok && noSection.errors[0]).toContain("분야 없이 저장할 수 없습니다");
  });

  test("공개·허브 자리는 만들 때 받지 않는다 — 감수 서명 뒤 편집 책임자가 정한다", () => {
    const r = parseSituationCreate(create({ visible: true, hubSlot: 1 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toHaveLength(2);
  });

  test("일반적 체크리스트는 항목 1개 이상과 고지 문장이 함께 (FAM-02 — 고지 없이 저장 0)", () => {
    expect(parseSituationCreate(create({ checklist: { items: ["상속 등기"], notice: CHECKLIST_NOTICE } })).ok).toBe(true);
    expect(parseSituationCreate(create({ checklist: { items: ["상속 등기"], notice: " " } })).ok).toBe(false);
    expect(parseSituationCreate(create({ checklist: { items: [], notice: CHECKLIST_NOTICE } })).ok).toBe(false);
    expect(parseSituationCreate(create({ checklist: null })).ok).toBe(true);
  });

  test("자주 틀리는 점은 3개까지 — 4개 거부, 빈 항목 거부", () => {
    expect(parseSituationCreate(create({ mistakes: ["a", "b", "c"] })).ok).toBe(true);
    expect(parseSituationCreate(create({ mistakes: ["a", "b", "c", "d"] })).ok).toBe(false);
    expect(parseSituationCreate(create({ mistakes: ["a", " "] })).ok).toBe(false);
  });

  test("연결 칸은 다음 행동 기능 키만 — 중복은 하나로, 모르는 키 거부", () => {
    const r = parseSituationCreate(create({ toolLinks: ["sm_calculator", "expert_finder", "sm_calculator"] }));
    expect(r.ok && r.value.tool_links).toEqual([{ feature: "sm_calculator" }, { feature: "expert_finder" }]);
    expect(parseSituationCreate(create({ toolLinks: ["tourism"] })).ok).toBe(false);
  });

  test("연결 번호 — 1 이상 정수 목록, 같은 번호 두 번 거부", () => {
    expect(parseSituationCreate(create({ articleIds: [3, 1] })).ok).toBe(true);
    expect(parseSituationCreate(create({ articleIds: [3, 3] })).ok).toBe(false);
    expect(parseSituationCreate(create({ glossaryIds: [0] })).ok).toBe(false);
  });
});

describe("고치기 본문 — 내용(situation.edit)과 공개·허브(situation.publish)를 나눈다", () => {
  test("주소는 바꾸지 않는다 · 빈 본문 거부", () => {
    expect(parseSituationPatch({ slug: "new" }).ok).toBe(false);
    expect(parseSituationPatch({}).ok).toBe(false);
  });

  test("공개·허브 칸은 placement로 — 허브에서 빼기는 null", () => {
    expect(parseSituationPatch({ visible: true, hubSlot: 2 })).toEqual({ ok: true, value: { content: {}, placement: { visible: true, hub_slot: 2 } } });
    expect(parseSituationPatch({ hubSlot: null })).toEqual({ ok: true, value: { content: {}, placement: { hub_slot: null } } });
    expect(parseSituationPatch({ hubSlot: 0 }).ok).toBe(false);
    expect(parseSituationPatch({ title: "새 제목", visible: false })).toEqual({ ok: true, value: { content: { title: "새 제목" }, placement: { visible: false } } });
  });

  test("감수 대상 칸이 실제로 바뀌었는가 — 같은 값을 다시 보내면 아니다, 제목만 바꾸면 아니다", () => {
    const before = { checks: checks(3), checklist: null, mistakes: ["숫자 착오"] };
    expect(changesReviewedFields(before, { title: "새 제목" })).toBe(false);
    expect(changesReviewedFields(before, { checks: checks(3), mistakes: ["숫자 착오"], checklist: null })).toBe(false);
    expect(changesReviewedFields(before, { mistakes: ["다른 점"] })).toBe(true);
    expect(changesReviewedFields(before, { checks: [{ title: "확인 1" }, { title: "확인 2" }, { title: "바뀐 확인" }] })).toBe(true);
    expect(changesReviewedFields({ checks: checks(3) }, { checklist: { items: ["새 항목"], notice: CHECKLIST_NOTICE } })).toBe(true);
  });

  test("DB(jsonb)가 칸 순서를 바꿔 돌려줘도 같은 값이면 바뀌지 않은 것 — 공개 중인 상황의 제목만 고칠 때 거부되지 않게", () => {
    const stored = { checks: [{ note: "통장", when: "판 날", title: "환급" }, { title: "b" }, { title: "c" }], checklist: { notice: CHECKLIST_NOTICE, items: ["x"] }, mistakes: [] };
    const sent = { checks: [{ title: "환급", when: "판 날", note: "통장" }, { title: "b" }, { title: "c" }], checklist: { items: ["x"], notice: CHECKLIST_NOTICE }, mistakes: [] };
    expect(changesReviewedFields(stored, sent)).toBe(false);
    expect(changesReviewedFields(stored, { ...sent, checklist: { items: ["y"], notice: CHECKLIST_NOTICE } })).toBe(true);
  });
});

describe("허브 자리 (UX-05 — 상한 4에서 5번째 카드 거부)", () => {
  const rows = (n: number, section = "tax") => Array.from({ length: n }, (_, i) => ({ id: i + 1, section, hub_slot: i + 1 }));

  test("4장이 찬 허브에 5번째 카드는 어느 자리든 거부 — 문장에 상한과 '5번째'", () => {
    for (const slot of [1, 4, 5]) {
      const err = hubSlotError(rows(4), { id: 99, section: "tax" }, slot, 4);
      expect(err).toContain("4장까지");
      expect(err).toContain("5번째");
    }
  });

  test("3장이면 빈 자리는 된다 · 겹치는 자리·상한 밖 자리는 거부 · 다른 분야 카드는 세지 않는다", () => {
    expect(hubSlotError(rows(3), { id: 99, section: "tax" }, 4, 4)).toBeNull();
    expect(hubSlotError(rows(3), { id: 99, section: "tax" }, 2, 4)).toContain("2번 자리에 이미");
    expect(hubSlotError(rows(3), { id: 99, section: "tax" }, 5, 4)).toContain("1~4번");
    expect(hubSlotError(rows(4, "realestate"), { id: 99, section: "tax" }, 1, 4)).toBeNull();
  });

  test("이미 허브에 있는 카드가 자기 자리를 다시 고르는 것은 겹침이 아니다", () => {
    expect(hubSlotError(rows(4), { id: 2, section: "tax" }, 2, 4)).toBeNull();
  });

  test("상한 설정이 바뀌면 그 값으로 센다 (settings.hub_situation_limit)", () => {
    expect(hubSlotError(rows(2), { id: 99, section: "tax" }, 3, 2)).toContain("2장까지");
    expect(nextFreeSlot(rows(2), "tax", 2)).toBeNull();
    expect(nextFreeSlot(rows(2), "tax", 4)).toBe(3);
    expect(nextFreeSlot([{ id: 1, section: "tax", hub_slot: 2 }], "tax", 4)).toBe(1);
  });

  test("허브 순서 — 그 분야 허브 카드 전부를 보내야 하고, 자리가 바뀌는 카드만 고친다", () => {
    const current = [
      { id: 10, section: "tax", hub_slot: 1 },
      { id: 11, section: "tax", hub_slot: 2 },
      { id: 12, section: "tax", hub_slot: 3 },
    ];
    expect(hubOrderPlan(current, [11, 10, 12])).toEqual({ ok: true, value: [{ id: 11, slot: 1 }, { id: 10, slot: 2 }] });
    expect(hubOrderPlan(current, [11, 10]).ok).toBe(false);
    expect(hubOrderPlan(current, [11, 10, 99]).ok).toBe(false);
    expect(parseHubOrder({ section: "tax", ids: [1, 1] }).ok).toBe(false);
    expect(parseHubOrder({ section: "tourism", ids: [1] }).ok).toBe(false);
    expect(parseHubOrder({ section: "local", ids: [3, 1] })).toEqual({ ok: true, value: { section: "local", ids: [3, 1] } });
  });
});

describe("화면 폼 → 본문 (API를 부르기 전에 2개·4개를 막는다)", () => {
  const filled = (over: Partial<SituationForm> = {}): SituationForm => ({
    ...emptySituationForm(),
    slug: "home-bought",
    section: "realestate",
    title: "집을 샀어요",
    pictogram: "home-bought",
    checks: [
      { title: "취득일", when: "잔금일", note: "" },
      { title: "주택 수", when: "", note: "" },
      { title: "감면", when: "", note: "생애최초 여부" },
    ],
    ...over,
  });

  test("새 폼은 빈 확인 칸 3개와 FAM-02 고지 문장으로 시작한다", () => {
    const f = emptySituationForm();
    expect(f.checks).toHaveLength(3);
    expect(f.checklistNotice).toBe(CHECKLIST_NOTICE);
  });

  test.each([2, 4])("먼저 확인할 것 %s개 → 묶음 칸 오류 (본문 0)", (n) => {
    const form = filled({ checks: Array.from({ length: n }, (_, i) => ({ ...emptyCheck(), title: `확인 ${i + 1}` })) });
    const r = situationFormToBody(form, "create");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[FIELD.checks]).toBe(`먼저 확인할 것은 정확히 3개여야 합니다 — 지금 ${n}개입니다`);
  });

  test("3개 — 본문 모양이 API와 같다 (빈 때·할 일은 빼고, 줄마다 하나인 칸은 목록으로)", () => {
    const r = situationFormToBody(filled({ mistakes: "취득일을 계약일로 착각\n\n", articleIds: "12, 7", toolLinks: ["sm_calculator", "x"], regionSelect: true }), "create");
    expect(r.ok && r.body).toEqual({
      slug: "home-bought",
      section: "realestate",
      title: "집을 샀어요",
      subtitle: null,
      pictogram: "home-bought",
      checks: [{ title: "취득일", when: "잔금일" }, { title: "주택 수" }, { title: "감면", note: "생애최초 여부" }],
      checklist: null,
      mistakes: ["취득일을 계약일로 착각"],
      articleIds: [12, 7],
      solvedCaseIds: [],
      glossaryIds: [],
      toolLinks: ["sm_calculator"],
      regionSelect: true,
      aliases: [],
    });
    expect(parseSituationCreate((r as { body: Record<string, unknown> }).body).ok).toBe(true);
  });

  test("칸마다 오류 — 빈 확인 제목·분야 없음·픽토그램 없음·번호 아닌 글자·자주 틀리는 점 4개·고지 없는 체크리스트", () => {
    const r = situationFormToBody(
      filled({
        section: "",
        pictogram: "",
        checks: [{ ...emptyCheck(), title: "a" }, emptyCheck(), { ...emptyCheck(), title: "c" }],
        articleIds: "12, 기사",
        mistakes: "1\n2\n3\n4",
        checklistItems: "상속 등기",
        checklistNotice: "",
      }),
      "create",
    );
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(
      [FIELD.section, FIELD.pictogram, FIELD.check(1, "title"), FIELD.articleIds, FIELD.mistakes, FIELD.checklistNotice].sort(),
    );
  });

  test("고치기 폼은 주소를 보내지 않는다 · 저장된 행 → 폼 → 본문이 원래 값", () => {
    const row = {
      slug: "car-sold",
      section: "tax",
      title: "차를 팔았어요",
      subtitle: "돌려받을 세금",
      pictogram: "car-sold",
      checks: [{ title: "a", when: "판 날" }, { title: "b" }, { title: "c", note: "통장" }],
      checklist: { items: ["x", "y"], notice: CHECKLIST_NOTICE },
      mistakes: ["m"],
      article_ids: [5],
      solved_case_ids: [6],
      glossary_ids: [7],
      tool_links: [{ feature: "expert_finder" }],
      region_select: false,
      aliases: ["차 팔았어요", "폐차"],
    };
    const r = situationFormToBody(situationToForm(row), "patch");
    expect(r.ok && r.body).toEqual({
      section: "tax",
      title: "차를 팔았어요",
      subtitle: "돌려받을 세금",
      pictogram: "car-sold",
      checks: row.checks,
      checklist: row.checklist,
      mistakes: ["m"],
      articleIds: [5],
      solvedCaseIds: [6],
      glossaryIds: [7],
      toolLinks: ["expert_finder"],
      regionSelect: false,
      aliases: ["차 팔았어요", "폐차"],
    });
  });
});


describe("검색 별칭 (SRCH-01 — 독자가 상황을 부르는 말, 설계 2.3 alias_limits)", () => {
  const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");
  const limits = [...MD.split("\n").find((l) => l.startsWith("| alias_limits "))!.split("|")[2]!.matchAll(/`([^`]*)`/g)].map((m) => Number(m[1]));

  test("한도는 설계 문서 2.3과 같다 (DB 제약 situations_aliases_shape)", () => {
    expect([ALIASES_MAX, ALIAS_CHARS_MAX]).toEqual(limits);
  });

  test("만들기·고치기 — 앞뒤 공백을 지운 목록, 20개·50자는 받는다", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `별칭 ${i + 1}`);
    const r = parseSituationCreate(create({ aliases: ["  차 팔았어요 ", "폐차", "가".repeat(50), ...twenty.slice(3)] }));
    expect(r.ok && r.value.aliases).toEqual(["차 팔았어요", "폐차", "가".repeat(50), ...twenty.slice(3)]);
    const patch = parseSituationPatch({ aliases: ["자동차 팔았어요"] });
    expect(patch.ok && patch.value).toEqual({ content: { aliases: ["자동차 팔았어요"] }, placement: {} });
    expect(parseSituationPatch({ aliases: [] }).ok).toBe(true);
  });

  test.each([
    [Array.from({ length: 21 }, (_, i) => `별칭 ${i}`), "situation.aliases: 검색 별칭은 20개까지입니다 — 지금 21개"],
    [["가".repeat(51)], `situation.aliases: 별칭마다 50자 이하로 줄이세요 — ‘${"가".repeat(51)}’`],
    [["  "], "situation.aliases: 빈 별칭이 있습니다"],
    [["?!·"], "situation.aliases: 글자나 숫자가 없는 별칭은 찾을 수 없습니다 — ‘?!·’"],
    [["차 팔았어요", "차팔았어요"], "situation.aliases: 같은 별칭이 두 번 있습니다(띄어쓰기·기호만 다른 것 포함) — ‘차팔았어요’"],
    ["차 팔았어요", "situation.aliases: 글자 목록이어야 합니다"],
    [[1], "situation.aliases: 글자 목록이어야 합니다"],
  ])("%j → 거부", (aliases, message) => {
    const r = parseSituationPatch({ aliases });
    expect(!r.ok && r.errors).toEqual([message]);
  });

  test("화면 폼 — 한 줄에 하나(빈 줄은 뺀다), 21줄·51자·같은 별칭은 API를 부르기 전에 칸 오류", () => {
    const base = { ...emptySituationForm(), slug: "car-sold", section: "tax", title: "차를 팔았어요", pictogram: "car-sold", checks: checks(3).map((c) => ({ ...emptyCheck(), ...c })) };
    const ok = situationFormToBody({ ...base, aliases: "차 팔았어요\n\n  폐차  \n" }, "create");
    expect(ok.ok && ok.body.aliases).toEqual(["차 팔았어요", "폐차"]);
    const cases: Array<[string, string]> = [
      [Array.from({ length: 21 }, (_, i) => `별칭 ${i}`).join("\n"), "검색 별칭은 20개까지입니다 — 지금 21개"],
      ["가".repeat(51), "별칭마다 50자 이하로 줄이세요 — 1번째 줄"],
      ["차 팔았어요\n차팔았어요", "같은 별칭이 두 번 있습니다(띄어쓰기·기호만 다른 것 포함) — 2번째 줄"],
      ["?!", "글자나 숫자가 없는 별칭은 찾을 수 없습니다 — 1번째 줄"],
    ];
    for (const [aliases, message] of cases) {
      const r = situationFormToBody({ ...base, aliases }, "create");
      expect(!r.ok && r.errors).toEqual({ [FIELD.aliases]: message });
    }
  });

  test("저장된 행의 별칭 → 폼은 한 줄에 하나, 별칭 칸이 없는 옛 행은 빈 칸", () => {
    expect(situationToForm({ ...rowLike, aliases: ["차 팔았어요", "폐차"] }).aliases).toBe("차 팔았어요\n폐차");
    expect(situationToForm(rowLike).aliases).toBe("");
  });
});
