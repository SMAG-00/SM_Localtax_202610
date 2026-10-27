import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ModeToggle, WorkspaceNav, cardCls, density } from "@/components/workspace/parts";
import { listMySessions } from "@/lib/server/agent/d-store";
import { featureOn } from "@/lib/server/brief/policy";
import { listBriefings, resolveItems } from "@/lib/server/notify/service";
import { preparePage } from "@/lib/server/workspace/page-data";
import { WIDGET_KEYS, listNotes, listScraps, listSearches, readPrefs } from "@/lib/server/workspace/store";

// 워크스페이스 대시보드 (W13-b, WS-02) - 권한이 있으면 위젯, 없으면 둘러보기. 요청마다 그리고 검색에 나오지 않는다.
// 위젯 하나가 실패해도 나머지는 그린다. 맞춤 브리핑 위젯은 W13-d 표가 생기면 더한다(준비 중 위젯 0). 최근 대화는 지방세봇 기능 키가 켜졌을 때만.
export const metadata: Metadata = { title: "워크스페이스", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TITLES: Record<(typeof WIDGET_KEYS)[number], string> = {
  law_changes: "관심 법령 개정",
  search_news: "저장 검색 새 결과",
  recent_notes: "최근 메모",
  recent_chats: "최근 대화",
  briefing: "맞춤 브리핑",
};

function Widget({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section className={`${cardCls} col-span-12 md:col-span-6`} data-testid={`widget-${id}`} aria-labelledby={`w-${id}`}>
      <h2 id={`w-${id}`} className="text-[18px] font-black text-navy-900">
        {TITLES[id as keyof typeof TITLES]}
      </h2>
      {children}
    </section>
  );
}
const Empty = ({ text }: { text: string }) => <p className="mt-2 text-[15px] text-navy-600">{text}</p>;

export default async function WorkspacePage() {
  const { db, userId, access, mode } = await preparePage("/workspace");
  const shell = (body: ReactNode) => (
    <main className={`mx-auto w-full max-w-5xl px-4 py-12 ${density(mode)}`} data-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-black text-navy-900">워크스페이스</h1>
        <ModeToggle mode={mode} />
      </div>
      <WorkspaceNav current="/workspace" />
      {body}
    </main>
  );

  if (access.view !== "full") {
    return shell(
      <section className={`${cardCls} mt-6`} data-testid="workspace-browse">
        <h2 className="text-[18px] font-black text-navy-900">워크스페이스 둘러보기</h2>
        <p className="mt-2 text-[15px] text-navy-700">메모·스크랩·저장 검색·내보내기는 이용 권한이 있는 회원이 새로 만들 수 있습니다. 이전에 만든 자료는 위 메뉴에서 열람하고 내보낼 수 있습니다.</p>
        <p className="mt-3">
          <Link href="/store" className="text-[15px] font-bold text-navy-900 underline">
            요금 안내 보기
          </Link>
        </p>
      </section>,
    );
  }

  const prefs = await readPrefs(db, userId).catch(() => ({ mode, order: [] as string[], hidden: [] as string[] }));
  const chatsOn = await featureOn(db, "taxbot").catch(() => false);
  const briefingOn = await featureOn(db, "my_briefings").catch(() => false);
  const keys = [...WIDGET_KEYS].filter((k) => (k !== "recent_chats" || chatsOn) && (k !== "briefing" || briefingOn) && !prefs.hidden.includes(k));
  keys.sort((a, b) => (prefs.order.indexOf(a) + 1 || 99) - (prefs.order.indexOf(b) + 1 || 99));

  const render = async (key: (typeof WIDGET_KEYS)[number]): Promise<ReactNode> => {
    try {
      if (key === "law_changes") {
        const revised = (await listScraps(db, userId, 100)).filter((s) => s.target_kind === "law_article" && s.revised);
        return revised.length === 0 ? <Empty text="개정된 스크랩이 없습니다" /> : <ul className="mt-2 space-y-1">{revised.slice(0, 5).map((s) => <li key={s.id}>{s.label} <span className="font-bold text-hermes-500">개정됨</span></li>)}</ul>;
      }
      if (key === "search_news") {
        const rows = await listSearches(db, userId, true);
        return rows.length === 0 ? <Empty text="저장한 검색이 없습니다" /> : <ul className="mt-2 space-y-1">{rows.slice(0, 5).map((s) => <li key={s.id}>{s.name} · 새 결과 {s.newCount ?? 0}건</li>)}</ul>;
      }
      if (key === "recent_notes") {
        const rows = await listNotes(db, userId, 5);
        return rows.length === 0 ? <Empty text="아직 메모가 없습니다" /> : <ul className="mt-2 space-y-1">{rows.map((n) => <li key={n.id}>{n.title ?? n.body.slice(0, 40)}</li>)}</ul>;
      }
      if (key === "briefing") {
        const latest = (await listBriefings(db, userId, 1))[0];
        const items = latest ? await resolveItems(db, latest.items) : [];
        return items.length === 0 ? <Empty text="아직 받은 브리핑이 없습니다" /> : <ul className="mt-2 space-y-1">{items.slice(0, 5).map((i) => <li key={`${i.type}-${i.id}`}><Link href={i.link} className="underline">{i.title}</Link> <span className="text-navy-600">기준일 {i.basisOn}</span></li>)}</ul>;
      }
      const sessions = await listMySessions(db, userId, null);
      return sessions.length === 0 ? <Empty text="저장된 대화가 없습니다" /> : <ul className="mt-2 space-y-1">{sessions.slice(0, 5).map((r) => <li key={r.id}>{r.first_question ?? "(저장하지 않은 대화)"}</li>)}</ul>;
    } catch {
      return <Empty text="이 위젯을 지금 불러오지 못했습니다" />;
    }
  };

  const bodies = await Promise.all(keys.map(render));
  return shell(
    <div className="mt-6 grid grid-cols-12 gap-4" data-testid="widget-grid">
      {keys.map((k, i) => (
        <Widget key={k} id={k}>
          {bodies[i]}
        </Widget>
      ))}
    </div>,
  );
}
