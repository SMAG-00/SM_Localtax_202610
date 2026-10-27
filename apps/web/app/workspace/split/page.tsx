import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SplitView, type SplitPanelData } from "@/components/site/SplitView";
import { parseActive, parsePanels, parseWidths, type PanelSpec } from "@/lib/law/split";
import { getViewer } from "@/lib/server/dal";
import { currentUserId, rateGate, readItem } from "@/lib/server/library/read";
import { loadPublicPanel } from "@/lib/server/public/law-v2";
import { readPublicSettings } from "@/lib/server/public/reads";
import { adminClient } from "@/lib/server/supabase";
import { listNotes } from "@/lib/server/workspace/store";

// 분할 화면 (/workspace/split?p=law:1:11,case:55&a=0&w=50-50 - LAW-07). 기능 키 law_split 꺼짐이면 404.
// 패널 구성은 주소에만 있고, 내용은 요청마다 받는 사람의 권한으로 다시 읽는다 (공유 주소 권한 재판정).
export const metadata: Metadata = { title: "분할 화면", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function panelData(spec: PanelSpec, userId: string | null): Promise<SplitPanelData> {
  const base = { spec, status: "not_found" as const, title: "", text: "", href: null, locked: false };
  if (spec.kind === "law" || spec.kind === "case") {
    const c = await loadPublicPanel(spec).catch(() => null);
    return c && c.status === "ok" ? { ...base, status: "ok", title: c.title, text: c.text, href: c.href } : base;
  }
  if (spec.kind === "node") {
    // 지식창고 본문은 library_read 한 곳으로만 받는다 - 비구독자는 미리보기만, 전문이 아니면 잠금 표시
    if ((await rateGate(userId)) !== "ok") return { ...base, status: "denied" };
    const r = await readItem("node", spec.id, userId);
    if (r.status === "ok") return { ...base, status: "ok", title: r.title, text: r.text, href: `/library/wiki/${spec.id}`, locked: !r.full };
    return r.status === "not_found" ? base : { ...base, status: "denied" };
  }
  // 내 메모 - 본인 것만. 남의 번호거나 로그인하지 않았으면 열 수 없음
  const db = adminClient();
  if (!userId || !db) return { ...base, status: "denied" };
  const notes = await listNotes(db, userId).catch(() => []);
  const note = notes.find((x) => Number(x.id) === spec.id);
  return note ? { ...base, status: "ok", title: note.title ?? "메모", text: note.body, href: null } : { ...base, status: "denied" };
}

export default async function SplitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (!(await readPublicSettings()).features.law_split) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const specs = parsePanels(one(sp.p));
  const viewer = await getViewer().catch(() => null);
  const userId = viewer?.userId ?? (await currentUserId().catch(() => null));
  const panels = await Promise.all(specs.map((s) => panelData(s, userId)));
  return (
    <main id="main" className="mx-auto w-full max-w-[1600px] px-4 py-8">
      <h1 className="text-[26px] font-black text-navy-900">분할 화면</h1>
      <div className="mt-4">
        <SplitView panels={panels} active={parseActive(one(sp.a), panels.length)} widths={parseWidths(one(sp.w), panels.length)} />
      </div>
    </main>
  );
}
