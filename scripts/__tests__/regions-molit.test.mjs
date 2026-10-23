// W4 2단계 — 두 번째 원본 형식 molit-csv (공공데이터포털 「국토교통부_전국 법정동」 CSV: UTF-8 BOM·쉼표·이름 4열)
// 시험 자료는 모두 접두 99의 가짜 지역을 이 파일 안에 글자로 둔다(실제 원본 파일은 저장소에 없다 — 해시만 기록).
// 멈추는 조건(코드 10자리·같은 코드 두 번·모르는 열 머리·이름 빈 값)이 두 형식 모두에서 그대로인지 + 2단계에서 실제 원본으로 확인한 분류 보정을 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { problemsOf, sourceOf } from "./regions-fixtures.mjs";
import { decode, parseSource, spaceCityGu } from "../regions/parse.mjs";
import { classOf, classifyRows } from "../regions/classify.mjs";
import { validateRows } from "../regions/validate.mjs";
import { currentFromSeed } from "../regions/diff.mjs";
import { runPipeline } from "../regions/cli.mjs";
import { resolveOptions } from "../regions/config.mjs";

const HEAD = "법정동코드,시도명,시군구명,읍면동명,리명,순번,생성일자";
const M = { format: "molit-csv" };
const csv = (...lines) => [HEAD, ...lines].join("\n");

const SAMPLE = csv(
  "9900000000,가상도,,,,1,2000-01-01",
  "9911000000,가상도,가상시,,,1,2000-01-01",
  "9911100000,가상도,가상시시험구,,,1,2000-01-01",
  "9911110100,가상도,가상시시험구,시험동,,1,2000-01-01",
  "9911110101,가상도,가상시시험구,시험동,가상리,2,2000-01-01",
  "9913000000,가상도,가상군,,,2,2000-01-01",
);

test("molit-csv — 이름 4열에서 빈 칸을 빼고 공백으로 이어 법정동명을 만들고, 일반구는 시와 띄운다(code.go.kr 이름짓기와 같음) · 모두 존재", () => {
  const { header, rows } = parseSource(SAMPLE, M);
  assert.deepEqual(header, HEAD.split(","));
  assert.deepEqual(
    rows.map((r) => [r.line, r.code, r.fullName, r.status]),
    [
      [2, "9900000000", "가상도", "active"],
      [3, "9911000000", "가상도 가상시", "active"],
      [4, "9911100000", "가상도 가상시 시험구", "active"],
      [5, "9911110100", "가상도 가상시 시험구 시험동", "active"],
      [6, "9911110101", "가상도 가상시 시험구 시험동 가상리", "active"],
      [7, "9913000000", "가상도 가상군", "active"],
    ],
  );
});

test("molit-csv — BOM 있는 UTF-8 바이트를 --encoding utf-8로 읽으면 같은 결과 · CRLF도 같음", () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE.replaceAll("\n", "\r\n"), "utf8")]);
  const text = decode(bytes, "utf-8");
  assert.ok(!text.startsWith("﻿"));
  assert.deepEqual(parseSource(text, M).rows, parseSource(SAMPLE, M).rows);
});

test("spaceCityGu — 시 바로 뒤에 붙은 구만 띄운다 (포항시남구·수원시장안구·창원시마산합포구) · 시·군·구 단독 이름은 그대로", () => {
  assert.equal(spaceCityGu("수원시장안구"), "수원시 장안구");
  assert.equal(spaceCityGu("포항시남구"), "포항시 남구");
  assert.equal(spaceCityGu("창원시마산합포구"), "창원시 마산합포구");
  for (const same of ["종로구", "강서구", "시흥시", "광주시", "태안군", "가상시", ""]) assert.equal(spaceCityGu(same), same, same);
});

test("두 형식은 서로의 파일을 받지 않는다 — molit 파일을 기본 형식으로, code.go.kr 열 머리를 molit로 읽으면 열 머리 중단", () => {
  assert.deepEqual(problemsOf(() => parseSource(SAMPLE)).map((p) => [p.code, p.line]), [["HEADER_UNKNOWN", 1]]);
  const goKr = "법정동코드,법정동명,폐지여부\n9900000000,가상도,존재\n";
  const p = problemsOf(() => parseSource(goKr, M));
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["HEADER_UNKNOWN", 1]]);
  assert.match(p[0].detail, /시도명 \| 시군구명/);
  // 열 순서만 바뀌어도 중단
  assert.equal(problemsOf(() => parseSource("법정동코드,시군구명,시도명,읍면동명,리명,순번,생성일자\n9900000000,가상도,,,,1,2000-01-01\n", M))[0].code, "HEADER_UNKNOWN");
  assert.throws(() => resolveOptions({ format: "xlsx" }), /--format/);
});

test("molit-csv — 코드 9자리·11자리·글자 섞임 → 중단, 줄 번호와 함께 모두 보고", () => {
  const p = problemsOf(() =>
    parseSource(csv("991100000,가상도,가상시,,,1,2000-01-01", "99110000000,가상도,가상시,,,1,2000-01-01", "99A1000000,가상도,가상시,,,1,2000-01-01", "9900000000,가상도,,,,1,2000-01-01"), M),
  );
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["CODE_FORMAT", 2], ["CODE_FORMAT", 3], ["CODE_FORMAT", 4]]);
  assert.match(p[1].detail, /11자/);
});

