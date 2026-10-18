// 브라우저 측정 도우미 시험 — 측정 거부·GPC면 전송 0 (GROW-01 · PRD-00 13장), 차례차례 보내기, 리퍼러는 첫 이벤트에 호스트만
import { describe, expect, test } from "vitest";
import { createTracker, hasRefusalCookie, measurementAllowed, referrerHost, sectionOfHref, type BrowserSignals } from "./client";

describe("4대 분야 카드 주소 → 분야 (home_entry_clicked)", () => {
  test.each([
    ["/tax", "tax"],
    ["/realestate", "realestate"],
    ["/finance?x=1", "finance"],
    ["/local/", "local"],
    ["/news", null],
    ["/taxes", null],
    ["https://evil.example/tax", null],
    ["", null],
    [null, null],
  ] as const)("%s → %s", (href, section) => {
    expect(sectionOfHref(href)).toBe(section);
  });
});

function browser(over: Partial<{ cookie: string; gpc: boolean; referrer: string }> = {}) {
  const state = { cookie: "", gpc: false, referrer: "", ...over };
  const signals: BrowserSignals = { cookie: () => state.cookie, gpc: () => state.gpc, referrer: () => state.referrer };
  const sent: string[] = [];
  const pending: (() => void)[] = [];
  /** 보내기 대역 — 응답은 시험이 풀어 줄 때까지 기다린다 */
  const send = (body: string) => {
    sent.push(body);
    return new Promise<void>((resolve) => pending.push(resolve));
  };
  return { state, signals, sent, pending, tracker: createTracker(signals, send) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("측정 거부·GPC — 보내지 않는다", () => {
  test("거부 쿠키가 있으면 전송 0", async () => {
    const b = browser({ cookie: "a=1; ltr_optout=1" });
    await b.tracker.track("hub_viewed", { section: "tax" });
    expect(b.sent).toEqual([]);
  });
  test("GPC 신호가 있으면 전송 0", async () => {
    const b = browser({ gpc: true });
    await b.tracker.track("article_viewed", { section: "tax", props: { article_id: 1, format: "general", content_type: "explainer" } });
    expect(b.sent).toEqual([]);
  });
  test("줄에서 기다리는 동안 [측정 거부]를 누르면 기다리던 것도 보내지 않는다", async () => {
    const b = browser();
    const first = b.tracker.track("home_entry_clicked", { section: "tax" });
    const second = b.tracker.track("hub_viewed", { section: "tax" });
    await flush();
    expect(b.sent).toHaveLength(1);
    b.state.cookie = "ltr_optout=1";
    b.pending.shift()!();
    await Promise.all([first, second]);
    expect(b.sent).toHaveLength(1);
  });
  test("거부 쿠키 판정 — 정확히 ltr_optout=1만", () => {
    expect(hasRefusalCookie("ltr_optout=1")).toBe(true);
    expect(hasRefusalCookie("x=2;ltr_optout=1")).toBe(true);
    expect(hasRefusalCookie("ltr_optout=0")).toBe(false);
    expect(hasRefusalCookie("my_ltr_optout=1")).toBe(false);
    expect(measurementAllowed({ cookie: () => "", gpc: () => false, referrer: () => "" })).toBe(true);
  });
});

describe("보내기", () => {
  test("본문 — 이름·분야·속성, 빈 속성은 빼고, 리퍼러는 첫 이벤트에 호스트만", async () => {
    const b = browser({ referrer: "https://www.Google.com/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8" });
    const p1 = b.tracker.track("hub_viewed", { section: "tax", props: {} });
    await flush();
    b.pending.shift()!();
    await p1;
    const p2 = b.tracker.track("article_viewed", { section: "tax", props: { article_id: 3, format: "general", content_type: "guide" }, entry: "tax_lens" });
    await flush();
    b.pending.shift()!();
    await p2;
    expect(b.sent.map((s) => JSON.parse(s))).toEqual([
      { name: "hub_viewed", section: "tax", referrer: "www.google.com" },
      { name: "article_viewed", section: "tax", props: { article_id: 3, format: "general", content_type: "guide" }, entry: "tax_lens" },
    ]);
    expect(b.sent.join("")).not.toContain("search?q");
  });

  test("차례차례 — 앞 요청의 응답(쿠키)을 받기 전에는 다음을 보내지 않는다 (새 브라우저에서 방문자 ID가 둘 생기지 않게)", async () => {
    const b = browser();
    const done: string[] = [];
    void b.tracker.track("home_entry_clicked", { section: "finance" }).then(() => done.push("a"));
    void b.tracker.track("hub_viewed", { section: "finance" }).then(() => done.push("b"));
    await flush();
    expect(b.sent).toHaveLength(1);
    b.pending.shift()!();
    await flush();
    expect(b.sent).toHaveLength(2);
    b.pending.shift()!();
    await flush();
    expect(done).toEqual(["a", "b"]);
  });

  test("keepalive는 고른 이벤트만 (기본은 끔 — 사이트 안 화면 전환은 문서를 떠나지 않는다)", async () => {
    const flags: boolean[] = [];
    const t = createTracker({ cookie: () => "", gpc: () => false, referrer: () => "" }, async (_body, keepalive) => {
      flags.push(keepalive);
    });
    await t.track("hub_viewed", { section: "tax" });
    await t.track("next_action_clicked", { props: { action: "same_section", screen: "article" }, keepalive: true });
    expect(flags).toEqual([false, true]);
  });

  test("보내기가 실패해도 다음 이벤트는 간다 (화면 오류 0)", async () => {
    const sent: string[] = [];
    let calls = 0;
    const t = createTracker({ cookie: () => "", gpc: () => false, referrer: () => "" }, async (body) => {
      sent.push(body);
      if (++calls === 1) throw new TypeError("Failed to fetch");
    });
    await t.track("hub_viewed", { section: "tax" });
    await t.track("hub_viewed", { section: "local" });
    expect(sent).toHaveLength(2);
  });

  test("리퍼러 호스트 — http(s)만, 소문자, 경로·쿼리 없음, 읽을 수 없으면 null", () => {
    expect(referrerHost("https://M.Search.Naver.com/search.naver?query=x")).toBe("m.search.naver.com");
    expect(referrerHost("http://127.0.0.1:3001/tax")).toBe("127.0.0.1");
    expect(referrerHost("android-app://com.google.android.gm/")).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
  });
});
