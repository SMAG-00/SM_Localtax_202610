// 히어로 배경 미디어 (PO 결정 2026-10-25) — 포스터가 첫 그림, 동작 줄이기·데이터 절약이면 영상 요청 0, 멈춤/재생 단추(WCAG 2.2.2), AI 생성 표시
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { FieldCards } from "../discovery/FieldCards";
import { FieldHubHead } from "../local/FieldHubHead";
import { Hero } from "./Hero";
import { HeroMedia } from "./HeroMedia";
import {
  HERO_AI_LABEL,
  HERO_PLAYBACK_LABELS,
  canPlayHeroVideo,
  heroMediaErrors,
  isHeroMediaPath,
  parseHeroMedia,
  pickHeroVideo,
  resolveHeroMedia,
  type ResolvedHeroMedia,
} from "./hero-media-logic";

const FULL: ResolvedHeroMedia = {
  video: "/media/hero/home.mp4",
  videoMobile: "/media/hero/home-m.mp4",
  poster: "/media/hero/home.avif",
  posterMobile: "/media/hero/home-m.avif",
  card: "/media/hero/home-card.avif",
  aiLabel: true,
};
const STILL: ResolvedHeroMedia = { ...FULL, video: null, videoMobile: null };

describe("경로·설정 모양 검사", () => {
  it("/media/hero/ 안의 파일만 통과 — 외부 주소·상위 폴더·하위 폴더·쿼리·확장자 틀림은 거부", () => {
    expect(isHeroMediaPath("/media/hero/home.mp4", "video")).toBe(true);
    expect(isHeroMediaPath("/media/hero/home-m.WEBM", "video")).toBe(true);
    expect(isHeroMediaPath("/media/hero/home.avif", "image")).toBe(true);
    for (const bad of ["https://evil.example/home.mp4", "//evil.example/a.mp4", "/media/hero/../x.mp4", "/media/hero/sub/a.mp4", "/media/hero/a.mp4?x=1", "/other/a.mp4", "/media/hero/a.avif", ""]) {
      expect(isHeroMediaPath(bad, "video")).toBe(false);
    }
    expect(isHeroMediaPath("/media/hero/a.mp4", "image")).toBe(false);
    expect(isHeroMediaPath(42, "image")).toBe(false);
  });

  it("heroMediaErrors — 올바른 값은 오류 0, 틀린 곳마다 칸 경로가 붙은 오류", () => {
    expect(heroMediaErrors({ home: { video: "/media/hero/home.mp4", poster: "/media/hero/home.avif", card: null }, tax: {}, aiLabel: false })).toEqual([]);
    expect(heroMediaErrors({})).toEqual([]);
    expect(heroMediaErrors(null)[0]).toMatch(/객체/);
    expect(heroMediaErrors([])[0]).toMatch(/객체/);
    expect(heroMediaErrors({ news: {} })[0]).toMatch(/^news: 모르는 칸/);
    expect(heroMediaErrors({ home: { autoplay: true } })[0]).toMatch(/^home\.autoplay: 모르는 칸/);
    expect(heroMediaErrors({ home: { video: "https://evil.example/a.mp4" } })[0]).toMatch(/^home\.video: \/media\/hero\//);
    expect(heroMediaErrors({ home: { poster: "/media/hero/a.mp4" } })[0]).toMatch(/^home\.poster:/);
    expect(heroMediaErrors({ home: "x" })[0]).toMatch(/^home: 객체/);
    expect(heroMediaErrors({ aiLabel: "yes" })[0]).toMatch(/aiLabel/);
  });
});

describe("parseHeroMedia · resolveHeroMedia — 틀린 값은 닫힌 쪽(그라데이션)", () => {
  it("값이 없거나 객체가 아니면 아무 미디어도 없고 aiLabel은 켜짐", () => {
    for (const v of [undefined, null, "x", 3, []]) expect(parseHeroMedia(v)).toEqual({ entries: {}, aiLabel: true });
  });

  it("틀린 경로 칸만 비우고 나머지는 살린다 — 모두 틀리면 그 분야는 없음", () => {
    const s = parseHeroMedia({
      home: { video: "https://evil.example/a.mp4", poster: "/media/hero/home.avif" },
      tax: { video: "/media/hero/../x.mp4", poster: "http://x/y.avif" },
      news: { poster: "/media/hero/news.avif" },
    });
    expect(s.entries.home).toEqual({ video: null, videoMobile: null, poster: "/media/hero/home.avif", posterMobile: null, card: null });
    expect(s.entries.tax).toBeUndefined();
    expect(Object.keys(s.entries)).toEqual(["home"]);
  });

  it("aiLabel은 false로 적었을 때만 꺼진다", () => {
    expect(parseHeroMedia({ aiLabel: false }).aiLabel).toBe(false);
    expect(parseHeroMedia({ aiLabel: "no" }).aiLabel).toBe(true);
  });

  it("모바일 칸이 비면 데스크톱 파일로, 카드 그림이 비면 모바일 포스터로 대신한다 · 없는 분야는 null", () => {
    const s = parseHeroMedia({ tax: { poster: "/media/hero/tax.avif" }, home: { video: "/media/hero/home.mp4", posterMobile: "/media/hero/home-m.avif" } });
    expect(resolveHeroMedia(s, "tax")).toEqual({ video: null, videoMobile: null, poster: "/media/hero/tax.avif", posterMobile: "/media/hero/tax.avif", card: "/media/hero/tax.avif", aiLabel: true });
    expect(resolveHeroMedia(s, "home")).toMatchObject({ videoMobile: "/media/hero/home.mp4", poster: "/media/hero/home-m.avif", card: "/media/hero/home-m.avif" });
    expect(resolveHeroMedia(s, "finance")).toBeNull();
  });
});

describe("재생 판정", () => {
  it("영상 파일이 있고 동작 줄이기·데이터 절약이 아닐 때만 영상을 불러온다", () => {
    expect(canPlayHeroVideo({ hasVideo: true, reducedMotion: false, saveData: false })).toBe(true);
    expect(canPlayHeroVideo({ hasVideo: true, reducedMotion: true, saveData: false })).toBe(false);
    expect(canPlayHeroVideo({ hasVideo: true, reducedMotion: false, saveData: true })).toBe(false);
    expect(canPlayHeroVideo({ hasVideo: false, reducedMotion: false, saveData: false })).toBe(false);
  });

  it("767px 이하는 모바일 영상, 그 위는 데스크톱 영상 — 한쪽만 있으면 있는 쪽", () => {
    expect(pickHeroVideo(FULL, 767)).toBe("/media/hero/home-m.mp4");
    expect(pickHeroVideo(FULL, 768)).toBe("/media/hero/home.mp4");
    expect(pickHeroVideo({ video: "/media/hero/a.mp4", videoMobile: null }, 390)).toBe("/media/hero/a.mp4");
    expect(pickHeroVideo({ video: null, videoMobile: null }, 1280)).toBeNull();
  });
});

type Env = { reduced?: boolean; saveData?: boolean; width?: number };
function setEnv({ reduced = false, saveData = false, width = 1280 }: Env = {}) {
  vi.stubGlobal(
    "matchMedia",
    (q: string) => ({ matches: q.includes("prefers-reduced-motion") ? reduced : false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }),
  );
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: globalThis.matchMedia });
  Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData } });
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

