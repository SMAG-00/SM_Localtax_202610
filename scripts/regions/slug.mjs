// 2.6 5 slug·별칭 (2.7 규칙 — 12장 #3 결정 전 초안)
//  · 시·도 slug = W2-b 씨앗 그대로 · 이미 DB에 있는 지역의 slug는 바꾸지 않는다(영속 주소)
//  · 새 시·군·구 slug = 이름의 로마자 표기(국어의 로마자 표기법 — 아래 romanize) + 단위 접미 -si·-gun·-gu (설정 slugStyle)
//    자동 변환은 초안이다 — 검토 파일 region_slugs.review.csv를 사람이 고쳐 다시 넣으면(--slug-review) 그 값을 쓴다
//  · 같은 부모 안 slug 중복 · 예약 이름 · 형식 밖 → 중단 (숫자 자동 덧붙임 0)
//  · 별칭: 공식 이름 그대로는 넣지 않는다 · 짧은 별칭(끝의 시·군·구를 뗀 이름)은 2글자 이상이고 전국 다른 지역의 이름·별칭과 겹치지 않을 때만
//    일반구(12장 #4 권고) = 상위 시의 별칭에 '○○시 ○○구'(늘) + '○○구'(전국에서 안 겹칠 때만) · 1글자 별칭 0
import { RESERVED_SLUGS, SLUG_RE, UNIT_SUFFIX, resolveOptions } from "./config.mjs";
import { problem, stopIf } from "./stop.mjs";

// ─── 로마자 표기 (국어의 로마자 표기법 — 표기 일람 + 자주 나오는 소리 변화. 'ㄴ' 첨가·예외 낱말은 사람이 검토 파일에서 고친다)
const INI = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOW = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
/** 받침 → 대표 소리 (k·n·t·l·m·p·ng) */
const FIN_CLASS = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
/** 받침 + 'ㅇ' 연음: 받침 번호 → [남는 받침, 넘어가는 첫소리(-1 = 사라짐)] */
const LIAISON = {
  1: [0, 0], 2: [0, 1], 3: [1, 9], 4: [0, 2], 5: [4, 12], 6: [4, -1], 7: [0, 3], 8: [0, 5], 9: [8, 0], 10: [8, 6], 11: [8, 7],
  12: [8, 9], 13: [8, 16], 14: [8, 17], 15: [8, -1], 16: [0, 6], 17: [0, 7], 18: [17, 9], 19: [0, 9], 20: [0, 10], 22: [0, 12],
  23: [0, 14], 24: [0, 15], 25: [0, 16], 26: [0, 17], 27: [0, -1],
};
const I_G = 0, I_N = 2, I_D = 3, I_R = 5, I_M = 6, I_NG = 11, I_J = 12, I_CH = 14, I_K = 15, I_T = 16, V_I = 20;

function romanizeHangulRun(chars) {
  const syl = chars.map((ch) => {
    const s = ch.codePointAt(0) - 0xac00;
    return { ini: Math.floor(s / 588), vow: Math.floor((s % 588) / 28), fin: s % 28, iniRoman: undefined, finRoman: undefined };
  });
  for (let i = 0; i + 1 < syl.length; i++) {
    const p = syl[i];
    const n = syl[i + 1];
    const f = p.fin;
    if (f === 0) continue;
    if (n.ini === I_NG && f !== 21) {
      // 연음 — 받침이 다음 첫소리로 (ㄷ·ㅌ + 이 → 지·치 구개음화)
      const [rest, moved] = LIAISON[f];
      p.fin = rest;
      if (moved >= 0) n.ini = moved === I_D && n.vow === V_I ? I_J : moved === I_T && n.vow === V_I ? I_CH : moved;
      continue;
    }
    const cls = FIN_CLASS[f];
    if ((f === 27 || f === 6 || f === 15) && (n.ini === I_G || n.ini === I_D || n.ini === I_J)) {
      // ㅎ + ㄱ·ㄷ·ㅈ → 거센소리 (좋고 → joko)
      n.ini = n.ini === I_G ? I_K : n.ini === I_D ? I_T : I_CH;
      p.finRoman = f === 27 ? "" : f === 6 ? "n" : "l";
      continue;
    }
    if (n.ini === I_N || n.ini === I_M) {
      // 비음화 (백마 → baengma) · ㄹ + ㄴ → ㄹㄹ (별내 → byeollae)
      if (cls === "k") p.finRoman = "ng";
      else if (cls === "t") p.finRoman = "n";
      else if (cls === "p") p.finRoman = "m";
      else if (cls === "l" && n.ini === I_N) n.iniRoman = "l";
      continue;
    }
    if (n.ini === I_R) {
      // ㄹ 앞 — ㄹㄹ(신라 → silla) · ㅁ·ㅇ + ㄹ → ㄴ(종로 → jongno) · ㄱ·ㅂ + ㄹ → ㅇㄴ·ㅁㄴ(왕십리 → wangsimni)
      if (cls === "l") n.iniRoman = "l";
      else if (cls === "n") {
        p.finRoman = "l";
        n.iniRoman = "l";
      } else if (cls === "m" || cls === "ng") n.iniRoman = "n";
      else {
        p.finRoman = cls === "k" ? "ng" : cls === "p" ? "m" : "n";
        n.iniRoman = "n";
      }
    }
    // 체언의 ㄱ·ㄷ·ㅂ + ㅎ 은 ㅎ을 밝혀 적는다 (묵호 → mukho) — 그대로 둔다
  }
  return syl.map((s) => (s.iniRoman ?? INI[s.ini]) + VOW[s.vow] + (s.finRoman ?? FIN_CLASS[s.fin])).join("");
}

