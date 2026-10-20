import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COMPANY_INFO_FIELDS, POLICY_DOCS, canEditPolicy, companyInfoRows, parsePolicyBody, policyBodyToText, publishWarnings, readPolicyBody } from "./docs";
import { hasEmailShape } from "./email";

const DESIGN = fs.readFileSync(path.join(process.cwd(), "..", "..", "docs", "dev", "W2-e_설계.md"), "utf8");

describe("정책 문서 표 = 설계 2.5", () => {
  const sec = DESIGN.split(/^### /m).find((s) => s.startsWith("2.5"))!;
  const rows = sec.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  it("문서 9종의 doc_key·주소·기능 키가 설계 표와 같다", () => {
    expect(rows.length).toBe(9);
    for (const r of rows) {
      const d = POLICY_DOCS.find((x) => x.key === r[0]!.replaceAll("`", ""));
      expect(d, r[0]).toBeDefined();
      expect(d!.href).toBe(r[1]!.replaceAll("`", ""));
      expect(d!.feature).toBe(r[2]!.replaceAll("`", ""));
    }
  });
});

describe("canEditPolicy", () => {
  it("관리자는 전부, 편집 책임자는 편집 원칙류만, 광고 담당은 광고·제휴 안내만", () => {
    expect(canEditPolicy("privacy", { isAdmin: true, roles: [] })).toBe(true);
    expect(canEditPolicy("ethics", { isAdmin: false, roles: ["editor"] })).toBe(true);
    expect(canEditPolicy("privacy", { isAdmin: false, roles: ["editor"] })).toBe(false);
    expect(canEditPolicy("advertise", { isAdmin: false, roles: ["ad_ops"] })).toBe(true);
    expect(canEditPolicy("ad-policy", { isAdmin: false, roles: ["ad_ops"] })).toBe(false);
    expect(canEditPolicy("about", { isAdmin: false, roles: ["reporter"] })).toBe(false);
  });
});

describe("parsePolicyBody (줄 표기)", () => {
  const text = "머리 문단 첫줄\n둘째줄\n\n## 제1절\n문단 하나\n\n- 항목 A\n- 항목 B\n\n> 강조 문장\n\n## 제2절\n<b>태그</b> 그대로 글자";
  it("절·문단·목록·강조로 나눈다", () => {
    expect(parsePolicyBody(text)).toEqual([
      { heading: "", blocks: [{ type: "paragraph", text: "머리 문단 첫줄 둘째줄" }] },
      { heading: "제1절", blocks: [{ type: "paragraph", text: "문단 하나" }, { type: "list", items: ["항목 A", "항목 B"] }, { type: "callout", text: "강조 문장" }] },
      { heading: "제2절", blocks: [{ type: "paragraph", text: "<b>태그</b> 그대로 글자" }] },
    ]);
  });
  it("빈 입력은 빈 목록", () => {
    expect(parsePolicyBody("  \n\n ")).toEqual([]);
  });
  it("조각 → 줄 표기 → 조각 왕복이 같다", () => {
    const body = parsePolicyBody(text);
    expect(parsePolicyBody(policyBodyToText(body))).toEqual(body);
  });
  it("저장본 검사는 모양이 틀린 것을 버린다", () => {
    expect(readPolicyBody("x")).toEqual([]);
    expect(readPolicyBody([{ heading: "a", blocks: [{ type: "paragraph", text: "t" }, { type: "script", text: "x" }, { type: "list", items: [1] }] }])).toEqual([{ heading: "a", blocks: [{ type: "paragraph", text: "t" }] }]);
  });
});

describe("publishWarnings", () => {
  it("빈 본문 · 금지 표현 · 이메일 모양을 경고한다", () => {
    expect(publishWarnings([], [], hasEmailShape)).toEqual(["본문이 비어 있습니다"]);
    const body = parsePolicyBody("## 절\n무조건 환급 a@b.kr");
    const w = publishWarnings(body, ["무조건 환급"], hasEmailShape);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("무조건 환급");
    expect(w[1]).toContain("이메일");
    expect(publishWarnings(parsePolicyBody("깨끗한 글"), ["무조건 환급"], hasEmailShape)).toEqual([]);
  });
});

describe("companyInfoRows", () => {
  it("값이 있는 칸만, 정해 둔 순서로", () => {
    expect(companyInfoRows({ phone: " 02-0000-0000 ", name: "상호값", editor: "  ", address: 3 })).toEqual([
      { label: "상호", value: "상호값" },
      { label: "대표전화", value: "02-0000-0000" },
    ]);
    expect(companyInfoRows(null)).toEqual([]);
    expect(COMPANY_INFO_FIELDS).toHaveLength(8);
  });
});
