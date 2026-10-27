import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ACCOUNT_RELATION_LABELS, ACCOUNT_TARGET_LABELS, accountList, isAccountCode } from "@/lib/law/accounts";
import { getAccountMappings } from "@/lib/server/public/law-v2";

// 계정과목 연결 (/workspace/accounts - LINK-02). 감수 서명된 매핑만. 계정과목 → 대상, 대상 → 계정과목 양방향.
// 회계기준은 이름과 조항 번호만 보인다(본문 0). 기능 키 account_links 꺼짐이면 404.
export const metadata: Metadata = { title: "계정과목 연결", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const rows = await getAccountMappings();
  if (rows === null) notFound();
  const sp = await searchParams;
  const code = typeof sp.account === "string" && isAccountCode(sp.account) ? sp.account : null;
  const accounts = accountList(rows);
  const selected = code ? rows.filter((r) => r.account_code === code) : [];
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">계정과목 연결</h1>
      {accounts.length === 0 ? (
        <p data-part="accounts-empty" className="mt-6 text-[15px] text-navy-700">공개된 연결이 아직 없습니다.</p>
      ) : (
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="계정과목">
          {accounts.map((a) => (
            <li key={a.code}>
              <Link href={`/workspace/accounts?account=${a.code}`} aria-current={a.code === code ? "true" : undefined} className={`rounded-full px-3 py-1 text-[14px] font-bold ${a.code === code ? "bg-navy-900 text-white" : "border border-navy-200"}`}>
                {a.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {code && (
        <ul data-part="mapping-list" className="mt-6 space-y-3">
          {selected.length === 0 && <li className="text-[15px] text-navy-700">이 계정과목에 공개된 연결이 없습니다.</li>}
          {selected.map((r) => (
            <li key={r.id} className="rounded-xl border border-navy-100 p-3 text-[14px]">
              <p className="font-bold text-navy-900">
                {ACCOUNT_TARGET_LABELS[r.target_type]} · {ACCOUNT_RELATION_LABELS[r.relation] ?? r.relation}
              </p>
              <p className="mt-1 text-navy-700">
                {r.target_type === "legal_doc" ? <Link href={`/workspace/split?p=case:${r.target_id}`} className="underline underline-offset-4">결정례 {r.target_id}</Link> : r.target_type === "pub_node" ? <Link href={`/library/wiki/${r.target_id}`} className="underline underline-offset-4">지식창고 {r.target_id}</Link> : <>법령 {r.target_id} 제{r.target_article_no}조{r.target_branch_no ? `의${r.target_branch_no}` : ""}</>}
              </p>
              {r.std_ref && <p className="mt-1 text-navy-600">회계기준 참조: {r.std_ref}</p>}
              <p className="mt-1 font-mono text-[12px] text-navy-600">버전 {r.version} · 감수 서명 {r.signed_at?.slice(0, 10)}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
