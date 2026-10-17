import { Callout } from "../base";
import { DateText, MONO, TEXT_LINK } from "./parts";
import { toTime } from "./format";

/** 개정 트래커 6단계 (TX-07) */
export type AmendmentStage = "발표" | "입법예고" | "국회 제출" | "의결" | "공포" | "시행";

export type UpdateBannerProps = {
  stage: AmendmentStage;
  /** 트래커 단계가 바뀐 시각 */
  changedAt: string;
  trackerHref: string;
  /** 기사의 마지막 실질 수정 시각 — 단계 변경 뒤에 고쳤으면 배너를 내린다 (TX-08) */
  articleModifiedAt?: string;
};

/** 갱신 배너 — 기사 본문 위 강조 문단 한 줄 (TX-08). 정정 이력 블록과 라벨을 나눈다 */
export function UpdateBanner({ stage, changedAt, trackerHref, articleModifiedAt }: UpdateBannerProps) {
  const changed = toTime(changedAt);
  const modified = toTime(articleModifiedAt);
  if (changed !== null && modified !== null && modified >= changed) return null;

  return (
    <aside data-ui="update-banner" aria-label="개정 단계 갱신 안내">
      <Callout>
        이 기사가 다룬 개정안이 <strong className="font-bold text-navy-900">{stage}</strong> 단계로 바뀌었습니다 (
        <DateText value={changedAt} className={MONO} />)<span aria-hidden="true"> · </span>
        <a href={trackerHref} className={TEXT_LINK}>
          트래커 보기
        </a>
      </Callout>
    </aside>
  );
}
