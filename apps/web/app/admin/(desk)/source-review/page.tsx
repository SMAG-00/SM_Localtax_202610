import type { Metadata } from "next";
import { RefetchForm, ResolveForm } from "@/components/admin/SourceReviewControls";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDate, isoToKstDateTime } from "@/lib/admin/form-utils";
import { REASON_LABELS, expiresOn, expiryDaysOf, type SourceReviewReason } from "@/lib/source-review/rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 원문 검수 (/admin/source-review, PRD-01B REG1-13 · W4 6단계) — 편집 책임자·관리자(source_review.resolve).
//  · 원문 다시 받기(수동): 출처 번호를 적으면 서버가 원문 주소에서 한 번 받거나(또는 붙여 넣은 원문) 해시를 비교한다 — 같은 주소를 쓴 공식 자료마다 해시가 다르면 1건
//  · 시점 만료: 배치(source-expiry, 매일 한국 00시대)가 확인일부터 기준 일수를 넘긴 공식 자료를 올린다
//  · 열린 항목이 있는 출처는 공개 기사 화면에 '검토 중'. 해결하면 다음 요청부터 사라진다
export const metadata: Metadata = { title: "원문 검수" };
export const dynamic = "force-dynamic";

interface QueueRow {
  id: number;
  target_type: string;
  target_id: number;
  article_id: number | null;
  reason: SourceReviewReason;
  old_hash: string | null;
  new_hash: string | null;
  basis_on: string | null;
  run_key: string | null;
  status: string;
  opened_at: string;
  opened_by: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}
interface SourceRow {
  id: number;
  title: string | null;
  source_name: string | null;
  source_url: string | null;
  last_verified_at: string | null;
}
interface ArticleRow {
  id: number;
  title: string;
  slug: string;
  status: string;
}

const COLUMNS = "id, target_type, target_id, article_id, reason, old_hash, new_hash, basis_on, run_key, status, opened_at, opened_by, resolved_by, resolved_at, resolution_note";
const short = (hash: string | null) => (hash ? hash.replace(/^sha256:/, "").slice(0, 12) : "—");

