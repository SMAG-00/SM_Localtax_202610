// 봇 판정 (ART-11 · HOME-05 · GROW-01 — docs/dev/W2-c_설계.md 2.5). 순수 모듈.
// 설정 bot_user_agents의 소문자 조각 중 하나라도 User-Agent에 들어 있으면 봇(대소문자 무시). User-Agent가 비어도 봇.
// 정규식이 아니다 — 느린 패턴 0. 판정 결과(참·거짓)만 남기고 User-Agent 원문은 저장·기록하지 않는다.

/** 아주 긴 User-Agent는 앞부분만 본다 (판정에 충분하고, 큰 글자로 서버를 붙잡지 않게) */
const UA_SCAN_LIMIT = 1024;

export function isBotUserAgent(userAgent: string | null | undefined, patterns: readonly string[]): boolean {
  const ua = (userAgent ?? "").trim();
  if (ua === "") return true;
  const lower = ua.slice(0, UA_SCAN_LIMIT).toLowerCase();
  return patterns.some((p) => p.length > 0 && lower.includes(p));
}

/**
 * 사람 브라우저 견본 — 봇 목록 조각이 이 중 하나에라도 들어 있으면 그 조각은 사람을 봇으로 만든다(설정 검사가 거부한다).
 * 데스크톱 Chrome·Edge·Firefox·macOS Safari, iOS Safari, 안드로이드 Chrome·삼성 인터넷, 카카오톡·네이버 앱 인앱 브라우저 (PRD-01A 10장 점검 브라우저)
 */
export const HUMAN_USER_AGENT_SAMPLES = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36;KAKAOTALK 2511300",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0",
  "Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 DaumApps/6.3.0",
] as const;
