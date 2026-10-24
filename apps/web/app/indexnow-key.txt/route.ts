import { indexingGate } from "@/lib/server/seo/load";
import { closed } from "@/lib/server/seo/respond";

// IndexNow 열쇠 확인 파일 (OPT-01) — IndexNow가 켜져 있고 색인 관문이 열렸고 열쇠가 있을 때만 열쇠 글자를 돌려준다. 그 밖은 404
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!gate.open || gate.settings?.indexnow !== true || !key) return closed();
  return new Response(key, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