/** 한글 → 로마자(소문자). 한글 음절이 아닌 글자: 영문·숫자는 그대로(소문자), 나머지는 '-' 구분 */
export function romanize(text) {
  let out = "";
  let run = [];
  const flush = () => {
    if (run.length) out += romanizeHangulRun(run);
    run = [];
  };
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xac00 && cp <= 0xd7a3) {
      run.push(ch);
      continue;
    }
    flush();
    out += /[A-Za-z0-9]/.test(ch) ? ch.toLowerCase() : "-";
  }
  flush();
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** 이름 끝 단위 글자(시·군·구) → 접미, 없으면 null */
export const unitSuffix = (name) => UNIT_SUFFIX[name.slice(-1)] ?? null;

/** 자동 slug 초안. 만들 수 없으면 null */
export function autoSlug(name, style = "suffix") {
  const suffix = unitSuffix(name);
  const stem = suffix ? name.slice(0, -1) : name;
  const base = romanize(stem);
  if (!base) return null;
  if (style === "plain") return base;
  return suffix ? `${base}-${suffix}` : null;
}

/** 짧은 별칭 후보 — 끝의 시·군·구를 뗀 이름, minLength 글자 이상일 때만 */
export function shortAliasCandidate(name, minLength = 2) {
  if (!unitSuffix(name)) return null;
  const stem = name.slice(0, -1);
  return [...stem].length >= minLength ? stem : null;
}

// ─── 검토 파일 (region_slugs.review.csv — 코드·이름·slug·별칭)
export const REVIEW_HEADER = ["code", "parent_code", "name", "slug", "aliases", "source"];
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** entries → CSV 글자 (엑셀이 한글을 읽도록 BOM, 줄바꿈 LF). 별칭은 '|'로 잇는다 */
export function reviewCsv(entries) {
  const lines = [REVIEW_HEADER.join(",")];
  for (const e of entries.filter((x) => x.level === "sigungu")) {
    lines.push([e.code, e.parentCode, e.name, e.slug, e.aliases.join("|"), e.source].map((v) => csvCell(String(v ?? ""))).join(","));
  }
  return `﻿${lines.join("\n")}\n`;
}

/** CSV 글자 → [{ 열 이름: 값 }] (따옴표·두 겹 따옴표·CRLF) */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** 검토 CSV → Map(code → { slug?, aliases? }) */
export function readReview(text) {
  const rows = parseCsv(text);
  const map = new Map();
  for (const r of rows) {
    if (!r.code) continue;
    const v = {};
    if (r.slug) v.slug = r.slug;
    if ("aliases" in r) v.aliases = r.aliases ? r.aliases.split("|").map((a) => a.trim()).filter(Boolean) : [];
    map.set(r.code, v);
  }
  return map;
}

// ─── slug·별칭 만들기
const uniq = (list) => [...new Set(list)];

/**
 * desired(validate 결과) + current(지금 지역 상태 [{code,parent_code,level,name,slug,aliases,valid_to,...}]) + review(Map)
 * → { entries: [{ code, parentCode, level, name, slug, aliases, source }], notes, problems }
 */
