import "server-only";
import type { ProgressStageKey } from "@ltr/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { profilePageIds } from "./brand";
import { publicDb, publicSearchDb, rowsOf } from "./db";
import { readPublicSettings, readRegions } from "./reads";
import { SITUATION_COLUMNS, type RegionRow, type SituationRow } from "./rows";
import {
  SEARCH_LIMITS,
  SEARCH_SCREEN,
  screenOptions,
  countArgs,
  countsMissing,
  emptySearchResult,
  queryTerms,
  searchArgs,
  toSearchResult,
  withCounts,
  type SearchOptions,
  type SearchResult,
  type SearchRow,
} from "./search-logic";
import { toSituationCard, type SituationCard } from "./situation-logic";
import type { SectionKey } from "./constants";

// 통합 검색 (SRCH-01 · SRCH-02 — docs/dev/W2-d_설계.md 7·8장) — 검색 함수 search_public 하나를 anon 키로 부른다(RLS·칸 권한이 경계,
// 함수도 security invoker). 응답은 캐시하지 않는다(publicSearchDb — no-store): 발행 취소·비공개가 다음 검색에 바로 빠진다.
// 기능 키(주소를 열지)는 다른 공개 화면과 같은 30초 캐시 설정을 읽는다. 검색어는 저장하지 않고 로그에도 남기지 않는다(10장).
// 같은 함수를 AI 도우미 검색 도구(01C CHAT-03)가 부른다 — 결과 모양(SearchRow)은 종류가 늘어도 같다.

/**
 * 검색 — 검색어가 비거나(남는 글자 없음) 종류 없는 탭(행사·전문가 — 01B·01C 전)·건너뛰기 한도를 넘는 쪽이면 DB를 부르지 않고 빈 결과.
 * perKind를 주면 종류별 묶음(전체 탭 — 종류마다 앞 n개, 쪽 없음).
 * 고른 탭·쪽에 행이 없으면 탭 숫자도 오지 않으므로 같은 거르개로 한 행만 다시 읽어 탭 숫자를 채운다(2단계 — 다른 탭에 결과가 있으면 그 탭이 보인다)
 */
export async function searchSite(options: SearchOptions, mode: { perKind?: number; pageSize?: number } = {}): Promise<SearchResult> {
  const args = searchArgs(options, mode);
  if (!args) return emptySearchResult(options, mode.pageSize ?? SEARCH_LIMITS.pageSize);
  const db = publicSearchDb();
  const [settings, found] = await Promise.all([readPublicSettings(), rowsOf<SearchRow>(db.rpc("search_public", args), "통합 검색")]);
  const rows = await withoutClosedPeople(found);
  const result = toSearchResult(rows, settings.features, options, args);
  if (!countsMissing(rows, args)) return result;
  const counted = await rowsOf<SearchRow>(db.rpc("search_public", countArgs(options)!), "통합 검색 탭 숫자");
  return withCounts(result, counted);
}

/**
 * 인물 결과 중 인물 페이지를 낼 수 없는 사람(동의서 없음·철회 — W3 7단계 BR-07)은 뺀다 — 결과 링크가 404로 가지 않게.
 * 탭 숫자(kind_counts)는 DB 함수가 세므로 이 사람들이 들어 있다 — 함수 안으로 옮기는 것은 W3 10단계(검색 연결)
 */
async function withoutClosedPeople(rows: SearchRow[]): Promise<SearchRow[]> {
  const ids = rows.filter((r) => r.kind === "person").map((r) => Number(r.ref)).filter((n) => Number.isInteger(n));
  if (ids.length === 0) return rows;
  const open = await profilePageIds(ids);
  return rows.filter((r) => r.kind !== "person" || open.has(Number(r.ref)));
}

/** 검색 화면 (/search) 한 번에 그릴 값 */
export interface SearchPageData {
  /** 화면 옵션 — 종류 없는 탭은 전체 탭, 전체 탭은 1쪽 (screenOptions) */
  options: SearchOptions;
  /** 검색 결과 — 검색어에 남는 글자가 없으면(검색 안 함) null */
  result: SearchResult | null;
  /** 추천 검색어 (settings.home_search_chips — 3~6개일 때만, 아니면 빈 목록) */
  chips: string[];
  /** 결과 없음 화면의 상황 카드 (UX-05) — 결과가 있으면 빈 목록 */
  situations: SituationCard[];
  /** 지역 거르개 선택지의 원본 — 공개 행정구역 (화면이 오늘 유효한 것만 고른다 — lib/site/search-view.ts regionGroups) */
  regions: RegionRow[];
  /** 오늘 (한국 날짜) */
  today: string;
  /** 트래커 '확정 아님' 기준 단계 (TX-08) */
  confirmStage: ProgressStageKey;
}

/**
 * 결과 없음 화면의 상황 카드 — 공개 상황(RLS — 감수된 visible만)을 편집 순서(sort)대로, 분야 거르개를 골랐으면 그 분야만.
 * 상한은 허브 상황 카드 상한 설정(hub_situation_limit — 초기값 4)을 같이 쓴다 [확인 필요 — 설계 12장 #20]
 */
async function emptySituations(section: SectionKey | null, limit: number): Promise<SituationCard[]> {
  let q = publicDb().from("situations").select(SITUATION_COLUMNS).order("sort").order("id").limit(limit);
  if (section) q = q.eq("section", section);
  const rows = await rowsOf<SituationRow>(q, "검색 결과 없음 상황 카드");
  return rows.flatMap((r) => toSituationCard(r) ?? []);
}

/** 검색 화면 — 기능 키 search가 꺼져 있으면 null(화면 404 — 링크도 0). 공개 데이터를 읽지 못하면 PublicDataError(readPublic이 닫힌 화면으로) */
export async function getSearchPage(requested: SearchOptions, now: Date = new Date()): Promise<SearchPageData | null> {
  const settings = await readPublicSettings();
  if (!settings.features.search) return null;
  const options = screenOptions(requested);
  const searching = queryTerms(options.q).terms.length > 0;
  const [result, regions] = await Promise.all([
    searching ? searchSite(options, options.tab === "all" ? { perKind: SEARCH_SCREEN.allPerKind } : {}) : Promise.resolve(null),
    readRegions(),
  ]);
  const empty = result !== null && Object.values(result.counts).every((n) => n === 0);
  return {
    options,
    result,
    chips: settings.searchChips,
    situations: empty ? await emptySituations(options.section, settings.hubSituationLimit) : [],
    regions,
    today: isoToKstDate(now.toISOString()),
    confirmStage: settings.confirmStage,
  };
}
