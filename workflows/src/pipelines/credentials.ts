// 인증키 비노출 (PIPE-08) — 키는 요청 주소를 만드는 한 곳에서만 쓰고, 저장·화면·오류 글에는 키 없는 주소만 남긴다.
// 이 파일은 순수 함수뿐이다(서버·시험·공개 화면 검사기가 같이 쓴다).

const PARAM = String.raw`(?:oc|servicekey|service_key|api_?key|auth_?key|access_?token|key)`;
/** 주소·HTML 안의 인증키 모양 — `OC=값`, `serviceKey=값` 등 (대소문자 무시) */
const CREDENTIAL_PARAM = new RegExp(String.raw`(^|[?&;"'\s&]|&amp;)(${PARAM})=([^&"'\s<>]*)`, "gi");

/** 글에서 인증키 모양 값과 알려진 비밀 값을 가린다 — 오류 글·실행 기록에 쓰기 전에 거친다 */
export function redactCredentials(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text.replace(CREDENTIAL_PARAM, (_m, lead: string, name: string) => `${lead}${name}=***`);
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join("***");
  }
  return out;
}

/** 공개 화면 HTML(또는 주소)에 인증키 모양이나 알려진 비밀 값이 있는지 — 있으면 찾은 조각(앞 12자)을 돌려준다. 검사기 */
export function findCredentials(text: string, secrets: readonly (string | null | undefined)[] = []): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(CREDENTIAL_PARAM)) {
    if (m[3] !== "" && m[3] !== "***") found.push(`${m[2]}=${m[3]}`.slice(0, 12));
  }
  for (const s of secrets) {
    if (s && s.length >= 3 && text.includes(s)) found.push("secret-value");
  }
  return found;
}

/** 법제처 법령 공개 주소 — 키가 없는 사람이 보는 화면 주소다. API 상세 링크를 이 주소로 바꿔 화면에 쓴다 */
export function publicLawUrl(lawName: string): string {
  return `https://www.law.go.kr/법령/${encodeURIComponent(lawName.trim())}`;
}

/** 공개 화면에 써도 되는 주소인가 — https이고 인증키 모양이 없다 */
export function isPublicUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url) && findCredentials(url).length === 0;
}