test("molit-csv — 같은 코드 두 번 → 중단, 두 줄 번호 · 이름 4열이 모두 빈 값 → 중단 · 칸 수 다름 → 중단", () => {
  const dup = problemsOf(() => parseSource(csv("9900000000,가상도,,,,1,2000-01-01", "9911000000,가상도,가상시,,,1,2000-01-01", "9900000000,가상도,,,,1,2000-01-01"), M));
  assert.deepEqual(dup.map((x) => [x.code, x.line]), [["CODE_DUPLICATE", [2, 4]]]);
  const empty = problemsOf(() => parseSource(csv("9900000000,,,,,1,2000-01-01"), M));
  assert.deepEqual(empty.map((x) => [x.code, x.line]), [["NAME_EMPTY", 2]]);
  const shape = problemsOf(() => parseSource(csv("9900000000,가상도,,,1,2000-01-01"), M));
  assert.deepEqual(shape.map((x) => [x.code, x.line]), [["ROW_SHAPE", 2]]);
});

test("molit-csv — 따옴표가 있는 줄은 풀지 않고 멈춘다 (쉼표를 품은 이름을 잘못 읽지 않도록)", () => {
  const p = problemsOf(() => parseSource(csv('9900000000,"가상도, 시험",,,,1,2000-01-01'), M));
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["ROW_SHAPE", 2]]);
});

test("분류 보정 — 상위 시가 없는 5번째 자리 ≠ 0 코드는 시·도 바로 아래 시·군·구 (광역시의 구·군), 시가 아닌 4자리+0이 있어도 일반구가 아니다", () => {
  const text = csv(
    "9900000000,가상광역시,,,,1,2000-01-01",
    "9921500000,가상광역시,시험구,,,1,2000-01-01", // 서울 광진구 11215 모양 — 9921000000 없음
    "9800000000,가상도,,,,2,2000-01-01",
    "9874000000,가상도,가상군,,,1,2000-01-01",
    "9874500000,가상도,시험군,,,2,2000-01-01", // 충북 증평군 43745 모양 — 4자리+0은 군, 이름이 구로 끝나지 않음
    "9876000000,가상도,가상시,,,3,2000-01-01",
    "9876100000,가상도,가상시시험구,,,1,2000-01-01",
    "9878000000,가상도,다른군,,,4,2000-01-01",
    "9878100000,가상도,다른군시험구,,,1,2000-01-01", // 4자리+0이 군인데 이름이 구로 끝남 → 일반구 아님
  );
  const { rows } = parseSource(text, M);
  const codes = new Set(rows.map((r) => r.code));
  assert.equal(classOf("9921500000", codes), null, "원래 규칙으로는 '상위 시 없음'");
  const out = Object.fromEntries(classifyRows(rows).rows.map((r) => [r.code, r.rowClass]));
  assert.equal(out["9921500000"], "sigungu");
  assert.equal(out["9874500000"], "sigungu");
  assert.equal(out["9876100000"], "general_gu");
  assert.equal(out["9878100000"], "sigungu");
  const named = Object.fromEntries(classifyRows(rows).rows.map((r) => [r.code, r.name]));
  assert.equal(named["9876100000"], "시험구", "일반구 이름 = 시를 뗀 자기 이름");
});

test("분류 보정 — 도 아래에 시 없이 붙은 구(상위 시 없음)는 여전히 중단 (2.6 3 '일반구의 상위 시 없음')", () => {
  const { rows } = parseSource(csv("9800000000,가상도,,,,1,2000-01-01", "9811100000,가상도,외톨이구,,,1,2000-01-01"), M);
  const p = classifyRows(rows).problems;
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["GENERAL_GU_NO_CITY", 3]]);
});

test("시·도 줄임 이름 하위 행(세종시) — 시·도의 유일한 시·군·구일 때만 시·도와 같은 이름 처리, 둘이면(제주시·서귀포시) 시·군·구 행", () => {
  const sejong = parseSource(csv("9900000000,가상특별자치시,,,,1,2000-01-01", "9911000000,가상특별자치시,가상시,,,1,2000-01-01"), M).rows;
  assert.equal(classifyRows(sejong).rows.find((r) => r.code === "9911000000").sameNameAsSido, true);
  const jeju = parseSource(
    csv("9900000000,시험특별자치도,,,,1,2000-01-01", "9911000000,시험특별자치도,시험시,,,1,2000-01-01", "9913000000,시험특별자치도,서험시,,,2,2000-01-01"),
    M,
  ).rows;
  const classified = classifyRows(jeju).rows;
  assert.equal(classified.find((r) => r.code === "9911000000").sameNameAsSido, undefined);
  assert.equal(classified.find((r) => r.code === "9913000000").sameNameAsSido, undefined);
  // 다른 시·도의 시(경기도 광주시)는 해당 없음
  const gw = parseSource(csv("9900000000,가상광역시,,,,1,2000-01-01", "9800000000,가상도,,,,2,2000-01-01", "9811000000,가상도,가상광시,,,1,2000-01-01"), M).rows;
  assert.equal(classifyRows(gw).rows.find((r) => r.code === "9811000000").sameNameAsSido, undefined);
});

