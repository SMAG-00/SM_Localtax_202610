// 네이버 프리미엄 콘텐츠 연재 원고의 순수 규칙 (W13-i CH-02). 네이버로 보내는 코드는 없다 - 원고 파일을 만들 뿐이다.
//  · '네이버 제휴 언론사' 표현은 원고·화면·문구에 0 (NAV-07) - 유료 연재는 뉴스 제휴와 다른 상태다.
//  · 이중 결제 안내 문구와 판매 조건은 PO 입력이다. 이 파일에는 문구를 두지 않고 자리 표시만 넣는다.

const AFFILIATE_CLAIM = /네이버\s*(뉴스\s*)?제휴\s*(언론사|매체|미디어)?/;

export const DOUBLE_PAY_PLACEHOLDER = "[확인 필요: 사이트 구독자 이중 결제 안내 문구 - PO 입력]";

export function hasAffiliateClaim(text: string): boolean {
  return AFFILIATE_CLAIM.test(text);
}

export interface ManuscriptInput {
  title: string;
  text: string;
  articleUrl: string;
  doublePayNotice?: string | null; // PO가 입력한 문구가 있을 때만
}

export type ManuscriptResult = { ok: true; file: string } | { ok: false; code: "affiliate_claim" | "empty_text" };

export function buildManuscript(input: ManuscriptInput): ManuscriptResult {
  const title = input.title.trim();
  const text = input.text.trim();
  if (text === "") return { ok: false, code: "empty_text" };
  if (hasAffiliateClaim(title) || hasAffiliateClaim(text) || hasAffiliateClaim(input.doublePayNotice ?? "")) return { ok: false, code: "affiliate_claim" };
  const notice = input.doublePayNotice?.trim() ? input.doublePayNotice.trim() : DOUBLE_PAY_PLACEHOLDER;
  const file = [`제목: ${title}`, `원문 링크: ${input.articleUrl}`, "", text, "", "---", `이중 결제 안내: ${notice}`, ""].join("\n");
  return { ok: true, file };
}
