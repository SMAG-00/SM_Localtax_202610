// W4 1단계 2.6 5 slug·별칭 (2.7 규칙) — 같은 부모 안 slug 중복 → 중단(숫자 자동 덧붙임 0) · 예약 이름 events·weekly → 중단 · 형식 밖 → 중단
//  짧은 별칭이 다른 지역 이름·별칭과 겹치면 넣지 않음 · 1글자 별칭 0 · 일반구 = 상위 시 별칭 · 검토 파일 region_slugs.review.csv
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEED_PLUS, FICTIONAL_SIDO, fix, textOf, problemsOf, pipelineFor } from "./regions-fixtures.mjs";
import { parseSource } from "../regions/parse.mjs";
import { classifyRows } from "../regions/classify.mjs";
import { validateRows } from "../regions/validate.mjs";
import { currentFromSeed } from "../regions/diff.mjs";
import { autoSlug, buildSlugs, parseCsv, readReview, reviewCsv, romanize, shortAliasCandidate, slugs } from "../regions/slug.mjs";

const desiredOf = (text, expectedSido = SEED_PLUS) => validateRows(classifyRows(parseSource(text).rows).rows, { expectedSido }).desired;
const v1 = () => desiredOf(textOf("v1.utf8.txt"));
const byCode = (entries) => Object.fromEntries(entries.map((e) => [e.code, e]));

test("로마자 표기 — 표기 일람과 자주 나오는 소리 변화(연음·비음화·ㄹ 동화·구개음화·거센소리·체언 ㅎ)", () => {
  const cases = {
    시험: "siheom", 가상: "gasang", 모의: "moui", 예시: "yesi", 나: "na",
    구미: "gumi", 영동: "yeongdong", 옥천: "okcheon", 합덕: "hapdeok", 호법: "hobeop", 월곶: "wolgot", 벚꽃: "beotkkot", 한밭: "hanbat",
    백마: "baengma", 종로: "jongno", 왕십리: "wangsimni", 별내: "byeollae", 신라: "silla", 대관령: "daegwallyeong",
    해돋이: "haedoji", 같이: "gachi", 좋고: "joko", 놓다: "nota", 묵호: "mukho", 집현전: "jiphyeonjeon",
    울산: "ulsan", 철원: "cheorwon", 넋이: "neoksi", 간라: "galla", 갈라: "galla",
  };
  for (const [ko, ro] of Object.entries(cases)) assert.equal(romanize(ko), ro, ko);
  assert.equal(romanize("가상 2동"), "gasang-2dong", "한글 밖 글자: 숫자는 그대로, 공백은 '-'");
  assert.equal(romanize("ABC시험"), "abcsiheom");
});

test("자동 slug — 접미 모양(권고안)·접미 없음 모양, 단위 글자 없으면 못 만든다 · 짧은 별칭 후보", () => {
  assert.equal(autoSlug("시험구"), "siheom-gu");
  assert.equal(autoSlug("예시군"), "yesi-gun");
  assert.equal(autoSlug("모의시"), "moui-si");
  assert.equal(autoSlug("시험구", "plain"), "siheom");
  assert.equal(autoSlug("가상도"), null, "시·군·구 단위가 아니면 접미 모양 slug를 만들지 않는다");
  assert.equal(autoSlug("가상도", "plain"), "gasangdo");
  assert.equal(shortAliasCandidate("나구"), null, "1글자");
  assert.equal(shortAliasCandidate("시험시"), "시험");
  assert.equal(shortAliasCandidate("가상도"), null);
});

