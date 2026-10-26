// 가이드 배치 관리 입력 규칙 (W11-c c1 - /admin/guides 배치 등록). 순수 모듈 - DB 트리거(마이그레이션 118)가 같은 규칙을 한 번 더 건다.
// 오류 문장은 "칸: 문장" 모양이다. 원고 칸은 받지 않는다 - 배치는 어느 화면에 어느 가이드를 붙일지만 정한다.
import { PLACEMENT_SURFACES, type PlacementSurface } from "./placements";

export const PLACEMENT_OPS = ["add", "remove"] as const;
export type PlacementOp = (typeof PLACEMENT_OPS)[number];

export interface PlacementInput {
  op: PlacementOp;
  guideId: number;
  surface: PlacementSurface;
  targetKey: string;
  sort: number;
}
export type ParsedPlacement = { ok: true; value: PlacementInput } | { ok: false; errors: string[] };

const TARGET = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export function parsePlacement(body: Record<string, unknown>): ParsedPlacement {
  const errors: string[] = [];
  const op = str(body.op);
  if (!(PLACEMENT_OPS as readonly string[]).includes(op)) errors.push(`op: ${PLACEMENT_OPS.join("·")} 중 하나입니다`);
  const guideId = int(body.guide_id);
  if (guideId === null || guideId < 1) errors.push("guide_id: 가이드 번호(1 이상 정수)가 필요합니다");
  const surface = str(body.surface);
  if (!(PLACEMENT_SURFACES as readonly string[]).includes(surface)) errors.push(`surface: ${PLACEMENT_SURFACES.join("·")} 중 하나입니다`);
  const targetKey = str(body.target_key);
  if (targetKey.length === 0 || targetKey.length > 100 || !TARGET.test(targetKey)) errors.push("target_key: 영문 소문자·숫자와 줄표(-)·밑줄(_)로 100자 이하입니다");
  const sortRaw = body.sort === undefined || body.sort === "" ? 0 : int(body.sort);
  if (sortRaw === null || sortRaw > 1000) errors.push("sort: 0~1000 정수입니다");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { op: op as PlacementOp, guideId: guideId as number, surface: surface as PlacementSurface, targetKey, sort: sortRaw as number } };
}
