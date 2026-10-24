// 픽토그램 24종 (PRD-00 8.6 · R11, PRD-01A UX-04) — 실제로 렌더한 SVG를 XML로 다시 파싱해 규칙을 하나씩 확인한다
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PICTOGRAMS, PICTOGRAM_NAMES, Pictogram, type PictogramName } from "./Pictogram";

const FORBIDDEN_ELEMENTS = ["linearGradient", "radialGradient", "filter", "pattern", "mask", "image", "text", "foreignObject", "use"];
const GEOMETRY_ATTRS = ["cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "x1", "y1", "x2", "y2"];
const FILL_TOKEN = "fill-hermes-500";

/** 렌더 결과의 <svg>를 문자열로 꺼내 독립 SVG 문서로 파싱한다 */
function parseRendered(name: PictogramName) {
  const { container } = render(<Pictogram name={name} label={PICTOGRAMS[name].label} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error(`${name}: svg 없음`);
  const doc = new DOMParser().parseFromString(svg.outerHTML, "image/svg+xml");
  return { container, doc, root: doc.documentElement };
}

describe("픽토그램 세트 구성", () => {
  it("모두 24종이고 이름이 겹치지 않는다", () => {
    expect(PICTOGRAM_NAMES).toHaveLength(24);
    expect(new Set(PICTOGRAM_NAMES).size).toBe(24);
    expect(Object.keys(PICTOGRAMS).sort()).toEqual([...PICTOGRAM_NAMES].sort());
  });

  it("세목 8 · 상황 8 · 4대 분야 4 · 지자체 허브 블록 4로 나뉜다", () => {
    const count = (group: string) => PICTOGRAM_NAMES.filter((n) => PICTOGRAMS[n].group === group).length;
    expect(count("tax")).toBe(8);
    expect(count("situation")).toBe(8);
    expect(count("field")).toBe(4);
    expect(count("hub")).toBe(4);
  });

  it("세목 8종의 라벨이 PRD 순서·글자 그대로다", () => {
    const labels = PICTOGRAM_NAMES.filter((n) => PICTOGRAMS[n].group === "tax").map((n) => PICTOGRAMS[n].label);
    expect(labels).toEqual(["취득세", "재산세", "종부세", "자동차세", "지방소득세", "등록면허세", "주민세", "환급"]);
  });

  it("4대 분야·지자체 허브 블록 라벨이 PRD 글자 그대로다", () => {
    const labelsOf = (group: string) => PICTOGRAM_NAMES.filter((n) => PICTOGRAMS[n].group === group).map((n) => PICTOGRAMS[n].label);
    expect(labelsOf("field")).toEqual(["지방세·부동산세금", "부동산재테크", "부동산금융", "지자체뉴스"]);
    expect(labelsOf("hub")).toEqual(["금주 핫뉴스", "지방세·지방재정", "부동산·개발", "행사안내"]);
  });

  it("라벨 24개가 서로 다르다", () => {
    const labels = PICTOGRAM_NAMES.map((n) => PICTOGRAMS[n].label);
    expect(new Set(labels).size).toBe(24);
  });

  it("그림 모양(도형 묶음)도 24종이 서로 다르다", () => {
    const shapes = PICTOGRAM_NAMES.map((n) => {
      const { container } = render(<Pictogram name={n} label={PICTOGRAMS[n].label} />);
      const markup = container.querySelector("svg")!.innerHTML;
      container.remove();
      return markup;
    });
    expect(new Set(shapes).size).toBe(24);
  });
});

describe.each(PICTOGRAM_NAMES.map((n) => [n] as const))("SVG 파싱 검사 — %s", (name) => {
  it("독립 SVG 문서로 파싱되고 viewBox가 0 0 24 24이다", () => {
    const { doc, root } = parseRendered(name);
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("선은 navy-900 토큰 1.75 굵기이고 바탕 채움은 없다", () => {
    const { root } = parseRendered(name);
    expect(root.getAttribute("class")?.split(/\s+/)).toContain("stroke-navy-900");
    expect(root.getAttribute("stroke-width")).toBe("1.75");
    expect(root.getAttribute("fill")).toBe("none");
  });

  it("hermes-500 채움 요소가 정확히 하나이고 그 밖의 요소는 색을 따로 정하지 않는다", () => {
    const { root } = parseRendered(name);
    const all = Array.from(root.querySelectorAll("*"));
    const points = all.filter((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes(FILL_TOKEN));
    expect(points).toHaveLength(1);
    for (const el of all) {
      if (el === points[0]) continue;
      expect(el.getAttribute("class"), `${name} <${el.tagName}> class`).toBeNull();
      expect(el.getAttribute("fill"), `${name} <${el.tagName}> fill`).toBeNull();
      expect(el.getAttribute("stroke"), `${name} <${el.tagName}> stroke`).toBeNull();
    }
  });

  it("그라데이션·필터·그림자·패턴·이미지·글자 요소가 없다 (평면)", () => {
    const { root } = parseRendered(name);
    for (const tag of FORBIDDEN_ELEMENTS) expect(root.getElementsByTagName(tag), `${name} <${tag}>`).toHaveLength(0);
    const fe = Array.from(root.querySelectorAll("*")).filter((el) => el.tagName.startsWith("fe"));
    expect(fe).toHaveLength(0);
  });

  it("색 값(hex·rgb)·style·url() 참조가 어느 속성에도 없다 (토큰 클래스만)", () => {
    const { root } = parseRendered(name);
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
      expect(el.hasAttribute("style"), `${name} <${el.tagName}> style`).toBe(false);
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === "xmlns") continue;
        expect(attr.value, `${name} ${attr.name}`).not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl|url\(/i);
      }
    }
  });

  it("모든 좌표가 24px 격자(0~24) 안에 있고 경로는 절대 좌표 명령만 쓴다", () => {
    const { root } = parseRendered(name);
    const nums: number[] = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      for (const a of GEOMETRY_ATTRS) if (el.hasAttribute(a)) nums.push(Number(el.getAttribute(a)));
      const d = el.getAttribute("d");
      if (d) {
        expect(d, `${name} d`).toMatch(/^[MLHVCSQTAZ0-9.\s,-]+$/);
        nums.push(...(d.match(/-?\d*\.?\d+/g) ?? []).map(Number));
      }
    }
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) {
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(24);
    }
  });

  it("라벨 글자가 함께 보이고 그림은 화면 읽기에서 겹쳐 읽히지 않는다", () => {
    const label = PICTOGRAMS[name].label;
    const { container } = render(<Pictogram name={name} label={label} />);
    const root = container.querySelector('[data-ui="pictogram"]')!;
    expect(root.getAttribute("data-pictogram")).toBe(name);
    expect(screen.getByText(label).closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("라벨 (R11 · UX-04)", () => {
  it("라벨을 숨기면 그림이 role=img + 라벨 이름으로 화면 읽기에 남는다", () => {
    render(<Pictogram name="vehicle" label="자동차세" showLabel={false} />);
    const img = screen.getByRole("img", { name: "자동차세" });
    expect(img.tagName.toLowerCase()).toBe("svg");
    expect(img.getAttribute("aria-hidden")).toBeNull();
    expect(screen.queryByText("자동차세")).toBeNull();
  });

  it("보이는 라벨은 기본 13px 700 navy-700이고, 카드 제목처럼 글자 모양을 바꿀 수 있다", () => {
    const { rerender } = render(<Pictogram name="refund" label="환급" />);
    expect(screen.getByText("환급").className).toContain("text-[13px]");
    expect(screen.getByText("환급").className).toContain("text-navy-700");
    rerender(<Pictogram name="refund" label="환급" labelClassName="text-[19px] font-black text-navy-900" />);
    expect(screen.getByText("환급").className).toBe("text-[19px] font-black text-navy-900");
  });

  it("크기를 정하면 SVG 너비·높이가 그 값이고 viewBox는 24 격자 그대로다", () => {
    const { container } = render(<Pictogram name="acquisition" label="취득세" size={40} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("기본 크기는 24px 격자 원래 크기다", () => {
    const { container } = render(<Pictogram name="acquisition" label="취득세" />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("24");
  });

  it("라벨 없이 쓰면 타입 검사가 실패한다 (tsc가 확인)", () => {
    // @ts-expect-error label은 필수다 — 라벨 없는 픽토그램은 만들 수 없다 (UX-04)
    const element = <Pictogram name="acquisition" />;
    expect(element.props).not.toHaveProperty("label");
  });

  it("세트에 없는 이름은 타입 검사가 실패한다 (tsc가 확인)", () => {
    // @ts-expect-error 24종 밖의 이름은 쓸 수 없다
    const element = <Pictogram name="tourism" label="관광" />;
    expect(element.props.name).toBe("tourism");
  });
});