describe("HeroMedia 화면", () => {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("서버가 그린 첫 화면에는 포스터 그림만 있고 영상 요소가 없다 (영상 요청 0 — 포스터가 첫 큰 그림)", () => {
    const html = renderToString(<HeroMedia media={FULL} />);
    expect(html).not.toContain("<video");
    expect(html).toContain('src="/media/hero/home.avif"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('media="(max-width: 767px)"');
    expect(html).toContain('srcSet="/media/hero/home-m.avif"');
    expect(html).toContain('type="image/avif"');
  });

  it("데스크톱 폭이면 데스크톱 영상, 모바일 폭이면 모바일 영상 — 소리 없음·반복·자동 재생·화면 안 재생, 장식(aria-hidden)", () => {
    setEnv({ width: 1280 });
    const { container, unmount } = render(<HeroMedia media={FULL} />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/media/hero/home.mp4");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.closest('[aria-hidden="true"]')).not.toBeNull();
    unmount();

    setEnv({ width: 390 });
    const mobile = render(<HeroMedia media={FULL} />);
    expect(mobile.container.querySelector("video")!.getAttribute("src")).toBe("/media/hero/home-m.mp4");
  });

  it("동작 줄이기(prefers-reduced-motion)면 영상 요소·멈춤 단추 없이 포스터만", () => {
    setEnv({ reduced: true });
    const { container } = render(<HeroMedia media={FULL} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/media/hero/home.avif");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("데이터 절약(Save-Data)이면 영상 요소 없이 포스터만", () => {
    setEnv({ saveData: true });
    const { container } = render(<HeroMedia media={FULL} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("영상 파일이 없으면(포스터만 설정) 영상·단추 없이 포스터 정지 그림", () => {
    setEnv();
    const { container } = render(<HeroMedia media={STILL} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/media/hero/home.avif");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("멈춤/재생 단추 — 재생 중이면 '일시정지', 누르면 pause, 멈춘 뒤엔 '재생', 누르면 play (WCAG 2.2.2)", () => {
    setEnv();
    const { container } = render(<HeroMedia media={FULL} />);
    const video = container.querySelector("video")!;
    // 재생이 시작되기 전(자동 재생이 막힌 환경)에는 '재생' 단추
    expect(screen.getByRole("button", { name: HERO_PLAYBACK_LABELS.play })).toBeTruthy();
    act(() => void fireEvent(video, new Event("playing")));
    const pauseBtn = screen.getByRole("button", { name: HERO_PLAYBACK_LABELS.pause });
    expect(pauseBtn.textContent).toBe("일시정지");
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.click(pauseBtn);
    expect(pause).toHaveBeenCalledTimes(1);
    act(() => void fireEvent(video, new Event("pause")));
    const playBtn = screen.getByRole("button", { name: HERO_PLAYBACK_LABELS.play });
    expect(playBtn.textContent).toBe("재생");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    fireEvent.click(playBtn);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("영상은 재생이 시작되기 전까지 보이지 않는다(포스터가 보인다) — 시작되면 나타난다", () => {
    setEnv();
    const { container } = render(<HeroMedia media={FULL} />);
    const video = container.querySelector("video")!;
    expect(video.className).toContain("opacity-0");
    act(() => void fireEvent(video, new Event("playing")));
    expect(video.className).toContain("opacity-100");
  });

  it("AI 생성 표시 — 기본으로 보이고 aiLabel false면 없다 (영상 없는 포스터 화면도 같다)", () => {
    setEnv();
    const on = render(<HeroMedia media={FULL} />);
    expect(screen.getByText(HERO_AI_LABEL)).toBeTruthy();
    on.unmount();
    render(<HeroMedia media={{ ...FULL, aiLabel: false }} />);
    expect(screen.queryByText(HERO_AI_LABEL)).toBeNull();
  });
});

describe("Hero · FieldHubHead · FieldCards 연결", () => {
  it("Hero — media가 없으면 지금 모양(빛번짐 2개·화면 전체 높이 아님), 있으면 화면 전체 높이 + 글자 쪽 어두운 막, 핵심 메시지 오렌지 강조는 그대로", () => {
    const plain = render(<Hero title="지방세를 알면 재테크가 보입니다" highlight={["지방세", "재테크"]} />);
    const plainSection = plain.container.querySelector('[data-ui="hero"]')!;
    expect(plainSection.getAttribute("data-media")).toBeNull();
    expect(plainSection.className).not.toContain("min-h-");
    expect(plainSection.querySelectorAll(".blur-3xl")).toHaveLength(2);
    plain.unmount();

    setEnv();
    const { container } = render(<Hero title="지방세를 알면 재테크가 보입니다" highlight={["지방세", "재테크"]} media={<HeroMedia media={STILL} />} />);
    const section = container.querySelector('[data-ui="hero"]')!;
    expect(section.getAttribute("data-media")).toBe("true");
    expect(section.className).toContain("min-h-[calc(100svh-4.5rem)]");
    expect(section.querySelector('[data-part="hero-media"]')).not.toBeNull();
    expect(section.querySelectorAll(".blur-3xl")).toHaveLength(0);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("지방세를 알면 재테크가 보입니다");
    expect(Array.from(h1.querySelectorAll(".text-hermes-400")).map((e) => e.textContent)).toEqual(["지방세", "재테크"]);
  });

  it("FieldHubHead — band가 없으면 지금 모양, 있으면 띠 안에 흰 글자 제목(h1 하나)·탭은 띠 아래", () => {
    const tabs = { items: [{ label: "전체", href: "/tax", id: "all" }], current: "all" };
    const base = render(<FieldHubHead field="tax" eyebrow="LOCAL TAX" title="지방세" tabs={tabs} />);
    expect(base.container.querySelector('[data-band="true"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-navy-900");
    base.unmount();

    const { container } = render(
      <FieldHubHead field="tax" eyebrow="LOCAL TAX" title="지방세" intro="한 줄 소개" tabs={tabs} band={(t) => <div data-testid="band">{t}</div>} />,
    );
    const band = screen.getByTestId("band");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(band.querySelector("h1")!.className).toContain("text-white");
    expect(band.textContent).toContain("한 줄 소개");
    expect(band.querySelector("nav")).toBeNull();
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("FieldCards — 그림이 있는 카드만 바탕 그림과 흰 글자, 링크·순서·글자는 그대로", () => {
    const { container } = render(<FieldCards points={{ tax: "포인트 글" }} images={{ tax: "/media/hero/tax-card.avif", finance: "/media/hero/finance-card.avif" }} />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/tax", "/realestate", "/finance", "/local"]);
    const imgs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(imgs).toEqual(["/media/hero/tax-card.avif", "/media/hero/finance-card.avif"]);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(links[0]!.textContent).toBe("지방세·부동산세금포인트 글");
    expect(screen.getByText("지방세·부동산세금").className).toContain("text-white");
    expect(screen.getByText("부동산재테크").className).toContain("text-navy-900");
  });
});
