// 프로젝트 트래커 규칙 (W4 12단계 — docs/dev/W4_설계.md 1장 12단계 · 2.1 · 2.2 · 12장 #10, PRD-01B PR-02 · PR-03 · PR-05)
// 사업 유형·단계 목록·고시는 모두 시험용 가짜다. DB 트리거(마이그레이션 …47)와 같은 규칙인지는 DB 시험 w4-projects.test.mjs가 같은 경우로 본다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { SETTING_SPECS, validateSettingValue } from "@/lib/admin/settings-rules";
import {
  NOTE_AMOUNT_RE,
  PROJECT_EVENT_KINDS,
  PROJECT_LIMITS,
  PROJECT_SETTING_SEEDS,
  PROJECT_STATUSES,
  EVENT_OP_KINDS,
  NO_PROJECT_TYPES,
  PRICE_WORDS,
  PROJECT_LINK_OPS,
  PROJECT_OPS,
  PUBLISH_TARGETS,
  currentStage,
  effectiveEvents,
  errorsByField,
  idOf,
  parseCreateProject,
  parseEventRequest,
  parseProjectLink,
  parsePublish,
  priceKeyErrors,
  priceWordsIn,
  usableProjectTypes,
  parseProjectTypes,
  parseStageLists,
  projectEventErrors,
  projectNoteWarnings,
  projectPublishErrors,
  projectRegionErrors,
  projectSettingsCrossErrors,
  projectStageListsErrors,
  projectTypeErrors,
  projectTypesErrors,
  stageKeysOf,
  type ProjectEventInput,
  type ProjectEventRow,
} from "./project-rules";

const ROOT = path.resolve(__dirname, "../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000047_w4_projects.sql"), "utf8");
const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const codes = (line: string) => [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const sqlCheck = (column: string) => {
  const m = new RegExp(`\\b${column} text not null (?:default '[a-z_]+' )?check \\(${column} in \\(([^)]+)\\)\\)`).exec(MIGRATION);
  if (!m) throw new Error(`마이그레이션에 ${column} check가 없다`);
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
};

const TYPES = { siheom_redev: { label: "시험용 재개발" }, siheom_small: { label: "시험용 소규모" } };
const LISTS = {
  siheom_redev: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "plan", label: "시험용 계획인가" },
    { key: "build", label: "시험용 착공" },
    { key: "done", label: "시험용 준공" },
  ],
  siheom_small: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "done", label: "시험용 준공" },
  ],
};
const KEYS = stageKeysOf(LISTS, "siheom_redev");
const FULL: ProjectEventInput = {
  kind: "stage",
  stage: "zone",
  notice_no: "시험용 고시 제2026-1호",
  notice_date: "2026-01-15",
  issuer: "시험용 가상구청",
  source_url: "https://gasang.example/notice/siheom-1",
  snapshot_id: 7,
  license_type: "kogl_1",
};
let nextId = 0;
const ev = (over: Partial<ProjectEventRow>): ProjectEventRow => ({ id: ++nextId, kind: "stage", stage: "zone", public: true, correction_of: null, recorded_at: `2026-10-0${(nextId % 9) + 1}T00:00:00Z`, ...over });
const errs = (input: ProjectEventInput, events: ProjectEventRow[] = []) => projectEventErrors(input, { stageKeys: KEYS, events });

