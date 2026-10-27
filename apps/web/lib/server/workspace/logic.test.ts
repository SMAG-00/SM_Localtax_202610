import { describe, expect, it } from "vitest";
import {
  UNVERSIONED,
  canCreate,
  canReadOwn,
  citationLine,
  countCitations,
  csvCell,
  cutExcerpt,
  decideWorkspaceAccess,
  excerptFor,
  excerptFromRead,
  isRevised,
  isValidTargetId,
  parseExcerptLimit,
  parseMode,
  parseSavedSearchLimit,
  seoulDate,
  toCsv,
  type ExportItem,
} from "./logic";

const item = (over: Partial<ExportItem> = {}): ExportItem => ({ kind: "node", id: "12", title: "시험용 노드", version: "abc", checkedOn: "2026-10-27", memo: "", aiDraft: false, excerpt: "", ...over });

describe("접근 판정 - 모드 값과 무관", () => {
  it("기능 키가 꺼지면 닫힘, 비로그인은 로그인, 권한 없으면 둘러보기, 있으면 전체", () => {
    expect(decideWorkspaceAccess({ featureOn: false, loggedIn: true, entitled: true })).toBe("closed");
    expect(decideWorkspaceAccess({ featureOn: true, loggedIn: false, entitled: false })).toBe("login");
    expect(decideWorkspaceAccess({ featureOn: true, loggedIn: true, entitled: false })).toBe("browse");
    expect(decideWorkspaceAccess({ featureOn: true, loggedIn: true, entitled: true })).toBe("full");
  });
  it("모드를 어떤 값으로 위조해도 판정 입력에 들어가지 않아 결과가 같다", () => {
    const base = { featureOn: true, loggedIn: true, entitled: false };
    for (const forged of ["expert", "admin", "", "EXPERT", null, 1]) {
      // 판정은 모드를 받지 않는다 - 위조 값이 섞인 객체를 넘겨도 결과는 같다
      expect(decideWorkspaceAccess({ ...base, mode: forged } as typeof base)).toBe("browse");
      expect(parseMode(forged)).toBe(forged === "expert" ? "expert" : "general");
    }
  });
  it("권한이 끝난 회원은 새로 만들 수 없지만 본인 자료는 열람한다 (구독 종료 후 보존)", () => {
    expect(canCreate("browse")).toBe(false);
    expect(canReadOwn("browse")).toBe(true);
    expect(canCreate("full")).toBe(true);
    expect(canReadOwn("login")).toBe(false);
    expect(canReadOwn("closed")).toBe(false);
  });
});

describe("설정 파싱 - 비어 있으면 닫힘", () => {
  it("저장 검색 한도: 빈 객체·음수·소수·문자열은 0", () => {
    expect(parseSavedSearchLimit({})).toBe(0);
    expect(parseSavedSearchLimit(undefined)).toBe(0);
    expect(parseSavedSearchLimit({ max: -1 })).toBe(0);
    expect(parseSavedSearchLimit({ max: 2.5 })).toBe(0);
    expect(parseSavedSearchLimit({ max: "3" })).toBe(0);
    expect(parseSavedSearchLimit({ max: 0 })).toBe(0);
    expect(parseSavedSearchLimit({ max: 3 })).toBe(3);
  });
  it("발췌 한도: 비면 null(내보내기 닫힘), 0은 발췌 없음", () => {
    expect(parseExcerptLimit({})).toBeNull();
    expect(parseExcerptLimit(null)).toBeNull();
    expect(parseExcerptLimit({ chars: -5 })).toBeNull();
    expect(parseExcerptLimit({ chars: 0 })).toBe(0);
    expect(parseExcerptLimit({ chars: 120 })).toBe(120);
  });
});

describe("발췌 절단 경계", () => {
  const body = "가나다라마";
  it("한도 0이면 빈 문자열", () => expect(cutExcerpt(body, 0)).toBe(""));
  it("한도 -1·소수는 빈 문자열", () => {
    expect(cutExcerpt(body, -1)).toBe("");
    expect(cutExcerpt(body, 1.5)).toBe("");
  });
  it("본문 길이 -1 / 같음 / +1", () => {
    expect(cutExcerpt(body, 4)).toBe("가나다라");
    expect(cutExcerpt(body, 5)).toBe(body);
    expect(cutExcerpt(body, 6)).toBe(body);
  });
  it("이모지(서로게이트 쌍)를 반으로 자르지 않는다", () => {
    expect(cutExcerpt("😀😀😀", 2)).toBe("😀😀");
  });
  it("권한이 끝났으면 한도가 커도 발췌 0, 본문이 없어도 0", () => {
    expect(excerptFor(body, 100, false)).toBe("");
    expect(excerptFor(null, 100, true)).toBe("");
    expect(excerptFor(body, 3, true)).toBe("가나다");
  });
});

