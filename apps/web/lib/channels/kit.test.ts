import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKit, channelLandingProps, CHANNEL_KEYS, CHECKLIST_KEYS, checkUtm, kitText, parsePost, type KitDraft } from "./kit";

// 모든 문장은 `시험용` 지어낸 글이다.
const labels = { brief: "브리프", cardnews: "카드뉴스", shorts: "쇼츠", naver_blog: "블로그", naver_post: "포스트" } as const;
const draft = (over: Partial<KitDraft> = {}): KitDraft => ({ review_item_id: 1, channel: "brief", text: "시험용 원고", article_url: "https://example.test/news/test-slug?utm_source=brief&utm_medium=owned&utm_campaign=test-slug", status: "approved", ...over });

describe("채널 목록은 원고 생성·DB 제약과 같다", () => {
  it("W12-f CHANNELS와 같은 값", () => {
    const src = readFileSync(new URL("../../../../workflows/src/ops/editorial-ai.ts", import.meta.url), "utf8");
    const m = /export const CHANNELS = \[(.*?)\] as const/.exec(src);
    expect(m).not.toBeNull();
    const ch = (m as RegExpExecArray)[1].split(",").map((s) => s.trim().replace(/"/g, ""));
    expect([...CHANNEL_KEYS]).toEqual(ch);
  });
  it("SQL 180 channel_posts 제약과 같은 값", () => {
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261026000180_w12h_channel_posts.sql", import.meta.url), "utf8");
    const m = /channel text not null check \(channel in \((.*?)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    expect((m as RegExpExecArray)[1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...CHANNEL_KEYS]);
  });
  it("체크리스트 키는 SQL 180과 같다", () => {
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261026000180_w12h_channel_posts.sql", import.meta.url), "utf8");
    for (const k of CHECKLIST_KEYS) expect(sql).toContain(`'${k}'`);
  });
});

describe("buildKit - 승인된 원고만, 채널당 가장 새 원고", () => {
  it("승인 전 상태는 키트에 0", () => {
    const k = buildKit([draft({ status: "drafted" }), draft({ review_item_id: 2, channel: "shorts", status: "in_review" }), draft({ review_item_id: 3, channel: "cardnews", status: "rejected" })], [], labels);
    expect(k).toEqual([]);
  });
  it("승인·게시됨 상태는 담고 채널 순서는 고정, 같은 채널은 번호가 큰 원고", () => {
    const k = buildKit([draft({ review_item_id: 5, channel: "naver_post" }), draft({ review_item_id: 2 }), draft({ review_item_id: 4 }), draft({ review_item_id: 9, channel: "shorts", status: "published", posted: true })], ["시험용 대체 텍스트"], labels);
    expect(k.map((b) => [b.channel, b.reviewItemId])).toEqual([["brief", 4], ["shorts", 9], ["naver_post", 5]]);
    expect(k[1].posted).toBe(true);
    expect(k[0].altTexts).toEqual(["시험용 대체 텍스트"]);
  });
  it("모르는 채널·빈 원고는 뺀다", () => {
    expect(buildKit([draft({ channel: "unknown" }), draft({ review_item_id: 2, text: "   " })], [], labels)).toEqual([]);
  });
  it("kitText는 채널마다 머리글·링크·대체 텍스트를 담는다", () => {
    const t = kitText("test-slug", buildKit([draft()], ["시험용 대체"], labels));
    expect(t).toContain("# 채널 배포 키트 - test-slug");
    expect(t).toContain("시험용 원고");
    expect(t).toContain("1. 시험용 대체");
    expect(t).toContain("utm_source=brief");
  });
});

describe("checkUtm - utm_source는 채널, utm_campaign은 기사 slug", () => {
  const ok = "https://example.test/news/test-slug?utm_source=naver_blog&utm_medium=owned&utm_campaign=test-slug";
  it("맞는 링크는 통과", () => {
    expect(checkUtm(ok, "naver_blog", "test-slug")).toEqual({ ok: true, problems: [] });
  });
  it.each([
    ["채널 불일치", ok.replace("utm_source=naver_blog", "utm_source=shorts")],
    ["slug 불일치", ok.replace("utm_campaign=test-slug", "utm_campaign=other")],
    ["medium 누락", ok.replace("&utm_medium=owned", "")],
    ["http", ok.replace("https", "http")],
  ])("%s -> 거부", (_n, url) => {
    expect(checkUtm(url, "naver_blog", "test-slug").ok).toBe(false);
  });
  it("주소가 아니면 거부", () => {
    expect(checkUtm("not a url", "brief", "x").ok).toBe(false);
  });
});

describe("parsePost - 게시 기록 입력", () => {
  const full = { source_noted: true, ai_notice: true, alt_text: true, not_ad: true };
  it("https 링크 + 체크리스트 4칸 true면 통과", () => {
    const r = parsePost({ postedUrl: " https://example.test/post/1 ", checklist: full });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.postedUrl).toBe("https://example.test/post/1");
  });
  it("체크 하나라도 빠지면 그 칸 이름이 오류에 나온다", () => {
    const r = parsePost({ postedUrl: "https://example.test/p", checklist: { ...full, alt_text: false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("alt_text");
  });
  it("http·인증키 변수·빈 링크 거부", () => {
    expect(parsePost({ postedUrl: "http://example.test/p", checklist: full }).ok).toBe(false);
    expect(parsePost({ postedUrl: "https://example.test/p?apikey=1", checklist: full }).ok).toBe(false);
    expect(parsePost({ postedUrl: "", checklist: full }).ok).toBe(false);
    expect(parsePost({ postedUrl: "https://example.test/p", checklist: null as unknown as object }).ok).toBe(false);
  });
});

describe("channelLandingProps - 측정 속성 형식", () => {
  it("밑줄은 하이픈, 형식 밖 slug는 article-번호", () => {
    expect(channelLandingProps("naver_blog", 7, "test-slug")).toEqual({ utm_source: "naver-blog", utm_campaign: "test-slug" });
    expect(channelLandingProps("brief", 7, "%ED%95%9C%EA%B8%80")).toEqual({ utm_source: "brief", utm_campaign: "article-7" });
  });
});

describe("외부 채널 게시 호출 0", () => {
  it("lib/channels·lib/server/channels 소스에 fetch·채널 계정 키 변수가 없다", () => {
    const dirs = [new URL("./", import.meta.url), new URL("../server/channels/", import.meta.url)];
    for (const dir of dirs) {
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
      } catch {
        continue; // 서버 디렉터리는 아직 없을 수 있다
      }
      for (const f of files) {
        const text = readFileSync(new URL(f, dir), "utf8");
        expect(text, f).not.toMatch(/\bfetch\s*\(/);
        expect(text, f).not.toMatch(/process\.env\.[A-Z_]*(NAVER|YOUTUBE|CHANNEL)[A-Z_]*(KEY|TOKEN|SECRET)/);
      }
    }
  });
});