describe("값 목록 = 설계 2.1 · 2.2 = 마이그레이션 …47 = 코드 상수", () => {
  test("project.status 3종 · project_event.kind 3종", () => {
    expect(codes(row("| project.status |"))).toEqual([...PROJECT_STATUSES]);
    expect(codes(row("| project_event.kind |"))).toEqual([...PROJECT_EVENT_KINDS]);
    expect(sqlCheck("status")).toEqual([...PROJECT_STATUSES]);
    expect(sqlCheck("kind")).toEqual([...PROJECT_EVENT_KINDS]);
  });
  test("설정 씨앗 둘 다 빈 값({}) — 12장 #10, 마이그레이션 씨앗과 같다", () => {
    expect(codes(row("| `project_types` · `project_stage_lists` |")).map((c) => JSON.parse(c))).toEqual([{}]);
    expect(PROJECT_SETTING_SEEDS).toEqual({ project_types: {}, project_stage_lists: {} });
    expect(MIGRATION).toContain("('project_types', '{}'::jsonb,");
    expect(MIGRATION).toContain("('project_stage_lists', '{}'::jsonb,");
  });
  test("한도 = DB 트리거 상수 (유형 30 · 단계 2~40 · 글자 40)", () => {
    expect(PROJECT_LIMITS).toEqual({ types: 30, stagesMin: 2, stagesMax: 40, label: 40 });
    expect(MIGRATION).toMatch(/> 30 then\s+raise exception '사업 유형\(project_types\)은 30개까지/);
    expect(MIGRATION).toContain("jsonb_array_length(v_v) < 2 or jsonb_array_length(v_v) > 40");
    expect(MIGRATION).toContain("length(v_v ->> 'label') > 40");
  });
});

describe("설정 검사 — project_types · project_stage_lists (운영 설정 화면 = DB 트리거)", () => {
  test("빈 값·시험용 목록은 받는다 — 설정 화면 검사도 같은 함수", () => {
    expect(projectTypesErrors({})).toEqual([]);
    expect(projectTypesErrors(TYPES)).toEqual([]);
    expect(projectStageListsErrors({})).toEqual([]);
    expect(projectStageListsErrors(LISTS)).toEqual([]);
    expect(validateSettingValue("project_types", TYPES, {})).toEqual({ ok: true, value: TYPES });
    expect(validateSettingValue("project_stage_lists", LISTS, {})).toEqual({ ok: true, value: LISTS });
    expect(SETTING_SPECS.project_types?.label).toMatch(/PR-02/);
    expect(parseProjectTypes(TYPES)).toEqual(TYPES);
    expect(parseStageLists({ x: [] })).toBeNull();
  });
  test.each([
    [[], /객체/],
    [{ Bad: { label: "시험용" } }, /Bad: 사업 유형 키/],
    [{ a: { label: "시험용" } }, /a: 사업 유형 키/],
    [{ siheom_a: "시험용" }, /siheom_a: 값은/],
    [{ siheom_a: { label: " " } }, /siheom_a: 값은/],
    [{ siheom_a: { label: "가".repeat(41) } }, /siheom_a: 값은/],
    [{ siheom_a: { label: "시험용", sort: 1 } }, /siheom_a: 값은/],
    [{ siheom_a: { label: "시험용" }, siheom_b: { label: "시험용" } }, /siheom_b: 사업 유형 글자 '시험용'가 두 번/],
    [Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`siheom_${i}`, { label: `시험용 ${i}` }])), /30개까지/],
  ])("project_types 거부 %j", (value, re) => {
    expect(projectTypesErrors(value).join("\n")).toMatch(re);
    expect(validateSettingValue("project_types", value, {}).ok).toBe(false);
  });
  test.each([
    [null, /객체/],
    [{ siheom_redev: [{ key: "zone", label: "시험용 1" }] }, /2~40단계/],
    [{ siheom_redev: { zone: "시험용" } }, /2~40단계/],
    [{ siheom_redev: Array.from({ length: 41 }, (_, i) => ({ key: `s_${i}`, label: `시험용 ${i}` })) }, /2~40단계/],
    [{ siheom_redev: [{ key: "zone", label: "시험용 1" }, { key: "zone", label: "시험용 2" }] }, /\[1\]: 단계 키 zone가 두 번/],
    [{ siheom_redev: [{ key: "zone", label: "시험용" }, { key: "done", label: "시험용" }] }, /\[1\]: 단계 글자/],
    [{ siheom_redev: [{ key: "Zone", label: "시험용 1" }, { key: "done", label: "시험용 2" }] }, /\[0\]: 단계는/],
    [{ siheom_redev: [{ key: "zone" }, { key: "done", label: "시험용 2" }] }, /\[0\]: 단계는/],
    [{ siheom_redev: [{ key: "zone", label: "시험용 1", date: "x" }, { key: "done", label: "시험용 2" }] }, /\[0\]: 단계는/],
  ])("project_stage_lists 거부 %j", (value, re) => {
    expect(projectStageListsErrors(value).join("\n")).toMatch(re);
  });
  test("두 설정 사이 — 단계 목록의 유형은 project_types에, 단계 목록이 있는 유형은 빼지 못함", () => {
    expect(projectSettingsCrossErrors("project_stage_lists", LISTS, {})).toEqual([
      "siheom_redev: project_types에 없는 사업 유형입니다 — 사업 유형을 먼저 넣으세요",
      "siheom_small: project_types에 없는 사업 유형입니다 — 사업 유형을 먼저 넣으세요",
    ]);
    expect(projectSettingsCrossErrors("project_stage_lists", LISTS, TYPES)).toEqual([]);
    expect(projectSettingsCrossErrors("project_types", { siheom_redev: TYPES.siheom_redev }, LISTS)).toEqual([
      "siheom_small: 단계 목록이 있는 사업 유형은 뺄 수 없습니다 — 먼저 project_stage_lists에서 빼세요",
    ]);
    expect(projectSettingsCrossErrors("project_types", TYPES, undefined)).toEqual([]);
  });
});

