import { TaxKindBadge } from "@ltr/ui";
import { toolLinkFor, type ToolContext } from "@/lib/calc/tool-link";
import type { OwnState } from "@/lib/igt/gate";

export type { OwnState };

// 계산기 허브(/calc)의 상속·증여세 자체 카드 (FAM-14) - 게이트가 열린 세목만 외부 계산기 카드 자리에 자체 카드를 보인다.
// 판정은 toolLinkFor 한 곳(기능 키 + 공개 게이트 + 엔진 해시)이 하고, 이 파일에 켜기 스위치는 없다.
// 카드 링크에 입력값 전달 0 (주소는 고정 경로뿐).

export function ownCardState(ctx: ToolContext): OwnState {
  return { gift: toolLinkFor("gift_tax", null, ctx).kind === "self", inheritance: toolLinkFor("inheritance_tax", null, ctx).kind === "self" };
}

/** 외부 계산기 카드(두 세목을 한 장으로 묶은 카드)는 두 세목이 모두 자체로 바뀐 때만 빠진다 */
export function hiddenExternalKeys(s: OwnState | undefined): string[] {
  return s && s.gift && s.inheritance ? ["inheritance_gift"] : [];
}

export const ownCount = (s: OwnState | undefined) => (s ? Number(s.gift) + Number(s.inheritance) : 0);

const CARD = "block rounded-2xl border border-navy-100 bg-white p-6 hover:border-navy-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

function Card({ href, id, title, rank }: { href: string; id: string; title: string; rank: number }) {
  return (
    <li data-link-card={id} data-link-rank={rank} data-tool-kind="self" data-tax-kind="national">
      <a href={href} className={CARD}>
        <TaxKindBadge kind="national" />
        <span className="mt-3 block text-[19px] font-black text-navy-900">{title}</span>
        <span className="mt-1 block text-[14px] text-navy-600">이 사이트 계산기 · 입력한 값은 저장하지 않습니다</span>
      </a>
    </li>
  );
}

export function OwnCards({ state, startRank }: { state: OwnState; startRank: number }) {
  let rank = startRank;
  return (
    <>
      {state.gift ? <Card href="/calc/gift-tax" id="self_gift" title="증여세 계산하기" rank={rank++} /> : null}
      {state.inheritance ? <Card href="/calc/inheritance-tax" id="self_inheritance" title="상속세 계산하기" rank={rank++} /> : null}
    </>
  );
}