test("v1 slug·별칭 — 자동 초안, 짧은 별칭 겹침 제외(시·도 별칭 '가상'·모의시/모의군), 일반구는 상위 시 별칭, 1글자 0", () => {
  const { entries, notes, problems } = buildSlugs(v1(), { current: currentFromSeed(SEED_PLUS) });
  assert.deepEqual(problems, []);
  const e = byCode(entries);
  assert.equal(entries.length, 24);
  assert.deepEqual(
    entries.filter((x) => x.level === "sigungu").map((x) => [x.code, x.slug, x.aliases]),
    [
      ["9911000000", "gasang-si", ["가상시 시험구", "시험구", "가상시 모의구", "모의구"]],
      ["9913000000", "siheom-si", ["시험"]],
      ["9915000000", "na-gu", []],
      ["9917000000", "yesi-gun", ["예시"]],
      ["9919000000", "moui-si", []],
      ["9920000000", "moui-gun", []],
    ],
  );
  assert.equal(e["1100000000"].slug, "seoul", "시·도 slug는 씨앗 그대로");
  assert.deepEqual(e["9900000000"].aliases, ["가상"]);
  assert.ok(notes.some((n) => /'가상'\(가상시\)/.test(n)), "가상도 별칭과 겹친 짧은 별칭");
  assert.ok(notes.some((n) => /'모의'\(모의시\)/.test(n)) && notes.some((n) => /'모의'\(모의군\)/.test(n)), "서로 겹친 짧은 별칭은 둘 다 넣지 않음");
  for (const x of entries) {
    assert.ok(x.aliases.every((a) => [...a].length >= 2), `${x.name} 1글자 별칭`);
    assert.ok(!x.aliases.includes(x.name), `${x.name} 공식 이름 그대로 별칭`);
  }
});

test("일반구 '○○구' 별칭은 전국에서 겹치면 넣지 않고 '○○시 ○○구'는 늘 넣는다", () => {
  const d = v1();
  d.sigungu.push({ code: "9925000000", parentCode: "9900000000", name: "시험구", line: 99 });
  const { entries, notes } = buildSlugs(d, { current: currentFromSeed(SEED_PLUS) });
  const e = byCode(entries);
  assert.deepEqual(e["9911000000"].aliases, ["가상시 시험구", "가상시 모의구", "모의구"]);
  assert.ok(notes.some((n) => /일반구 별칭 '시험구'/.test(n)));
});

test("같은 부모 안 slug 중복 → 중단 (숫자 자동 덧붙임 0) — 로마자가 같은 두 이름 · 지금 DB의 폐지 행 slug와 겹침", () => {
  const d = desiredOf(textOf("slug-collision.txt"), FICTIONAL_SIDO);
  const p = problemsOf(() => slugs(d, { current: currentFromSeed(FICTIONAL_SIDO) }));
  assert.deepEqual(p.map((x) => x.code), ["SLUG_DUPLICATE"]);
  assert.match(p[0].detail, /9900000000\/galla-gun — 9931000000 간라군 · 9933000000 갈라군/);
  const r = buildSlugs(d, { current: currentFromSeed(FICTIONAL_SIDO) });
  assert.ok(r.entries.every((x) => !/-\d+$/.test(x.slug)), "숫자를 붙여 피하지 않는다");
  const retiredRow = { code: "9939000000", parent_code: "9900000000", level: "sigungu", name: "옛시험시", slug: "siheom-si", aliases: [], valid_from: null, valid_to: "2020-01-01", successor_code: "9913000000" };
  const p2 = problemsOf(() => slugs(v1(), { current: [...currentFromSeed(SEED_PLUS), retiredRow] }));
  assert.deepEqual(p2.map((x) => x.code), ["SLUG_DUPLICATE"]);
  assert.match(p2[0].detail, /siheom-si — 9913000000 시험시 · 9939000000 옛시험시/);
});

test("검토 파일 — 예약 이름 events·weekly slug → 중단", () => {
  const review = readReview(fs.readFileSync(fix("review-reserved.csv"), "utf8"));
  const p = problemsOf(() => slugs(v1(), { current: currentFromSeed(SEED_PLUS), review }));
  assert.deepEqual(p.map((x) => [x.code, x.detail.split(" (")[0]]), [["SLUG_RESERVED", "9911000000 가상시 — 'events'"], ["SLUG_RESERVED", "9913000000 시험시 — 'weekly'"]]);
});

