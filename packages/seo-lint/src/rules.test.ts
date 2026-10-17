// 규칙 파일(rules/rules.v1.json) ↔ PRD, 규칙 파일 검사기(parseRules), 패널 문구 금지어 (OPT-03)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import rawRules from "../rules/rules.v1.json";
import pkg from "../package.json";
import {
  AXES,
  BLOCKING_RULE_IDS,
  BLOCKING_SAMPLES,
  ENGINE_VERSION,
  FORBIDDEN_PANEL_WORDS,
  PASSING_SAMPLE,
  RULES_V1,
  SCORE_DISCLAIMER,
  lintArticle,
  parseRules,
} from "./index";

const PRD_DIR = fileURLToPath(new URL("../../../docs/PRD/", import.meta.url));
const prd = (prefix: string) => {
  const file = fs.readdirSync(PRD_DIR).find((f) => f.startsWith(prefix));
  if (!file) throw new Error(`PRD 문서 없음: ${prefix}`);
  return fs.readFileSync(PRD_DIR + file, "utf8");
};
const opt03Row = prd("PRD-01A").split("\n").find((l) => l.startsWith("| OPT-03 |"))!;
const panelRow = prd("PRD-00").split("\n").find((l) => l.startsWith("| 최적화 점검 패널 |"))!;

type RawRules = { version: string; axes: string[]; rules: Array<Record<string, any>> };
const cloneRaw = (): RawRules => JSON.parse(JSON.stringify(rawRules));
const ruleOf = (raw: RawRules, id: string) => raw.rules.find((r) => r.id === id)!;

describe("규칙 파일 버전", () => {
  it("규칙 파일 version이 결과 ruleVersion에 그대로 실린다 (seo_checks.rules_version)", () => {
    expect(rawRules.version).toBe("2026.10-w1b");
    const result = lintArticle(PASSING_SAMPLE.article, PASSING_SAMPLE.context, RULES_V1);
    expect(result.ruleVersion).toBe(rawRules.version);
  });

  it("다른 version의 규칙 파일을 넣으면 결과 ruleVersion도 그 값이다", () => {
    const raw = cloneRaw();
    raw.version = "2026.11-test";
    const result = lintArticle(PASSING_SAMPLE.article, PASSING_SAMPLE.context, parseRules(raw));
    expect(result.ruleVersion).toBe("2026.11-test");
  });

  it("엔진 버전은 package.json version이다 (seo_checks.engine_version)", () => {
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(lintArticle(PASSING_SAMPLE.article, PASSING_SAMPLE.context, RULES_V1).engineVersion).toBe(pkg.version);
  });
});

describe("규칙 파일 ↔ PRD", () => {
  it("차단 규칙 8종의 이름이 OPT-03 차단 견본 8종 이름과 같은 순서로 같다", () => {
    const listed = opt03Row
      .slice(opt03Row.indexOf("차단 항목 견본 8종(") + "차단 항목 견본 8종(".length, opt03Row.indexOf(" — 해당 항목 하나만"))
      .split(" · ")
      .map((s) => s.replace("(대상 기사)", "").trim());
    expect(listed).toHaveLength(8);
    const blockNames = BLOCKING_RULE_IDS.map((id) => RULES_V1.rules.find((r) => r.id === id)!.name);
    expect(blockNames).toEqual(listed);
    expect(RULES_V1.rules.filter((r) => r.level === "block").map((r) => r.id).sort()).toEqual([...BLOCKING_RULE_IDS].sort());
  });

  it("4축(SEO·AEO·GEO·공통)마다 규칙이 하나 이상 있고 모든 규칙이 PRD 근거를 적었다", () => {
    expect(RULES_V1.axes).toEqual(["SEO", "AEO", "GEO", "공통"]);
    for (const axis of AXES) expect(RULES_V1.rules.some((r) => r.axis === axis)).toBe(true);
    for (const r of RULES_V1.rules) expect(r.source).toMatch(/PRD-01A|OPT-\d\d/);
  });

  it("모든 규칙이 PRD 점검 표의 제 축 행에 있는 항목을 근거로 적었다 — 차단 규칙은 굵은 글씨(차단) 칸, 경고 규칙은 그 밖", () => {
    const doc = prd("PRD-01A");
    const start = doc.indexOf("**발행 전 점검 항목**");
    const table = doc.slice(start, doc.indexOf("| ID | 요구사항", start));
    const row = (axis: string) => table.split("\n").find((l) => l.startsWith(`| ${axis} | `))!;
    for (const r of RULES_V1.rules) {
      const cited = r.source.match(/점검 표 (SEO|AEO|GEO|공통) 「([^」]+)」/);
      expect(cited, r.id).not.toBeNull();
      expect(cited![1], r.id).toBe(r.axis);
      const text = row(r.axis);
      const bold = text.match(/\*\*([^*]+)\*\*/)?.[1] ?? "";
      expect(text, r.id).toContain(cited![2]);
      expect(bold.includes(cited![2]), r.id).toBe(r.level === "block");
    }
  });
});

