import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasUnlimitedWording } from "./quota";

// 소스 글자를 직접 읽는 경계 검사 (W12-d: HOME-10 · ASK-10 · ASK-13)
const WEB = path.join(__dirname, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(WEB, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("질문형 홈 검색 → 지방세봇 호출 0 (HOME-10)", () => {
  it("검색 화면·헤더·검색 페이지 코드는 /api/ask를 부르지 않는다", () => {
    for (const f of [["components", "site", "SearchView.tsx"], ["components", "site", "SiteHeader.tsx"], ["app", "(site)", "search", "page.tsx"], ["components", "site", "AgentEntry.tsx"], ["components", "site", "AgentEntryButton.tsx"]]) {
      expect(strip(read(...f)), f.join("/")).not.toMatch(/\/api\/ask/);
    }
  });
  it("진입 버튼은 이벤트만 보내고 전송·주소 이동을 하지 않는다", () => {
    const code = strip(read("components", "site", "AgentEntryButton.tsx"));
    expect(code).toMatch(/dispatchEvent/);
    expect(code).not.toMatch(/fetch\(|router\.|location\.|history\./);
  });
});

describe("모드 전환은 주소·제목을 바꾸지 않는다 (CHAT-15)", () => {
  it("도우미 창·지방세봇 패널에 라우터 이동·제목 변경 코드가 없다", () => {
    for (const f of ["AssistantWidget.tsx", "AgentPanel.tsx"]) {
      expect(strip(read("components", "site", f)), f).not.toMatch(/router\.(push|replace)|history\.(push|replace)State|document\.title\s*=|location\.(href|assign|replace)\s*=/);
    }
  });
});

describe("화면 문구에 '무제한'이 없다 (ASK-10)", () => {
  it("지방세봇 화면 파일과 한도 문구", () => {
    for (const f of [["components", "site", "AgentPanel.tsx"], ["components", "site", "AgentEntry.tsx"], ["app", "my", "conversations", "page.tsx"]]) {
      expect(hasUnlimitedWording(read(...f)), f.join("/")).toBe(false);
    }
  });
});

describe("법률 문구를 코드에 두지 않는다 (COMPLY)", () => {
  it("모드 고지·하단 고지는 props로만 받는다", () => {
    const code = read("components", "site", "AgentPanel.tsx");
    expect(code).toMatch(/props\.ui\.modeNotice/);
    expect(code).toMatch(/props\.ui\.answerFooter/);
  });
});
