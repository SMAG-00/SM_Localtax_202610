// 캠페인 랜딩 문구 검사 (GROW-04, W10-i 결정 9) - 순수 함수 (시험 copy-check.test.ts)
//  · 금지 표현(과장·오인·투자 권유) · 세액 표현(숫자 + 원) · 'AI 계산' 같은 사실과 다른 표현을 막는다. 통과해야 copy_check_hash가 적히고 승인할 수 있다
//  · 문구는 PO·편집자가 직접 쓴다 - 이 검사는 고쳐 쓸 문장을 알려주기만 하고 대신 쓰지 않는다
import { pointLineProblems } from "@ltr/editorial";
import { HEADER_SHORTCUTS } from "@ltr/ui";
import { WEEKLY_INVESTMENT_PHRASES } from "@/lib/server/public/realestate-weekly-logic";

/** PRD-00 8.8 금지 표현 가운데 광고 문구에 해당하는 것 + 투자 권유 표현. 운영 사전(settings forbidden_phrases)과 합쳐 쓴다 */
export const CAMPAIGN_PHRASES: readonly string[] = ["무조건", "세금 0원", "최저가", "100% 환급", "절세 보장", "무료 상담", "세금 폭탄", "놓치면 끝", "명품", ...WEEKLY_INVESTMENT_PHRASES];
/** 계산기를 AI가 계산하는 것처럼 부르는 표현 - 계산은 감수된 결정론적 엔진이 한다 */
const AI_CALC = /AI\s*(세금\s*)?(계산|산출|환급)/i;

export function campaignCopyProblems(title: string, body: string, forbidden: readonly string[] = []): string[] {
  const out: string[] = [];
  const phrases = [...new Set([...CAMPAIGN_PHRASES, ...forbidden])];
  const label = ["제목", "본문"];
  for (const p of pointLineProblems([title, body], phrases)) out.push(`${label[p.index]}: ${p.message}`);
  [title, body].forEach((t, i) => {
    if (AI_CALC.test(t)) out.push(`${label[i]}: 계산을 AI가 하는 것처럼 쓰지 않습니다 — '${HEADER_SHORTCUTS[0]!.label}'로 써 주세요`);
  });
  return out;
}