describe("parseRules — 규칙 파일 검사", () => {
  it("v1 규칙 파일은 통과한다", () => {
    expect(parseRules(cloneRaw()).rules).toHaveLength(16);
  });

  it("메시지에 패널 금지어가 들어간 규칙 파일은 거부한다", () => {
    const raw = cloneRaw();
    ruleOf(raw, "seo.internal-links").messages.fail = "내부 링크를 늘리면 상위 노출에 유리합니다";
    expect(() => parseRules(raw)).toThrow(/seo\.internal-links.*금지어/);
  });

  it("항목 이름에 금지어가 들어가도 거부한다", () => {
    const raw = cloneRaw();
    ruleOf(raw, "aeo.faq").name = "FAQ 순위";
    expect(() => parseRules(raw)).toThrow(/aeo\.faq.*금지어/);
  });

  it("차단 규칙 8종 중 하나라도 빠지면 거부한다", () => {
    const raw = cloneRaw();
    raw.rules = raw.rules.filter((r) => r.id !== "geo.author");
    expect(() => parseRules(raw)).toThrow(/geo\.author/);
  });

  it("차단 규칙을 경고로 낮추면 거부한다", () => {
    const raw = cloneRaw();
    ruleOf(raw, "common.similarity").level = "warn";
    expect(() => parseRules(raw)).toThrow(/common\.similarity.*block/);
  });

  it("엔진에 없는 규칙 ID와 같은 ID 두 번은 거부한다", () => {
    const unknown = cloneRaw();
    unknown.rules.push({ ...ruleOf(unknown, "seo.image-alt"), id: "seo.keyword-density" });
    expect(() => parseRules(unknown)).toThrow(/seo\.keyword-density/);
    const dup = cloneRaw();
    dup.rules.push({ ...ruleOf(dup, "seo.image-alt") });
    expect(() => parseRules(dup)).toThrow(/seo\.image-alt.*두 번/);
  });

  it("점검 함수가 쓰는 메시지 키가 빠지거나 모르는 키가 있으면 거부한다", () => {
    const missing = cloneRaw();
    delete ruleOf(missing, "geo.dates").messages.mismatch;
    expect(() => parseRules(missing)).toThrow(/geo\.dates.*mismatch/);
    const extra = cloneRaw();
    ruleOf(extra, "geo.author").messages.typo = "오타 키";
    expect(() => parseRules(extra)).toThrow(/geo\.author.*typo/);
  });

  it("기준값 형식이 틀리면 거부한다 — 정수 자리에 문자열, 목록 자리에 빈 배열", () => {
    const badInt = cloneRaw();
    ruleOf(badInt, "seo.internal-links").params.min = "2";
    expect(() => parseRules(badInt)).toThrow(/seo\.internal-links.*min/);
    const emptyList = cloneRaw();
    ruleOf(emptyList, "aeo.question-heading").params.suffixes = [];
    expect(() => parseRules(emptyList)).toThrow(/aeo\.question-heading.*suffixes/);
  });

  it("가중치가 양의 정수가 아니거나 축·등급이 틀리면 거부한다", () => {
    const w = cloneRaw();
    ruleOf(w, "aeo.faq").weight = 0;
    expect(() => parseRules(w)).toThrow(/aeo\.faq.*weight/);
    const axis = cloneRaw();
    ruleOf(axis, "aeo.faq").axis = "AIO";
    expect(() => parseRules(axis)).toThrow(/aeo\.faq.*axis/);
    const level = cloneRaw();
    ruleOf(level, "aeo.faq").level = "info";
    expect(() => parseRules(level)).toThrow(/aeo\.faq.*level/);
  });

  it("축 목록이 SEO·AEO·GEO·공통이 아니면 거부한다", () => {
    const raw = cloneRaw();
    raw.axes = ["SEO", "AEO", "GEO"];
    expect(() => parseRules(raw)).toThrow(/axes/);
  });

  it("비교 대상 없음 등급(unverifiedLevel)은 그 상태를 낼 수 있는 규칙(유사도)에만 둘 수 있다", () => {
    const raw = cloneRaw();
    ruleOf(raw, "geo.author").unverifiedLevel = "warn";
    expect(() => parseRules(raw)).toThrow(/geo\.author.*unverifiedLevel/);
    const missing = cloneRaw();
    delete ruleOf(missing, "common.similarity").unverifiedLevel;
    expect(() => parseRules(missing)).toThrow(/common\.similarity.*unverifiedLevel/);
  });
});

describe("패널 문구 금지어 — '순위'·'노출 예측'·'상위 노출' 0 (OPT-03)", () => {
  const prdWords = [...opt03Row.match(/문구에 ((?:'[^']+'·?)+) 0/)![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const ruleTexts = RULES_V1.rules.flatMap((r) => [r.name, ...Object.values(r.messages)]);
  const emitted = [PASSING_SAMPLE, ...BLOCKING_SAMPLES].flatMap((s) =>
    lintArticle(s.article, s.context, RULES_V1).items.map((i) => i.message),
  );

  it("엔진의 금지어 목록이 OPT-03 수용 기준의 세 낱말과 같다", () => {
    expect(prdWords).toEqual(["순위", "노출 예측", "상위 노출"]);
    expect([...FORBIDDEN_PANEL_WORDS]).toEqual(prdWords);
  });

  it("규칙 파일의 항목 이름·문구 전부에 금지어가 없다", () => {
    expect(ruleTexts.length).toBeGreaterThan(40);
    for (const text of ruleTexts) for (const w of prdWords) expect(text).not.toContain(w);
  });

  it("견본 9종을 점검해 나온 패널 문구 전부에 금지어가 없다", () => {
    expect(emitted).toHaveLength(9 * 16);
    for (const text of emitted) for (const w of prdWords) expect(text).not.toContain(w);
  });

  it("고정 문구는 PRD-00 8.6 '최적화 점검 패널'의 문구 그대로이고, 금지어 '순위'가 든 패널 문구는 이것 하나뿐이다", () => {
    const fixed = panelRow.match(/고정 문구 "([^"]+)"/)![1];
    expect(SCORE_DISCLAIMER).toBe(fixed);
    expect(SCORE_DISCLAIMER).toBe("내부 품질 지표 — 검색 순위 예측이 아닙니다");
    const panelTexts = [SCORE_DISCLAIMER, ...ruleTexts, ...emitted];
    expect(panelTexts.filter((t) => t.includes("순위"))).toEqual([SCORE_DISCLAIMER]);
  });
});
