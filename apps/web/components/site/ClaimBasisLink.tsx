import { UiLink } from "@ltr/ui";

// 경력 연수 표기('50년' 등)의 근거 링크 (W3 8단계 — PRD-01C BR-01 '승인 후에는 근거 설명 링크와 함께만') — 연재 제목 옆에 늘 붙는다.
// 가리키는 곳은 인물 페이지의 근거 증빙 약력 줄(#evidence-<증빙 번호>). 문구는 고정 낱말 하나 — 경력 내용은 인물 페이지가 증빙 승인 약력으로만 보인다.
export function ClaimBasisLink({ href }: { href: string }) {
  return (
    <UiLink
      href={href}
      data-part="claim-basis"
      className="ml-2 inline-flex min-h-11 items-center text-[14px] font-bold text-navy-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
    >
      근거<span className="sr-only"> — 경력 표시 근거 증빙 보기</span>
    </UiLink>
  );
}