describe("프로젝트 — 지역·사업 유형·공개", () => {
  test("지역 코드는 오늘(KST 날짜) 유효한 행정구역만 — 폐지 오늘은 받고 어제는 거부, 시작 내일 거부", () => {
    const today = "2026-10-23";
    expect(projectRegionErrors("9901100000", { valid_from: null, valid_to: null }, today)).toEqual([]);
    expect(projectRegionErrors("9901400000", { valid_from: null, valid_to: today }, today)).toEqual([]);
    expect(projectRegionErrors("9901200000", { valid_from: null, valid_to: "2026-10-22" }, today)).toEqual(["region_code: 9901200000는 오늘 유효한 행정구역(regions)이 아닙니다"]);
    expect(projectRegionErrors("9901300000", { valid_from: "2026-10-24", valid_to: null }, today)).toHaveLength(1);
    expect(projectRegionErrors("9909900000", null, today)).toHaveLength(1);
    expect(projectRegionErrors("990110", null, today)).toEqual(["region_code: 법정동코드 10자리가 필요합니다"]);
  });
  test("사업 유형은 단계 목록이 있는 유형만 — 씨앗(빈 값)이면 어떤 유형도 거부", () => {
    expect(projectTypeErrors("siheom_redev", {}, {})).toHaveLength(1);
    expect(projectTypeErrors("siheom_redev", TYPES, LISTS)).toEqual([]);
    expect(projectTypeErrors("siheom_none", TYPES, LISTS)[0]).toMatch(/단계 목록이 없습니다/);
    expect(projectTypeErrors("siheom_small", TYPES, { siheom_redev: LISTS.siheom_redev })[0]).toMatch(/siheom_small의 단계 목록이 없습니다/);
    expect(projectTypeErrors("Bad", TYPES, LISTS)).toEqual(["project_type: 사업 유형 키가 필요합니다"]);
    expect(stageKeysOf(null, "siheom_redev")).toEqual([]);
    expect(stageKeysOf(LISTS, "toString")).toEqual([]);
  });
  test("공개 — 공개 단계 기록 0건(비공개·해당 없음·거둔 기록만)·출처·확인일 없으면 거부", () => {
    const ok = { source_name: "시험용 가상구청", last_verified_at: "2026-10-20T01:00:00Z" };
    expect(projectPublishErrors(ok, [], KEYS)).toEqual(["status: 공개 단계 기록이 0건인 프로젝트는 공개할 수 없습니다 (PR-02)"]);
    const hidden = ev({ public: false });
    const na = ev({ kind: "not_applicable", stage: "plan" });
    const wrong = ev({ stage: "build" });
    const retract = ev({ kind: "correction", stage: null, correction_of: wrong.id });
    expect(projectPublishErrors(ok, [hidden, na, wrong, retract], KEYS)).toHaveLength(1);
    expect(projectPublishErrors(ok, [ev({ stage: "zone" })], KEYS)).toEqual([]);
    expect(projectPublishErrors({ source_name: " ", last_verified_at: null }, [ev({})], KEYS)).toEqual([
      "source_name: 데이터 출처가 있어야 공개합니다 (PR-02 데이터 출처 줄)",
      "last_verified_at: 정보 확인일이 있어야 공개합니다 (PR-02 데이터 출처 줄)",
    ]);
  });
});

describe("단계 기록 — 칸 검사 (PR-03 — DB 제약 project_events_evidence와 같다)", () => {
  test("증거가 모두 찬 단계 기록은 받는다", () => {
    expect(errs(FULL)).toEqual([]);
  });
  test.each([
    ["notice_no", { notice_no: " " }, "notice_no: 고시 번호가 필요합니다 (PR-03)"],
    ["notice_date 빈 값", { notice_date: undefined }, "notice_date: 고시일(YYYY-MM-DD)이 필요합니다 (PR-03)"],
    ["notice_date 없는 날", { notice_date: "2026-02-30" }, "notice_date: 고시일(YYYY-MM-DD)이 필요합니다 (PR-03)"],
    ["issuer", { issuer: "" }, "issuer: 고시 기관이 필요합니다 (PR-03)"],
    ["source_url", { source_url: "gasang.example/notice" }, "source_url: 고시 원문 주소(http·https)가 필요합니다 (PR-03)"],
    ["snapshot_id", { snapshot_id: null }, "snapshot_id: 원본 스냅샷이 필요합니다 (PR-03)"],
    ["snapshot_id 글자", { snapshot_id: "7" }, "snapshot_id: 원본 스냅샷이 필요합니다 (PR-03)"],
    ["license_type", { license_type: "kogl_9" }, "license_type: 원문의 공공누리 유형이 필요합니다 (PR-07)"],
  ])("%s가 없으면 그 칸 오류 하나", (_label, over, message) => {
    expect(errs({ ...FULL, ...over })).toEqual([message]);
  });
  test("목록 밖 단계·단계 없음·kind 값 목록 밖", () => {
    expect(errs({ ...FULL, stage: "siheom_unknown" })).toEqual(["stage: siheom_unknown는 이 사업 유형의 단계 목록에 없습니다"]);
    expect(projectEventErrors({ ...FULL, stage: "plan" }, { stageKeys: stageKeysOf(LISTS, "siheom_small"), events: [] })[0]).toMatch(/plan는 이 사업 유형의 단계 목록에 없습니다/);
    expect(errs({ ...FULL, stage: undefined })).toContain("stage: 단계가 필요합니다");
    expect(errs({ ...FULL, kind: "siheom" })).toEqual(["kind: stage·not_applicable·correction 중 하나입니다"]);
    expect(errs({ ...FULL, public: "yes" })).toEqual(["public: true 또는 false입니다"]);
    expect(errs({ ...FULL, correction_of: 3 })).toEqual(["correction_of: 정정 기록(kind correction)에만 씁니다"]);
  });
});

