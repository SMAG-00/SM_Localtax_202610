import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COMPANY_INFO_FIELDS, POLICY_DOCS, canEditPolicy, companyFooter, companyInfoErrors, fillMasthead, parsePolicyBody, policyBodyToText, publishWarnings, readPolicyBody } from "./docs";
import { hasEmailShape } from "./email";

const DESIGN = fs.readFileSync(path.join(process.cwd(), "..", "..", "docs", "dev", "W2-e_설계.md"), "utf8");

describe("정책 문서 표 = 설계 2.5", () => {
  const sec = DESIGN.split(/^### /m).find((s) => s.startsWith("2.5"))!;
  const rows = sec.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  it("문서 11종의 doc_key·주소·기능 키가 설계 표와 같다", () => {
    expect(rows.length).toBe(11);
    expect(POLICY_DOCS).toHaveLength(11);
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

describe("새 정책 문서 — 청소년보호정책·저작권보호정책", () => {
  it("주소·기능 키·고치는 사람이 정해 둔 값이고 관리자만 고친다", () => {
    const youth = POLICY_DOCS.find((d) => d.key === "youth-protection")!;
    const copyright = POLICY_DOCS.find((d) => d.key === "copyright-policy")!;
    expect([youth.href, youth.feature, youth.label, youth.editors]).toEqual(["/about/youth-protection", "page_youth_protection", "청소년보호정책", "admin"]);
    expect([copyright.href, copyright.feature, copyright.label, copyright.editors]).toEqual(["/about/copyright-policy", "page_copyright_policy", "저작권보호정책", "admin"]);
    expect(canEditPolicy("youth-protection", { isAdmin: false, roles: ["editor"] })).toBe(false);
    expect(canEditPolicy("copyright-policy", { isAdmin: true, roles: [] })).toBe(true);
  });
});

describe("companyFooter (바닥글 매체 정보·연락처·안내 문구)", () => {
  const MAST = "시험 제호(가칭)";

  it("값이 있는 칸만 정해 둔 순서로 — 제호가 매체 정보 맨 앞, 문구 안 {제호}는 제호로 바뀐다", () => {
    const f = companyFooter(
      {
        phone: " 02-0000-0000 ",
        fax: "02-0000-0001",
        address: "시험시 시험구 1",
        registered_on: "2009-04-06",
        registration_no: "성동 라 00032",
        publisher_editor: "홍길동",
        youth_officer: "  ",
        corporation: "시험법인(주)",
        copyright_notice: "{제호} 모든 콘텐츠는 보호받습니다.",
        open_reporting_notice: "열린보도원칙 문구",
      },
      MAST,
    );
    expect(f.media).toEqual([
      { label: "제호", value: MAST },
      { label: "등록일", value: "2009-04-06" },
      { label: "등록번호", value: "성동 라 00032" },
      { label: "발행·편집인", value: "홍길동" },
      { label: "법인명", value: "시험법인(주)" },
    ]);
    expect(f.contact).toEqual([
      { label: "주소", value: "시험시 시험구 1" },
      { label: "전화", value: "02-0000-0000" },
      { label: "FAX", value: "02-0000-0001" },
    ]);
    expect(f.notices).toEqual([`${MAST} 모든 콘텐츠는 보호받습니다.`, "열린보도원칙 문구"]);
  });

  it("설정이 없거나 모양이 틀리면 제호 한 줄만 (나머지 줄 0)", () => {
    for (const bad of [null, undefined, [], "글자", 3]) expect(companyFooter(bad, MAST)).toEqual({ notices: [], media: [{ label: "제호", value: MAST }], contact: [] });
  });

  it("글자가 아닌 값·빈 글자는 그 줄을 숨긴다", () => {
    const f = companyFooter({ address: 3, phone: "", fax: null, copyright_notice: "   " }, MAST);
    expect(f.contact).toEqual([]);
    expect(f.notices).toEqual([]);
  });

  it("칸은 15개이고 키가 겹치지 않는다", () => {
    expect(COMPANY_INFO_FIELDS).toHaveLength(15);
    expect(new Set(COMPANY_INFO_FIELDS.map((f) => f.key)).size).toBe(15);
  });

  it("fillMasthead — {제호}가 여러 번 있어도 모두 바꾸고, 없으면 그대로", () => {
    expect(fillMasthead("{제호} 그리고 {제호}", "A")).toBe("A 그리고 A");
    expect(fillMasthead("제호 없음", "A")).toBe("제호 없음");
  });
});

describe("companyInfoErrors (운영 설정 저장 검사)", () => {
  it("아는 칸의 한 줄 글자는 통과하고 빈 글자도 통과한다", () => {
    expect(companyInfoErrors({ phone: "02-1", fax: "", copyright_notice: "{제호} 문구" })).toEqual([]);
    expect(companyInfoErrors({})).toEqual([]);
  });

  it("객체가 아니면 거부", () => {
    for (const bad of [null, [], "글자", 1]) expect(companyInfoErrors(bad)).toEqual(["값은 JSON 객체여야 합니다"]);
  });

  it("모르는 칸·글자 아닌 값·줄바꿈을 각각 거부", () => {
    const e = companyInfoErrors({ unknown_key: "x", phone: 3, address: "가\n나" });
    expect(e).toHaveLength(3);
    expect(e[0]).toContain("unknown_key: 모르는 칸");
    expect(e[1]).toContain("phone: 따옴표로 감싼 글자");
    expect(e[2]).toContain("address: 한 줄");
  });

  it("글자 수 상한 경계 - 전화 60자는 통과, 61자는 거부", () => {
    expect(companyInfoErrors({ phone: "1".repeat(60) })).toEqual([]);
    expect(companyInfoErrors({ phone: "1".repeat(61) })).toEqual(["phone: 60자 이하여야 합니다 (지금 61자)"]);
  });
});
