// 지역 연결 규칙 (W4 13단계 — docs/dev/W4_설계.md 2.1 · 12장 100번~, PRD-01B REG1-10) — 값 목록 = 설계 = 마이그레이션, 입력 검사, 상태 흐름
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  EDITOR_RELATIONS,
  LINK_REASON_MAX,
  LINK_RELATION_LABELS,
  LINK_TYPE_LABELS,
  REGIONAL_LINK_BLOCKED_TYPES,
  REGIONAL_LINK_ORIGINS,
  REGIONAL_LINK_RELATIONS,
  REGIONAL_LINK_STATUSES,
  REGIONAL_LINK_TYPES,
  SUGGEST_LIMIT,
  linkRefErrors,
  parseConfirmLink,
  parseCreateLink,
  parseLinkRef,
  parseRemoveLink,
  parseSuggest,
  statusConflict,
} from "./regional-link-rules";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000048_w4_regional_links.sql"), "utf8");
const designCodes = (prefix: string) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  if (!l) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return [...l.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
};
const migrationList = (constraint: string) => {
  const m = new RegExp(`constraint ${constraint} check \\(\\w+ in \\(([^)]*)\\)\\)`).exec(MIGRATION);
  if (!m) throw new Error(`마이그레이션에 ${constraint}가 없다`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

describe("값 목록 = 설계 2.1 = 마이그레이션 …48", () => {
  test("끝 종류 5 · 관계 6 · 출처 2 · 상태 3", () => {
    expect([...REGIONAL_LINK_TYPES]).toEqual(designCodes("| regional_link.from/to type |"));
    expect([...REGIONAL_LINK_TYPES]).toEqual(migrationList("regional_links_from_type"));
    expect([...REGIONAL_LINK_TYPES]).toEqual(migrationList("regional_links_to_type"));
    expect([...REGIONAL_LINK_RELATIONS]).toEqual(designCodes("| regional_link.relation |"));
    expect([...REGIONAL_LINK_RELATIONS]).toEqual(migrationList("regional_links_relation"));
    expect([...REGIONAL_LINK_ORIGINS]).toEqual(designCodes("| regional_link.origin |"));
    expect([...REGIONAL_LINK_ORIGINS]).toEqual(migrationList("regional_links_origin"));
    expect([...REGIONAL_LINK_STATUSES]).toEqual(designCodes("| regional_link.status |"));
    expect([...REGIONAL_LINK_STATUSES]).toEqual(migrationList("regional_links_status"));
  });
  test("관광 항목 3종 = 설계 '저장 거부' = DB 저장 검사 목록 · 허용 목록 밖", () => {
    expect([...REGIONAL_LINK_BLOCKED_TYPES]).toEqual(designCodes("| regional_link.blocked type (저장 거부) |"));
    expect(MIGRATION).toContain(`c_blocked constant text[] := array[${REGIONAL_LINK_BLOCKED_TYPES.map((t) => `'${t}'`).join(", ")}]`);
    for (const b of REGIONAL_LINK_BLOCKED_TYPES) expect(REGIONAL_LINK_TYPES as readonly string[]).not.toContain(b);
  });
  test("한도 = 마이그레이션 상수 (이유 300자 · 자동 후보 20건) · 글자 표는 값 목록 전부", () => {
    expect(MIGRATION).toContain(`length(reason) <= ${LINK_REASON_MAX}`);
    expect(MIGRATION).toContain(`c_limit constant integer := ${SUGGEST_LIMIT}`);
    expect(Object.keys(LINK_TYPE_LABELS)).toEqual([...REGIONAL_LINK_TYPES]);
    expect(Object.keys(LINK_RELATION_LABELS)).toEqual([...REGIONAL_LINK_RELATIONS]);
    expect(EDITOR_RELATIONS).not.toContain("related_event");
  });
});

describe("끝 검사 — 관광 항목·행사(W6)·번호 모양", () => {
  test.each([...REGIONAL_LINK_BLOCKED_TYPES])("관광 항목 %s → PRD-X 문장 (도착·출발)", (t) => {
    expect(linkRefErrors("to", t, "1")).toEqual([expect.stringMatching(new RegExp(`^toType: 관광 항목 종류\\(${t}\\)는 지역 연결에 저장하지 않습니다.*PRD-X`))]);
    expect(linkRefErrors("from", ` ${t} `, "1")[0]).toMatch(/^fromType: 관광 항목 종류/);
  });
  test("모르는 종류·행사·번호 모양", () => {
    expect(linkRefErrors("to", "shop", "1")).toEqual(["toType: article·official_source·project·region 중 하나여야 합니다"]);
    expect(linkRefErrors("to", undefined, "1")[0]).toMatch(/^toType:/);
    expect(linkRefErrors("to", "local_event", "1")).toEqual(["toType: 행사(local_event) 연결은 행사 표가 생기는 W6에서 엽니다"]);
    for (const bad of ["", "0", "-1", "1.5", "abc", "1".repeat(19)]) expect(linkRefErrors("to", "article", bad), bad).toEqual(["toId: 1 이상의 번호여야 합니다"]);
    for (const bad of ["110000000", "11000000000", "11000000aa"]) expect(linkRefErrors("to", "region", bad), bad).toEqual(["toId: 행정구역 코드 10자리 숫자여야 합니다"]);
    expect(linkRefErrors("to", "article", 12)).toEqual([]);
    expect(linkRefErrors("to", "article", " 12 ")).toEqual([]);
    expect(linkRefErrors("to", "region", "1100000000")).toEqual([]);
    expect(linkRefErrors("to", "official_source", "7")).toEqual([]);
  });
  test("주소 ?from= 읽기", () => {
    expect(parseLinkRef("article:12")).toEqual({ type: "article", id: "12" });
    expect(parseLinkRef("region:1100000000")).toEqual({ type: "region", id: "1100000000" });
    for (const bad of ["", null, "article", "article:", "attraction:1", "local_event:1", "region:11", "article:0", "article:1:2"]) expect(parseLinkRef(bad), String(bad)).toBeNull();
  });
});

describe("만들기·확인·지우기·후보 입력", () => {
  const base = { fromType: "article", fromId: 1, toType: "article", toId: "2", relation: "related_tax" };
  test("받는 값 — 후보로 만들기(이유 없어도) · 바로 확인(이유 필수)", () => {
    expect(parseCreateLink(base)).toEqual({ ok: true, value: { from: { type: "article", id: "1" }, to: { type: "article", id: "2" }, relation: "related_tax", reason: null, confirm: false } });
    const c = parseCreateLink({ ...base, confirm: true, reason: "  같은 세목  " });
    expect(c).toEqual({ ok: true, value: expect.objectContaining({ confirm: true, reason: "같은 세목" }) });
  });
  test("거부 — 관광 도착·자기 자신·관계 규칙·확인 이유 없음·이유 301자·confirm 모양", () => {
    const bad = (over: Record<string, unknown>) => {
      const r = parseCreateLink({ ...base, ...over });
      if (r.ok) throw new Error("받으면 안 된다");
      return r.errors;
    };
    expect(bad({ toType: "restaurant" })[0]).toMatch(/^toType: 관광 항목 종류\(restaurant\)/);
    expect(bad({ toId: 1 })).toEqual(["toId: 자기 자신과는 연결하지 않습니다"]);
    expect(bad({ relation: "nearby" })).toEqual([`relation: ${EDITOR_RELATIONS.join("·")} 중 하나여야 합니다`]);
    expect(bad({ relation: "related_event" })).toEqual(["relation: related_event는 행사 연결(W6)에서만 씁니다"]);
    expect(bad({ relation: "related_project" })).toEqual(["relation: related_project는 한쪽이 프로젝트인 연결에만 씁니다"]);
    expect(parseCreateLink({ ...base, toType: "project", relation: "related_project" }).ok).toBe(true);
    expect(bad({ confirm: true })).toEqual(["reason: 확인 이유를 적으세요 — 확인 기록(확인자·시각·이유)이 있어야 공개됩니다"]);
    expect(bad({ confirm: true, reason: "   " })[0]).toMatch(/^reason: 확인 이유/);
    expect(bad({ reason: "가".repeat(LINK_REASON_MAX + 1) })).toEqual([`reason: ${LINK_REASON_MAX}자 이하여야 합니다`]);
    expect(parseCreateLink({ ...base, reason: "가".repeat(LINK_REASON_MAX) }).ok).toBe(true);
    expect(bad({ confirm: "yes" })).toContain("confirm: 참·거짓이어야 합니다");
    expect(bad({ reason: 3 })).toContain("reason: 글자여야 합니다");
    expect(bad({ fromType: "tour_item", toType: "attraction" })).toHaveLength(2);
  });
  test("확인 — 번호·이유 필수, 관계를 함께 바꿈(목록 안·related_event 거부)", () => {
    expect(parseConfirmLink({ linkId: 3, reason: "같은 지역 재개발 기사" })).toEqual({ ok: true, value: { linkId: 3, reason: "같은 지역 재개발 기사", relation: null } });
    expect(parseConfirmLink({ linkId: 3, reason: "이유", relation: "related_realestate" })).toEqual({ ok: true, value: { linkId: 3, reason: "이유", relation: "related_realestate" } });
    expect(parseConfirmLink({ linkId: "3", reason: "" })).toEqual({ ok: false, errors: ["linkId: 1 이상의 번호여야 합니다", "reason: 확인 이유를 적으세요 — 확인 기록(확인자·시각·이유)이 있어야 공개됩니다"] });
    expect(parseConfirmLink({ linkId: 3, reason: "이유", relation: "related_event" })).toEqual({ ok: false, errors: ["relation: related_event는 행사 연결(W6)에서만 씁니다"] });
  });
  test("지우기 — 이유 필수", () => {
    expect(parseRemoveLink({ linkId: 9, reason: "다른 지역 기사" })).toEqual({ ok: true, value: { linkId: 9, reason: "다른 지역 기사" } });
    expect(parseRemoveLink({ linkId: 9 })).toEqual({ ok: false, errors: ["reason: 지우는 이유를 적으세요"] });
    expect(parseRemoveLink({ linkId: 0, reason: "x" })).toEqual({ ok: false, errors: ["linkId: 1 이상의 번호여야 합니다"] });
  });
  test("후보 찾기 — 프로젝트·기사·지역에서만", () => {
    expect(parseSuggest({ fromType: "project", fromId: 4 })).toEqual({ ok: true, value: { type: "project", id: "4" } });
    expect(parseSuggest({ fromType: "region", fromId: "1100000000" })).toEqual({ ok: true, value: { type: "region", id: "1100000000" } });
    expect(parseSuggest({ fromType: "official_source", fromId: 4 })).toEqual({ ok: false, errors: ["fromType: 같은 지역 자동 후보는 project·article·region에서만 찾습니다"] });
    expect((parseSuggest({ fromType: "attraction", fromId: 4 }) as { errors: string[] }).errors[0]).toMatch(/관광 항목/);
  });
});

describe("상태 흐름 (DB 트리거와 같은 흐름)", () => {
  test("후보 → 확인·지움 · 확인 → 지움 · 지운 것 되살리기·확인 → 후보 거부", () => {
    expect(statusConflict("candidate", "confirmed")).toBeNull();
    expect(statusConflict("candidate", "removed")).toBeNull();
    expect(statusConflict("confirmed", "removed")).toBeNull();
    expect(statusConflict("confirmed", "candidate")).toMatch(/후보로 돌리지 않습니다/);
    expect(statusConflict("confirmed", "confirmed")).toMatch(/이미 확인된/);
    expect(statusConflict("removed", "confirmed")).toMatch(/되살리지 않습니다/);
    expect(statusConflict("removed", "removed")).toMatch(/되살리지 않습니다/);
  });
});