describe("library_read 결과에서만 발췌", () => {
  const full = { ok: true, full: true, text: "가나다라마" };
  it("전문을 받았을 때만 한도까지 자른다", () => {
    expect(excerptFromRead(full, 3, true)).toBe("가나다");
    expect(excerptFromRead(full, 5, true)).toBe("가나다라마");
    expect(excerptFromRead(full, 0, true)).toBe("");
  });
  it("미리보기만 받았으면(판매 권리 미확인·library 권한 없음) 한도가 커도 0", () => {
    expect(excerptFromRead({ ok: true, full: false, text: "가나", locked: true, reason: "sale_rights" }, 100, true)).toBe("");
    expect(excerptFromRead({ ok: true, full: false, text: "가나", locked: true, reason: "subscribe" }, 100, true)).toBe("");
  });
  it("실패·빈 값·모양 불일치·워크스페이스 권한 끝남은 0", () => {
    expect(excerptFromRead({ ok: false, code: "not_found" }, 100, true)).toBe("");
    expect(excerptFromRead(null, 100, true)).toBe("");
    expect(excerptFromRead({ ok: true, full: "true", text: "가" }, 100, true)).toBe("");
    expect(excerptFromRead({ ok: true, full: true, text: 5 }, 100, true)).toBe("");
    expect(excerptFromRead(full, 100, false)).toBe("");
  });
});

describe("개정됨 판정", () => {
  it("버전이 다르면 개정됨, 같거나 지금 버전을 모르면 아님", () => {
    expect(isRevised("10", "11")).toBe(true);
    expect(isRevised("10", "10")).toBe(false);
    expect(isRevised("10", null)).toBe(false);
    expect(isRevised(UNVERSIONED, "11")).toBe(false);
  });
});

describe("대상 번호 모양", () => {
  it("숫자 종류는 1~18자리 숫자만, 대화 종류는 영숫자 64자까지", () => {
    expect(isValidTargetId("node", "123456789012345678")).toBe(true);
    expect(isValidTargetId("node", "1234567890123456789")).toBe(false);
    expect(isValidTargetId("node", "12a")).toBe(false);
    expect(isValidTargetId("node", "")).toBe(false);
    expect(isValidTargetId("agent_answer", "a".repeat(64))).toBe(true);
    expect(isValidTargetId("agent_answer", "a".repeat(65))).toBe(false);
    expect(isValidTargetId("copilot_result", "x y")).toBe(false);
  });
});

describe("CSV", () => {
  it("UTF-8 BOM으로 시작하고 머리 행과 CRLF를 쓴다", () => {
    const csv = toCsv([item({ memo: "한글 메모" })], "2026-10-27");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("종류,대상 번호,제목,원문 버전,확인일,메모,AI 초안,발췌,내보낸 날짜");
    expect(lines[1]).toBe("지식창고 노드,12,시험용 노드,abc,2026-10-27,한글 메모,,,2026-10-27");
    expect(lines[2]).toBe("");
    expect(Buffer.from(csv, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
  it("쉼표·따옴표·줄바꿈은 따옴표로 감싸고, 수식으로 읽힐 첫 글자는 막는다", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("줄\n바꿈")).toBe('"줄\n바꿈"');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("평범")).toBe("평범");
  });
  it("AI 초안 표기와 대상 없는 메모 행", () => {
    const csv = toCsv([item({ aiDraft: true }), item({ kind: null, id: null, title: "그냥 메모" })], "2026-10-27");
    const rows = csv.slice(1).split("\r\n");
    expect(rows[1].split(",")[6]).toBe("AI 초안");
    expect(rows[2].startsWith("메모,,그냥 메모")).toBe(true);
  });
});

describe("인용", () => {
  it("대상 있는 항목만 인용으로 센다", () => {
    expect(countCitations([item(), item({ kind: null, id: null }), item({ id: "7" })])).toBe(2);
    expect(citationLine(item({ kind: null, id: null }))).toBe("");
    expect(citationLine(item())).toBe("지식창고 노드 · 번호 12 · 원문 버전 abc · 확인일 2026-10-27");
  });
  it("서울 날짜는 UTC 15시에 하루 넘어간다", () => {
    expect(seoulDate(new Date("2026-10-27T14:59:59Z"))).toBe("2026-10-27");
    expect(seoulDate(new Date("2026-10-27T15:00:00Z"))).toBe("2026-10-28");
  });
});