export function buildSlugs(desired, { current = [], review = new Map(), ...over } = {}) {
  const o = resolveOptions(over);
  const problems = [];
  const notes = [];
  const curBy = new Map(current.map((r) => [r.code, r]));
  const sigunguCodes = new Set(desired.sigungu.map((s) => s.code));
  for (const code of review.keys()) {
    if (!sigunguCodes.has(code)) problems.push(problem("REVIEW_UNKNOWN_CODE", code));
  }

  const entries = [];
  for (const s of desired.sido) {
    const cur = curBy.get(s.code);
    entries.push({ code: s.code, parentCode: null, level: "sido", name: s.name, slug: cur?.slug ?? s.slug, aliases: uniq([...(cur?.aliases ?? []), ...s.aliases]), source: cur ? "current" : "seed" });
  }
  for (const s of desired.sigungu) {
    const cur = curBy.get(s.code);
    const rev = review.get(s.code) ?? {};
    let slug;
    let source;
    if (cur) {
      slug = cur.slug;
      source = "current";
      if (rev.slug && rev.slug !== cur.slug) problems.push(problem("SLUG_FORMAT", `${s.code} ${s.name} — 이미 있는 slug '${cur.slug}'는 바꾸지 않습니다(영속 주소, 검토 값 '${rev.slug}')`));
    } else if (rev.slug) {
      slug = rev.slug;
      source = "review";
    } else {
      slug = autoSlug(s.name, o.slugStyle);
      source = "auto";
      if (!slug) problems.push(problem("SLUG_FORMAT", `${s.code} '${s.name}' — 단위 글자(시·군·구)가 없거나 로마자로 바꿀 수 없어 slug를 만들지 못했습니다`, s.line));
    }
    entries.push({ code: s.code, parentCode: s.parentCode, level: "sigungu", name: s.name, slug: slug ?? "", aliases: [], source, line: s.line, review: rev });
  }

  // 별칭 — 이름·별칭의 주인(지역 코드) 목록으로 겹침을 본다
  const owners = new Map();
  const own = (text, code) => {
    if (!owners.has(text)) owners.set(text, new Set());
    owners.get(text).add(code);
  };
  const entryBy = new Map(entries.map((e) => [e.code, e]));
  for (const e of entries) {
    own(e.name, e.code);
    for (const a of e.level === "sido" ? e.aliases : curBy.get(e.code)?.aliases ?? []) own(a, e.code);
  }
  const guAliases = new Map(); // city code → [{ text, always }]
  for (const g of desired.generalGu) {
    const city = entryBy.get(g.cityCode);
    if (!city) continue;
    const full = `${city.name} ${g.name}`;
    own(full, city.code);
    own(g.name, city.code);
    if (!guAliases.has(city.code)) guAliases.set(city.code, []);
    guAliases.get(city.code).push({ text: full, always: true }, { text: g.name, always: false });
  }
  const shortOf = new Map();
  for (const e of entries.filter((x) => x.level === "sigungu")) {
    const c = shortAliasCandidate(e.name, o.minAliasLength);
    if (c) {
      shortOf.set(e.code, c);
      own(c, e.code);
    }
  }
  const mine = (text, code) => owners.get(text)?.size === 1 && owners.get(text).has(code);
  for (const e of entries.filter((x) => x.level === "sigungu")) {
    const computed = [];
    const c = shortOf.get(e.code);
    if (c) {
      if (mine(c, e.code)) computed.push(c);
      else notes.push(`짧은 별칭 '${c}'(${e.name})은 다른 지역 이름·별칭과 겹쳐 넣지 않음`);
    }
    for (const a of guAliases.get(e.code) ?? []) {
      if (a.always || mine(a.text, e.code)) computed.push(a.text);
      else notes.push(`일반구 별칭 '${a.text}'(${e.name})은 전국에서 겹쳐 넣지 않음`);
    }
    let aliases;
    if (e.review.aliases) {
      aliases = e.review.aliases;
      e.source = e.source === "auto" ? "review" : e.source;
      for (const a of aliases) {
        if ([...a].length < o.minAliasLength) problems.push(problem("ALIAS_FORMAT", `${e.code} ${e.name} — '${a}'`, e.line));
      }
    } else aliases = [...(curBy.get(e.code)?.aliases ?? []), ...computed];
    e.aliases = uniq(aliases.filter((a) => a !== e.name && [...a].length >= o.minAliasLength));
    delete e.review;
  }

  // slug 검사 — 형식 · 예약 이름 · 같은 부모 안 중복(지금 DB의 폐지 행 slug도 자리를 차지한다)
  for (const e of entries) {
    if (!e.slug) continue;
    if (!SLUG_RE.test(e.slug)) problems.push(problem("SLUG_FORMAT", `${e.code} ${e.name} — '${e.slug}'`, e.line));
    else if (RESERVED_SLUGS.includes(e.slug)) problems.push(problem("SLUG_RESERVED", `${e.code} ${e.name} — '${e.slug}' (예약: ${RESERVED_SLUGS.join("·")})`, e.line));
  }
  const groups = new Map();
  const put = (parent, slug, code, name) => {
    const key = `${parent ?? ""}/${slug}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(code, name);
  };
  for (const e of entries) if (e.slug) put(e.parentCode, e.slug, e.code, e.name);
  for (const r of current) put(r.parent_code, r.slug, r.code, r.name);
  for (const [key, members] of groups) {
    if (members.size > 1) problems.push(problem("SLUG_DUPLICATE", `${key} — ${[...members].map(([c, n]) => `${c} ${n}`).join(" · ")}`));
  }
  return { entries, notes, problems };
}

export function slugs(desired, opts) {
  const r = buildSlugs(desired, opts);
  stopIf(r.problems);
  return r;
}