describe("단계 기록 — 순서·정정 (DB 트리거 project_events_check와 같다)", () => {
  const zone = ev({ stage: "zone" });
  const build = ev({ stage: "build" });
  test("같은 단계·앞 순서 거부, 다음 단계는 받는다", () => {
    expect(errs({ ...FULL, stage: "build" }, [zone, build])).toEqual(["stage: 이미 기록된 단계입니다 (build) — 고치려면 정정 기록을 쓰세요"]);
    expect(errs({ ...FULL, stage: "plan" }, [zone, build])).toEqual(["stage: 앞 순서 단계로 돌아가는 기록은 거부합니다 (현재 build → 새 기록 plan) — 잘못된 기록은 정정 기록으로 고치세요"]);
    expect(errs({ ...FULL, stage: "done" }, [zone, build])).toEqual([]);
  });
  test("비공개 기록도 순서·같은 단계 검사에 든다", () => {
    const hiddenBuild = ev({ stage: "build", public: false });
    expect(errs({ ...FULL, stage: "plan" }, [zone, hiddenBuild])[0]).toMatch(/앞 순서/);
    expect(errs({ ...FULL, stage: "build" }, [zone, hiddenBuild])[0]).toMatch(/이미 기록된 단계/);
  });
  test("해당 없음 — 사유 필수, 앞 순서여도 받는다, 같은 단계 두 번은 거부, 증거 칸은 보지 않는다", () => {
    expect(errs({ kind: "not_applicable", stage: "plan" }, [zone, build])).toEqual(["reason: 이 단계가 없는 사유가 필요합니다"]);
    expect(errs({ kind: "not_applicable", stage: "plan", reason: "시험용 사유" }, [zone, build])).toEqual([]);
    const na = ev({ kind: "not_applicable", stage: "plan" });
    expect(errs({ kind: "not_applicable", stage: "plan", reason: "시험용" }, [zone, build, na])[0]).toMatch(/이미 기록된 단계/);
    // 해당 없음과 같은 단계의 단계 기록도 거부
    expect(errs({ ...FULL, stage: "plan" }, [zone, na])[0]).toMatch(/이미 기록된 단계/);
  });
  test("정정 — 사유 필수 · 같은 프로젝트 기록만 · 한 번만 · 거두기(단계 없음)는 증거 없이 · 바꿔 적기는 증거 필수·다른 기록과 같은 단계 거부", () => {
    expect(errs({ kind: "correction", correction_of: build.id }, [zone, build])).toEqual(["reason: 정정 사유가 필요합니다"]);
    expect(errs({ kind: "correction", correction_of: 9999, reason: "시험용" }, [zone, build])).toEqual(["correction_of: 같은 프로젝트의 기록 번호가 필요합니다"]);
    expect(errs({ kind: "correction", correction_of: build.id, reason: "시험용 거두기" }, [zone, build])).toEqual([]);
    const retract = ev({ kind: "correction", stage: null, correction_of: build.id });
    expect(errs({ kind: "correction", correction_of: build.id, reason: "시험용 두 번째" }, [zone, build, retract])[0]).toMatch(/이미 정정된 기록/);
    // 정정을 정정 — 거두기를 바꿔 적기로
    expect(errs({ ...FULL, kind: "correction", stage: "build", correction_of: retract.id, reason: "시험용" }, [zone, build, retract])).toEqual([]);
    expect(errs({ ...FULL, kind: "correction", stage: "build", correction_of: retract.id, reason: "시험용", notice_no: "" }, [zone, build, retract])).toEqual([
      "notice_no: 고시 번호가 필요합니다 (PR-03)",
    ]);
    expect(errs({ ...FULL, kind: "correction", stage: "zone", correction_of: build.id, reason: "시험용" }, [zone, build])[0]).toMatch(/이미 기록된 단계입니다 \(zone\) — 그 기록을 정정하세요/);
    expect(errs({ ...FULL, kind: "correction", stage: "zone", correction_of: zone.id, reason: "시험용 — 고시 번호 오기" }, [zone, build])).toEqual([]);
  });
});

