import "server-only";
import { cache } from "react";
import { publicDb, rowsOf } from "./db";
import { DESCRIPTION_TITLES, parsePilotRegions } from "./region-index-logic";

// 지역 색인 판정 읽기 (W4 11단계 — 규칙은 region-index-logic.ts). 공개 데이터 함수라 anon 키로만 읽는다:
//  · 뷰 public_region_index(…46 — 사이트맵 원본) — 최소선 이상 + region_hubs 켜짐인 지역만. 지역 허브 noindex 판정·/local '색인 대상' 표시
//  · 설정 pilot_regions — …46의 공개 정책(이 키 한 줄). 행이 없거나 모양이 틀리면 빈 목록(칩 0)
//  · 메타 설명 — 그 지역 코드 하나만 단 최신 자체 취재 기사(지자체뉴스·편집 분야·편집 승인 보도기사) 제목 2건 (12장 #27·#83)
// 판정은 DB가 렌더 때 계산한다 — 임계값 설정을 바꾸면 설정 쓰기 API가 공개 데이터 캐시를 만료해 다음 렌더부터.

/** 그 지역이 색인 대상인가 (사이트맵 원본에 있는가) */
export async function readRegionIndexed(code: string): Promise<boolean> {
  const rows = await rowsOf<{ code: string }>(publicDb().from("public_region_index").select("code").eq("code", code), "지역 색인 판정");
  return rows.length > 0;
}

/** 색인 대상 시·도 코드 (/local 시·도 카드) */
export async function readIndexedSidoCodes(): Promise<Set<string>> {
  const rows = await rowsOf<{ code: string }>(publicDb().from("public_region_index").select("code").eq("level", "sido"), "색인 대상 시·도");
  return new Set(rows.map((r) => r.code));
}

/** 시범 지역 (요청 안에서 한 번) */
export const readPilotRegions = cache(async (): Promise<string[]> => {
  const rows = await rowsOf<{ value: unknown }>(publicDb().from("settings").select("value").eq("key", "pilot_regions"), "시범 지역");
  return parsePilotRegions(rows[0]?.value);
});

/** 메타 설명 재료 — 그 지역 코드 하나만 단 최신 자체 취재 기사 제목 */
export async function readDescriptionTitles(code: string): Promise<string[]> {
  const rows = await rowsOf<{ title: string }>(
    publicDb()
      .from("public_articles")
      .select("title")
      .eq("section", "local")
      .eq("reported_approved", true)
      .not("editorial_field", "is", null)
      .filter("region_codes", "eq", `{${code}}`)
      .order("first_published_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(DESCRIPTION_TITLES),
    "지역 메타 설명",
  );
  return rows.map((r) => r.title);
}
