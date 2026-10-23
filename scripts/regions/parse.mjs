// 2.6 1 받기 · 2 읽기 — 원본 파일 바이트 → 행 목록. 순수 함수 (파일 읽기는 cli.mjs)
//  · 인코딩은 명령 인자로만 정한다(추측하지 않는다). 읽을 수 없는 바이트는 바로 중단(fatal)
//  · BOM 제거 · 줄바꿈 CRLF/LF/CR 모두 · 열 머리는 설정과 순서까지 같아야 한다
//  · 코드 10자리 숫자 · 이름 빈 값 · 폐지여부 2값 · 같은 코드 두 번 — 줄 번호와 함께 모두 모아 한 번에 보고
//  · 형식 두 가지(config SOURCE_FORMATS) — code-go-kr(기본) · molit-csv(이름 열 4개를 이어 법정동명을 만들고 모두 '존재'). 멈추는 조건은 두 형식 모두 같다
import crypto from "node:crypto";
import { DELIMITERS, ENCODINGS, SOURCE_FORMATS, resolveOptions } from "./config.mjs";
import { problem, stopIf } from "./stop.mjs";

export const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/** 1 받기 — 받을 때 기록한 해시·배포일이 있고 파일과 같아야 한다 */
export function checkReceipt(bytes, { sha256: recorded, fileDate } = {}) {
  const actual = sha256(bytes);
  const problems = [];
  if (!recorded) problems.push(problem("RECEIPT_HASH_MISSING", `파일의 SHA-256은 ${actual}입니다 — 받을 때 기록한 값을 --sha256으로 주세요`));
  else if (recorded.toLowerCase() !== actual) problems.push(problem("RECEIPT_HASH_MISMATCH", `기록 ${recorded.toLowerCase()} · 파일 ${actual}`));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fileDate ?? "") || Number.isNaN(Date.parse(`${fileDate}T00:00:00Z`))) {
    problems.push(problem("RECEIPT_DATE_MISSING", `받은 값: ${fileDate ?? "(없음)"}`));
  }
  stopIf(problems);
  return actual;
}

/** 바이트 → 글자. encoding = cp949 | utf-8 (명령 인자 그대로) */
export function decode(bytes, encoding) {
  const label = ENCODINGS[String(encoding ?? "").toLowerCase()];
  if (!label) throw new Error(`--encoding은 ${Object.keys(ENCODINGS).join("·")} 중 하나를 주세요 (받은 값: ${encoding ?? "없음"})`);
  let text;
  try {
    text = new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch (err) {
    stopIf([problem("DECODE_FAILED", `${encoding}: ${err.message}`)]);
  }
  return text.replace(/^﻿/, "");
}

/**
 * molit-csv의 시군구명은 일반구를 시와 붙여 적는다('수원시장안구') — code.go.kr 파일처럼 '수원시 장안구'로 띄운다.
 * 첫 '시'(1번째 글자 이후) 뒤에 2글자 이상(구 포함)이 남고 '구'로 끝날 때만 (시 이름 자체가 '구'로 끝나는 경우는 없다)
 */
export const spaceCityGu = (name) => name.replace(/^(.{1,}?시)(.+구)$/, "$1 $2");

export const normalizeName = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * 글자 → { header, rows: [{ line, code, fullName, status }] }. 문제가 하나라도 있으면 RegionImportError(문제 전부)
 * status = 설정 statusValues의 값(active·retired)
 */
export function parseSource(text, over = {}) {
  const o = resolveOptions(over);
  const fmt = SOURCE_FORMATS[o.format];
  const molit = fmt.kind === "molit";
  const expectedHeader = molit ? fmt.header : o.header;
  const sep = molit ? DELIMITERS[fmt.delimiter] : DELIMITERS[o.delimiter];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const problems = [];
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) {
    stopIf([problem("HEADER_UNKNOWN", "파일이 비어 있습니다", 1)]);
  }
  const header = lines[first].split(sep).map((c) => c.trim());
  if (header.length !== expectedHeader.length || header.some((h, i) => h !== expectedHeader[i])) {
    stopIf([problem("HEADER_UNKNOWN", `기대 [${expectedHeader.join(" | ")}] · 받은 [${header.join(" | ")}]`, first + 1)]);
  }
  const rows = [];
  const seen = new Map(); // code → 줄 번호
  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const line = i + 1;
    if (molit && raw.includes('"')) {
      // 따옴표 칸(쉼표를 품은 이름 등)은 풀지 않는다 — 잘못 읽느니 멈춘다
      problems.push(problem("ROW_SHAPE", "따옴표가 있는 줄은 읽지 않습니다", line));
      continue;
    }
    const cells = raw.split(sep).map((c) => c.trim());
    if (cells.length !== expectedHeader.length) {
      problems.push(problem("ROW_SHAPE", `칸 ${cells.length}개 (열 머리 ${expectedHeader.length}개)`, line));
      continue;
    }
    // molit-csv: 법정동명 = 이름 열 4개 중 빈 칸을 뺀 것을 공백으로 이은 것 · 폐지여부 열이 없어 모두 '존재'
    const code = cells[0];
    const rawName = molit ? cells.slice(1, 1 + fmt.nameColumns).filter((c) => c !== "").map((c, i) => (i === 1 ? spaceCityGu(c) : c)).join(" ") : cells[1];
    const rawStatus = molit ? "존재" : cells[2];
    let ok = true;
    if (!/^[0-9]{10}$/.test(code)) {
      problems.push(problem("CODE_FORMAT", `'${code}' (${code.length}자)`, line));
      ok = false;
    }
    const fullName = normalizeName(rawName);
    if (!fullName) {
      problems.push(problem("NAME_EMPTY", `코드 ${code}`, line));
      ok = false;
    }
    const status = o.statusValues[rawStatus];
    if (!status) {
      problems.push(problem("STATUS_UNKNOWN", `'${rawStatus}' (허용: ${Object.keys(o.statusValues).join("·")})`, line));
      ok = false;
    }
    if (seen.has(code)) {
      problems.push(problem("CODE_DUPLICATE", `코드 ${code}`, [seen.get(code), line]));
      ok = false;
    } else seen.set(code, line);
    if (ok) rows.push({ line, code, fullName, status });
  }
  stopIf(problems);
  return { header, rows };
}
