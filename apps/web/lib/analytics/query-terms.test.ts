// 검색어 집계 순수 규칙 (SRCH-03 — docs/dev/W2-d_설계.md 2.7 · 2.8 · 8.3) — 설계 문서 표를 읽어 대조한다 (DB 시험 w2d-query-terms가 같은 표를 읽는다)
//  · 2.8 가림 견본 — 검색어마다 가린 값·정규형이 표와 같고, 정규형 '—'은 저장 0 · 가린 값은 DB check와 같은 모양 검사(storable)를 지난다
//  · 숫자 줄 경계(8자리 그대로 · 9자리 가림) · 주민등록번호/번호 구별 · 100자 자르기(가림 글자를 자르지 않는다) · 경계에 걸친 번호
//  · 같은 정규형 합산 열쇠 · 세는가(봇·편집국·측정 거부·미리 받기·2쪽·같은 검색 안 이동) · 30분 안 다시 찾기 · 기간(한국 날짜) · 설정 검사
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MASK_LABELS,
  QUERY_TERMS,
  QUERY_TERM_SOURCES,
  RecentSearches,
  checkQueryTermsSettings,
  isPrefetch,
  isSameSearch,
  maskQuery,
  periodOf,
  readQueryTermsSettings,
  resolveTermsPeriod,
  skipReason,
  storable,
  type CountSignals,
} from "./query-terms";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");
const ticks = (s: string) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
function sub(no: string): string {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const part = sec?.split(/^### /m).find((s) => s.startsWith(no));
  if (!part) throw new Error(`설계 문서 ${no}가 없다`);
  return part;
}
const tableRows = (s: string) =>
  s
    .split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const VALUES = new Map(tableRows(sub("2.7")).map(([name, cell]) => [name!.split(/\s/)[0]!, ticks(cell!)]));
const value = (name: string) => {
  const v = VALUES.get(name);
  if (!v?.length) throw new Error(`설계 2.7에 '${name}'이 없다`);
  return v;
};
const GOLDEN = tableRows(sub("2.8")).map(([input, masked, normalized]) => ({ input: ticks(input!)[0]!, masked: ticks(masked!)[0]!, normalized: normalized === "—" ? null : ticks(normalized!)[0]! }));
const SEED = JSON.parse(sub("2.7").match(/^#### `query_terms`\s*\n+```json\n([\s\S]*?)\n```/m)![1]!);

describe("설계 2.7 값 = 코드 상수", () => {
  test("출처·가림 글자·숫자 줄·글자 수·다시 찾기·목록·기간 단추", () => {
    expect([...QUERY_TERM_SOURCES]).toEqual(value("query_terms.source"));
    expect(Object.values(MASK_LABELS)).toEqual(value("query_terms.mask_labels"));
    expect(QUERY_TERMS.period).toBe(value("query_terms.period")[0]);
    expect(QUERY_TERMS.digitRun).toBe(Number(value("query_terms.digit_run")[0]));
    expect(QUERY_TERMS.termChars).toBe(Number(value("query_terms.term_chars")[0]));
    expect(QUERY_TERMS.scanChars).toBe(Number(value("query_terms.scan_chars")[0]));
    expect(QUERY_TERMS.dedupeMinutes).toBe(Number(value("query_terms.dedupe_minutes")[0]));
    expect(QUERY_TERMS.listSize).toBe(Number(value("query_terms.list_size")[0]));
    expect([...QUERY_TERMS.presets]).toEqual(value("query_terms.presets").map(Number));
  });
  test("설정 씨앗은 검사를 지난다", () => {
    expect(checkQueryTermsSettings(SEED)).toEqual([]);
    expect(readQueryTermsSettings(SEED)).toEqual(SEED);
  });
});

describe("가림 견본 (설계 2.8)", () => {
  test("견본 표를 읽었다 — 전화·이메일·주민등록번호·긴 번호와 닮은꼴(날짜·기간·조문·대표번호)", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(20);
    for (const label of Object.values(MASK_LABELS)) expect(GOLDEN.some((g) => g.masked.includes(label)), label).toBe(true);
    for (const lookalike of ["2026-10-19 개편안", "60일 안에 신고", "지방세법 제111조"]) expect(GOLDEN.some((g) => g.input === lookalike && g.masked === lookalike), lookalike).toBe(true);
  });
  test.each(GOLDEN)("$input → $masked / $normalized", ({ input, masked, normalized }) => {
    const m = maskQuery(input);
    expect(m.text).toBe(masked);
    expect(m.normalized).toBe(normalized ?? "");
    expect(storable(m)).toBe(normalized !== null);
  });
  test("가린 종류는 글 차례대로", () => {
    expect(maskQuery("hong@example.com 그리고 010-1234-5678 그리고 900101-1234567 그리고 1234-5678-9012-3456").masked).toEqual(["email", "phone", "rrn", "number"]);
    expect(maskQuery("취득세 신고 기한").masked).toEqual([]);
  });
  test("원문 숫자·이메일 조각이 가린 값·정규형 어디에도 남지 않는다", () => {
    const raw = "문의 hong.gil-dong@example.co.kr 또는 010 9876 5432, 주민 851231-2345678, 계좌 3333-01-1234567";
    const m = maskQuery(raw);
    for (const piece of ["hong", "example", "9876", "5432", "851231", "2345678", "3333", "1234567"]) {
      expect(m.text).not.toContain(piece);
      expect(m.normalized).not.toContain(piece);
    }
    expect(m.text).toBe("문의 [이메일] 또는 [전화번호], 주민 [주민등록번호], 계좌 [번호]");
    expect(m.normalized).toBe("문의 또는 주민 계좌");
  });
});

describe("숫자 줄 경계 (설계 2.7 query_terms.digit_run)", () => {
  test.each([
    ["12345678", "12345678"],
    ["123456789", "[번호]"],
    ["1234-5678", "1234-5678"],
    ["1234-56789", "[번호]"],
    ["12 34 56 78", "12 34 56 78"],
    ["12 34 56 789", "[번호]"],
    ["1234/5678/9", "[번호]"],
    ["2026.10.19", "2026.10.19"],
    ["20261019", "20261019"],
    ["2026년 10월 19일 12345678", "2026년 10월 19일 12345678"],
    ["0101234567가8", "[전화번호]가8"],
  ])("%s → %s", (input, masked) => {
    expect(maskQuery(input).text).toBe(masked);
  });
  test("주민등록번호 — 생년월일·성별 숫자가 맞을 때만, 아니면 번호 (어느 쪽이든 가린다)", () => {
    expect(maskQuery("000229-3123456").text).toBe("[주민등록번호]");
    expect(maskQuery("850230-1234567").text).toBe("[번호]"); // 2월 30일
    expect(maskQuery("851231-9234567").text).toBe("[번호]"); // 성별 숫자 9
    expect(maskQuery("8512311234567").text).toBe("[주민등록번호]");
  });
  test("전화번호 — 0으로 시작하는 9~11자리 · +82/82 국가 번호 · 괄호 지역 번호", () => {
    for (const s of ["02-123-4567", "031-123-4567", "070-1234-5678", "010 1234 5678", "+82-2-123-4567", "821012345678", "(031) 123-4567"]) expect(maskQuery(s).text, s).toBe("[전화번호]");
    expect(maskQuery("1588-1234").text).toBe("1588-1234");
  });
});

describe("자르기 — 앞 100자, 가림 글자를 자르지 않는다", () => {
  test("100자를 넘는 글은 100자에서 자르고 끝 공백을 뺀다", () => {
    const m = maskQuery(`${"가".repeat(98)} 나다`);
    expect(Array.from(m.text).length).toBe(QUERY_TERMS.termChars);
    expect(m.text.endsWith("나")).toBe(true);
    expect(maskQuery(`${"가".repeat(99)} 나다`).text).toBe("가".repeat(99)); // 100번째가 띄어쓰기면 빼고 99자
  });
  test("가림 글자가 100자 경계에 걸리면 통째로 뺀다", () => {
    const m = maskQuery(`${"가".repeat(97)} 010-1234-5678`);
    expect(m.text).toBe("가".repeat(97));
    expect(storable(m)).toBe(true);
  });
  test("저장 글자 수 경계에 걸친 번호도 통째로 가린다(앞 200자 안에서 찾는다) — 번호 조각이 남지 않는다", () => {
    const m = maskQuery(`${"세".repeat(95)} 010-1234-5678 끝`);
    expect(m.text).toBe(`${"세".repeat(95)}`);
    expect(m.text).not.toMatch(/[0-9]/);
  });
  test("빈 검색어·띄어쓰기뿐·기호뿐 → 저장 0", () => {
    for (const s of ["", "   ", "?!·", null, undefined]) {
      const m = maskQuery(s);
      expect(storable(m), String(s)).toBe(false);
    }
  });
  test("사용 영역 글자(가림 자리 표시와 같은 범위)는 지운다 — 가짜 가림 글자를 만들 수 없다", () => {
    const m = maskQuery(`취득세${String.fromCharCode(0xe002)}감면`);
    expect(m.text).toBe("취득세감면");
    expect(m.masked).toEqual([]);
  });
});

describe("같은 정규형 — 합산 열쇠 (설계 5장 끝 '같은 정규형' = 붙인 낱말 목록)", () => {
  test("띄어쓰기·기호·전각·대소문자만 다르면 같은 열쇠 (한 글자 낱말은 4장 3대로 옆 낱말에 붙는다 — '취득 세 감면'은 '취득 세감면')", () => {
    expect(maskQuery("취득 세 감면").normalized).toBe("취득 세감면");
    const keys = ["취득세 감면", "취득세, 감면", "  취득세   감면!! ", "「취득세」 감면", "취득세·감면"].map((s) => maskQuery(s).normalized);
    expect(new Set(keys)).toEqual(new Set(["취득세 감면"]));
    expect(maskQuery("ＰＦ 대출").normalized).toBe(maskQuery("pf 대출").normalized);
  });
  test("가림만 다르면 같은 열쇠 — 번호를 뺀 질문으로 합친다", () => {
    expect(maskQuery("취득세 010-1234-5678").normalized).toBe(maskQuery("취득세 010-9999-0000").normalized);
    expect(maskQuery("취득세 010-1234-5678").normalized).toBe("취득세");
  });
  test("낱말 차례가 다르거나 낱말이 다르면 다른 열쇠", () => {
    expect(maskQuery("감면 취득세").normalized).not.toBe(maskQuery("취득세 감면").normalized);
    expect(maskQuery("취득세 감면").normalized).not.toBe(maskQuery("재산세 감면").normalized);
  });
});

describe("저장할 수 있는 값 (DB check와 같은 판정)", () => {
  test("무작위 숫자·기호·글자·@ 조합 2,000개 — 가린 값은 언제나 9자리 숫자 줄·이메일 모양이 없다", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const parts = ["0", "1", "5", "9", "-", ".", " ", "(", ")", "+", "@", "a", "가", "세", "x", "_", "/", "０", "＠"];
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => parts[Math.floor(rand() * parts.length)]).join("");
      const m = maskQuery(s);
      const nfkc = m.text.normalize("NFKC");
      expect(/[0-9](?:[^0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]*[0-9]){8}/u.test(nfkc), s).toBe(false);
      expect(/[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿_.%+-]\s*@\s*[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]/u.test(nfkc), s).toBe(false);
    }
  });
  test("겹친 낱말을 빼서 숫자 낱말이 이웃이 되면(정규형에 9자리 줄) 세지 않는다", () => {
    const m = maskQuery("11111 가가 22222 가가 33333");
    expect(m.normalized).toBe("11111 가가 22222 33333");
    expect(storable(m)).toBe(false);
  });
});