const SIDO = (code, name, slug) => ({ code, name, slug, aliases: [] });

test("검증 — 씨앗 시·도가 원본에 행이 없으면 중단, 사람이 후속 입력에 폐지로 적었을 때만 통과(넣을 목록에서 빠짐)", () => {
  const rows = classifyRows(parseSource(csv("9900000000,가상도,,,,1,2000-01-01", "9911000000,가상도,가상시,,,1,2000-01-01"), M).rows).rows;
  const expectedSido = [SIDO("9900000000", "가상도", "gasang"), SIDO("9800000000", "옛가상도", "yet")];
  const stop = validateRows(rows, { expectedSido }).problems;
  assert.deepEqual(stop.map((p) => p.code), ["SEED_MISMATCH"]);
  assert.match(stop[0].detail, /9800000000/);
  const ok = validateRows(rows, { expectedSido, retiringSido: new Set(["9800000000"]) });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.desired.sido.map((s) => s.code), ["9900000000"]);
  assert.ok(ok.notes.some((n) => /9800000000/.test(n)));
  // 원본에 있는데 기준에 없는 시·도는 후속 입력으로 가려지지 않는다
  const extra = classifyRows(parseSource(csv("9900000000,가상도,,,,1,2000-01-01", "9700000000,새가상도,,,,2,2000-01-01"), M).rows).rows;
  assert.deepEqual(
    validateRows(extra, { expectedSido: [SIDO("9900000000", "가상도", "gasang")], retiringSido: new Set(["9700000000"]) }).problems.map((p) => p.code),
    ["SEED_MISMATCH"],
  );
});

test("전 과정 — molit 파일 → 새 시·도 추가 + 사라진 씨앗 시·도 폐지·옛 주소 301 + 일반구는 상위 시 별칭 · 해시·형식이 기록에 남음", () => {
  const text = csv(
    "9900000000,가상도,,,,1,2000-01-01",
    "9911000000,가상도,신설시,,,1,2000-01-01",
    "9911100000,가상도,신설시시험구,,,1,2000-01-01",
    "9911110100,가상도,신설시시험구,시험동,,1,2000-01-01",
    "9700000000,새가상특별시,,,,2,2026-06-30",
    "9711000000,새가상특별시,새구,,,1,2026-06-30",
    "9711010100,새가상특별시,새구,새동,,1,2026-06-30",
  );
  const { bytes, sha } = sourceOf(`﻿${text}\n`);
  const seed = [SIDO("9900000000", "가상도", "gasang"), SIDO("9800000000", "옛가상도", "yet")];
  const expectedSido = [...seed, { code: "9700000000", name: "새가상특별시", slug: "new-sido", aliases: ["새가상"] }];
  const successors = new Map([["9800000000", { successor: "9700000000", validTo: "2026-06-30", basis: "시험용 근거" }]]);
  const r = runPipeline({
    bytes, fileName: "molit-sample.csv", encoding: "utf-8", sha256: sha, fileDate: "2026-07-29",
    current: currentFromSeed(seed), expectedSido, successors, today: "2026-10-24", options: M,
  });
  assert.equal(r.source.sha256, sha);
  assert.equal(r.derived.source.format, "molit-csv");
  assert.equal(r.derived.source.rows_total, 7);
  assert.deepEqual(r.derived.class_counts, { sido: 2, sigungu: 2, general_gu: 1, sub_district: 2 });
  assert.deepEqual(r.plan.counts, { added: 3, renamed: 0, retired: 1, unchanged: 1 });
  assert.deepEqual(r.plan.added.map((e) => [e.code, e.level, e.parentCode]).sort(), [["9700000000", "sido", null], ["9711000000", "sigungu", "9700000000"], ["9911000000", "sigungu", "9900000000"]]);
  assert.deepEqual(r.plan.redirects, [{ old_path: "/local/yet", region_code: "9700000000", reason: "retired" }]);
  const sijak = r.entries.find((e) => e.code === "9911000000");
  assert.ok(sijak.aliases.includes("신설시 시험구"), `일반구는 상위 시 별칭: ${sijak.aliases}`);
  assert.ok(r.plan.entries.find((e) => e.code === "9700000000").aliases.includes("옛가상도"), "폐지된 시·도의 옛 이름은 후속 시·도 별칭");
  assert.deepEqual(r.derived.rows.map((x) => x.status), ["존재", "존재", "존재", "존재", "존재"]);
  // 후속 입력 없이 시·도가 사라지면 같은 원본이어도 멈춘다
  const stop = problemsOf(() => runPipeline({ bytes, fileName: "m.csv", encoding: "utf-8", sha256: sha, fileDate: "2026-07-29", current: currentFromSeed(seed), expectedSido, today: "2026-10-24", options: M }));
  assert.deepEqual(stop.map((p) => p.code), ["SEED_MISMATCH"]);
});
