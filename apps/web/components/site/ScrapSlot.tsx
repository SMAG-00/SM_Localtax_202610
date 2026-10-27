import { readPublicSettings } from "@/lib/server/public/reads";
import { ScrapButton } from "./ScrapButton";

// 기능 키 workspace가 꺼져 있으면 렌더 0 (W13-c). 켜져 있어도 로그인·권한 판정은 API가 한다.
export async function ScrapSlot({ targetKind, targetId, label }: { targetKind: "law_article" | "legal_doc"; targetId: number; label: string }) {
  const on = await readPublicSettings()
    .then((s) => (s.features as Record<string, boolean>).workspace === true)
    .catch(() => false);
  return on ? <ScrapButton targetKind={targetKind} targetId={targetId} label={label} /> : null;
}
