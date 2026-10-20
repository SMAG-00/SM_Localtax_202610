import type { ReactNode } from "react";
import Link from "next/link";
import { Eyebrow } from "@ltr/ui";
import { policyDoc } from "@/lib/policy/docs";
import { maskEmailForDisplay } from "@/lib/policy/email";
import { MARKDOWN_LINK, isOpenPath, type Features } from "@/lib/server/public/constants";
import type { PolicyView } from "@/lib/server/public/policy";

// 정책 페이지 공통 틀 (W2-e 6.1) — 아이브로 · 제목 · 게시본 본문 절들 · 게시일·시행일·개정 이력. 본문은 조각만 그린다(HTML 직접 입력 0).
//  · 모든 글은 이메일 가림 표기를 지난다(2.7). [글](주소)는 isOpenPath를 지난 사이트 안 주소만 링크, 나머지는 글자만

const kstDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : "");

function Inline({ text, features }: { text: string; features: Features }): ReactNode {
  const masked = maskEmailForDisplay(text);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of masked.matchAll(new RegExp(MARKDOWN_LINK.source, "g"))) {
    out.push(masked.slice(last, m.index));
    const href = m[2]!;
    out.push(href.startsWith("/") && !href.startsWith("//") && isOpenPath(href, features) ? <Link key={m.index} href={href} className="font-bold underline underline-offset-4">{m[1]}</Link> : m[1]);
    last = m.index! + m[0].length;
  }
  out.push(masked.slice(last));
  return <>{out}</>;
}

export function PolicyPage({ view, children }: { view: PolicyView; children?: ReactNode }) {
  const doc = policyDoc(view.docKey);
  const f = view.features;
  return (
    <article data-ui="policy-page" data-doc={doc.key} data-version={view.version} className="mx-auto max-w-3xl px-4 py-16">
      <Eyebrow>{doc.label}</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">{doc.label}</h1>
      {!view.current && (
        <p role="status" data-part="old-version" className="mt-4 rounded-xl border border-navy-100 bg-white px-4 py-3 text-[15px] font-bold text-navy-900">
          {`이전 판(버전 ${view.version})입니다. `}
          <Link href={doc.href} className="underline underline-offset-4">
            현재 판 보기
          </Link>
        </p>
      )}
      <div className="mt-8 space-y-8 text-[17px] leading-relaxed text-navy-800">
        {view.body.map((s, i) => (
          <section key={i}>
            {s.heading && <h2 className="text-[22px] font-black text-navy-900">{maskEmailForDisplay(s.heading)}</h2>}
            <div className="mt-3 space-y-3">
              {s.blocks.map((b, j) =>
                b.type === "list" ? (
                  <ul key={j} className="list-disc space-y-1 pl-6">
                    {b.items.map((it, k) => (
                      <li key={k}>
                        <Inline text={it} features={f} />
                      </li>
                    ))}
                  </ul>
                ) : b.type === "callout" ? (
                  <p key={j} className="rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 font-bold text-navy-900">
                    <Inline text={b.text} features={f} />
                  </p>
                ) : (
                  <p key={j}>
                    <Inline text={b.text} features={f} />
                  </p>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      {children}
      <footer data-part="revisions" className="mt-12 border-t border-navy-100 pt-6 font-mono text-[14px] text-navy-700">
        <p>
          게시일 {kstDate(view.publishedAt)}
          {view.effectiveOn ? ` · 시행일 ${view.effectiveOn}` : ""}
        </p>
        {view.history.length > 1 && (
          <>
            <h2 className="mt-4 font-sans text-[16px] font-black text-navy-900">개정 이력</h2>
            <ul className="mt-2 space-y-1">
              {view.history.map((h) => (
                <li key={h.version}>
                  <Link href={h.status === "published" ? doc.href : `${doc.href}?v=${h.version}`} className="underline underline-offset-4">
                    버전 {h.version}
                  </Link>{" "}
                  · {kstDate(h.publishedAt)}
                  {h.effectiveOn ? ` · 시행 ${h.effectiveOn}` : ""}
                  {h.changeSummary ? ` · ${maskEmailForDisplay(h.changeSummary)}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </footer>
    </article>
  );
}
