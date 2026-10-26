// 브라우저 메모리 전달 (RE-04 · FAM-05 · b4) - 주택 수 판정 결과의 주택 수를 취득세 계산기·총비용 시뮬레이터가 이어받는다.
//  · 값은 이 모듈의 변수에만 있다. 주소(쿼리·해시)·localStorage·sessionStorage·쿠키·서버·이벤트에 쓰지 않는다. 새로고침하면 사라진다(페이지 이동 때만 이어짐).
//  · SM 양도세 카드(외부 사이트)에는 넘기지 않는다: 카드 주소는 값을 모르고, 이 모듈은 외부 링크 쪽에서 쓰지 않는다.
//  · 담는 값은 주택 수 하나(와 원인)뿐이다. 모양이 틀리면 담지 않는다.

export interface Handoff {
  /** 취득 후 보유 주택 수 */
  houseCount: number;
  cause: "PAID" | "INHERITANCE" | "GIFT";
}

let current: Handoff | null = null;

const CAUSES = ["PAID", "INHERITANCE", "GIFT"];

/** 담기 - 모양이 맞으면 true */
export function setHandoff(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.houseCount !== "number" || !Number.isSafeInteger(o.houseCount) || o.houseCount < 0) return false;
  if (typeof o.cause !== "string" || !CAUSES.includes(o.cause)) return false;
  current = { houseCount: o.houseCount, cause: o.cause as Handoff["cause"] };
  return true;
}

/** 읽기 - 사본을 준다(받은 쪽이 바꿔도 원본은 그대로) */
export function readHandoff(): Handoff | null {
  return current ? { ...current } : null;
}

export function clearHandoff(): void {
  current = null;
}

/** 화면이 구독해 읽는 현재 값(같은 값이면 같은 객체) - 사본이 아니므로 읽기만 한다 */
export function snapshotHandoff(): Readonly<Handoff> | null {
  return current;
}
