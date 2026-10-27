import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { paywalledArticle, toJsonLdScriptContent } from "@ltr/structured-data";
import { JsonLd } from "@/components/site/JsonLd";
import { LibraryGate, LibraryLimited, LibraryText } from "@/components/site/LibraryViews";
import { PAYWALL_SELECTOR } from "@/lib/server/billing/paywall-logic";
import { siteUrl } from "@/lib/server/env";
import { currentUserId, getEditionsOf, getNode, getNodeRefs, getNodeSiblings, rateGate, readItem } from "@/lib/server/library/read";
import { pageTitle } from "@/lib/site/hub-view";

// 실무·편람 위키 노드 (/library/wiki/[node] - W13-a a5, LIB-02·04·06). 요청마다 그린다(공유 캐시 0).
//  · 판차·기준일을 고정폭으로 표시하고, 최신판이 아니면 안내를 둔다. 같은 위치의 다른 판은 연혁 목록으로 연다.
//  · 본문은 library_read가 자른 값만. 메타 설명·구조화 데이터에는 제목만 쓴다.
export const dynamic = "force-dynamic";

const idOf = (v: string): number | null => (/^\d{1,12}$/.test(v) && Number(v) >= 1 ? Number(v) : null);

export async function generateMetadata({ params }: { params: Promise<{ node: string }> }): Promise<Metadata> {
  const id = idOf((await params).node);
  const node = id === null ? null : await getNode(id);
  return { title: pageTitle(node ? node.title : "지식창고"), robots: { index: false, follow: false } };
}

export default async function WikiNodePage({ params }: { params: Promise<{ node: string }> }) {
  await connection();
  const id = idOf((await params).node);
  if (id === null) notFound();
  const node = await getNode(id);
  if (!node) notFound();
  const userId = await currentUserId();
  if ((await rateGate(userId)) !== "ok") return <LibraryLimited />;
  const [r, children, editions, refs] = await Promise.all([readItem("node", node.id, userId), getNodeSiblings(node), getEditionsOf(node), getNodeRefs(node.id)]);
  const history = editions.filter((e) => e.id !== node.id);
  const base = siteUrl();
  return (
    <main data-ui="library-wiki" className="mx-auto max-w-3xl px-4 py-16">
      {r.status === "ok" && !r.full ? (
        <JsonLd
          part="library-jsonld"
          content={toJsonLdScriptContent(paywalledArticle({ ...(base ? { url: `${base}/library/wiki/${node.id}` } : {}), title: node.title, paywallSelector: PAYWALL_SELECTOR }))}
        />
      ) : null}
      <p className="font-mono text-[15px] text-navy-700" data-part="library-edition">
        {node.publication_title} · {node.edition_label} · 기준일 {node.as_of}
      </p>
      <h1 className="mt-2 text-[32px] leading-tight font-black tracking-tight text-navy-900">{node.title}</h1>
      {!node.is_latest ? (
        <p data-part="library-old-edition" className="mt-2 text-[15px] text-navy-800">
          최신판이 아닌 판입니다. 아래 연혁에서 다른 판을 볼 수 있습니다.
        </p>
      ) : null}
      <div className="mt-8">
        {r.status === "ok" ? (
          <>
            <LibraryText text={r.text} asOf={node.as_of} part={r.full ? "library-body" : "library-preview"} watermark={r.full && userId ? `구독자 ${userId.slice(0, 8)}` : null} />
            {!r.full ? <LibraryGate reason={r.reason} /> : null}
          </>
        ) : (
          <p className="text-[16px] text-navy-800">이 항목은 지금 열 수 없습니다.</p>
        )}
      </div>
      {children.length > 0 ? (
        <nav aria-label="하위 항목" data-part="library-children" className="mt-10">
          <h2 className="text-[19px] font-black text-navy-900">하위 항목</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px]">
            {children.map((c) => (
              <li key={c.id}>
                <a href={`/library/wiki/${c.id}`} className="underline underline-offset-2">
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {refs.length > 0 ? (
        <nav aria-label="상호참조" data-part="library-refs" className="mt-10">
          <h2 className="text-[19px] font-black text-navy-900">상호참조</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px]">
            {refs.map((x) => (
              <li key={x.ref_id}>
                <a href={`/library/wiki/${x.ref_id}`} className="underline underline-offset-2">
                  {x.ref_title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {history.length > 0 ? (
        <nav aria-label="판 연혁" data-part="library-history" className="mt-10">
          <h2 className="text-[19px] font-black text-navy-900">판 연혁</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-[15px]">
            {history.map((e) => (
              <li key={e.id}>
                <a href={`/library/wiki/${e.id}`} className="underline underline-offset-2">
                  {e.edition_label} (기준일 {e.as_of})
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
