// 표시 요소 — 데이터 출처 줄 · 국세·지방세 배지 · 기사 유형 배지 · 편집 분야 배지 · 제휴 배지 · HOT 배지 · `확정 아님` 칩
// 규칙: 색에 더해 글자로 뜻을 전한다 (PRD-00 8.9) — 배지마다 글자가 서로 달라야 한다
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceLine } from "./SourceLine";
import { TaxKindBadge } from "./TaxKindBadge";
import { ARTICLE_TYPE_BADGE_LABELS, ARTICLE_TYPE_BADGE_ORDER, ArticleTypeBadge, INFO_LIST_MARKER_LABELS, InfoListMarker } from "./ArticleTypeBadge";
import { EDITORIAL_FIELD_BADGE_LABELS, EditorialFieldBadge } from "./EditorialFieldBadge";
import { PartnerBadge } from "./PartnerBadge";
import { HotBadge } from "./HotBadge";
import { UnconfirmedChip } from "./UnconfirmedChip";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("데이터 출처 줄", () => {
  it("고정폭 한 줄 '출처 ○○ · 기준일 ○○ · 정보 확인일 ○○'", () => {
    const { container } = render(<SourceLine source="행정안전부 지방세통계" baseDate="2025-12-31" checkedAt="2026-10-13" />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("P");
    expect(root.getAttribute("data-ui")).toBe("source-line");
    expect(root.textContent).toBe("출처 행정안전부 지방세통계 · 기준일 2025-12-31 · 정보 확인일 2026-10-13");
    expect(tokens(root)).toEqual(expect.arrayContaining(["font-mono", "text-[13px]", "tracking-wide"]));
  });

  it("기준일·확인일이 없으면 추정하지 않고 '확인 필요'로 쓴다", () => {
    const { container } = render(<SourceLine source="국토교통부" baseDate={null} />);
    expect(container.firstElementChild?.textContent).toBe("출처 국토교통부 · 기준일 확인 필요 · 정보 확인일 확인 필요");
  });

  it("공백뿐인 값도 '확인 필요'로 쓴다", () => {
    const { container } = render(<SourceLine source="  " baseDate=" " checkedAt="" />);
    expect(container.firstElementChild?.textContent).toBe("출처 확인 필요 · 기준일 확인 필요 · 정보 확인일 확인 필요");
  });

  it("항목마다 줄바꿈하지 않는 묶음이라 좁은 화면에서는 가운뎃점 자리에서만 줄이 바뀐다", () => {
    const { container } = render(<SourceLine source="행정안전부" baseDate="2025-12-31" checkedAt="2026-10-13" />);
    const parts = [...container.querySelectorAll(".whitespace-nowrap")].map((s) => s.textContent);
    expect(parts).toEqual(["출처 행정안전부", "기준일 2025-12-31", "정보 확인일 2026-10-13"]);
  });
});

describe("국세·지방세 배지", () => {
  it("'지방세'는 navy-900 바탕 흰 글자", () => {
    const { container } = render(<TaxKindBadge kind="local" />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-ui")).toBe("tax-kind-badge");
    const label = screen.getByText("지방세");
    expect(tokens(label)).toEqual(expect.arrayContaining(["bg-navy-900", "text-white", "font-bold"]));
  });

  it("'국세'는 ivory-dark 바탕 navy-800 글자 + navy-200 테두리", () => {
    render(<TaxKindBadge kind="national" />);
    expect(tokens(screen.getByText("국세"))).toEqual(expect.arrayContaining(["bg-ivory-dark", "text-navy-800", "border", "border-navy-200"]));
  });

  it("세목 아코디언의 '기타'도 같은 모양의 다른 글자다", () => {
    render(<TaxKindBadge kind="other" />);
    expect(tokens(screen.getByText("기타"))).toEqual(expect.arrayContaining(["bg-navy-50", "text-navy-700"]));
  });

  it("세 배지의 글자가 모두 다르다 (색만으로 구분하지 않는다)", () => {
    const { container } = render(
      <>
        <TaxKindBadge kind="local" />
        <TaxKindBadge kind="national" />
        <TaxKindBadge kind="other" />
      </>,
    );
    const texts = [...container.querySelectorAll('[data-ui="tax-kind-badge"]')].map((b) => b.textContent);
    expect(new Set(texts).size).toBe(3);
  });

  it("최종 감수일을 주면 배지 옆에 고정폭으로, 주지 않으면 없다", () => {
    const { container, rerender } = render(<TaxKindBadge kind="national" reviewedAt="2026-10-13" />);
    const date = screen.getByText("최종 감수 2026-10-13");
    expect(tokens(date)).toContain("font-mono");
    expect(container.firstElementChild?.contains(date)).toBe(true);
    rerender(<TaxKindBadge kind="national" />);
    expect(screen.queryByText(/최종 감수/)).toBeNull();
  });
});

describe("기사 유형 배지", () => {
  it("6종 글자는 보도·해설·가이드·오피니언·금주 핫뉴스·광고 순서이고 모두 다르다", () => {
    expect(ARTICLE_TYPE_BADGE_ORDER.map((t) => ARTICLE_TYPE_BADGE_LABELS[t])).toEqual(["보도", "해설", "가이드", "오피니언", "금주 핫뉴스", "광고"]);
    const { container } = render(
      <>
        {ARTICLE_TYPE_BADGE_ORDER.map((t) => (
          <ArticleTypeBadge key={t} type={t} />
        ))}
      </>,
    );
    const badges = [...container.querySelectorAll('[data-ui="article-type-badge"]')];
    expect(badges.map((b) => b.textContent)).toEqual(["보도", "해설", "가이드", "오피니언", "금주 핫뉴스", "광고"]);
    expect(badges.map((b) => b.getAttribute("data-type"))).toEqual(["reported_news", "explainer", "guide", "opinion", "digest", "sponsored"]);
  });

  it("모양은 같고(rounded-md navy-200 테두리 13px 700 navy-800) 광고만 ivory-dark 바탕", () => {
    const { container } = render(
      <>
        {ARTICLE_TYPE_BADGE_ORDER.map((t) => (
          <ArticleTypeBadge key={t} type={t} />
        ))}
      </>,
    );
    for (const b of container.querySelectorAll('[data-ui="article-type-badge"]')) {
      expect(tokens(b)).toEqual(expect.arrayContaining(["rounded-md", "border", "border-navy-200", "text-[13px]", "font-bold", "text-navy-800"]));
      if (b.getAttribute("data-type") === "sponsored") {
        expect(tokens(b)).toContain("bg-ivory-dark");
        expect(tokens(b)).not.toContain("bg-white");
      } else {
        expect(tokens(b)).toContain("bg-white");
        expect(tokens(b)).not.toContain("bg-ivory-dark");
      }
    }
  });

  it("정보 목록 표시 '행사안내'·'분양 정보'는 같은 문법이지만 글자가 기사 유형 6종과 겹치지 않는다", () => {
    expect(Object.values(INFO_LIST_MARKER_LABELS)).toEqual(["행사안내", "분양 정보"]);
    const articleLabels = new Set(Object.values(ARTICLE_TYPE_BADGE_LABELS));
    for (const label of Object.values(INFO_LIST_MARKER_LABELS)) expect(articleLabels.has(label)).toBe(false);

    const { container } = render(
      <>
        <InfoListMarker kind="event" />
        <InfoListMarker kind="presale" />
      </>,
    );
    const markers = [...container.querySelectorAll('[data-ui="info-list-marker"]')];
    expect(markers.map((m) => m.textContent)).toEqual(["행사안내", "분양 정보"]);
    markers.forEach((m) => expect(tokens(m)).toEqual(expect.arrayContaining(["rounded-md", "border-navy-200", "bg-white", "text-[13px]", "font-bold", "text-navy-800"])));
    // 기사 유형 배지로 세지 않는다 (검색 결과의 행사에 기사 유형 배지 0 — SRCH-01)
    expect(container.querySelectorAll('[data-ui="article-type-badge"]').length).toBe(0);
  });
});

describe("편집 분야 배지", () => {
  it("글자 4종 지방세·부동산 세금·지방재정·도시·부동산 정책, 모두 다르다", () => {
    expect(EDITORIAL_FIELD_BADGE_LABELS).toEqual({
      local_tax: "지방세",
      realestate: "부동산 세금",
      local_finance: "지방재정",
      urban_policy: "도시·부동산 정책",
    });
    expect(new Set(Object.values(EDITORIAL_FIELD_BADGE_LABELS)).size).toBe(4);
  });

  it("칩 문법 그대로이고 분야마다 색이 같다 — 글자로만 구분한다", () => {
    const { container } = render(
      <>
        <EditorialFieldBadge field="local_tax" />
        <EditorialFieldBadge field="urban_policy" />
      </>,
    );
    const roots = [...container.querySelectorAll('[data-ui="editorial-field-badge"]')];
    expect(roots.map((r) => r.textContent)).toEqual(["지방세", "도시·부동산 정책"]);
    expect(roots.map((r) => r.getAttribute("data-field"))).toEqual(["local_tax", "urban_policy"]);
    const chips = roots.map((r) => r.querySelector('[data-ui="chip"]')!);
    chips.forEach((c) => expect(tokens(c)).toEqual(expect.arrayContaining(["bg-ivory", "text-navy-700", "text-[13px]", "font-bold"])));
    expect(chips[0].getAttribute("class")).toBe(chips[1].getAttribute("class"));
  });
});

describe("제휴 배지", () => {
  it("'공동 기획 ○○' — 흰 바탕 navy-200 테두리 13px 700 navy-700", () => {
    const { container } = render(<PartnerBadge partner="가나다 세무법인" />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-ui")).toBe("partner-badge");
    expect(root.textContent).toBe("공동 기획 가나다 세무법인");
    expect(tokens(root)).toEqual(expect.arrayContaining(["rounded-md", "border", "border-navy-200", "bg-white", "text-[13px]", "font-bold", "text-navy-700"]));
  });

  it("제휴사 이름이 비어도 '공동 기획'만 쓰고 '광고'와 섞지 않는다", () => {
    const { container } = render(<PartnerBadge partner="   " />);
    expect(container.firstElementChild?.textContent).toBe("공동 기획");
    expect(container.textContent).not.toContain("광고");
  });
});

describe("HOT 배지", () => {
  it("'HOT' — rounded-full hermes-50 바탕 12px 700 hermes-800 글자", () => {
    const { container } = render(<HotBadge />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-ui")).toBe("hot-badge");
    expect(root.textContent).toBe("HOT");
    expect(tokens(root)).toEqual(expect.arrayContaining(["rounded-full", "bg-hermes-50", "px-2", "py-0.5", "text-[12px]", "font-bold", "text-hermes-800"]));
  });
});

describe("`확정 아님` 칩", () => {
  it("칩 문법 navy-50 바탕 · navy-700 글자 '확정 아님'", () => {
    const { container } = render(<UnconfirmedChip />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-ui")).toBe("unconfirmed-chip");
    expect(root.textContent).toBe("확정 아님");
    expect(tokens(root)).toEqual(expect.arrayContaining(["rounded-md", "bg-navy-50", "text-navy-700", "text-[13px]", "font-bold"]));
    expect(tokens(root)).not.toContain("bg-ivory");
  });
});
