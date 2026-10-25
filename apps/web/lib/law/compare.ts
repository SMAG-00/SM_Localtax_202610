// 신구조문 대비 (LAW-02) - 두 개정판의 같은 조문을 앵커(블록 id)로 맞춘다. 순수 모듈.
import type { ProvisionBlock } from "./anchors";

export interface CompareRow {
  id: string;
  old: string | null;
  now: string | null;
  status: "same" | "changed" | "added" | "removed";
}

export function compareBlocks(oldBlocks: readonly ProvisionBlock[], newBlocks: readonly ProvisionBlock[]): CompareRow[] {
  const oldById = new Map(oldBlocks.map((b) => [b.id, b.text]));
  const newIds = new Set(newBlocks.map((b) => b.id));
  const rows: CompareRow[] = newBlocks.map((b) => {
    const o = oldById.get(b.id) ?? null;
    return { id: b.id, old: o, now: b.text, status: o === null ? "added" : o === b.text ? "same" : "changed" };
  });
  for (const b of oldBlocks) if (!newIds.has(b.id)) rows.push({ id: b.id, old: b.text, now: null, status: "removed" });
  return rows;
}
