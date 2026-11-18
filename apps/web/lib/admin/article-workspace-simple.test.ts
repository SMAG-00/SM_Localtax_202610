import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 기사 편집 화면은 기본 정보·본문·출처·저장·발행만 보인다 (2026-11-19 PO 결정: "너도 이해 못하는 것을 사용자가 어떻게 이해하나").
// 걷어낸 칸의 DB 칸·데이터는 그대로 두고 화면에서만 뺐다 — 되돌릴 때는 이 시험의 금지 목록을 고쳐 컴포넌트를 다시 붙이면 된다.
const src = readFileSync(resolve(__dirname, "../../components/admin/ArticleWorkspace.tsx"), "utf8");

describe("기사 편집 화면 — 사용자가 이해할 수 있는 칸만", () => {
  it.each(["ClaimsEditor", "EvidencePanel", "ChecklistsEditor", "TaxLensEditor", "SolvedCaseEditor", "MethodGuide", "CheckPanel", "RegionalJudgePanel"])("%s 를 그리지 않는다", (name) => {
    expect(src).not.toMatch(new RegExp(`<${name}[\s/>]`));
  });

  it("'그 밖의 칸' 묶음과 점검 결과 접이가 없다", () => {
    expect(src).not.toContain("more-sections");
    expect(src).not.toContain("check-fold");
  });

  it("남겨야 할 칸은 있다 — 기본 정보·본문·출처·저장·발행", () => {
    for (const id of ['id="meta"', 'id="blocks"', 'id="sources"', 'id="save"', 'id="publish-now"']) expect(src).toContain(id);
  });

  it("발행을 막는 항목은 저장 칸에 보인다 (publish-blockers·발행 실패 요약)", () => {
    expect(src).toContain("publish-blockers");
    expect(src).toContain("publishFailure");
  });

  it("발행 API는 본문에 내부 표시가 남은 기사를 막는다 (기사 6번 사고)", () => {
    const route = readFileSync(resolve(__dirname, "../../app/api/admin/articles/[id]/publish/route.ts"), "utf8");
    expect(route).toContain("leftoverPublishProblem(before.body)");
    expect(route).toContain("publish.leftover-memo");
  });
});
