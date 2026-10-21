// W4 1단계 2.6 1 받기 · 2 읽기 — 시험용 가짜 원본(CP949·UTF-8 두 판)
//  인코딩은 인자로만 · BOM 제거 · CRLF · 열 머리가 다르면 중단 · 코드 9자리·11자리·글자 섞임 → 중단 + 줄 번호 · 이름 빈 값 · 폐지여부 2값 밖 · 같은 코드 두 번
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesOf, textOf, problemsOf, sourceOf } from "./regions-fixtures.mjs";
import { checkReceipt, decode, parseSource, sha256 } from "../regions/parse.mjs";

test("CP949 판과 UTF-8(BOM) 판을 각각의 인코딩으로 읽으면 같은 글자 — BOM은 빠진다", () => {
  const cp = decode(bytesOf("v1.cp949.txt"), "cp949");
  const u8 = decode(bytesOf("v1.utf8.txt"), "utf-8");
  assert.equal(bytesOf("v1.utf8.txt")[0], 0xef, "UTF-8 판은 BOM으로 시작한다");
  assert.notDeepEqual(bytesOf("v1.cp949.txt"), bytesOf("v1.utf8.txt"), "두 판의 바이트는 다르다");
  assert.equal(cp, u8);
  assert.ok(!u8.startsWith("﻿"));
  assert.ok(cp.startsWith("법정동코드\t법정동명\t폐지여부\n"));
  assert.deepEqual(parseSource(cp).rows, parseSource(u8).rows);
});

test("인코딩은 인자로만 — 없거나 모르는 값은 오류, 다른 인코딩으로 읽으면 중단(읽기 실패 또는 열 머리 다름)", () => {
  assert.throws(() => decode(bytesOf("v1.cp949.txt")), /--encoding/);
  assert.throws(() => decode(bytesOf("v1.cp949.txt"), "latin1"), /--encoding/);
  const asUtf8 = problemsOf(() => decode(bytesOf("v1.cp949.txt"), "utf-8"));
  assert.deepEqual(asUtf8.map((p) => p.code), ["DECODE_FAILED"], "CP949 바이트는 UTF-8로 읽을 수 없다");
  let wrong;
  const probs = problemsOf(() => {
    wrong = decode(bytesOf("v1.utf8.txt"), "cp949");
    parseSource(wrong);
  });
  assert.ok(["DECODE_FAILED", "HEADER_UNKNOWN"].includes(probs[0].code), JSON.stringify(probs));
});

test("v1 원본 — 32행, 줄 번호·코드·이름·상태", () => {
  const { header, rows } = parseSource(textOf("v1.utf8.txt"));
  assert.deepEqual(header, ["법정동코드", "법정동명", "폐지여부"]);
  assert.equal(rows.length, 32);
  assert.deepEqual(rows[0], { line: 2, code: "1100000000", fullName: "서울특별시", status: "active" });
  const retired = rows.filter((r) => r.status === "retired").map((r) => r.code);
  assert.deepEqual(retired, ["9922000000", "9922025000"]);
  assert.equal(rows.find((r) => r.code === "9911100000").fullName, "가상도 가상시 시험구");
});

test("줄바꿈 CRLF·CR, 칸 앞뒤 공백·이름 안 겹공백도 같은 결과 · 빈 줄은 건너뛴다", () => {
  const lf = parseSource(textOf("v1.utf8.txt")).rows;
  const crlf = parseSource(textOf("v1.utf8.txt").replaceAll("\n", "\r\n")).rows;
  assert.deepEqual(crlf, lf);
  const cr = parseSource(textOf("v1.utf8.txt").replaceAll("\n", "\r")).rows;
  assert.deepEqual(cr, lf);
  const spaced = parseSource("법정동코드\t법정동명\t폐지여부\n\n 9900000000 \t 가상도   가상시 \t존재\n\n").rows;
  assert.deepEqual(spaced, [{ line: 3, code: "9900000000", fullName: "가상도 가상시", status: "active" }]);
});

