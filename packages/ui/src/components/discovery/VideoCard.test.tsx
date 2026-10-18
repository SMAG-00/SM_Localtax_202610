// 동영상 카드 (PRD-00 8.6 · 8.9, PRD-01A ART-08) — 16:9 썸네일(원본 비율), 재생 시간, "자막 있음" 칩, 요약. 썸네일 위에 글자 없음(R4)
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkProvider, type UiLinkProps } from "../link";
import { VideoCard, formatDuration, playableSrc } from "./VideoCard";

const THUMB = { src: "/media/video-acquisition.jpg", width: 1280, height: 720 };
const EMBED = "https://www.youtube-nocookie.com/embed/abc123XYZ_-" as const;
const BASE = {
  title: "생애 첫 집, 취득세 감면 요건 3가지",
  summary: "처음 집을 산 사람이 받을 수 있는 취득세 감면 요건을 4분 동안 차례로 설명합니다.",
  thumbnail: THUMB,
  durationSeconds: 272,
  captions: true,
};

describe("재생 시간 표기", () => {
  it.each([
    [0, "0:00", "PT0S"],
    [59, "0:59", "PT59S"],
    [60, "1:00", "PT1M0S"],
    [272, "4:32", "PT4M32S"],
    [3599, "59:59", "PT59M59S"],
    [3600, "1:00:00", "PT1H0M0S"],
    [3725, "1:02:05", "PT1H2M5S"],
    [12.9, "0:12", "PT12S"],
  ])("%s초 → %s (%s)", (sec, text, iso) => {
    expect(formatDuration(sec)).toEqual({ text, iso });
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])("잘못된 값 %s는 표기하지 않는다(null)", (sec) => {
    expect(formatDuration(sec)).toBeNull();
  });
});

