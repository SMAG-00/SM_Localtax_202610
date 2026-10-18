import { Eyebrow, TabNav, type TabNavItem } from "../base";
import { FieldTaxPoint, type FieldTaxPointProps } from "./FieldTaxPoint";

/** 4대 분야 허브 — 지방세 /tax · 부동산 /realestate · 부동산개발금융 /finance · 지자체뉴스 /local */
export type FieldHub = "tax" | "realestate" | "finance" | "local";

type Common = {
  /** 허브 영문명 — 예: REAL ESTATE */
  eyebrow: string;
  title: string;
  /** 한 줄 소개 — 편집국이 쓴 문장만. 없으면 줄째 없다 (빈 문단 0) */
  intro?: string | null;
  /** 하위 분야 탭 (링크 탭) */
  tabs?: { items: TabNavItem[]; current: string; label?: string };
};

/**
 * 지방세 허브에는 분야 지방세 포인트 블록이 없다 — 나머지 세 허브만 받는다 (CORE-02).
 * `news`는 같은 골격을 쓰는 뉴스 전체(`/news` — 허브 탭 4개, CAT-02)다 — 분야 지방세 포인트 블록이 없다
 */
export type FieldHubHeadProps = Common &
  ({ field: "tax"; taxPoint?: never } | { field: Exclude<FieldHub, "tax">; taxPoint?: FieldTaxPointProps } | { field: "news"; taxPoint?: never });

/**
 * 분야 허브 머리 — 아이브로 + 제목 + 한 줄 소개 → (분야 지방세 포인트 블록) → 하위 분야 탭 (RP-02).
 * 순서는 CAT-02 수용 기준(머리 → 지방세 포인트 → 탭, 네 허브 같은 골격)과 PRD-00 8.10 지자체 허브 골격을 따른다
 */
export function FieldHubHead(props: FieldHubHeadProps) {
  const { eyebrow, title, intro, tabs } = props;
  const taxPoint = props.field !== "tax" && props.field !== "news" ? props.taxPoint : undefined;
  const introText = intro?.trim();
  return (
    <header data-ui="field-hub-head" data-field={props.field}>
      <Eyebrow>{eyebrow}</Eyebrow>
      {/* 띄어쓰기 없는 긴 이름(제휴사 이름 등)도 줄을 바꾼다 — 360px 가로 스크롤 0 (본문은 한국어 단어 단위 줄바꿈 keep-all) */}
      <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[40px]">{title}</h1>
      {introText && <p className="mt-2 text-[17px] text-navy-600">{introText}</p>}
      {taxPoint && (
        <div className="mt-8">
          <FieldTaxPoint {...taxPoint} />
        </div>
      )}
      {tabs && tabs.items.length > 0 && (
        <div className="mt-8">
          <TabNav label={tabs.label ?? "하위 분야"} items={tabs.items} current={tabs.current} />
        </div>
      )}
    </header>
  );
}