test("검토 파일 — 형식 밖 slug(대문자·밑줄·'--') → 중단, 1글자 별칭 → 중단, 원본에 없는 코드 → 중단", () => {
  const review = readReview(fs.readFileSync(fix("review-format.csv"), "utf8"));
  const p = problemsOf(() => slugs(v1(), { current: currentFromSeed(SEED_PLUS), review }));
  assert.deepEqual(p.map((x) => x.code).sort(), ["ALIAS_FORMAT", "SLUG_FORMAT", "SLUG_FORMAT"]);
  assert.ok(p.some((x) => /Gasang_Si/.test(x.detail)) && p.some((x) => /siheom--si/.test(x.detail)) && p.some((x) => /'시'/.test(x.detail)));
  const unknown = new Map([["9999000000", { slug: "x-gu" }]]);
  assert.deepEqual(problemsOf(() => slugs(v1(), { current: currentFromSeed(SEED_PLUS), review: unknown })).map((x) => x.code), ["REVIEW_UNKNOWN_CODE"]);
});

test("검토 파일을 그대로 다시 넣으면 같은 결과 · 사람이 고친 slug·별칭을 쓴다 · 이미 있는 지역의 slug는 못 바꾼다", () => {
  const cur = currentFromSeed(SEED_PLUS);
  const first = buildSlugs(v1(), { current: cur });
  const csv = reviewCsv(first.entries);
  assert.ok(csv.startsWith("﻿code,parent_code,name,slug,aliases,source\n"));
  assert.equal(csv.split("\n").filter(Boolean).length, 7, "머리 + 시·군·구 6줄 (시·도·일반구 줄 0)");
  assert.ok(!csv.includes("\r"));
  const again = buildSlugs(v1(), { current: cur, review: readReview(csv) });
  assert.deepEqual(again.entries.map((x) => [x.code, x.slug, x.aliases]), first.entries.map((x) => [x.code, x.slug, x.aliases]));
  const edited = csv.replace("9915000000,9900000000,나구,na-gu,,auto", "9915000000,9900000000,나구,nagu-district,나구역,auto");
  const r = byCode(buildSlugs(v1(), { current: cur, review: readReview(edited) }).entries);
  assert.equal(r["9915000000"].slug, "nagu-district");
  assert.deepEqual(r["9915000000"].aliases, ["나구역"]);
  assert.equal(r["9915000000"].source, "review");
  // 따옴표·쉼표가 든 칸
  assert.deepEqual(parseCsv('a,b\n"x, ""y""",z\r\n'), [{ a: 'x, "y"', b: "z" }]);
  // 이미 DB에 있는 지역 — 검토 파일 slug가 달라도 지금 slug 그대로 + 중단
  const after = pipelineFor("v1.utf8.txt").after;
  const p = problemsOf(() => slugs(v1(), { current: after, review: new Map([["9913000000", { slug: "new-siheom-si" }]]) }));
  assert.deepEqual(p.map((x) => x.code), ["SLUG_FORMAT"]);
  assert.match(p[0].detail, /바꾸지 않습니다/);
});

test("접미 없음 모양(12장 #3 대안)은 설정으로 바꾼다", () => {
  const r = byCode(buildSlugs(v1(), { current: currentFromSeed(SEED_PLUS), slugStyle: "plain" }).entries);
  assert.equal(r["9913000000"].slug, "siheom");
  assert.equal(r["9920000000"].slug, "moui");
  assert.equal(r["9919000000"].slug, "moui");
  assert.deepEqual(problemsOf(() => slugs(v1(), { current: currentFromSeed(SEED_PLUS), slugStyle: "plain" })).map((x) => x.code), ["SLUG_DUPLICATE"], "모의시·모의군이 같은 slug");
  assert.throws(() => buildSlugs(v1(), { slugStyle: "numeric" }), /slug 모양/);
});
