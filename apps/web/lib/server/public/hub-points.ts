import "server-only";
import type { HubPointSection } from "@/lib/admin/hub-point-rules";
import { publicDb, rowsOf } from "./db";
import { HUB_POINT_COLUMNS, hubTaxPoints, type HubPointRow, type HubTaxPoint } from "./hub-point-logic";
import type { SectionKey } from "./constants";

// 허브 "이 분야의 지방세 포인트" 읽기 (01B CORE-02 · W3 9단계 — 설계 4장 getHubTaxPoint) — 공개 뷰(서명 분야만)를 anon으로 읽는다.
// 감수 전 분야는 뷰에 행이 없어 null → 블록째 숨김. 편집국 쓰기(/api/admin/hub-points)가 공개 데이터 캐시를 바로 만료한다.

export type { HubTaxPoint } from "./hub-point-logic";

export async function readHubTaxPoints(): Promise<Partial<Record<HubPointSection, HubTaxPoint>>> {
  return hubTaxPoints(await rowsOf<HubPointRow>(publicDb().from("public_hub_tax_points").select(HUB_POINT_COLUMNS), "허브 지방세 포인트"));
}

/** 한 분야 — 지방세 허브는 포인트 블록이 없다(늘 null) */
export async function getHubTaxPoint(section: SectionKey): Promise<HubTaxPoint | null> {
  if (section === "tax") return null;
  return (await readHubTaxPoints())[section] ?? null;
}