describe("현재 단계 — 가장 늦은 순서의 공개 기록 (뷰 project_current_stages와 같다)", () => {
  test("비공개·해당 없음·정정된 기록 빼고, 바꿔 적은 기록은 넣는다", () => {
    const zone = ev({ stage: "zone" });
    const plan = ev({ stage: "plan" });
    const hiddenBuild = ev({ stage: "build", public: false });
    const na = ev({ kind: "not_applicable", stage: "done" });
    expect(currentStage([], KEYS)).toBeNull();
    expect(currentStage([zone, plan, hiddenBuild, na], KEYS)?.stage).toBe("plan");
    const publish = ev({ kind: "correction", stage: "build", correction_of: hiddenBuild.id, public: true });
    expect(currentStage([zone, plan, hiddenBuild, na, publish], KEYS)?.id).toBe(publish.id);
    const retractPlan = ev({ kind: "correction", stage: null, correction_of: plan.id });
    expect(effectiveEvents([zone, plan, retractPlan]).map((e) => e.id)).toEqual([zone.id, retractPlan.id]);
    expect(currentStage([zone, plan, retractPlan], KEYS)?.stage).toBe("zone");
  });
  test("단계 목록 순서를 바꾸면 그 순서로", () => {
    const events = [ev({ stage: "zone" }), ev({ stage: "plan" }), ev({ stage: "build" })];
    expect(currentStage(events, ["build", "zone", "plan", "done"])?.stage).toBe("plan");
  });
});

describe("메모 저장 경고 — 숫자 + 원·% (PR-05, 막지 않음 — DB project_note_has_amount와 같은 견본)", () => {
  // DB 시험 w4-projects.test.mjs NOTE_SAMPLES와 같은 견본
  test.each([
    ["시험용 3억 원", true],
    ["시험용 5,000만원", true],
    ["시험용 1억5천만 원", true],
    ["시험용 12.5%", true],
    ["시험용 3 %p", true],
    ["시험용 7％", true],
    ["시험용 1000원에", true],
    ["시험용 고시 제2026-15호 원문", false],
    ["시험용 원문 3 원본", false],
    ["시험용 2단계 원문 확인", false],
    ["시험용 2026-10-20 고시", false],
    ["시험용 금액 없음", false],
  ])("%s → %s", (note, expected) => {
    expect(NOTE_AMOUNT_RE.test(note)).toBe(expected);
    expect(projectNoteWarnings(note)).toHaveLength(expected ? 1 : 0);
  });
  test("빈 메모·글자 아닌 값은 경고 0, 경고가 있어도 칸 오류는 0", () => {
    expect(projectNoteWarnings(null)).toEqual([]);
    expect(projectNoteWarnings(3)).toEqual([]);
    expect(errs({ ...FULL, note: "시험용 3억 원" })).toEqual([]);
    expect(projectNoteWarnings("시험용 3억 원")[0]).toMatch(/PR-05 저장 경고/);
  });
});

// ── 14단계 관리 API 입력 (/api/admin/projects — 1장 14단계 '칸별 오류(고시 번호·원문·스냅샷·단계) 422') ──

const TODAY = "2026-10-23";
const VALID_REGION = { valid_from: null, valid_to: null };
const CREATE = { op: "create", slug: "siheom-project", name: "시험용 프로젝트", region_code: "9901100000", project_type: "siheom_redev" };
const ctxCreate = (over: Partial<Parameters<typeof parseCreateProject>[1]> = {}) => ({ types: TYPES, lists: LISTS, region: VALID_REGION, today: TODAY, ...over });
const fieldsOf = (errors: string[]) => Object.keys(errorsByField(errors)).sort();
const errorsOf = (r: { ok: true } | { ok: false; errors: string[] }) => (r.ok ? [] : r.errors);
const NOTICE = {
  stage: "zone",
  notice_no: "시험용 고시 제2026-1호",
  notice_date: "2026-01-15",
  issuer: "시험용 가상구청",
  source_url: "https://gasang.example/notice/siheom-1",
  snapshot_payload: "시험용 고시 원문",
  license_type: "kogl_1",
};
const evReq = (op: "event" | "correct", body: Record<string, unknown>, events: ProjectEventRow[] = []) => parseEventRequest(op, { project_id: 5, ...body }, { stageKeys: KEYS, events });

