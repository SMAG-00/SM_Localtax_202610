import "server-only";
import type { OfficialLink } from "@ltr/ui";
import { getViewer } from "@/lib/server/dal";
import type { OfficialLinkCard } from "./calc";
import type { CalcTools } from "./calc-tools";

// 계산기 화면이 서버에서 클라이언트 부품으로 넘기는 값 만들기 - 주소는 official_links 설정값, 입력값은 받지 않는다.

const toLink = (c: OfficialLinkCard): OfficialLink => ({ url: c.url, status: c.status, checkedAt: c.checkedOn ?? "" });
/** 쓸 수 없는 대체 안내 자리 - 카드가 알아서 비워진다(깨진 링크 렌더 0) */
const NO_LINK: OfficialLink = { url: "", status: "broken", checkedAt: "" };

export interface OfficialPair {
  link: OfficialLink;
  fallback: OfficialLink;
}

/** 외부 계산기 카드 (안심 상속증여계산기) - 끊기면 국세청 안내, 그것도 못 쓰면 렌더 0 */
export function externalPair(tools: CalcTools): OfficialPair | null {
  const ext = tools.links.external.find((c) => c.key === "inheritance_gift");
  if (!ext) return null;
  const nts = tools.links.fallbacks.find((c) => c.key === "nts");
  return { link: toLink(ext), fallback: nts ? toLink(nts) : NO_LINK };
}

/** SM 취득세 카드 - 끊기면 위택스 안내 */
export function smAcquisitionPair(tools: CalcTools): (OfficialPair & { usageNote: string }) | null {
  if (!tools.features.sm_calculator) return null;
  const sm = tools.links.sm.find((c) => c.key === "acquisition");
  if (!sm) return null;
  const wetax = tools.links.fallbacks.find((c) => c.key === "wetax");
  return { link: toLink(sm), fallback: wetax ? toLink(wetax) : NO_LINK, usageNote: sm.termsNote ?? "" };
}

/** 로그인한 회원인가 - 서버 설정이 안 끝났거나 읽기 실패면 비회원으로 본다(비회원 화면이 더 좁다) */
export async function isMemberNow(): Promise<boolean> {
  try {
    return (await getViewer()) !== null;
  } catch {
    return false;
  }
}
