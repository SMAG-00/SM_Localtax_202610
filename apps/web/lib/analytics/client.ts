// 브라우저 측정 도우미 (docs/dev/W2-c_설계.md 6장) — 공개 화면의 클라이언트 컴포넌트가 부른다. 서버 전용 모듈·설정을 읽지 않는다.
//  · 측정 거부 쿠키(ltr_optout=1)나 브라우저 GPC 신호(navigator.globalPrivacyControl)가 있으면 아무것도 보내지 않는다 — 전송 0 (GROW-01)
//  · 같은 출처 POST /api/events — JSON. 실패는 조용히 버린다(화면 오류 0)
//  · keepalive(문서를 떠나도 끝까지 보낸다)는 고른 이벤트만 — 새 문서로 넘어가는 순간 보내는 이벤트(바깥 링크 등)가 켠다. 사이트 안 화면 전환은 문서를 떠나지 않아 필요 없고,
//    keepalive 요청은 브라우저 전체 64KB 상한을 함께 쓴다
//  · 응답 본문은 끝까지 읽는다 — 읽지 않은 본문이 남으면 브라우저가 요청을 끝난 것으로 보지 않는다("네트워크 조용함"을 기다리는 화면 시험이 멈춘다)
//  · 한 줄로 차례차례 보낸다 — 앞 요청의 응답(방문자·세션 쿠키)을 받은 뒤 다음을 보낸다(새 브라우저에서 방문자 ID가 둘 생기지 않게)
//  · 리퍼러는 호스트 이름만, 문서를 처음 연 뒤 첫 이벤트에만 붙인다(사이트 안 화면 전환은 문서 리퍼러가 바뀌지 않는다)
import { SECTION_KEYS, type SectionKey } from "@/lib/server/public/constants";
import type { CLIENT_ENTRIES, EventName, Mode } from "./events";

export const EVENTS_PATH = "/api/events";
const REFUSAL = "ltr_optout=1";

/** 4대 분야 카드 링크 주소 → 분야 (`/tax` · `/realestate?x` …). 허브 주소가 아니면 null */
export function sectionOfHref(href: string | null | undefined): SectionKey | null {
  const m = href ? /^\/([a-z]+)(?:[/?#]|$)/.exec(href) : null;
  return m && (SECTION_KEYS as readonly string[]).includes(m[1]!) ? (m[1] as SectionKey) : null;
}

export interface TrackOptions {
  section?: SectionKey | null;
  props?: Record<string, string | number | boolean>;
  entry?: (typeof CLIENT_ENTRIES)[number];
  mode?: Mode;
  /** 문서를 떠나는 순간 보내는 이벤트만 true (위 설명) */
  keepalive?: boolean;
}

export interface BrowserSignals {
  /** document.cookie */
  cookie(): string;
  /** navigator.globalPrivacyControl === true */
  gpc(): boolean;
  /** document.referrer */
  referrer(): string;
}

export type Send = (body: string, keepalive: boolean) => Promise<unknown>;

/** 측정 거부 쿠키가 있나 (Cookie 글 — "a=1; ltr_optout=1") */
export const hasRefusalCookie = (cookie: string): boolean => cookie.split(";").some((p) => p.trim() === REFUSAL);

/** 리퍼러 주소 → 호스트 이름(소문자). http(s)가 아니거나 읽을 수 없으면 null — 경로·쿼리는 보내지 않는다 */
export function referrerHost(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function measurementAllowed(signals: BrowserSignals): boolean {
  return !signals.gpc() && !hasRefusalCookie(signals.cookie());
}

export interface Tracker {
  /** 보내기 — 측정이 허용되지 않으면 아무것도 하지 않는다. 앞의 보내기가 끝난 뒤 보낸다 */
  track(name: EventName, options?: TrackOptions): Promise<void>;
}

export function createTracker(signals: BrowserSignals, send: Send): Tracker {
  let queue: Promise<unknown> = Promise.resolve();
  let referrerSent = false;
  return {
    track(name, options = {}) {
      if (!measurementAllowed(signals)) return Promise.resolve();
      const body: Record<string, unknown> = { name };
      if (options.section) body.section = options.section;
      if (options.props && Object.keys(options.props).length) body.props = options.props;
      if (options.entry) body.entry = options.entry;
      if (options.mode) body.mode = options.mode;
      if (!referrerSent) {
        referrerSent = true;
        const host = referrerHost(signals.referrer());
        if (host) body.referrer = host;
      }
      const text = JSON.stringify(body);
      const next = queue.then(() => {
        // 차례가 온 때 다시 본다 — 그 사이 [측정 거부]를 눌렀을 수 있다
        if (!measurementAllowed(signals)) return undefined;
        return send(text, options.keepalive === true).catch(() => undefined);
      });
      queue = next;
      return next.then(() => undefined);
    },
  };
}

let browserTracker: Tracker | null = null;

/** 공개 화면의 기본 도우미 — 브라우저에서만 */
export function track(name: EventName, options?: TrackOptions): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  browserTracker ??= createTracker(
    {
      cookie: () => document.cookie,
      gpc: () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
      referrer: () => document.referrer,
    },
    (body, keepalive) =>
      fetch(EVENTS_PATH, {
        method: "POST",
        keepalive,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body,
      }).then((res) => res.arrayBuffer()), // 응답 본문을 끝까지 읽는다 — 읽지 않으면 브라우저가 요청을 끝난 것으로 보지 않는다(네트워크 대기가 멈춘다)
  );
  return browserTracker.track(name, options);
}
