// 국가법령정보센터 Open API 클라이언트 — SM `agents/law-api.ts`를 복사해 이 저장소 방식으로 고친 것 (SOURCE.json: 원본 커밋·해시).
// **여기에는 AI가 없다.** 조문을 가져오고 해시를 비교하는 결정론적 코드뿐이다 (AIOPS-06 · SM 불변 원칙 4).
//
// SM 원본에서 바꾼 점 (동작 규칙은 그대로 — 지수 백오프 3회, 4xx는 재시도 없음, 완전일치 + 현행만):
//  · process.env 대신 기관코드(oc)를 만들 때 받는다 — 키가 없으면 만들지 않는다(파이프라인은 그 전에 건너뛴다)
//  · Next.js fetch 캐시 옵션 제거, fetch·sleep을 넣을 수 있게 해 시험이 실제 네트워크 없이 돈다
//  · 키는 요청 주소를 만드는 build() 한 곳에만 있고, 돌려주는 값에는 키 없는 주소(safeUrl)만 담는다 (PIPE-08)
//  · 본문 조회 실패를 null로 삼키지 않고 호출자가 구분한다(스냅샷 없이 저장하지 않으므로)
//  · TypeScript 매개변수 속성을 쓰지 않는다(명령줄 시험이 형 지우기만으로 읽는다)
// 실응답 견본 계약: 응답 키는 한글이다 — 아래 형은 SM이 2026-07-12 실응답으로 확정한 것이고, 이 저장소의 시험은 지어낸 견본(시험용)으로 같은 모양을 확인한다.
import { redactCredentials } from "../credentials.ts";

const BASE = "https://www.law.go.kr/DRF";
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_RETRIES = 3;

/** lawSearch.do 의 law 항목 (실제 응답 필드) */
export interface LawSearchItem {
  법령ID: string;
  법령명한글: string;
  법령일련번호: string;
  공포일자: string; // YYYYMMDD
  공포번호: string;
  시행일자: string; // YYYYMMDD
  현행연혁코드: string;
  제개정구분명: string;
  소관부처명: string;
  법령구분명: string;
}

/** 감시에 필요한 만큼만 정규화한 결과 */
export interface LawSnapshot {
  readonly lawId: string;
  readonly lawSerial: string;
  readonly lawName: string;
  /** ISO date. 예: "2026-07-01" */
  readonly effectiveDate: string;
  readonly promulgationDate: string;
  readonly promulgationNo: string;
  readonly revisionType: string;
}

export class LawApiError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LawApiError";
    this.status = status;
  }
}

/** "20260701" → "2026-07-01" */
export function toIsoDate(yyyymmdd: string): string {
  const s = String(yyyymmdd).trim();
  if (!/^\d{8}$/.test(s)) throw new LawApiError(`날짜 형식이 예상과 다릅니다: ${yyyymmdd}`);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Web Crypto 기반 SHA-256 (Node·Edge 양쪽) */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FetchedText {
  text: string;
  status: number;
  /** 인증키가 없는 주소 — 스냅샷·기록에는 이것만 쓴다 */
  safeUrl: string;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ApiConfig {
  /** 기관코드(LAW_API_OC) — 비어 있으면 만들 수 없다 */
  oc: string;
  fetch?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LawApi {
  /** 요청 → 본문 글자. 지수 백오프(1s→2s) 최대 retries회, 4xx는 재시도 없이 즉시 실패 (PIPE-06) */
  getText(path: string, params: Record<string, string>): Promise<FetchedText>;
  getJson(path: string, params: Record<string, string>): Promise<{ json: unknown } & FetchedText>;
  searchLaw(lawName: string): Promise<LawSnapshot | null>;
  getLawBody(lawId: string): Promise<{ text: string; hash: string; safeUrl: string; status: number } | null>;
}

export function createLawApi(config: ApiConfig): LawApi {
  if (!config.oc) throw new LawApiError("LAW_API_OC 가 설정되지 않았습니다. 법제처에서 승인받은 기관코드를 넣으세요.");
  const oc = config.oc;
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const retries = config.retries ?? DEFAULT_RETRIES;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // 인증키가 들어가는 유일한 곳
  function build(path: string, params: Record<string, string>): { url: string; safeUrl: string } {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return { url: `${BASE}/${path}?OC=${encodeURIComponent(oc)}&${query}`, safeUrl: `${BASE}/${path}?${query}` };
  }

  async function getText(path: string, params: Record<string, string>): Promise<FetchedText> {
    const { url, safeUrl } = build(path, params);
    let lastMessage = "알 수 없는 오류";
    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // 1s → 2s → 4s
      try {
        const response = await doFetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return { text: await response.text(), status: response.status, safeUrl };
        if (response.status >= 400 && response.status < 500) {
          throw new LawApiError(`법령 API가 요청을 거부했습니다 (HTTP ${response.status}). 기관코드 승인 여부와 파라미터를 확인하세요.`, response.status);
        }
        lastMessage = `법령 API 오류 (HTTP ${response.status})`;
      } catch (error) {
        if (error instanceof LawApiError && error.status !== undefined && error.status < 500) throw error;
        lastMessage = redactCredentials(error instanceof Error ? error.message : String(error), [oc]);
      }
    }
    throw new LawApiError(`법령 API 호출이 ${retries}회 모두 실패했습니다: ${lastMessage}`);
  }

  async function getJson(path: string, params: Record<string, string>) {
    const got = await getText(path, params);
    try {
      return { ...got, json: JSON.parse(got.text) as unknown };
    } catch {
      throw new LawApiError("법령 API 응답이 JSON이 아닙니다");
    }
  }

  /** 법령명 완전일치 + 현행만 (검색은 유사어까지 잡아 온다) */
  async function searchLaw(lawName: string): Promise<LawSnapshot | null> {
    const { json } = await getJson("lawSearch.do", { target: "law", type: "JSON", display: "100", query: lawName });
    const raw = (json as { LawSearch?: { law?: LawSearchItem | LawSearchItem[] } }).LawSearch?.law;
    if (!raw) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const hit = list.find((item) => item.법령명한글 === lawName && item.현행연혁코드 === "현행");
    if (!hit) return null;
    return {
      lawId: hit.법령ID,
      lawSerial: String(hit.법령일련번호),
      lawName: hit.법령명한글,
      effectiveDate: toIsoDate(hit.시행일자),
      promulgationDate: toIsoDate(hit.공포일자),
      promulgationNo: String(hit.공포번호),
      revisionType: hit.제개정구분명,
    };
  }

  async function getLawBody(lawId: string) {
    let got: FetchedText;
    try {
      got = await getText("lawService.do", { target: "law", type: "JSON", ID: lawId });
    } catch {
      return null; // 호출자가 구분한다 — 본문이 없으면 스냅샷을 만들 수 없으므로 새 개정판도 만들지 않는다
    }
    if (got.text.trim() === "") return null;
    return { text: got.text, hash: await sha256(got.text), safeUrl: got.safeUrl, status: got.status };
  }

  return { getText, getJson, searchLaw, getLawBody };
}
