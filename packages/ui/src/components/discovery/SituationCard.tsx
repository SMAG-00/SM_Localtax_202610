import type { ReactNode } from "react";
import { LinkCard } from "../base";
import { Pictogram, type PictogramName } from "./Pictogram";

export type SituationCardProps = {
  /** 상황 페이지 `/situations/[slug]` */
  href: string;
  /** 상황마다 고르는 그림 (`situations.pictogram`) — 상황 8종 외에 세목·분야 그림도 쓸 수 있다 */
  pictogram: PictogramName;
  /** 상황 한 문장 ("차를 팔았어요") — 픽토그램의 글자 라벨이 된다 */
  title: string;
  /** 무엇을 알 수 있는지 한 줄 (`situations.subtitle`) */
  description: string;
  /** 국세·지방세 배지 자리 (상속·증여 상황 카드 — 다른 묶음의 배지를 넣는다) */
  badge?: ReactNode;
};

/** 상황 카드 — 링크 카드 문법, 픽토그램 + 상황 한 문장(19px 900) + 한 줄, 호버 bg-hermes-50 (PRD-00 8.6 · UX-05) */
export function SituationCard({ href, pictogram, title, description, badge }: SituationCardProps) {
  return (
    <div data-ui="situation-card" className="h-full">
      <LinkCard href={href} className="flex h-full flex-col hover:bg-hermes-50">
        <Pictogram name={pictogram} label={title} size={40} layout="start" labelClassName="text-[19px] leading-snug font-black text-navy-900" />
        {badge && (
          <span data-slot="badge" className="mt-2 flex flex-wrap items-center gap-2">
            {badge}
          </span>
        )}
        <p className="mt-2 text-[15px] leading-relaxed text-navy-600">{description}</p>
      </LinkCard>
    </div>
  );
}