describe("동영상 카드", () => {
  it("썸네일은 원본 비율 그대로 줄인다 — 자르기(object-cover)·배경 이미지 없음", () => {
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(THUMB.src);
    expect(img.getAttribute("width")).toBe("1280");
    expect(img.getAttribute("height")).toBe("720");
    expect(img.className).toContain("h-auto");
    expect(img.className).toContain("w-full");
    expect(img.className).not.toContain("object-cover");
    expect(container.querySelector("[style*='background']")).toBeNull();
  });

  it("썸네일 영역 위에는 글자가 없다 (R4 — 재생 시간·칩은 아래 줄)", () => {
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    const frame = container.querySelector("[data-thumbnail-frame]")!;
    expect(frame.contains(container.querySelector("img"))).toBe(true);
    expect(frame.textContent).toBe("");
  });

  it("재생 시간은 고정폭 <time>이고 ISO 기간 값을 갖는다", () => {
    render(<VideoCard {...BASE} embedUrl={EMBED} />);
    const time = screen.getByText("4:32");
    expect(time.tagName.toLowerCase()).toBe("time");
    expect(time.getAttribute("datetime")).toBe("PT4M32S");
    expect(time.className).toContain("font-mono");
  });

  it("자막이 있으면 '자막 있음' 칩, 없으면 칩이 없다", () => {
    const { rerender } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    expect(screen.getByText("자막 있음").getAttribute("data-ui")).toBe("chip");
    rerender(<VideoCard {...BASE} captions={false} embedUrl={EMBED} />);
    expect(screen.queryByText("자막 있음")).toBeNull();
  });

  it("제목(19px 900)과 요약 글이 보인다", () => {
    render(<VideoCard {...BASE} embedUrl={EMBED} />);
    expect(screen.getByRole("heading", { name: BASE.title }).className).toContain("text-[19px]");
    expect(screen.getByText(BASE.summary)).toBeTruthy();
  });

  it("누르기 전에는 플레이어(iframe)가 없고, 누르면 youtube-nocookie 플레이어가 열리며 onPlay가 한 번 불린다", async () => {
    const onPlay = vi.fn();
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} onPlay={onPlay} />);
    expect(container.querySelector("iframe")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `동영상 재생: ${BASE.title}` }));
    const iframe = container.querySelector("iframe")!;
    const src = new URL(iframe.getAttribute("src")!);
    expect(src.hostname).toBe("www.youtube-nocookie.com");
    expect(src.pathname).toBe("/embed/abc123XYZ_-");
    expect(src.searchParams.get("autoplay")).toBe("1");
    expect(iframe.getAttribute("title")).toBe(BASE.title);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /동영상 재생/ })).toBeNull();
  });

  it("키보드(Enter)로도 재생할 수 있다", async () => {
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    screen.getByRole("button", { name: /동영상 재생/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("youtube-nocookie가 아닌 주소는 타입 검사가 막고, 실행 중에도 플레이어를 만들지 않는다", () => {
    const { container } = render(
      // @ts-expect-error 임베드 주소는 youtube-nocookie.com/embed/ 만 (ART-08)
      <VideoCard {...BASE} embedUrl="https://www.youtube.com/embed/abc123XYZ" />,
    );
    expect(screen.queryByRole("button", { name: /동영상 재생/ })).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("링크형(동영상 목록)은 제목 링크로 기사에 가고 재생 버튼이 없다", () => {
    render(<VideoCard {...BASE} href="/news/acquisition-video" />);
    const link = screen.getByRole("link", { name: BASE.title });
    expect(link.getAttribute("href")).toBe("/news/acquisition-video");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("재생 시간이 잘못된 값이면 시간 표기만 빠지고 카드는 보인다", () => {
    const { container } = render(<VideoCard {...BASE} durationSeconds={-5} embedUrl={EMBED} />);
    expect(container.querySelector("time")).toBeNull();
    expect(screen.getByText(BASE.summary)).toBeTruthy();
  });

  it("루트 data-ui=video-card", () => {
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    expect(container.firstElementChild!.getAttribute("data-ui")).toBe("video-card");
  });

  it("재생을 누르면 키보드 초점이 플레이어로 옮겨 간다 (재생 단추가 사라져도 초점을 잃지 않는다)", async () => {
    const { container } = render(<VideoCard {...BASE} embedUrl={EMBED} />);
    await userEvent.click(screen.getByRole("button", { name: /동영상 재생/ }));
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("배지 자리 — 기사 유형·제휴 배지가 재생 시간 줄에 같은 글자로 들어간다", () => {
    render(<VideoCard {...BASE} href="/news/a" badges={<span data-ui="partner-badge">공동 기획 가온세무법인</span>} />);
    const badge = screen.getByText("공동 기획 가온세무법인");
    expect(badge.closest('[data-ui="video-card"]')).not.toBeNull();
    expect(badge.closest("[data-thumbnail-frame]")).toBeNull();
  });

  it("썸네일 크기를 모르면 width·height 속성 없이 원본 비율로 줄인다, 재생 시간을 빼면 시간 표기가 없다", () => {
    const { container } = render(<VideoCard title="t" summary="s" captions={false} thumbnail={{ src: "/m.jpg" }} embedUrl={EMBED} />);
    const img = container.querySelector("img")!;
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.hasAttribute("height")).toBe(false);
    expect(img.className).toContain("h-auto");
    expect(container.querySelector("time")).toBeNull();
  });

  it("링크형 제목은 사이트 안 이동 링크(앱 링크)다 — 새로고침 없이 기사로 (FND-09)", () => {
    const AppLink = (p: UiLinkProps) => <a data-app-link="" {...p} />;
    render(
      <LinkProvider component={AppLink}>
        <VideoCard {...BASE} href="/news/acquisition-video" />
      </LinkProvider>,
    );
    expect(screen.getByRole("link", { name: BASE.title }).hasAttribute("data-app-link")).toBe(true);
  });
});

describe("플레이어 주소 (누른 뒤 여는 주소)", () => {
  it("저장 검사를 지난 모양이면 autoplay를 붙여 연다", () => {
    expect(playableSrc(`${EMBED}?start=30`)).toBe(`${EMBED}?start=30&autoplay=1`);
  });

  it.each([
    "https://www.youtube.com/embed/abc123XYZ_-",
    "http://www.youtube-nocookie.com/embed/abc123XYZ_-",
    "https://www.youtube-nocookie.com.evil.example/embed/abc123XYZ_-",
    "https://user@www.youtube-nocookie.com/embed/abc123XYZ_-",
    "https://www.youtube-nocookie.com:8443/embed/abc123XYZ_-",
    "https://www.youtube-nocookie.com/embed/abc123XYZ_-/extra",
    "https://www.youtube-nocookie.com/embed/short",
    "https://www.youtube-nocookie.com/",
    "not a url",
    "",
  ])("%s → 플레이어 0", (url) => {
    expect(playableSrc(url)).toBeNull();
  });
});