test("열 머리가 설정과 다르면 중단 — 1번째 줄", () => {
  const p = problemsOf(() => parseSource(textOf("bad-header.txt")));
  assert.equal(p.length, 1);
  assert.equal(p[0].code, "HEADER_UNKNOWN");
  assert.equal(p[0].line, 1);
  assert.match(p[0].detail, /코드 \| 이름 \| 폐지여부/);
  // 순서만 바뀐 머리도 중단
  assert.equal(problemsOf(() => parseSource("법정동명\t법정동코드\t폐지여부\n가상도\t9900000000\t존재\n"))[0].code, "HEADER_UNKNOWN");
  // 칸 구분자가 다르면(쉼표 파일을 탭으로) 머리부터 다르다
  assert.equal(problemsOf(() => parseSource("법정동코드,법정동명,폐지여부\n9900000000,가상도,존재\n"))[0].code, "HEADER_UNKNOWN");
  assert.equal(parseSource("법정동코드,법정동명,폐지여부\n9900000000,가상도,존재\n", { delimiter: "comma" }).rows.length, 1);
  assert.throws(() => parseSource("x", { delimiter: "semicolon" }), /--delimiter/);
});

test("코드 9자리·11자리·글자 섞임 → 중단, 줄 번호와 함께 셋 모두 보고", () => {
  const p = problemsOf(() => parseSource(textOf("bad-code.txt")));
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["CODE_FORMAT", 3], ["CODE_FORMAT", 4], ["CODE_FORMAT", 5]]);
  assert.match(p[0].detail, /991100000/);
  assert.match(p[1].detail, /11자/);
  assert.match(p[2].detail, /99A1000000/);
});

test("이름 빈 값 · 폐지여부 2값 밖 · 칸 수 다름 → 중단 + 줄 번호", () => {
  const name = problemsOf(() => parseSource(textOf("bad-name.txt")));
  assert.deepEqual(name.map((x) => [x.code, x.line]), [["NAME_EMPTY", 3]]);
  const status = problemsOf(() => parseSource(textOf("bad-status.txt")));
  assert.deepEqual(status.map((x) => [x.code, x.line]), [["STATUS_UNKNOWN", 3]]);
  assert.match(status[0].detail, /'사용'/);
  const shape = problemsOf(() => parseSource("법정동코드\t법정동명\t폐지여부\n9900000000\t가상도\n"));
  assert.deepEqual(shape.map((x) => [x.code, x.line]), [["ROW_SHAPE", 2]]);
});

test("같은 코드 두 번 → 중단, 두 줄 번호", () => {
  const p = problemsOf(() => parseSource(textOf("dup-code.txt")));
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["CODE_DUPLICATE", [3, 5]]]);
});

test("1 받기 — 기록한 SHA-256이 없으면 중단, 다르면 중단, 배포일 형식 밖이면 중단, 같으면 해시를 돌려준다", () => {
  const bytes = bytesOf("v1.cp949.txt");
  const actual = sha256(bytes);
  assert.match(actual, /^[0-9a-f]{64}$/);
  assert.equal(checkReceipt(bytes, { sha256: actual.toUpperCase(), fileDate: "2026-10-01" }), actual);
  const missing = problemsOf(() => checkReceipt(bytes, { fileDate: "2026-10-01" }));
  assert.deepEqual(missing.map((x) => x.code), ["RECEIPT_HASH_MISSING"]);
  assert.match(missing[0].detail, new RegExp(actual), "파일의 해시를 알려 준다");
  const other = sourceOf("다른 파일");
  assert.deepEqual(problemsOf(() => checkReceipt(bytes, { sha256: other.sha, fileDate: "2026-10-01" })).map((x) => x.code), ["RECEIPT_HASH_MISMATCH"]);
  assert.deepEqual(problemsOf(() => checkReceipt(bytes, { sha256: actual, fileDate: "2026/10/01" })).map((x) => x.code), ["RECEIPT_DATE_MISSING"]);
  assert.deepEqual(problemsOf(() => checkReceipt(bytes, { sha256: actual })).map((x) => x.code), ["RECEIPT_DATE_MISSING"]);
});