describe("관리 API 값 목록 (1장 14단계 op · 2.10 가격 사전)", () => {
  test("op 5종 = 설계 1장 14단계 줄 · 연결 작업 4종 = 13단계 API · 공개 전환 2종 · op=event 기록 종류 2종", () => {
    expect(row("| 14 프로젝트 관리 화면 |")).toContain(`op = ${PROJECT_OPS.join("·")}`);
    expect([...PROJECT_LINK_OPS]).toEqual(["suggest", "create", "confirm", "remove"]);
    expect([...PUBLISH_TARGETS]).toEqual(["public", "hidden"]);
    expect([...EVENT_OP_KINDS]).toEqual(["stage", "not_applicable"]);
  });
  test("가격 사전 = 설계 2.10 낱말 16개 = check-price-fields.mjs PRICE_WORDS", () => {
    const line = row("낱말(소문자, 밑줄 무시, 칸 이름 일부):").split(". 시험은")[0]!;
    expect([...PRICE_WORDS]).toEqual([...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const script = fs.readFileSync(path.join(ROOT, "packages", "db", "scripts", "check-price-fields.mjs"), "utf8");
    const list = /PRICE_WORDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(script)![1]!;
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...PRICE_WORDS]);
  });
  test("낱말 맞추기 — 소문자·밑줄 무시·일부 일치, 관리 API 칸 이름은 0", () => {
    expect(priceWordsIn("Sale_Price")).toEqual(["price"]);
    expect(priceWordsIn("saleamount")).toEqual(["sale_amount"]);
    expect(priceWordsIn("조합원분담금")).toEqual(["분담금"]);
    for (const k of ["op", "slug", "name", "region_code", "project_type", "landmark", "summary", "source_name", "project_id", "kind", "stage", "notice_no", "notice_date", "issuer", "source_url", "snapshot_id", "snapshot_payload", "license_type", "note", "correction_of", "reason", "public", "status", "verified", "linkOp", "toType", "toId", "relation", "confirm", "linkId"]) {
      expect(priceWordsIn(k)).toEqual([]);
    }
  });
});

describe("op=create — 칸별 422 · 빈 사업 유형 목록은 만들기 막음 (12장 #10)", () => {
  test("시험용 목록·오늘 유효한 지역이면 초안 값", () => {
    expect(parseCreateProject({ ...CREATE, summary: " 요약 ", source_name: "", landmark: true }, ctxCreate())).toEqual({
      ok: true,
      value: { slug: "siheom-project", name: "시험용 프로젝트", region_code: "9901100000", project_type: "siheom_redev", landmark: true, summary: "요약", source_name: null },
    });
  });
  test("빈 씨앗({}) — project_type 칸에 안내 문장 하나, 다른 칸이 맞아도 거부", () => {
    for (const settings of [{ types: {}, lists: {} }, { types: null, lists: null }, { types: TYPES, lists: {} }]) {
      expect(errorsOf(parseCreateProject(CREATE, ctxCreate(settings)))).toEqual([`project_type: ${NO_PROJECT_TYPES}`]);
    }
    expect(NO_PROJECT_TYPES.startsWith("사업 유형 목록이 아직 없습니다")).toBe(true);
    expect(usableProjectTypes({}, {})).toEqual([]);
    expect(usableProjectTypes(TYPES, { siheom_small: LISTS.siheom_small })).toEqual([["siheom_small", "시험용 소규모"]]);
  });
  test("칸마다 사유 — 주소·이름·지역(모양·오늘 유효 아님·폐지 오늘은 받음)·목록 밖 유형·대표 표시 모양", () => {
    expect(fieldsOf(errorsOf(parseCreateProject({ op: "create" }, ctxCreate({ region: null }))))).toEqual(["name", "project_type", "region_code", "slug"]);
    expect(errorsOf(parseCreateProject({ ...CREATE, slug: "Siheom Project" }, ctxCreate()))).toEqual(["slug: 주소는 영문 소문자·숫자와 '-'만 씁니다 (예: siheom-project)"]);
    expect(errorsOf(parseCreateProject({ ...CREATE, region_code: "99011" }, ctxCreate()))).toEqual(["region_code: 법정동코드 10자리가 필요합니다"]);
    expect(errorsOf(parseCreateProject(CREATE, ctxCreate({ region: { valid_from: null, valid_to: "2026-10-22" } })))).toEqual(["region_code: 9901100000는 오늘 유효한 행정구역(regions)이 아닙니다"]);
    expect(errorsOf(parseCreateProject(CREATE, ctxCreate({ region: { valid_from: null, valid_to: TODAY } })))).toEqual([]);
    expect(fieldsOf(errorsOf(parseCreateProject({ ...CREATE, project_type: "siheom_none" }, ctxCreate())))).toEqual(["project_type"]);
    expect(errorsOf(parseCreateProject({ ...CREATE, landmark: "yes" }, ctxCreate()))).toEqual(["landmark: true 또는 false입니다"]);
  });
  test("가격·분담금·수익률·시세 칸을 보내면 그 칸마다 422 (PR-05 — 받는 칸 0)", () => {
    const errors = errorsOf(parseCreateProject({ ...CREATE, sale_price: 1, contribution_note: "x", 예상수익률: "y", market_value: 2 }, ctxCreate()));
    expect(errors).toHaveLength(4);
    expect(fieldsOf(errors)).toEqual(["contribution_note", "market_value", "sale_price", "예상수익률"]);
    expect(errors).toContain("예상수익률: 가격·분양가·분담금·수익률·시세는 프로젝트에 저장하지 않습니다 — 가격 정보는 편집 승인을 거친 기사로만 씁니다 (PR-05)");
    expect(priceKeyErrors({ slug: "a", stage: "zone" })).toEqual([]);
  });
});

