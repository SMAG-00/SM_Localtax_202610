import Link from "next/link";
import type { Metadata } from "next";
import { SelectField } from "@ltr/ui";
import { DataTable, EmptyNote, OUTLINE_BUTTON, PageTitle, TD, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import {
  ARTICLE_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
  EDITORIAL_STATUS_LABELS,
  REPORTING_METHOD_LABELS,
  SECTION_LABELS,
  TAX_REVIEW_STATUS_LABELS,
  labelOf,
  optionsOf,
} from "@/lib/admin/labels";
import { templatesFor } from "@/lib/admin/templates";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { listArticles } from "@/lib/server/admin/queries";
import { personForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";

// 기사 목록 (/admin/articles) — 게재 상태·분야·기사 유형으로 거른다. 광고·협찬 담당은 광고·협찬 콘텐츠만 본다 (ART-10 · NAV-06)
export const metadata: Metadata = { title: "기사" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS_TONE: Record<string, "navy" | "emerald" | "amber" | "rose"> = { published: "emerald", approved: "emerald", held: "amber", deleted: "rose" };

export default async function ArticlesPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, ["article.read", "sponsored.manage"]);
  const sp = await searchParams;
  const onlySponsored = !can(viewer, "article.read");
  const pick = (v: string, labels: object) => (Object.hasOwn(labels, v) ? v : "");
  const status = pick(queryValue(sp.status), ARTICLE_STATUS_LABELS);
  const section = pick(queryValue(sp.section), SECTION_LABELS);
  const type = onlySponsored ? "sponsored" : pick(queryValue(sp.type), CONTENT_TYPE_LABELS);
  const mine = queryValue(sp.mine) === "1";

  const db = serviceDb();
  const person = mine ? await personForUser(db, viewer.userId) : null;
  const rows = mine && !person ? [] : await listArticles(db, { status, section, type, ...(person ? { authorId: person.id } : {}) });
  const canWrite = templatesFor(viewer).length > 0;

  return (
    <>
      <PageTitle title={onlySponsored ? "광고·협찬 콘텐츠" : mine ? "내 기사" : "기사"} description="최근에 고친 순서입니다.">
        {canWrite && (
          <Link href="/admin/articles/new" className={OUTLINE_BUTTON}>
            새 기사 쓰기
          </Link>
        )}
      </PageTitle>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-navy-100 bg-white p-4" aria-label="기사 거르기">
        <div className="w-full sm:w-44">
          <SelectField id="filter-status" name="status" label="게재 상태" options={optionsOf(ARTICLE_STATUS_LABELS)} placeholder="전체" defaultValue={status} />
        </div>
        <div className="w-full sm:w-44">
          <SelectField id="filter-section" name="section" label="분야" options={optionsOf(SECTION_LABELS)} placeholder="전체" defaultValue={section} />
        </div>
        {!onlySponsored && (
          <div className="w-full sm:w-44">
            <SelectField id="filter-type" name="type" label="기사 유형" options={optionsOf(CONTENT_TYPE_LABELS)} placeholder="전체" defaultValue={type} />
          </div>
        )}
        {mine && <input type="hidden" name="mine" value="1" />}
        <button type="submit" className={OUTLINE_BUTTON}>
          보기
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyNote>조건에 맞는 기사가 없습니다.</EmptyNote>
      ) : (
        <DataTable caption="기사 목록" head={["제목", "분야·유형", "게재 상태", "편집 승인", "세무 감수", "버전", "고친 시각"]}>
          {rows.map((a) => (
            <tr key={a.id} data-testid={`article-row-${a.id}`}>
              <td className={TD}>
                <Link href={`/admin/articles/${a.id}`} className={`${TEXT_LINK} [overflow-wrap:anywhere]`}>
                  {a.title}
                </Link>
              </td>
              <td className={TD}>
                {labelOf(SECTION_LABELS, a.section)} · {labelOf(CONTENT_TYPE_LABELS, a.content_type)}
                {a.reporting_method && ` · ${labelOf(REPORTING_METHOD_LABELS, a.reporting_method)}`}
              </td>
              <td className={TD}>
                <ToneChip tone={STATUS_TONE[a.status] ?? "navy"}>{labelOf(ARTICLE_STATUS_LABELS, a.status)}</ToneChip>
              </td>
              <td className={TD}>{labelOf(EDITORIAL_STATUS_LABELS, a.editorial_status)}</td>
              <td className={TD}>{labelOf(TAX_REVIEW_STATUS_LABELS, a.tax_review_status)}</td>
              <td className={`${TD} font-mono`}>{a.version}</td>
              <td className={`${TD} font-mono text-[13px]`}>{isoToKstDateTime(a.updated_at)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
