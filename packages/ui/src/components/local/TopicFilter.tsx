import { TabNav } from "../base";

/** URL 쿼리 `topic` 값 — 10.6 읽기 API와 같은 값 */
export type LocalTopic = "local_tax" | "local_finance" | "realestate" | "urban_policy";

/** 글자 순서 고정: 전체 · 지방세 · 지방재정 · 부동산·정비 · 도시정책 (PRD-00 8.6) */
export const TOPIC_FILTER_ITEMS: ReadonlyArray<{ topic: LocalTopic | null; label: string }> = [
  { topic: null, label: "전체" },
  { topic: "local_tax", label: "지방세" },
  { topic: "local_finance", label: "지방재정" },
  { topic: "realestate", label: "부동산·정비" },
  { topic: "urban_policy", label: "도시정책" },
];

export type TopicFilterProps = {
  /** 거르는 목록의 주소 — 예: /local/seoul/gangnam-gu */
  basePath: string;
  /** 지금 요청의 `topic` 쿼리 값 (모르는 값이면 '전체') */
  topic?: string | null;
};

/** 분야 필터 — 서버에서 렌더하는 링크 탭. JS가 꺼져도 동작하고, 모바일은 줄바꿈 (REG-06·REG1-02) */
export function TopicFilter({ basePath, topic }: TopicFilterProps) {
  const joiner = basePath.includes("?") ? "&" : "?";
  const current = TOPIC_FILTER_ITEMS.some((i) => i.topic !== null && i.topic === topic) ? (topic as LocalTopic) : "all";
  return (
    <div data-ui="topic-filter">
      <TabNav
        label="분야 필터"
        current={current}
        items={TOPIC_FILTER_ITEMS.map((i) => ({
          id: i.topic ?? "all",
          label: i.label,
          href: i.topic ? `${basePath}${joiner}topic=${i.topic}` : basePath,
        }))}
      />
    </div>
  );
}
