// 봇 판정 시험 (ART-11 '봇 User-Agent 목록에 맞는 조회는 0회' — 설정 씨앗 목록으로)
import { describe, expect, test } from "vitest";
import { HUMAN_USER_AGENT_SAMPLES, isBotUserAgent } from "./bots";
import { designSeeds } from "./test-design";

const PATTERNS = (designSeeds().get("bot_user_agents") as { patterns: string[] }).patterns;

describe("봇 판정 (설계 2.5 씨앗 목록)", () => {
  test.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
    "Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html) Daumoa",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "kakaotalk-scrap/1.0; +https://devtalk.kakao.com/",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "curl/8.7.1",
    "python-requests/2.32.3",
    "Go-http-client/2.0",
    "axios/1.7.7",
    "node", // Node.js fetch 기본 User-Agent
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "vercel-cron/1.0",
  ])("봇: %s", (ua) => {
    expect(isBotUserAgent(ua, PATTERNS)).toBe(true);
  });

  test("빈 User-Agent·없음·공백만도 봇", () => {
    expect(isBotUserAgent("", PATTERNS)).toBe(true);
    expect(isBotUserAgent(null, PATTERNS)).toBe(true);
    expect(isBotUserAgent("   ", PATTERNS)).toBe(true);
  });

  test("사람 브라우저 견본(데스크톱·iOS·안드로이드·삼성 인터넷·카카오톡·네이버·다음 앱 인앱)은 사람", () => {
    for (const ua of HUMAN_USER_AGENT_SAMPLES) expect(isBotUserAgent(ua, PATTERNS), ua).toBe(false);
  });

  test("대소문자를 가리지 않는다 · 목록을 비우면 빈 User-Agent만 봇 (목록은 설정 — 코드 상수 0)", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; BINGBOT/2.0)", ["bot"])).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (compatible; bingbot/2.0)", [])).toBe(false);
    expect(isBotUserAgent("MyMonitor/1.0", ["mymonitor"])).toBe(true);
  });

  test("아주 긴 User-Agent는 앞 1,024자만 본다", () => {
    expect(isBotUserAgent(`${"a".repeat(1023)}bot`, ["bot"])).toBe(false);
    expect(isBotUserAgent(`${"a".repeat(1021)}bot`, ["bot"])).toBe(true);
  });
});
