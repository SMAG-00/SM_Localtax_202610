// 2.6 4 검증 — 부모·시·도 씨앗 대조·같은 이름 하위 행(12장 #5) → 넣을 지역 목록(desired)
//  · '존재' 시·군·구·일반구마다 같은 앞 2자리 '존재' 시·도
//  · '존재' 일반구의 상위 시도 '존재'
//  · 원본의 '존재' 시·도 = 기준 시·도 목록(W2-b 씨앗 17 + 이번에 더하는 시·도 --new-sido)과 코드·이름이 같다 (빠짐·더함·이름 다름 모두 중단)
//    예외: 씨앗 시·도가 원본에 행이 아예 없고 사람이 후속 입력(--successors)에 폐지로 적었으면(retiringSido) 멈추지 않고 넣을 목록에서 뺀다 — 폐지는 차이 보고가 처리한다
//  · 시·도와 이름이 같은 하위 행(세종 등): 설정 sameNameChild에 따라 — sido_alias(권고) = 넣지 않음 / sigungu = 시·군·구 행
import fs from "node:fs";
import { resolveOptions } from "./config.mjs";
import { problem, stopIf } from "./stop.mjs";

/** W2-b 마이그레이션의 시·도 씨앗 insert에서 [{ code, name, slug, aliases }] */
export function readSidoSeed(sql) {
  const re = /\('([0-9]{10})',\s*null,\s*'sido',\s*'([^']+)',\s*'([a-z0-9-]+)',\s*array\[([^\]]*)\]\)/g;
  return [...sql.matchAll(re)].map((m) => ({
    code: m[1],
    name: m[2].trim(),
    slug: m[3],
    aliases: [...m[4].matchAll(/'([^']*)'/g)].map((a) => a[1]),
  }));
}

/** 기준 시·도 파일들(.sql = 씨앗 마이그레이션 · .json = [{code,name,slug,aliases}]) 합치기. 같은 코드 두 번은 오류 */
export function loadSidoSeed(paths) {
  const all = [];
  for (const p of paths) {
    const text = fs.readFileSync(p, "utf8");
    const list = p.endsWith(".json") ? JSON.parse(text) : readSidoSeed(text);
    if (!list.length) throw new Error(`기준 시·도 파일에서 시·도를 하나도 읽지 못했습니다: ${p}`);
    for (const s of list) {
      if (!/^[0-9]{2}0{8}$/.test(s.code) || !s.name || !s.slug) throw new Error(`기준 시·도 칸이 규칙 밖입니다: ${p} ${JSON.stringify(s)}`);
      if (all.some((x) => x.code === s.code)) throw new Error(`기준 시·도 코드가 두 번 나옵니다: ${s.code}`);
      all.push({ code: s.code, name: s.name, slug: s.slug, aliases: [...(s.aliases ?? [])] });
    }
  }
  return all;
}

/**
 * classified(classifyRows 결과의 rows) → { desired, notes, problems }
 * desired = { sido: [{code,name,slug,aliases}], sigungu: [{code,parentCode,name,line}], generalGu: [{code,cityCode,cityName,name,line}] }
 */
export function validateRows(classified, { expectedSido, retiringSido = new Set(), ...over } = {}) {
  const o = resolveOptions(over);
  if (!expectedSido?.length) throw new Error("기준 시·도 목록(expectedSido)이 없습니다");
  const byCode = new Map(classified.map((r) => [r.code, r]));
  const active = (code) => byCode.get(code)?.status === "active";
  const problems = [];
  const notes = [];
  const desired = { sido: [], sigungu: [], generalGu: [] };

  // 시·도 씨앗 대조
  const expectedCodes = new Set(expectedSido.map((s) => s.code));
  for (const s of expectedSido) {
    const r = byCode.get(s.code);
    if (!r && retiringSido.has(s.code)) notes.push(`씨앗 시·도 ${s.code} ${s.name} — 원본에 행이 없고 후속 입력에 폐지로 적혀 있어 넣지 않고 폐지로 처리합니다`);
    else if (!r) problems.push(problem("SEED_MISMATCH", `씨앗 ${s.code} ${s.name}이 원본에 없습니다`));
    else if (r.rowClass !== "sido" || r.status !== "active") problems.push(problem("SEED_MISMATCH", `씨앗 ${s.code} ${s.name}이 원본에서 '존재' 시·도가 아닙니다`, r.line));
    else if (r.fullName !== s.name) problems.push(problem("SEED_MISMATCH", `${s.code} 이름 — 씨앗 '${s.name}' · 원본 '${r.fullName}'`, r.line));
    else desired.sido.push({ code: s.code, name: s.name, slug: s.slug, aliases: [...s.aliases] });
  }
  for (const r of classified) {
    if (r.rowClass === "sido" && r.status === "active" && !expectedCodes.has(r.code)) {
      problems.push(problem("SEED_MISMATCH", `원본의 '존재' 시·도 ${r.code} ${r.fullName}이 씨앗에 없습니다`, r.line));
    }
  }

  for (const r of classified) {
    if (r.status !== "active" || (r.rowClass !== "sigungu" && r.rowClass !== "general_gu")) continue;
    if (!active(r.sidoCode)) {
      problems.push(problem("PARENT_MISSING", `${r.code} ${r.fullName} — 시·도 ${r.sidoCode} ${byCode.has(r.sidoCode) ? "폐지" : "없음"}`, r.line));
      continue;
    }
    if (r.rowClass === "general_gu") {
      if (!active(r.cityCode)) {
        problems.push(problem("GENERAL_GU_CITY_RETIRED", `${r.code} ${r.fullName} — 상위 시 ${r.cityCode} 폐지`, r.line));
        continue;
      }
      desired.generalGu.push({ code: r.code, cityCode: r.cityCode, cityName: r.cityName, name: r.name, line: r.line });
      continue;
    }
    if (r.sameNameAsSido && o.sameNameChild === "sido_alias") {
      notes.push(`시·도와 이름이 같은 하위 행 ${r.code} ${r.fullName} — 넣지 않고 시·도 ${r.sidoCode}로 찾는다 (12장 #5 권고 기본값)`);
      continue;
    }
    desired.sigungu.push({ code: r.code, parentCode: r.sidoCode, name: r.name, line: r.line });
  }
  return { desired, notes, problems };
}

export function validate(classified, opts) {
  const r = validateRows(classified, opts);
  stopIf(r.problems);
  return r;
}
