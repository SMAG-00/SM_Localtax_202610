import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteBlocker, deletedSlug } from "./article-delete";

describe("deleteBlocker — 기사 삭제 버튼을 누를 수 있는 상태", () => {
  it.each(["draft", "in_review", "approved", "held"])("%s 기사는 삭제할 수 있다", (status) => {
    expect(deleteBlocker(status)).toBeNull();
  });
  it.each(["published", "scheduled"])("%s 기사는 먼저 내려야 한다 — 공개 기사를 버튼 한 번으로 지우지 않는다", (status) => {
    expect(deleteBlocker(status)).toMatch(/먼저 내려/);
  });
  it("이미 삭제된 기사는 다시 삭제하지 않는다", () => {
    expect(deleteBlocker("deleted")).toMatch(/이미 삭제/);
  });
});

describe("deletedSlug — 삭제한 기사의 주소를 비워 같은 주소로 새 기사를 만들 수 있게 한다", () => {
  it("원래 주소 뒤에 -deleted-번호를 붙인다", () => {
    expect(deletedSlug("desk-2026-11-18", 6)).toBe("desk-2026-11-18-deleted-6");
  });
  it("결과는 DB 주소 규칙(공백·/ 없음, 예약어 아님)을 지키고 원래 주소와 다르다", () => {
    const s = deletedSlug("20261118-2adf", 4);
    expect(s).toMatch(/^[^\s/]+$/);
    expect(s).not.toBe("20261118-2adf");
    expect(["video", "photo", "popular"]).not.toContain(s.toLowerCase());
  });
  it("다른 기사 번호면 다른 주소 — 같은 주소의 기사를 여러 번 지워도 겹치지 않는다", () => {
    expect(deletedSlug("same", 1)).not.toBe(deletedSlug("same", 2));
  });
  it("이미 -deleted-가 붙은 주소에 또 붙이지 않는다", () => {
    expect(deletedSlug("desk-x-deleted-6", 6)).toBe("desk-x-deleted-6");
  });
});

describe("삭제 버튼 연결 (소스 확인)", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
  it("기사 목록에 삭제 버튼이 있고, 편집 책임자(correction.decide)에게만 그려진다", () => {
    const page = read("../../app/admin/(desk)/articles/page.tsx");
    expect(page).toContain("DeleteArticleButton");
    expect(page).toContain('can(viewer, "correction.decide")');
    expect(page).toContain("deleteBlocker(a.status)");
  });
  it("삭제 API는 편집 책임자 권한을 확인하고 공개 중 기사를 거부하며 감사 기록을 남긴다", () => {
    const route = read("../../app/api/admin/articles/[id]/route.ts");
    expect(route).toContain("export const DELETE");
    expect(route).toContain('authorize(viewer, "correction.decide"');
    expect(route).toContain("deleteBlocker(before.status)");
    expect(route).toContain('"article.delete"');
  });
});
