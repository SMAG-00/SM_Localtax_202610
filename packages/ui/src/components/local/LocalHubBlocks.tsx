import { useId, type ReactNode } from "react";
import { Eyebrow } from "../base";
import { UiLink } from "../link";
import { MONO, TEXT_LINK } from "./shared";

/** 블록 하나의 내용 — 카드(핫뉴스 항목·기사·프로젝트·분양 정보·행사·공식 자료 카드)는 바깥에서 만들어 넣는다 */
export type HubBlockContent = {
  /** 카드 2~5장 — 5장을 넘기면 앞의 5장만 보인다 */
  items: ReactNode[];
  /** 고정폭 한 줄 — 금주 핫뉴스의 주차·기간·발행일 등 */
  meta?: string;
  /** 지자체 허브 블록 픽토그램 (글자 라벨인 블록 제목과 함께 보인다) */
  pictogram?: ReactNode;
  more?: { href: string; label: string };
  /** 시·군·구 기사가 없어 상위 시·도 기사를 보일 때 그 시·도 이름 (REG-06) */
  fallbackRegion?: string;
};

/**
 * 블록 다섯 개는 이름으로만 받는다 — 순서를 바꾸는 prop은 없다 (LG-08: 코드 고정).
 * 값이 없는 블록은 기능 플래그로 꺼진 것으로 보고 빠진다.
 */
export type LocalHubBlocksProps = {
  weekly?: HubBlockContent;
  localTax?: HubBlockContent;
  realEstate?: HubBlockContent;
  events?: HubBlockContent;
  sources?: HubBlockContent;
};

type BlockKey = keyof LocalHubBlocksProps;

const BLOCKS: ReadonlyArray<{ key: BlockKey; eyebrow: string; title: string }> = [
  { key: "weekly", eyebrow: "WEEKLY", title: "금주 핫뉴스" },
  { key: "localTax", eyebrow: "LOCAL TAX", title: "지방세·지방재정" },
  { key: "realEstate", eyebrow: "REAL ESTATE", title: "부동산·개발" },
  { key: "events", eyebrow: "EVENTS", title: "행사안내" },
  { key: "sources", eyebrow: "SOURCES", title: "공식 자료/해설" },
];

const MAX_ITEMS = 5;

function Block({ id, blockKey, eyebrow, title, content }: { id: string; blockKey: BlockKey; eyebrow: string; title: string; content: HubBlockContent }) {
  const isEvents = blockKey === "events";
  const headingId = `${id}-title`;
  const items = content.items.slice(0, MAX_ITEMS);
  return (
    <section data-hub-block={blockKey} aria-labelledby={headingId}>
      <div className="flex items-start gap-3">
        {content.pictogram && <span className="mt-1 shrink-0">{content.pictogram}</span>}
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={headingId} className="mt-3 text-[28px] font-black tracking-tight text-navy-900 sm:text-[32px]">
            {title}
          </h2>
          {content.meta && <p className={`mt-1 ${MONO} text-navy-600`}>{content.meta}</p>}
        </div>
      </div>
      {content.fallbackRegion && <p className="mt-4 text-[15px] text-navy-600">{`이 지역 기사가 없어 ${content.fallbackRegion} 기사를 보여 드립니다.`}</p>}
      {items.length === 0 && isEvents ? (
        <p className="mt-6 text-[17px] text-navy-600">현재 확인된 일정 없음</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {content.more && (
        <p className="mt-4">
          <UiLink href={content.more.href} className={TEXT_LINK}>
            {content.more.label}
          </UiLink>
        </p>
      )}
    </section>
  );
}

/** 지자체 허브 블록 — ① 금주 핫뉴스 ② 지방세·지방재정 ③ 부동산·개발 ④ 행사안내 ⑤ 공식 자료/해설 고정 순서 (LG-08·REG1-02) */
export function LocalHubBlocks(props: LocalHubBlocksProps) {
  const base = useId();
  return (
    <div data-ui="local-hub-blocks" className="space-y-20">
      {BLOCKS.map(({ key, eyebrow, title }) => {
        const content = props[key];
        if (!content) return null;
        // 기사·자료가 없는 블록은 빈 카드나 다른 정보로 채우지 않고 뺀다. 행사안내만 '현재 확인된 일정 없음'
        if (content.items.length === 0 && key !== "events") return null;
        return <Block key={key} id={`${base}-${key}`} blockKey={key} eyebrow={eyebrow} title={title} content={content} />;
      })}
    </div>
  );
}
