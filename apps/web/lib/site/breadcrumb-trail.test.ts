import { describe, expect, test } from "vitest";
import { validate } from "@ltr/structured-data";
import { brand } from "@ltr/ui";
import { aboutOrganizationJsonLd } from "./org-jsonld";
import { staticTrail, trailJsonLd } from "./breadcrumb-trail";

const SITE = "https://trail.example.test";
const nodesOf = (content: string | null) => JSON.parse(content!) as Record<string, unknown>[];

describe("고정 주소 경로 표시 (BreadcrumbList · OPT-02)", () => {
  test("분야 허브는 홈 > 새 분야 이름 — 세 분야 이름이 바뀐 이름 그대로 (옛 이름 0)", () => {
    expect(staticTrail("/tax")!.map((t) => t.name)).toEqual(["홈", "지방세·부동산세금"]);
    expect(staticTrail("/realestate")!.map((t) => t.name)).toEqual(["홈", "부동산재테크"]);
    expect(staticTrail("/finance")!.map((t) => t.name)).toEqual(["홈", "부동산금융"]);
    expect(staticTrail("/local")!.map((t) => t.name)[0]).toBe("홈");
    const all = ["/tax", "/tax/amendments", "/tax/interpretations", "/realestate/inheritance-gift/gift", "/finance/trust-pf"].flatMap((p) => staticTrail(p)!.map((t) => t.name));
    expect(all).not.toContain("지방세");
    expect(all).not.toContain("개발금융");
  });

  test("하위 고정 주소는 상위 분야를 거친다 — 끝 항목이 현재 주소", () => {
    const trail = staticTrail("/realestate/inheritance-gift/gift")!;
    expect(trail.map((t) => t.path)).toEqual(["/", "/realestate", "/realestate/inheritance-gift", "/realestate/inheritance-gift/gift"]);
    expect(staticTrail("/tax/amendments/")!.at(-1)!.path).toBe("/tax/amendments");
  });

  test("고정 주소가 아니면 null (동적 주소는 화면이 자기 데이터로 만든다), 쿼리·조각은 무시", () => {
    for (const p of ["/news/some-slug", "/tax/some-category", "/local/seoul", "/admin", "/nope"]) expect(staticTrail(p), p).toBeNull();
    expect(staticTrail("/tax?x=1#top")).not.toBeNull();
    expect(staticTrail("/")).toBeNull();
  });

  test("BreadcrumbList 글 — 절대 주소·순서·검사기 오류 0, 사이트 주소가 없으면 내지 않는다", () => {
    const json = trailJsonLd(staticTrail("/tax/amendments")!, SITE);
    const nodes = nodesOf(json);
    expect(validate(nodes as never)).toEqual([]);
    const items = (nodes[0] as { itemListElement: { position: number; name: string; item: string }[] }).itemListElement;
    expect(items.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, "홈", `${SITE}/`],
      [2, "지방세·부동산세금", `${SITE}/tax`],
      [3, "개정 트래커", `${SITE}/tax/amendments`],
    ]);
    expect(trailJsonLd(staticTrail("/tax")!, undefined)).toBeNull();
    expect(trailJsonLd([{ name: "홈", path: "/" }], SITE)).toBeNull();
  });
});

describe("매체 소개 NewsMediaOrganization — 발행 기관 SM(선명) (OPT-02)", () => {
  test("이름은 운영 주체, 사이트 이름은 alternateName, 열린 정책 페이지 주소만 단다 · 검사기 오류 0", () => {
    const nodes = nodesOf(aboutOrganizationJsonLd(SITE, ["/about", "/about/ethics", "/about/privacy"]));
    const org = nodes[0]!;
    expect(org["@type"]).toBe("NewsMediaOrganization");
    expect(org.name).toBe("SM(선명)");
    expect(org.alternateName).toBe(brand.productName); // 제품명 글자는 brand.ts 한 곳에만 (packages/ui/tests/brand.test.mjs)
    expect(org.url).toBe(`${SITE}/`);
    expect(org.ethicsPolicy).toBe(`${SITE}/about/ethics`);
    expect(org.publishingPrinciples).toBeUndefined();
    expect(org.correctionsPolicy).toBeUndefined();
    expect(validate(nodes as never)).toEqual([]);
  });

  test("사이트 주소가 없으면 내지 않는다", () => {
    expect(aboutOrganizationJsonLd(undefined, [])).toBeNull();
  });
});
