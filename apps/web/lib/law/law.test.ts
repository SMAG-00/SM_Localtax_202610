import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, earliestVersion, isRealIsoDate, kstToday, parseAsOf, pickVersionAsOf, previousVersion, upcomingBadge, upcomingVersions } from "./as-of";
import { splitProvision } from "./anchors";
import { articleSegment, lawHref, lawThreeHref, parseArticleSegment, parseLawSegment } from "./article-ref";
import { compareBlocks } from "./compare";
import { extractArticleCitations, extractCaseNumbers, keepExistingArticles, provisionKey, segmentText } from "./citations";
import { qualityPasses } from "./quality";
import { groupByTab, isAfterAsOf, reasonForArticleOfDoc, reasonForProvision, type RelatedItem } from "./related";
import { buildThreeRows } from "./three";

// 시험용 개정판 - 지어낸 날짜(법령 날짜 아님)
const A = { id: 1, promulgated_on: "2025-10-01", effective_on: "2026-01-01" };
const B = { id: 2, promulgated_on: "2026-10-01", effective_on: "2027-01-01" };
const C = { id: 3, promulgated_on: "2026-10-01", effective_on: "2027-01-01" }; // 같은 시행일 - 번호가 큰 쪽이 이긴다

describe("기준일 개정판 선택 (LAW-02 · LAW-03 · LAW-05)", () => {
  it("시행일 전날은 이전 개정판, 당일은 새 개정판, 다음 날도 새 개정판", () => {
    expect(pickVersionAsOf([A, B], "2026-12-31")).toBe(A);
    expect(pickVersionAsOf([A, B], "2027-01-01")).toBe(B);
    expect(pickVersionAsOf([B, A], "2027-01-02")).toBe(B);
  });
  it("기준일이 첫 개정판 시행일보다 앞서면 null, 가장 이른 개정판을 따로 찾는다", () => {
    expect(pickVersionAsOf([A, B], "2025-12-31")).toBeNull();
    expect(earliestVersion([B, A])).toBe(A);
    expect(earliestVersion([])).toBeNull();
  });
  it("시행일자가 같으면 공포일자, 그다음 번호가 큰 쪽", () => {
    expect(pickVersionAsOf([B, C], "2027-06-01")).toBe(C);
    const older = { id: 9, promulgated_on: "2026-09-30", effective_on: "2027-01-01" };
    expect(pickVersionAsOf([older, B], "2027-01-01")).toBe(B);
  });
  it("바로 앞 개정판 - 신구 대비의 '구'", () => {
    expect(previousVersion([A, B], B)).toBe(A);
    expect(previousVersion([A, B], A)).toBeNull();
  });
  it("시행 예정 배지 - 시행일 전날까지 있고 당일부터 없다, 공포 전 개정판은 아직 없다", () => {
    expect(upcomingVersions([A, B], "2026-12-31")).toEqual([B]);
    expect(upcomingVersions([A, B], "2027-01-01")).toEqual([]);
    expect(upcomingVersions([A, B], "2026-09-30")).toEqual([]);
    expect(upcomingBadge("2027-01-01")).toBe("2027.1.1 시행 예정");
  });
  it("?date= 해석 - 올바른 날짜만 쓰고 달력에 없는 날·형식 밖은 오늘", () => {
    expect(parseAsOf("2026-10-13", "2026-10-25")).toEqual({ date: "2026-10-13", explicit: true });
    expect(parseAsOf("2026-02-30", "2026-10-25")).toEqual({ date: "2026-10-25", explicit: false });
    expect(parseAsOf("26-10-13", "2026-10-25").explicit).toBe(false);
    expect(parseAsOf(undefined, "2026-10-25").date).toBe("2026-10-25");
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2027-02-29")).toBe(false);
  });
  it("한국 날짜 - UTC 15:00이 한국 다음 날 00:00", () => {
    expect(kstToday(new Date("2026-12-31T14:59:59Z"))).toBe("2026-12-31");
    expect(kstToday(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("조문 블록과 앵커 (LAW-01 · LAW-04)", () => {
  it("항·호·목에 앵커 p1, p1-i1, p1-i1-s1을 붙인다", () => {
    const blocks = splitProvision("① 시험용 첫째 항\n1. 시험용 호\n가. 시험용 목\n나. 시험용 목 둘\n2의2. 시험용 호 가지\n② 시험용 둘째 항");
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p1-i1", "p1-i1-s1", "p1-i1-s2", "p1-i2-2", "p2"]);
    expect(blocks[1]!.level).toBe("item");
  });
  it("항 표시가 없는 조문은 첫 줄이 p1, 이어지는 줄은 같은 블록 글자에 붙는다", () => {
    const blocks = splitProvision("시험용 한 문장\n이어지는 줄");
    expect(blocks).toEqual([{ id: "p1", level: "paragraph", text: "시험용 한 문장\n이어지는 줄" }]);
  });
  it("항 앞의 머리 줄은 lead", () => {
    expect(splitProvision("시험용 머리\n① 시험용 항").map((b) => b.id)).toEqual(["lead", "p1"]);
  });
});

describe("법령 주소 (LAW-04)", () => {
  it("조와 가지 번호 주소를 읽고 만든다", () => {
    expect(parseArticleSegment("11")).toEqual({ no: 11, branch: 0 });
    expect(parseArticleSegment("11-2")).toEqual({ no: 11, branch: 2 });
    expect(parseArticleSegment("0")).toBeNull();
    expect(parseArticleSegment("11-0")).toBeNull();
    expect(parseArticleSegment("abc")).toBeNull();
    expect(articleSegment(11, 2)).toBe("11-2");
  });
  it("같은 시점·위치로 여는 주소 - 이름 인코딩, date, 앵커", () => {
    expect(lawHref("시험용법", { article: { no: 11, branch: 0 }, date: "2026-10-13", anchor: "p1" })).toBe(`/law/${encodeURIComponent("시험용법")}/11?date=2026-10-13#p1`);
    expect(lawThreeHref("시험용법", "2026-10-13", { no: 3, branch: 1 })).toBe(`/law/${encodeURIComponent("시험용법")}/three?date=2026-10-13&article=3-1`);
    expect(parseLawSegment(encodeURIComponent("시험용법 시행령"))).toEqual({ name: "시험용법 시행령" });
    expect(parseLawSegment("12")).toEqual({ id: 12 });
    expect(parseLawSegment("%E0%A4%A")).toBeNull();
  });
});

describe("신구조문 대비 (LAW-02)", () => {
  it("같은 앵커끼리 맞추고 바뀐 것·새로 생긴 것·없어진 것을 가른다", () => {
    const rows = compareBlocks(splitProvision("① 가\n② 나\n③ 다"), splitProvision("① 가\n② 나2\n④ 라").concat([{ id: "p3", level: "paragraph", text: "③ 다" }]));
    expect(rows.map((r) => [r.id, r.status])).toEqual([["p1", "same"], ["p2", "changed"], ["p4", "added"], ["p3", "same"]]);
    expect(compareBlocks(splitProvision("① 가\n② 나"), splitProvision("① 가")).at(-1)).toEqual({ id: "p2", old: "② 나", now: null, status: "removed" });
  });
});

describe("3단 보기 행 (LAW-05)", () => {
  const S = (no: number, branch = 0) => ({ lawId: 1, no, branch });
  const D = (no: number) => ({ lawId: 2, no, branch: 0 });
  const R = (no: number) => ({ lawId: 3, no, branch: 0 });
  it("법률 조문마다 시행령·시행규칙 조문을 같은 행에 모으고, 시행령→시행규칙 위임도 같은 행의 시행규칙 칸에 둔다", () => {
    const rows = buildThreeRows(
      [S(1), S(2), S(2, 1)],
      [
        { parent: S(1), child: D(5) },
        { parent: S(1), child: D(3) },
        { parent: D(5), child: R(7) },
        { parent: S(1), child: R(2) },
      ],
      2,
      3,
    );
    expect(rows[0]!.decree.map((r) => r.no)).toEqual([3, 5]);
    expect(rows[0]!.rule.map((r) => r.no)).toEqual([2, 7]);
    expect(rows[1]).toEqual({ statute: S(2), decree: [], rule: [] });
    expect(rows[2]!.decree).toEqual([]);
  });
  it("시행령·시행규칙이 없는 법령이면 빈 칸", () => {
    expect(buildThreeRows([S(1)], [{ parent: S(1), child: D(5) }], null, null)).toEqual([{ statute: S(1), decree: [], rule: [] }]);
  });
});

describe("표본 검사 관문 (LAW-05 · CASE-02) - DB 함수와 같은 기준", () => {
  it("위임 매핑: 표본 50건에서 48 합격, 47 보류, 49건 표본은 크기 부족", () => {
    expect(qualityPasses("delegation_mapping", 50, 48)).toBe(true);
    expect(qualityPasses("delegation_mapping", 50, 47)).toBe(false);
    expect(qualityPasses("delegation_mapping", 49, 49)).toBe(false);
  });
  it("조문 인용·기사 패턴: 표본 100건에서 95 합격, 94 보류", () => {
    for (const k of ["case_citation", "article_pattern"] as const) {
      expect(qualityPasses(k, 100, 95)).toBe(true);
      expect(qualityPasses(k, 100, 94)).toBe(false);
      expect(qualityPasses(k, 99, 99)).toBe(false);
    }
  });
  it("마이그레이션 89의 SQL 함수가 같은 숫자를 쓴다", () => {
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261025000089_w10d_links_delegations.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/'delegation_mapping' then p_size >= 50 and p_matched \* 100 >= p_size \* 95/);
    expect(sql).toMatch(/'case_citation' then p_size >= 100 and p_matched \* 100 >= p_size \* 95/);
    expect(sql).toMatch(/'article_pattern' then p_size >= 100 and p_matched \* 100 >= p_size \* 95/);
  });
});

describe("조문 인용·사건번호 추출 (CASE-02 · ART-12)", () => {
  const laws = [
    { id: 1, name: "시험용법" },
    { id: 2, name: "시험용법 시행령" },
  ];
  it("'제11조의2'를 '제11조'로 자르지 않는다", () => {
    const [c] = extractArticleCitations("시험용법 제11조의2에 따른다", laws);
    expect(c).toMatchObject({ lawId: 1, articleNo: 11, branchNo: 2, text: "시험용법 제11조의2" });
  });
  it("'조의' 뒤에 숫자가 없으면(‘제11조의 규정’) 가지 번호 없이 제11조", () => {
    const [c] = extractArticleCitations("시험용법 제11조의 규정에 따라", laws);
    expect(c).toMatchObject({ articleNo: 11, branchNo: 0, text: "시험용법 제11조" });
  });
  it("긴 법령 이름(시행령)이 먼저 맞고, 항 번호는 앵커용으로 읽는다", () => {
    const [c] = extractArticleCitations("시험용법 시행령 제3조 제2항 단서", laws);
    expect(c).toMatchObject({ lawId: 2, articleNo: 3, paragraph: 2 });
  });
  it("DB에 없는 조문은 링크 후보에서 뺀다", () => {
    const found = extractArticleCitations("시험용법 제11조와 시험용법 제99조", laws);
    const kept = keepExistingArticles(found, new Set([provisionKey(1, 11, 0)]));
    expect(kept.map((c) => c.articleNo)).toEqual([11]);
  });
  it("사건번호 - 조세심판원과 법원 형식, 공백은 지우고 이어진 숫자는 건드리지 않는다", () => {
    const found = extractCaseNumbers("조심2026지0085 결정과 조심 2026 서 123, 대법원 2026두12345 판결, 12026두1 은 아님, 2026년 1월");
    expect(found.map((f) => [f.normalized, f.family])).toEqual([["조심2026지0085", "tribunal"], ["조심2026서123", "tribunal"], ["2026두12345", "court"]]);
  });
  it("조각 나누기 - 겹치면 먼저 시작한 것만, 글자를 잃지 않는다", () => {
    const text = "가 시험용법 제11조 나 조심2026지0085 다";
    const segs = segmentText(text, [...extractArticleCitations(text, laws), ...extractCaseNumbers(text)]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.match).length).toBe(2);
  });

  it("표본 100건 패턴 시험 - 추출 정확도 95% 이상 (ART-12 · CASE-02)", () => {
    // 조문 표기 60건(가지 번호·항·띄어쓰기 변형) + 사건번호 25건 + 아무것도 없는 문장 15건 = 100건. 기대값은 손으로 정한다
    const samples: Array<{ text: string; expect: string[] }> = [];
    for (let n = 1; n <= 20; n++) samples.push({ text: `근거는 시험용법 제${n}조이다`, expect: [`1:${n}:0`] });
    for (let n = 1; n <= 20; n++) samples.push({ text: `시험용법 제${n}조의${(n % 5) + 1}에 따라`, expect: [`1:${n}:${(n % 5) + 1}`] });
    for (let n = 1; n <= 10; n++) samples.push({ text: `시험용법 시행령 제 ${n} 조 제${(n % 3) + 1}항`, expect: [`2:${n}:0`] });
    for (let n = 1; n <= 10; n++) samples.push({ text: `시험용법 제${n}조와 시험용법 시행령 제${n + 1}조`, expect: [`1:${n}:0`, `2:${n + 1}:0`] });
    for (let n = 1; n <= 15; n++) samples.push({ text: `조심2026지${String(n).padStart(4, "0")} 결정`, expect: [`조심2026지${String(n).padStart(4, "0")}`] });
    for (let n = 1; n <= 10; n++) samples.push({ text: `대법원 2026두${10000 + n} 판결`, expect: [`2026두${10000 + n}`] });
    for (let n = 1; n <= 15; n++) samples.push({ text: `제${n}조 ${n}항 그리고 ${2000 + n}년 ${n}월에 시험용 문장`, expect: [] });
    expect(samples).toHaveLength(100);
    let ok = 0;
    for (const s of samples) {
      const got = [...extractArticleCitations(s.text, laws).map((c) => provisionKey(c.lawId, c.articleNo, c.branchNo)), ...extractCaseNumbers(s.text).map((c) => c.normalized)];
      if (JSON.stringify(got) === JSON.stringify(s.expect)) ok += 1;
    }
    expect(ok).toBeGreaterThanOrEqual(95);
  });
});

describe("관련 자료 패널 (LAW-06 · TX-11)", () => {
  const item = (over: Partial<RelatedItem>): RelatedItem => ({ linkId: 1, kind: "legal_doc", docType: "case", relation: "cites", origin: "editor", title: "시험용", href: "/x", decidedOn: "2026-10-13", ...over });
  it("이유 문장은 관계 값과 종류에서만 만든다", () => {
    expect(reasonForProvision({ kind: "legal_doc", docType: "tribunal", relation: "cites" })).toBe("이 조문을 인용한 심판 결정례");
    expect(reasonForProvision({ kind: "legal_doc", docType: "interpretation", relation: "interprets" })).toBe("이 조문을 해석한 유권해석");
    expect(reasonForProvision({ kind: "article", docType: null, relation: "explains" })).toBe("이 조문을 설명한 기사");
    expect(reasonForArticleOfDoc("explains")).toBe("이 문서를 해설한 기사");
  });
  it("기준일 이후 문서 - 전날 문서는 아니고 당일도 아니고 다음 날 문서만 이후", () => {
    expect(isAfterAsOf("2026-10-12", "2026-10-13")).toBe(false);
    expect(isAfterAsOf("2026-10-13", "2026-10-13")).toBe(false);
    expect(isAfterAsOf("2026-10-14", "2026-10-13")).toBe(true);
    expect(isAfterAsOf(null, "2026-10-13")).toBe(false);
  });
  it("탭 묶기 - 예규·통칙·유권해석은 해석 탭, 최신 결정일 먼저", () => {
    const g = groupByTab([
      item({ linkId: 1, docType: "ruling", decidedOn: "2026-01-01" }),
      item({ linkId: 2, docType: "circular", decidedOn: "2026-05-01" }),
      item({ linkId: 3, docType: "case" }),
      item({ linkId: 4, kind: "article", docType: null, decidedOn: null }),
    ]);
    expect(g.interpretation.map((i) => i.linkId)).toEqual([2, 1]);
    expect(g.case.map((i) => i.linkId)).toEqual([3]);
    expect(g.article.map((i) => i.linkId)).toEqual([4]);
    expect(g.tribunal).toEqual([]);
  });
});