describe("세는가 — 사람이 새로 찾은 한 번만", () => {
  const ok: CountSignals = { storable: true, page: 1, prefetch: false, refused: false, bot: false, staff: false, sameSearch: false };
  test("모두 아니면 센다", () => expect(skipReason(ok)).toBeNull());
  test.each([
    [{ storable: false }, "empty"],
    [{ page: 2 }, "page"],
    [{ prefetch: true }, "prefetch"],
    [{ refused: true }, "refused"],
    [{ bot: true }, "bot"],
    [{ staff: true }, "staff"],
    [{ sameSearch: true }, "same_search"],
  ] as const)("%o → %s", (over, reason) => {
    expect(skipReason({ ...ok, ...over })).toBe(reason);
  });
  test("미리 받기 머리글", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(isPrefetch(h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetch(h({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetch(h({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetch(h({ rsc: "1" }))).toBe(false);
    expect(isPrefetch(h({}))).toBe(false);
  });
  test("같은 검색 안의 이동 — 같은 사이트 /search이고 정규형이 같을 때만", () => {
    const hosts = ["127.0.0.1:3001", "e2e.example.test"];
    const key = maskQuery("취득세 감면").normalized;
    expect(isSameSearch(`http://127.0.0.1:3001/search?q=${encodeURIComponent("취득세,  감면")}&tab=article`, hosts, key)).toBe(true);
    expect(isSameSearch("https://e2e.example.test/search?q=취득세감면!&page=2", hosts, key)).toBe(false); // '취득세감면'은 다른 정규형(한 낱말)
    expect(isSameSearch("https://e2e.example.test/search?q=취득세 감면&section=tax", hosts, key)).toBe(true);
    expect(isSameSearch("https://e2e.example.test/search?q=재산세", hosts, key)).toBe(false);
    expect(isSameSearch("https://e2e.example.test/?q=취득세 감면", hosts, key)).toBe(false);
    expect(isSameSearch("https://evil.example/search?q=취득세 감면", hosts, key)).toBe(false);
    expect(isSameSearch("not a url", hosts, key)).toBe(false);
    expect(isSameSearch(null, hosts, key)).toBe(false);
    expect(isSameSearch("https://e2e.example.test/search?q=", hosts, "")).toBe(false);
  });
  test("30분 안 다시 찾기 — 29분 59초는 한 번, 30분부터 다시 센다, 열쇠마다 따로, 상한을 넘으면 오래된 열쇠부터 버린다", () => {
    const r = new RecentSearches();
    const t0 = Date.parse("2026-10-19T00:00:00Z");
    expect(r.seen("v:1|취득세", t0)).toBe(false);
    expect(r.seen("v:1|취득세", t0 + 30 * 60_000 - 1000)).toBe(true);
    expect(r.seen("v:2|취득세", t0 + 1000)).toBe(false);
    expect(r.seen("v:1|재산세", t0 + 1000)).toBe(false);
    expect(r.seen("v:1|취득세", t0 + 30 * 60_000)).toBe(false);
    expect(r.seen("v:1|취득세", t0 + 30 * 60_000 - 5)).toBe(true); // 시계가 몇 ms 뒤로 가도
    const small = new RecentSearches(60_000, 2);
    small.seen("a", t0);
    small.seen("b", t0);
    small.seen("c", t0);
    expect(small.size).toBe(2);
    expect(small.seen("a", t0 + 1)).toBe(false);
    expect(small.seen("c", t0 + 1)).toBe(true);
  });
});

describe("기간 (한국 날짜)", () => {
  test("기간 행 = 한국 날짜 — UTC 14:59:59는 그날, 15:00은 다음 날", () => {
    expect(periodOf(Date.parse("2026-10-19T14:59:59.999Z"))).toBe("2026-10-19");
    expect(periodOf(Date.parse("2026-10-19T15:00:00Z"))).toBe("2026-10-20");
  });
  const now = Date.parse("2026-10-19T03:00:00Z"); // 한국 12:00
  test("기본 최근 7일 · 단추 30·90일 · 직접 고른 기간", () => {
    expect(resolveTermsPeriod({}, now, 395)).toEqual({ period: { from: "2026-10-13", to: "2026-10-19", days: 7, preset: 7 }, error: null });
    expect(resolveTermsPeriod({ days: "30" }, now, 395).period).toEqual({ from: "2026-09-20", to: "2026-10-19", days: 30, preset: 30 });
    expect(resolveTermsPeriod({ days: "90" }, now, 395).period.from).toBe("2026-07-22");
    expect(resolveTermsPeriod({ from: "2026-10-01", to: "2026-10-01" }, now, 395)).toEqual({ period: { from: "2026-10-01", to: "2026-10-01", days: 1, preset: null }, error: null });
  });
  test.each([
    [{ days: "8" }, "알 수 없는 기간"],
    [{ from: "2026-10-05", to: "2026-10-01" }, "늦습니다"],
    [{ from: "2026-10-01", to: "2026-10-20" }, "오늘(2026-10-19)까지"],
    [{ from: "2026-02-30", to: "2026-03-01" }, "YYYY-MM-DD"],
    [{ from: "2026-10-01" }, "YYYY-MM-DD"],
    [{ from: "2025-09-19", to: "2026-10-19" }, "보존 일수(395일)"],
  ])("%o → 최근 7일 + 이유", (q, why) => {
    const r = resolveTermsPeriod(q, now, 395);
    expect(r.period.preset).toBe(7);
    expect(r.error).toContain(why);
  });
  test("보존 일수 경계 — 395일은 되고 396일은 안 된다", () => {
    expect(resolveTermsPeriod({ from: "2025-09-20", to: "2026-10-19" }, now, 395).error).toBeNull();
    expect(resolveTermsPeriod({ from: "2025-09-19", to: "2026-10-19" }, now, 395).error).not.toBeNull();
  });
});

describe("설정 query_terms 검사", () => {
  test.each([
    [null, "JSON 객체"],
    [{ ...SEED, retention_days: 30 }, "retention_days: 31~1825"],
    [{ ...SEED, retention_days: 1826 }, "retention_days"],
    [{ ...SEED, retention_days: 395.5 }, "retention_days"],
    [{ ...SEED, display_min_count: 0 }, "display_min_count: 1~100"],
    [{ ...SEED, display_min_count: 101 }, "display_min_count"],
    [{ ...SEED, extra: 1 }, "extra: 모르는 칸"],
    [{ version: "x", retention_days: 395 }, "display_min_count: 필요합니다"],
    [{ ...SEED, version: "" }, "version"],
  ])("%o → %s", (v, msg) => {
    expect(checkQueryTermsSettings(v).join(" / ")).toContain(msg);
    expect(readQueryTermsSettings(v)).toBeNull();
  });
  test("경계 값은 받는다 · 값을 바꾸면 버전도", () => {
    expect(checkQueryTermsSettings({ ...SEED, retention_days: 31, display_min_count: 1 })).toEqual([]);
    expect(checkQueryTermsSettings({ ...SEED, retention_days: 1825, display_min_count: 100 })).toEqual([]);
    expect(checkQueryTermsSettings({ ...SEED, display_min_count: 3 }, SEED).join()).toContain("버전도 바꿔야");
    expect(checkQueryTermsSettings({ ...SEED, display_min_count: 3, version: "2026-10-20.1" }, SEED)).toEqual([]);
    expect(checkQueryTermsSettings(SEED, SEED)).toEqual([]);
  });
});
