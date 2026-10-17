// services 묶음 — AI 도우미 화면 (PRD-00 8.6: AI 도우미 런처 · AI 도우미 패널 · 답변 카드 · 진행 상태). 화면만 — 네트워크 요청 0
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantLauncher } from "./AssistantLauncher";
import { AssistantPanel, type AssistantMessage, type AssistantPanelProps } from "./AssistantPanel";
import { AnswerCard } from "./AnswerCard";
import { ProgressStatus } from "./ProgressStatus";

const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

afterEach(() => vi.restoreAllMocks());

describe("AI 도우미 런처 (CHAT-01 · CHAT-02)", () => {
  it("우측 하단 고정 어두운 버튼 문법 — 글자 '무엇을 도와드릴까요?'는 숨기지 않는다(360px 포함)", () => {
    render(<AssistantLauncher />);
    const b = screen.getByRole("button", { name: /무엇을 도와드릴까요\?/ });
    expect(b.getAttribute("data-ui")).toBe("assistant-launcher");
    for (const c of ["fixed", "bottom-4", "right-4", "bg-navy-900", "text-white", "rounded-xl", "min-h-11"]) expect(cls(b)).toContain(c);
    const label = within(b).getByText("무엇을 도와드릴까요?");
    expect(cls(label)).not.toMatch(/(^|\s)(hidden|sr-only)(\s|$)/);
    expect(cls(label)).not.toMatch(/(^|\s)max-sm:hidden|(^|\s)sm:inline/);
  });

  it("주 버튼이 아니고 hermes-500 포인트는 아이콘 하나에만 — 흰 글자/hermes-500 바탕 0", () => {
    const { container } = render(<AssistantLauncher />);
    expect(container.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(container.querySelectorAll(".fill-hermes-500").length).toBe(1);
    expect(cls(container.firstElementChild)).not.toContain("bg-hermes-500");
  });

  it("aria-label·aria-expanded(기본 닫힘)·aria-controls·data-nosnippet", () => {
    render(<AssistantLauncher controls="assistant-panel" />);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-label")).toContain("무엇을 도와드릴까요?");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-controls")).toBe("assistant-panel");
    expect(b.hasAttribute("data-nosnippet")).toBe(true);
  });

  it("아이콘 자리에 픽토그램을 넣을 수 있고 화면 읽기에서는 숨긴다", () => {
    render(<AssistantLauncher icon={<svg data-testid="pictogram" />} />);
    expect(screen.getByTestId("pictogram").closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("클릭·Enter로 onClick을 부른다 (키보드 접근)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<AssistantLauncher onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("견본용 inline 배치는 고정 위치를 쓰지 않는다", () => {
    render(<AssistantLauncher placement="inline" />);
    expect(cls(screen.getByRole("button"))).not.toMatch(/(^|\s)fixed(\s|$)/);
  });
});

describe("진행 상태 (1단계 AI 도우미)", () => {
  it("단계에 따라 한 줄로 쌓는다 — '사이트에서 찾는 중 → 3건 확인 → 답변 작성 중'", () => {
    const { rerender } = render(<ProgressStatus stage="searching" />);
    const line = document.querySelector('[data-ui="progress-status"]')!;
    expect(line.textContent).toBe("사이트에서 찾는 중");
    rerender(<ProgressStatus stage="found" count={3} />);
    expect(line.textContent).toBe("사이트에서 찾는 중 → 3건 확인");
    rerender(<ProgressStatus stage="writing" count={3} />);
    expect(line.textContent).toBe("사이트에서 찾는 중 → 3건 확인 → 답변 작성 중");
  });

  it("고정폭 한 줄(p 하나)이고 aria-live=polite", () => {
    render(<ProgressStatus stage="writing" count={3} />);
    const line = document.querySelector('[data-ui="progress-status"]')!;
    expect(line.tagName).toBe("P");
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(cls(line)).toContain("font-mono");
  });

  it("경계 — 0건은 '0건 확인', 음수·소수는 숫자 없이 '결과 확인'", () => {
    const { rerender } = render(<ProgressStatus stage="found" count={0} />);
    const line = document.querySelector('[data-ui="progress-status"]')!;
    expect(line.textContent).toBe("사이트에서 찾는 중 → 0건 확인");
    rerender(<ProgressStatus stage="found" count={-1} />);
    expect(line.textContent).toBe("사이트에서 찾는 중 → 결과 확인");
    rerender(<ProgressStatus stage="found" count={2.5} />);
    expect(line.textContent).toBe("사이트에서 찾는 중 → 결과 확인");
  });
});

describe("답변 카드 (1단계 AI 도우미 — CHAT-04 · CHAT-16 · CHAT-17)", () => {
  const answer = {
    paragraphs: ["취득세는 잔금일부터 60일 안에 신고합니다.", "자세한 기준은 아래 해설에 있습니다."],
    citations: [
      { title: "취득세 신고 기한 해설", href: "/news/acquisition-tax-deadline" },
      { title: "위택스 취득세 안내", href: "https://www.wetax.go.kr/" },
    ],
  };

  it("'AI 답변' 배지·결론 단락(왼쪽 hermes-500 2px 선)·인용 링크 목록·고정 고지", () => {
    render(<AnswerCard {...answer} />);
    const card = document.querySelector('[data-ui="answer-card"]') as HTMLElement;
    expect(within(card).getByText("AI 답변")).toBeTruthy();
    const conclusion = within(card).getByText("취득세는 잔금일부터 60일 안에 신고합니다.");
    expect(cls(conclusion)).toContain("border-l-2");
    expect(cls(conclusion)).toContain("border-hermes-500");
    const links = within(within(card).getByRole("list", { name: "인용 출처" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/news/acquisition-tax-deadline", "https://www.wetax.go.kr/"]);
    expect(links[0].getAttribute("target")).toBeNull();
    expect(links[1].getAttribute("target")).toBe("_blank");
    expect(links[1].getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.textContent).toContain("AI가 작성한 안내이며 세무 자문이 아닙니다");
  });

  it("요약 답에만 'AI 요약' 배지가 붙는다", () => {
    const { unmount } = render(<AnswerCard {...answer} />);
    expect(screen.queryByText("AI 요약")).toBeNull();
    unmount();
    render(<AnswerCard {...answer} summary />);
    expect(screen.getByText("AI 요약")).toBeTruthy();
  });

  it("금액·명세서 블록이 없다 — 표·입력 요소·주 버튼 0", () => {
    const { container } = render(<AnswerCard {...answer} />);
    expect(container.querySelectorAll("table, input, textarea, select").length).toBe(0);
    expect(container.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
  });

  it("[도움됨]을 누르면 눌림 상태와 고마움 안내, onFeedback('helpful')", async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    render(<AnswerCard {...answer} onFeedback={onFeedback} experts={{ findHref: "/experts?field=local-tax" }} />);
    await user.click(screen.getByRole("button", { name: "도움됨" }));
    expect(screen.getByRole("button", { name: "도움됨" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "아니에요" }).getAttribute("aria-pressed")).toBe("false");
    expect(onFeedback).toHaveBeenCalledWith("helpful");
    expect(screen.getByRole("status").textContent).toContain("의견을 보내 주셔서 고맙습니다");
    expect(screen.queryByRole("link", { name: "전문가 직접 찾기" })).toBeNull();
  });

  it("[아니에요] 뒤에 전문가 연결 두 버튼(어두운 버튼, 같은 비중)이 나온다", async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    render(<AnswerCard {...answer} onFeedback={onFeedback} experts={{ findHref: "/experts?field=local-tax", requestHref: "/experts/request" }} />);
    expect(screen.queryByRole("link", { name: "전문가 직접 찾기" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "아니에요" }));
    expect(onFeedback).toHaveBeenCalledWith("not-helpful");
    const find = screen.getByRole("link", { name: "전문가 직접 찾기" });
    const request = screen.getByRole("link", { name: "SM 전문가에게 연락 받기" });
    expect(find.getAttribute("href")).toBe("/experts?field=local-tax");
    expect(request.getAttribute("href")).toBe("/experts/request");
    expect(find.getAttribute("data-ui")).toBe("dark-button");
    expect(request.getAttribute("data-ui")).toBe("dark-button");
  });

  it("연락 요청이 닫혀 있으면(requestHref 없음) [SM 전문가에게 연락 받기]는 없다", async () => {
    const user = userEvent.setup();
    render(<AnswerCard {...answer} experts={{ findHref: "/experts" }} />);
    await user.click(screen.getByRole("button", { name: "아니에요" }));
    expect(screen.getByRole("link", { name: "전문가 직접 찾기" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "SM 전문가에게 연락 받기" })).toBeNull();
  });
});

describe("AI 도우미 패널 (CHAT-01 · CHAT-08 · CHAT-10 · CHAT-16 · CHAT-17)", () => {
  const notice = ["AI가 이 사이트의 자료를 찾아 안내합니다.", "세무 자문이 아닙니다.", "대화는 국외(미국)에서 처리되고 30일 보관됩니다.", "개인정보와 계산 입력값은 넣지 마세요."];
  const aiNotice = "생성형 AI가 만든 안내입니다";
  const messages: AssistantMessage[] = [
    { id: "m1", kind: "question", text: "취득세 신고 기한이 언제예요?" },
    { id: "m2", kind: "answer", answer: { paragraphs: ["잔금일부터 60일 안에 신고합니다."], citations: [{ title: "신고 기한 해설", href: "/news/deadline" }] } },
    { id: "m3", kind: "question", text: "이 아파트 취득세 얼마예요?" },
    { id: "m4", kind: "scope", reason: "세액은 도우미가 계산하지 않습니다.", links: [{ label: "SM 취득세 계산기", href: "https://sm-calc.example.org/acquisition" }], basisDate: "2026-10-01" },
    { id: "m5", kind: "search-only", results: [{ label: "취득세 신고 안내", href: "/news/acquisition-guide" }] },
  ];
  const base: AssistantPanelProps = { aiNotice, firstUseNotice: notice, onSubmit: () => {}, onClose: () => {} };

  it("머리 — 아이브로 ASSISTANT·제목·생성형 AI 고지 한 줄·[닫기], 모드 탭 HTML 0", () => {
    render(<AssistantPanel {...base} />);
    const panel = screen.getByRole("dialog", { name: "무엇을 도와드릴까요?" });
    expect(panel.getAttribute("data-ui")).toBe("assistant-panel");
    expect(within(panel).getByText("ASSISTANT").closest('[data-ui="eyebrow"]')).not.toBeNull();
    expect(within(panel).getByText(aiNotice)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "닫기" })).toBeTruthy();
    expect(panel.querySelectorAll('[role="tablist"], [role="tab"]').length).toBe(0);
    expect(panel.textContent).not.toContain("지방세봇");
  });

  it("첫 사용 고지를 확인해야 입력창·[보내기]·추천 질문이 열리고, 확인하면 입력창으로 초점이 간다", async () => {
    const user = userEvent.setup();
    const onNoticeConfirm = vi.fn();
    render(<AssistantPanel {...base} suggestions={["재산세 납부 기한"]} onNoticeConfirm={onNoticeConfirm} />);
    const input = screen.getByRole("textbox", { name: "질문" }) as HTMLInputElement;
    const send = screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement;
    const chip = screen.getByRole("button", { name: "재산세 납부 기한" }) as HTMLButtonElement;
    for (const line of notice) expect(screen.getByText(line)).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(chip.disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "확인했습니다" }));
    expect(onNoticeConfirm).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(false);
    expect(send.disabled).toBe(false);
    expect(chip.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "확인했습니다" })).toBeNull();
  });

  it("확인 기록이 열린 뒤에 도착해도(브라우저 기록 읽기) 고지 상자를 거두고 입력창을 연다", () => {
    const { rerender } = render(<AssistantPanel {...base} />);
    expect((screen.getByRole("textbox", { name: "질문" }) as HTMLInputElement).disabled).toBe(true);
    rerender(<AssistantPanel {...base} defaultNoticeConfirmed />);
    expect(screen.queryByRole("button", { name: "확인했습니다" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "질문" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("이미 확인한 사용자는 고지 상자 없이 열리고 초점이 입력창에 있다", () => {
    render(<AssistantPanel {...base} defaultNoticeConfirmed />);
    expect(screen.queryByRole("button", { name: "확인했습니다" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "질문" }));
  });

  it("[보내기] — 질문을 onSubmit으로만 넘기고 입력창을 비운다 (패널 스스로 네트워크 요청 0)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onSubmit = vi.fn();
    render(<AssistantPanel {...base} defaultNoticeConfirmed onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "질문" }) as HTMLInputElement;
    await user.type(input, "  재산세는 언제 내요?  ");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    expect(onSubmit).toHaveBeenCalledWith("재산세는 언제 내요?");
    expect(input.value).toBe("");
    await user.type(input, "자동차세 연납{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith("자동차세 연납");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("공백뿐인 질문은 보내지 않는다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AssistantPanel {...base} defaultNoticeConfirmed onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox", { name: "질문" }), "   {Enter}");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("추천 질문 칩을 누르면 그 질문을 보낸다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AssistantPanel {...base} defaultNoticeConfirmed suggestions={["재산세 납부 기한", "취득세 감면"]} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "취득세 감면" }));
    expect(onSubmit).toHaveBeenCalledWith("취득세 감면");
  });

  it("답변을 쓰는 중(busy)에는 [보내기]가 꺼진다", () => {
    render(<AssistantPanel {...base} defaultNoticeConfirmed busy progress={{ stage: "found", count: 3 }} />);
    expect((screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-ui="assistant-panel"] [data-ui="progress-status"]')!.textContent).toBe("사이트에서 찾는 중 → 3건 확인");
  });

  it("메시지 영역은 aria-live=polite, 주 버튼은 [보내기] 하나 (전문가 버튼은 어두운 버튼)", () => {
    const { container } = render(<AssistantPanel {...base} defaultNoticeConfirmed messages={messages} experts={{ findHref: "/experts?field=local-tax", requestHref: "/experts/request" }} />);
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    const primaries = container.querySelectorAll('[data-ui="primary-button"]');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent).toBe("보내기");
    expect(within(log).getAllByRole("link", { name: "전문가 직접 찾기" }).every((a) => a.getAttribute("data-ui") === "dark-button")).toBe(true);
  });

  it("메시지 종류 — 질문·답변 카드('AI 답변')·범위 안내(사유·갈 곳·기준일·두 버튼)·'검색 결과만'(AI 답변 배지 0)", () => {
    render(<AssistantPanel {...base} defaultNoticeConfirmed messages={messages} experts={{ findHref: "/experts?field=local-tax", requestHref: "/experts/request" }} />);
    const log = screen.getByRole("log");
    expect(within(log).getByText("취득세 신고 기한이 언제예요?")).toBeTruthy();
    expect(within(log).getAllByText("AI 답변").length).toBe(1);
    const scope = log.querySelector('[data-message="scope"]') as HTMLElement;
    expect(scope.textContent).toContain("세액은 도우미가 계산하지 않습니다.");
    expect(within(scope).getByRole("link", { name: /SM 취득세 계산기/ }).getAttribute("target")).toBe("_blank");
    expect(scope.querySelector("time")?.textContent).toBe("2026-10-01");
    expect(within(scope).getByRole("link", { name: "SM 전문가에게 연락 받기" })).toBeTruthy();
    const searchOnly = log.querySelector('[data-message="search-only"]') as HTMLElement;
    expect(searchOnly.textContent).toContain("검색 결과만");
    expect(searchOnly.textContent).not.toContain("AI 답변");
    expect(within(searchOnly).getByRole("link", { name: "취득세 신고 안내" }).getAttribute("href")).toBe("/news/acquisition-guide");
    expect(within(searchOnly).getByRole("link", { name: "전문가 직접 찾기" })).toBeTruthy();
  });

  function Harness({ onClose }: { onClose: () => void }) {
    const launcher = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <>
        <AssistantLauncher ref={launcher} expanded={open} onClick={() => setOpen(true)} />
        {open && (
          <AssistantPanel
            {...base}
            defaultNoticeConfirmed
            returnFocusRef={launcher}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }

  it("Esc로 닫으면 onClose를 부르고 초점이 런처로 돌아온다", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "질문" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /무엇을 도와드릴까요\?/ }));
  });

  it("[닫기] 버튼도 같은 동작 — onClose + 런처로 초점", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /무엇을 도와드릴까요\?/ }));
  });

  it("모바일은 전체 화면(fixed inset-0), 640px 이상은 우측 하단 카드 — data-nosnippet", () => {
    render(<AssistantPanel {...base} />);
    const panel = screen.getByRole("dialog");
    for (const c of ["fixed", "inset-0", "sm:inset-auto", "sm:bottom-6", "sm:right-6", "sm:rounded-2xl", "sm:border-navy-100"]) expect(cls(panel)).toContain(c);
    expect(panel.hasAttribute("data-nosnippet")).toBe(true);
  });

  function LateMount({ autoFocus }: { autoFocus?: boolean }) {
    const [show, setShow] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setShow(true)}>
          바깥
        </button>
        {show && <AssistantPanel {...base} placement="inline" autoFocus={autoFocus} />}
      </>
    );
  }

  it("견본용 inline 배치 — 고정 위치 0, autoFocus=false면 열려도 초점을 옮기지 않는다", async () => {
    const user = userEvent.setup();
    render(<LateMount autoFocus={false} />);
    await user.click(screen.getByRole("button", { name: "바깥" }));
    expect(cls(screen.getByRole("dialog"))).not.toMatch(/(^|\s)fixed(\s|$)/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "바깥" }));
  });

  it("기본(autoFocus)은 열릴 때 초점을 패널 안(고지 확인 버튼)으로 옮긴다", async () => {
    const user = userEvent.setup();
    render(<LateMount />);
    await user.click(screen.getByRole("button", { name: "바깥" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "확인했습니다" }));
  });
});