export default async function SourceReviewPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "source_review.resolve");
  const db = serviceDb();
  const [open, done, setting] = await Promise.all([
    db.from("source_review_queue").select(COLUMNS).eq("status", "open").order("opened_at").order("id"),
    db.from("source_review_queue").select(COLUMNS).eq("status", "resolved").order("resolved_at", { ascending: false }).limit(20),
    db.from("settings").select("value").eq("key", "official_source_expiry_days").limit(1),
  ]);
  if (open.error) throw dbError(open.error, "source_review_queue 열린 항목");
  if (done.error) throw dbError(done.error, "source_review_queue 해결 항목");
  if (setting.error) throw dbError(setting.error, "settings 만료 기준");
  const openRows = (open.data ?? []) as QueueRow[];
  const doneRows = (done.data ?? []) as QueueRow[];
  const days = expiryDaysOf(setting.data?.[0]?.value);

  const sourceIds = [...new Set([...openRows, ...doneRows].filter((r) => r.target_type === "article_source").map((r) => Number(r.target_id)))];
  const articleIds = [...new Set([...openRows, ...doneRows].flatMap((r) => (r.article_id === null ? [] : [Number(r.article_id)])))];
  const [sources, articles, newer] = await Promise.all([
    sourceIds.length ? db.from("article_sources").select("id, title, source_name, source_url, last_verified_at").in("id", sourceIds) : Promise.resolve({ data: [], error: null }),
    articleIds.length ? db.from("articles").select("id, title, slug, status").in("id", articleIds) : Promise.resolve({ data: [], error: null }),
    sourceIds.length ? db.from("article_sources").select("supersedes_id").in("supersedes_id", sourceIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (sources.error) throw dbError(sources.error, "article_sources");
  if (articles.error) throw dbError(articles.error, "articles");
  if (newer.error) throw dbError(newer.error, "article_sources 새 버전");
  const sourceMap = new Map(((sources.data ?? []) as SourceRow[]).map((s) => [Number(s.id), s]));
  const articleMap = new Map(((articles.data ?? []) as ArticleRow[]).map((a) => [Number(a.id), a]));
  const superseded = new Set(((newer.data ?? []) as { supersedes_id: number }[]).map((r) => Number(r.supersedes_id)));

  const describe = (r: QueueRow) => {
    const s = sourceMap.get(Number(r.target_id));
    const a = r.article_id === null ? undefined : articleMap.get(Number(r.article_id));
    return { s, a, sourceName: s ? (s.title ?? s.source_name ?? `src:${r.target_id}`) : `src:${r.target_id}` };
  };

  return (
    <>
      <PageTitle
        title="원문 검수"
        description={`공식 자료의 원문이 바뀌었거나 확인일부터 ${days}일을 넘긴 자료입니다. 열린 항목이 있는 출처는 공개 기사 화면에 '검토 중'으로 보입니다.`}
      />
      <div className="space-y-8">
        <Panel id="refetch" title="원문 다시 받기" description="같은 원문 주소를 쓴 모든 기사의 공식 자료를 함께 비교합니다. 해시가 같으면 항목을 만들지 않습니다.">
          <RefetchForm />
        </Panel>

        <Panel id="open-items" title={`열린 항목 ${openRows.length}건`}>
          {openRows.length === 0 ? (
            <EmptyNote>열린 검수 항목이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="source-review-open">
              {openRows.map((r) => {
                const { s, a, sourceName } = describe(r);
                return (
                  <li key={r.id} data-queue-id={r.id} data-source-id={r.target_id} data-reason={r.reason} className="rounded-xl border border-navy-100 p-4">
                    <p className="text-[15px] font-bold text-navy-900">
                      <ToneChip tone={r.reason === "snapshot_changed" ? "rose" : "amber"}>{REASON_LABELS[r.reason] ?? r.reason}</ToneChip> <span className={MONO}>src:{r.target_id}</span> {sourceName}
                      {superseded.has(Number(r.target_id)) && <span className="ml-2 text-[14px] font-normal text-navy-600">(새 버전으로 대체됨 — 해결만 하면 됩니다)</span>}
                    </p>
                    <p className="mt-1 text-[14px] text-navy-700">
                      기사{" "}
                      {a ? (
                        <a className={TEXT_LINK} href={`/admin/articles/${a.id}`}>
                          {a.title}
                        </a>
                      ) : (
                        `#${r.article_id ?? "—"}`
                      )}
                      {s?.source_url && (
                        <>
                          {" · "}
                          <a className={TEXT_LINK} href={s.source_url} target="_blank" rel="noopener noreferrer">
                            원문 주소 (새 창)
                          </a>
                        </>
                      )}
                    </p>
                    <p className={`${MONO} mt-1 text-navy-600`}>
                      {r.reason === "snapshot_changed"
                        ? `옛 해시 ${short(r.old_hash)} → 새 해시 ${short(r.new_hash)} · 연 날 ${isoToKstDateTime(r.opened_at)}`
                        : `확인일 ${r.basis_on ?? "—"} · 만료 ${r.basis_on ? expiresOn(`${r.basis_on}T00:00:00+09:00`, days) : "—"} · 실행 ${r.run_key ?? "—"}`}
                    </p>
                    <ResolveForm id={Number(r.id)} reason={superseded.has(Number(r.target_id)) ? "snapshot_changed" : r.reason} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel id="resolved-items" title="최근 해결 20건">
          {doneRows.length === 0 ? (
            <EmptyNote>해결한 항목이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-2 text-[14px] text-navy-800" data-testid="source-review-resolved">
              {doneRows.map((r) => {
                const { sourceName } = describe(r);
                return (
                  <li key={r.id} data-queue-id={r.id}>
                    <span className={MONO}>{isoToKstDate(r.resolved_at)}</span> {REASON_LABELS[r.reason] ?? r.reason} · <span className={MONO}>src:{r.target_id}</span> {sourceName}
                    {r.resolution_note && <span className="text-navy-600">{` · ${r.resolution_note}`}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
