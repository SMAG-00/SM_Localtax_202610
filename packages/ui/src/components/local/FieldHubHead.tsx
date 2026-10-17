import { Eyebrow, TabNav, type TabNavItem } from "../base";
import { FieldTaxPoint, type FieldTaxPointProps } from "./FieldTaxPoint";

/** 4대 분야 허브 — 지방세 /tax · 부동산 /realestate · 부동산개발금융 /finance · 지자체뉴스 /local */
export type FieldHub = "tax" | "realestate" | "finance" | "local";

type Common = {
  /** 허브 영문명 — 예: REAL ESTATE */
  eyebrow: string;
  title: string;
  /** 한 줄 소개 */
  intro: string;
  /** 하위 분야 탭 (링크 탭) */
  tabs?: { items: TabNavItem[]; current: string; label?: string };
};

/** 지방세 허브에는 분야 지방세 포인트 블록이 없다 — 나머지 세 허브만 받는다 (CORE-02) */
export type FieldHubHeadProps = Common & ({ field: "tax"; taxPoint?: never } | { field: Exclude<FieldHub, "tax">; taxPoint?: FieldTaxPointProps });

/** 분야 허브 머리 — 아이브로 + 제목 + 한 줄 소개 + 하위 분야 탭 (+ 분야 지방세 포인트 블록) (RP-02) */
export function FieldHubHead(props: FieldHubHeadProps) {
  const { eyebrow, title, intro, tabs } = props;
  const taxPoint = props.field !== "tax" ? props.taxPoint : undefined;
  return (
    <header data-ui="field-hub-head" data-field={props.field}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">{title}</h1>
      <p className="mt-2 text-[17px] text-navy-600">{intro}</p>
      {tabs && tabs.items.length > 0 && (
        <div className="mt-8">
          <TabNav label={tabs.label ?? "하위 분야"} items={tabs.items} current={tabs.current} />
        </div>
      )}
      {taxPoint && (
        <div className="mt-8">
          <FieldTaxPoint {...taxPoint} />
        </div>
      )}
    </header>
  );
}