describe("op=event·correct — 고시 6칸·단계·사유 칸별 422 (PR-03 — DB 제약·트리거와 같은 규칙)", () => {
  test("고시 6칸 + 붙여 넣은 원문 → 저장 값(스냅샷은 저장 직전에 만든다) · 스냅샷 번호도 받는다", () => {
    const r = evReq("event", { ...NOTICE, note: "시험용 메모" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ projectId: 5, snapshotPayload: "시험용 고시 원문", evidence: true, warnings: [] });
    expect(r.value.input).toMatchObject({ kind: "stage", stage: "zone", notice_no: "시험용 고시 제2026-1호", snapshot_id: null, license_type: "kogl_1", public: true, correction_of: null, note: "시험용 메모" });
    const byId = evReq("event", { ...NOTICE, snapshot_payload: undefined, snapshot_id: "12" });
    expect(byId.ok && byId.value.input.snapshot_id).toBe(12);
  });
  test.each([
    ["고시 번호", { notice_no: " " }, "notice_no: 고시 번호가 필요합니다 (PR-03)"],
    ["고시일", { notice_date: "2026-02-30" }, "notice_date: 고시일(YYYY-MM-DD)이 필요합니다 (PR-03)"],
    ["고시 기관", { issuer: undefined }, "issuer: 고시 기관이 필요합니다 (PR-03)"],
    ["원문 주소", { source_url: "gasang.example/notice" }, "source_url: 고시 원문 주소(http·https)가 필요합니다 (PR-03)"],
    ["스냅샷", { snapshot_payload: "  " }, "snapshot_payload: 원본 스냅샷(원문 글자 붙여 넣기 또는 스냅샷 번호)이 필요합니다 (PR-03)"],
    ["공공누리", { license_type: "kogl_9" }, "license_type: 원문의 공공누리 유형이 필요합니다 (PR-07)"],
    ["단계(목록 밖)", { stage: "siheom_none" }, "stage: siheom_none는 이 사업 유형의 단계 목록에 없습니다"],
    ["단계(없음)", { stage: "" }, "stage: 단계가 필요합니다"],
  ])("%s 칸만 틀리면 그 칸 오류 하나", (_name, over, message) => {
    expect(errorsOf(evReq("event", { ...NOTICE, ...over }))).toEqual([message]);
  });
  test("스냅샷 번호·원문 둘 다 · 번호 모양 · 프로젝트 번호 없음 · op=event로 정정 · 모르는 종류", () => {
    expect(errorsOf(evReq("event", { ...NOTICE, snapshot_id: 3 }))).toEqual(["snapshot_payload: 원본 스냅샷 번호와 원문 글자 중 하나만 넣으세요"]);
    expect(errorsOf(evReq("event", { ...NOTICE, snapshot_payload: undefined, snapshot_id: "0" }))).toEqual([
      "snapshot_id: 원본 스냅샷 번호는 1 이상 정수입니다",
      "snapshot_payload: 원본 스냅샷(원문 글자 붙여 넣기 또는 스냅샷 번호)이 필요합니다 (PR-03)",
    ]);
    expect(errorsOf(parseEventRequest("event", NOTICE, { stageKeys: KEYS, events: [] }))).toEqual(["project_id: 프로젝트 번호가 필요합니다"]);
    expect(errorsOf(evReq("event", { ...NOTICE, kind: "correction" }))).toEqual(["kind: 정정은 op correct로 적습니다 (사유 필수)"]);
    expect(errorsOf(evReq("event", { ...NOTICE, kind: "skip" }))).toEqual(["kind: stage·not_applicable 중 하나입니다"]);
  });
  test("같은 단계·앞 순서 — 칸 stage 사유 (DB 트리거와 같은 문장)", () => {
    const events = [ev({ stage: "build" })];
    expect(errorsOf(evReq("event", { ...NOTICE, stage: "build" }, events))).toEqual(["stage: 이미 기록된 단계입니다 (build) — 고치려면 정정 기록을 쓰세요"]);
    expect(errorsOf(evReq("event", { ...NOTICE, stage: "plan" }, events))[0]).toMatch(/^stage: 앞 순서 단계로 돌아가는 기록은 거부합니다 \(현재 build → 새 기록 plan\)/);
  });
  test("해당 없음 — 사유 필수 · 증거 칸은 저장하지 않는다", () => {
    expect(errorsOf(evReq("event", { kind: "not_applicable", stage: "plan" }))).toEqual(["reason: 이 단계가 없는 사유가 필요합니다"]);
    const r = evReq("event", { kind: "not_applicable", stage: "plan", reason: "시험용 — 이 구역은 계획인가가 없다", notice_no: "무시" });
    expect(r.ok && [r.value.evidence, r.value.input.notice_no, r.value.snapshotPayload, r.value.input.reason]).toEqual([false, null, null, "시험용 — 이 구역은 계획인가가 없다"]);
  });
  test("정정 — 사유 필수·대상 필수·한 번만 · 거두기(단계 없음)는 증거 없이 · 바꿔 적기는 고시 6칸 필수", () => {
    const target = ev({ stage: "zone" });
    expect(fieldsOf(errorsOf(evReq("correct", { correction_of: String(target.id) }, [target])))).toEqual(["reason"]);
    expect(errorsOf(evReq("correct", { reason: "시험용 정정" }, [target]))).toEqual(["correction_of: 같은 프로젝트의 기록 번호가 필요합니다"]);
    const withdraw = evReq("correct", { correction_of: String(target.id), reason: "시험용 — 잘못 적은 기록" }, [target]);
    expect(withdraw.ok && [withdraw.value.input.kind, withdraw.value.input.stage, withdraw.value.input.correction_of, withdraw.value.evidence]).toEqual(["correction", null, target.id, false]);
    expect(fieldsOf(errorsOf(evReq("correct", { correction_of: target.id, reason: "시험용 바꿔 적기", stage: "plan" }, [target])))).toEqual(["issuer", "license_type", "notice_date", "notice_no", "snapshot_payload", "source_url"]);
    expect(evReq("correct", { ...NOTICE, stage: "plan", correction_of: target.id, reason: "시험용 바꿔 적기" }, [target]).ok).toBe(true);
    const fixed = ev({ kind: "correction", stage: null, correction_of: target.id });
    expect(errorsOf(evReq("correct", { correction_of: target.id, reason: "다시" }, [target, fixed]))[0]).toMatch(/^correction_of: 이미 정정된 기록\(\d+\)입니다 — 정정은 한 번만/);
    expect(errorsOf(evReq("correct", { kind: "stage", correction_of: target.id, reason: "x" }, [target]))).toEqual(["kind: 정정(op correct)의 기록 종류는 correction입니다"]);
  });
  test("메모 숫자 + 원·% → 저장은 받고 경고 (PR-05)", () => {
    const r = evReq("event", { ...NOTICE, note: "시험용 사업비 1,200억원 메모" });
    expect(r.ok && r.value.warnings).toEqual(["note: 메모에 숫자 + 원·% 표현이 있습니다 — 가격 정보는 편집 승인을 거친 기사로만 씁니다 (PR-05 저장 경고)"]);
  });
});

