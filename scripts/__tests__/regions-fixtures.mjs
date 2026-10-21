// 행정구역 적재 도구 시험 공용 — 시험용 가짜 원본(scripts/__tests__/fixtures/regions/)
// 가짜 행정구역은 법정동코드에 없는 접두 99만 쓴다(W4 설계 8장). 실제 코드는 W2-b 시·도 17 씨앗(마이그레이션 20261018000009)뿐이다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIDO_SEED_MIGRATION, DESIGN_DOC } from "../regions/config.mjs";
import { loadSidoSeed } from "../regions/validate.mjs";
import { sha256 } from "../regions/parse.mjs";
import { currentFromSeed } from "../regions/diff.mjs";
import { runPipeline } from "../regions/cli.mjs";

export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "regions");
export const fix = (name) => path.join(FIX, name);
export const bytesOf = (name) => fs.readFileSync(fix(name));
export const textOf = (name) => fs.readFileSync(fix(name), "utf8").replace(/^﻿/, "");
export const SEED = loadSidoSeed([SIDO_SEED_MIGRATION]);
export const FICTIONAL_SIDO = loadSidoSeed([fix("sido-fictional.json")]);
export const SEED_PLUS = [...SEED, ...FICTIONAL_SIDO];
export const SIDO_SEED_MIGRATION_PATH = SIDO_SEED_MIGRATION;
export const DESIGN = fs.readFileSync(DESIGN_DOC, "utf8");

/** 설계 문서 2장 소절 (예: '2.6') */
export function designSection(no) {
  const sec = DESIGN.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  if (!sec) throw new Error("설계 문서 2장을 찾지 못했다");
  const sub = sec.split(/^### /m).find((s) => s.startsWith(`${no} `));
  if (!sub) throw new Error(`설계 문서 ${no} 소절이 없다`);
  return sub;
}
export const tableRows = (sub) =>
  sub
    .split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .slice(1);
export const ticks = (s) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** 시험용 원본 글자 → 바이트(UTF-8) + 그 해시 */
export const sourceOf = (text) => {
  const bytes = Buffer.from(text, "utf8");
  return { bytes, sha: sha256(bytes) };
};

/** 견본 파일로 전 과정 (기본: 씨앗 17 + 가짜 시·도, 지금 상태 = 씨앗만) */
export function pipelineFor(name, over = {}) {
  const bytes = over.bytes ?? bytesOf(name);
  const expectedSido = over.expectedSido ?? SEED_PLUS;
  return runPipeline({
    bytes,
    fileName: name,
    encoding: over.encoding ?? (name.includes("cp949") ? "cp949" : "utf-8"),
    sha256: over.sha256 ?? sha256(bytes),
    fileDate: over.fileDate ?? "2026-10-01",
    current: over.current ?? currentFromSeed(expectedSido),
    expectedSido,
    review: over.review,
    successors: over.successors,
    today: over.today,
    options: over.options,
  });
}

/** RegionImportError의 문제 목록을 돌려준다 (안 던지면 시험 실패) */
export function problemsOf(fn) {
  try {
    fn();
  } catch (err) {
    if (err.name === "RegionImportError") return err.problems;
    throw err;
  }
  throw new Error("멈추지 않았다");
}
