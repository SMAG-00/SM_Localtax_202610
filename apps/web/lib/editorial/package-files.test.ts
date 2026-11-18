// 편집위원 데스크 결과물 파일 묶기 — 지침 v4 14-1 폴더 구조와 예전 코워크 폴더(thumbnails·cardnews)
import { describe, expect, test } from "vitest";
import { formatBytes, groupOf, packageFileGroups } from "./package-files";

const f = (path: string, mime = "application/octet-stream") => ({ path, size: 1, mime, key: `packages/2026_11_01/${path.length}.bin` });

describe("결과물 묶기", () => {
  test("폴더 바로 아래는 기사, 하위 폴더 이름으로 묶음 — 대소문자 무시, 모르는 폴더는 기타", () => {
    expect(groupOf("보유세_칼럼_20261101.md")).toBe("article");
    expect(groupOf("images/ai1_거실.png")).toBe("images");
    expect(groupOf("thumbnails/x_1200x630.png")).toBe("images");
    expect(groupOf("Instagram/card01_표지.png")).toBe("instagram");
    expect(groupOf("cardnews/card02.png")).toBe("instagram");
    expect(groupOf("thread/2026-11-01_threads.md")).toBe("thread");
    expect(groupOf("youtube/2026-11-01_youtube.xlsx")).toBe("youtube");
    expect(groupOf("_desk/report.json")).toBe("other");
  });

  test("기사는 md → html → docx → pdf 순서, 비어 있는 묶음은 빠진다", () => {
    const groups = packageFileGroups([f("a.pdf"), f("a.docx"), f("youtube/y.xlsx"), f("a.md"), f("a.html"), f("thread/t.md")]);
    expect(groups.map((g) => g.label)).toEqual(["기사", "쓰레드", "유튜브"]);
    expect(groups[0]!.files.map((x) => x.path)).toEqual(["a.md", "a.html", "a.docx", "a.pdf"]);
  });

  test("카드 7장은 이름순 (card01 → card07)", () => {
    const cards = ["card07_마무리.png", "card01_표지.png", "card03_핵심.png"].map((n) => f(`instagram/${n}`, "image/png"));
    expect(packageFileGroups(cards)[0]!.files.map((x) => x.path)).toEqual(["instagram/card01_표지.png", "instagram/card03_핵심.png", "instagram/card07_마무리.png"]);
  });
});

describe("크기 표시", () => {
  test("경계값 1023B · 1KB · 1MB", () => {
    expect(formatBytes(1023)).toBe("1023B");
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0MB");
  });
});
