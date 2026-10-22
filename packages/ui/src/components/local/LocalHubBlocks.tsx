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
  /** 시·군·구 기사가 없어 상위 시·도 기사를 보일 때 그 사실 문장 (REG-06 — "○○ 기사가 없어 ○○ 기사를 보입니다", 문장은 화면이 정한다) */
  fallbackNotice?: string;
  /** 카드가 0장일 때 블록째 보일 0건 문장 (REG1-02 '상위에도 없으면 0건 상태 문장') — 없으면 블록째 뺀다. 행사안내는 늘 '현재 확인된 일정 없음' */
  empty?: string;
  /**
   * 블록 안 묶음 — 한 블록 안에서 종류가 다른 카드를 제목과 함께 나눠 보인다(공식 자료/해설 블록의 '공식 자료 원문'(원문 블록)과 '감수 해설'(해석) —
   * REG1-07 '원문 블록 ≠ 해석'). 묶음마다 카드 6장까지, 카드 0장인 묶음은 빠진다. items 다음에 그린다
   */
  groups?: HubBlockGroup[];
};

export type HubBlockGroup = {
  key: string;
  title: string;
  /** 묶음 제목 아래 한 줄 안내 */
  note?: string;
  items: ReactNode[];
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
const MAX_GROUP_ITEMS = 6;

/** 블록에 보일 카드가 있나 — items와 묶음 카드를 함께 센다 */
const cardCount = (content: HubBlockContent) => content.items.length + (content.groups ?? []).reduce((n, g) => n + g.items.length, 0);

function Block({ id, blockKey, eyebrow, title, content }: { id: string; blockKey: BlockKey; eyebrow: string; title: string; content: HubBlockContent }) {
  const isEvents = blockKey === "events";
  const headingId = `${id}-title`;
  const items = content.items.slice(0, MAX_ITEMS);
  const groups = (content.groups ?? []).filter((g) => g.items.length > 0 && g.title.trim());
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
      {content.fallbackNotice && (
        <p data-part="block-fallback" className="mt-4 text-[15px] text-navy-600">
          {content.fallbackNotice}
        </p>
      )}
      {items.length === 0 && groups.length === 0 ? (
        <p data-part="block-empty" className="mt-6 text-[17px] text-navy-600">
          {isEvents ? "현재 확인된 일정 없음" : content.empty}
        </p>
      ) : (
        items.length > 0 && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )
      )}
      {groups.map((g) => (
        <section key={g.key} data-part="block-group" data-group={g.key} aria-labelledby={`${id}-${g.key}`} className="mt-8">
          <h3 id={`${id}-${g.key}`} className="text-[19px] font-black text-navy-900">
            {g.title}
          </h3>
          {g.note && <p className="mt-1 text-[14px] text-navy-600">{g.note}</p>}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.slice(0, MAX_GROUP_ITEMS).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
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
        // 기사·자료가 없는 블록은 빈 카드나 다른 정보로 채우지 않고 뺀다 — 0건 문장(empty)을 받은 블록은 그 문장만. 행사안내는 '현재 확인된 일정 없음'
        if (cardCount(content) === 0 && key !== "events" && !content.empty?.trim()) return null;
        return <Block key={key} id={`${base}-${key}`} blockKey={key} eyebrow={eyebrow} title={title} content={content} />;
      })}
    </div>
  );
}
