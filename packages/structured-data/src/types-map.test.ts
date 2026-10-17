// OPT-02 — 유형 대응표는 패키지의 한 파일(types-map.ts)에 두고, PRD-01A OPT-02 행이 적은 유형과 같다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_TOP_LEVEL_TYPES, BREADCRUMB_TYPE, EXCLUDED_TYPES, PAGE_TYPE_MAP } from "./types-map";
import { pageJsonLd } from "./page";
import { passSamples } from "../fixtures/samples";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PRD_DIR = path.join(ROOT, "docs", "PRD");
const prd01a = fs.readdirSync(PRD_DIR).find((f) => f.startsWith("PRD-01A"))!;
const doc = fs.readFileSync(path.join(PRD_DIR, prd01a), "utf8");
const opt02Row = doc.split("\n").find((l) => l.startsWith("| OPT-02 |"))!;
/** 요구사항 칸(두 번째 칸)만 — 수용 기준 칸의 `headline` 같은 속성 이름은 빼고 본다 */
const requirementCell = opt02Row.split("|")[2];
const docTypes = [...requirementCell.matchAll(/`([A-Z][A-Za-z]+)`/g)].map((m) => m[1]);

describe("유형 대응표 ↔ PRD-01A OPT-02", () => {
  it("OPT-02 요구사항 칸에서 7유형과 VideoObject를 읽었다 (문서 읽기 자체 확인)", () => {
    expect(docTypes).toEqual([
      "NewsArticle",
      "NewsMediaOrganization",
      "Person",
      "Event",
      "Book",
      "Course",
      "Dataset",
      "VideoObject",
    ]);
    expect(requirementCell).toContain("BreadcrumbList");
  });

  it("대응표의 페이지 유형은 7개이고, 문서의 7유형이 각 페이지의 주 유형(인물은 주 엔터티)으로 하나씩 있다", () => {
    const kinds = Object.keys(PAGE_TYPE_MAP);
    expect(kinds).toHaveLength(7);
    const mainTypes = Object.values(PAGE_TYPE_MAP).map((e) => ("mainEntityType" in e ? e.mainEntityType : e.primaryType));
    expect([...mainTypes].sort()).toEqual(docTypes.filter((t) => t !== "VideoObject").sort());
  });

  it("인물 페이지는 ProfilePage(주 엔터티 Person)다 — BR-02 · EXPL-12", () => {
    expect(PAGE_TYPE_MAP.person.primaryType).toBe("ProfilePage");
    expect(PAGE_TYPE_MAP.person.mainEntityType).toBe("Person");
    expect(PAGE_TYPE_MAP.person.route).toBe("/people/[slug]");
  });

  it("동영상 기사의 VideoObject는 기사 유형의 추가 유형이고, BreadcrumbList는 공통 추가 유형이다", () => {
    expect(PAGE_TYPE_MAP.article.additionalTypes.map((a) => a.type)).toEqual(["VideoObject"]);
    expect(BREADCRUMB_TYPE).toBe("BreadcrumbList");
  });

  it("FAQPage는 OPT-02 목록에 없어 대응표에서 뺐고, 빼낸 이유가 적혀 있다", () => {
    expect(docTypes).not.toContain("FAQPage");
    expect(ALLOWED_TOP_LEVEL_TYPES).not.toContain("FAQPage");
    const faq = EXCLUDED_TYPES.find((e) => e.type === "FAQPage");
    expect(faq?.reason).toMatch(/OPT-02/);
  });

  it("최상위로 낼 수 있는 유형 = 7유형의 주 유형 + Person + VideoObject + BreadcrumbList", () => {
    expect([...ALLOWED_TOP_LEVEL_TYPES].sort()).toEqual(
      [
        "NewsArticle",
        "NewsMediaOrganization",
        "ProfilePage",
        "Person",
        "Event",
        "Book",
        "Course",
        "Dataset",
        "VideoObject",
        "BreadcrumbList",
      ].sort(),
    );
  });

  it("각 유형 견본의 생성 결과 첫 노드 @type이 대응표의 주 유형과 같다 (생성기가 대응표를 따른다)", () => {
    for (const [kind, entry] of Object.entries(PAGE_TYPE_MAP)) {
      const nodes = pageJsonLd(passSamples[kind as keyof typeof PAGE_TYPE_MAP]);
      expect(nodes[0]["@type"], kind).toBe(entry.primaryType);
    }
  });
});