describe("op=publish · op=link 입력", () => {
  test("공개·내리기 · 상태 값 목록 밖 · 확인 표시 모양 · 프로젝트 번호", () => {
    expect(parsePublish({ project_id: "5", status: "public", source_name: " 시험용 출처 ", verified: true })).toEqual({ ok: true, value: { projectId: 5, status: "public", source_name: "시험용 출처", verified: true } });
    expect(parsePublish({ project_id: 5, status: "hidden" })).toEqual({ ok: true, value: { projectId: 5, status: "hidden", source_name: null, verified: false } });
    expect(fieldsOf(errorsOf(parsePublish({ status: "draft", verified: "yes" })))).toEqual(["project_id", "status", "verified"]);
  });
  test("공개 조건 미달 사유는 칸으로 나뉜다 (화면이 칸 옆에 보인다)", () => {
    expect(fieldsOf(projectPublishErrors({ source_name: null, last_verified_at: null }, [], KEYS))).toEqual(["last_verified_at", "source_name", "status"]);
    expect(errorsByField(["그냥 문장", "stage: 하나", "stage: 둘"])).toEqual({ "": ["그냥 문장"], stage: ["하나", "둘"] });
  });
  test("연결 작업 — 4종만 · 출발은 그 프로젝트 · 번호 모양", () => {
    expect(parseProjectLink({ project_id: 5, linkOp: "suggest" })).toEqual({ ok: true, value: { projectId: 5, linkOp: "suggest" } });
    expect(fieldsOf(errorsOf(parseProjectLink({ project_id: 5, linkOp: "publish", fromType: "article" })))).toEqual(["fromType", "linkOp"]);
    expect(idOf("12")).toBe(12);
    for (const bad of ["0", "-1", "1.5", "abc", "", null, 0, 1.5]) expect(idOf(bad)).toBeNull();
  });
});
