import Link from "next/link";
import type { Metadata } from "next";
import { Chip, SelectField } from "@ltr/ui";
import { AssignmentForm } from "@/components/admin/AssignmentForm";
import { AssignmentStatusControl } from "@/components/admin/AssignmentStatusControl";
import { EmptyNote, OUTLINE_BUTTON, PageTitle, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { assignmentFormFrom, groupByDueMonth } from "@/lib/admin/assignment-form";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { ARTICLE_STATUS_LABELS, ASSIGNMENT_STATUS_LABELS, EDITORIAL_FIELD_LABELS, REPORTING_METHOD_LABELS, SECTION_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { templatesFor } from "@/lib/admin/templates";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { articlesForAssignments, listAssignments, listStaffPeople } from "@/lib/server/admin/queries";
import { serviceDb } from "@/lib/server/articles/service";

// 기사 기획 캘린더 (/admin/stories, NAV-09) — 분야·상태로 거르고 마감 달별로 본다. 등록·고치기·상태 바꾸기·이 기획으로 기사 쓰기
export const metadata: Metadata = { title: "기사 기획" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS_TONE: Record<string, "navy" | "emerald" | "amber"> = { published: "emerald", held: "amber" };

export default async function AssignmentsPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "assignment.read");
  const sp = await searchParams;
  const status = Object.hasOwn(ASSIGNMENT_STATUS_LABELS, queryValue(sp.status)) ? queryValue(sp.status) : "";
  const section = Object.hasOwn(SECTION_LABELS, queryValue(sp.section)) ? queryValue(sp.section) : "";

  const db = serviceDb();
  const [rows, people] = await Promise.all([listAssignments(db, { status, section }), listStaffPeople(db)]);
  const linked = await articlesForAssignments(
    db,
    rows.map((r) => r.id),
  );
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const canCreate = can(viewer, "assignment.create");
  const canUpdate = can(viewer, "assignment.update");
  const canWrite = templatesFor(viewer).length > 0;
  const groups = groupByDueMonth(rows);

  return (
    <>
      <PageTitle title="기사 기획" description="분야별 기획을 마감 순서로 봅니다. 상태 순서는 아이디어 → 배정 → 취재 중 → 사실 확인 → 검토 → 발행입니다." />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-navy-100 bg-white p-4" aria-label="기획 거르기">
        <div className="w-full sm:w-48">
          <SelectField id="filter-section" name="section" label="분야" options={optionsOf(SECTION_LABELS)} placeholder="전체" defaultValue={section} />
        </div>
        <div className="w-full sm:w-48">
          <SelectField id="filter-status" name="status" label="상태" options={optionsOf(ASSIGNMENT_STATUS_LABELS)} placeholder="전체" defaultValue={status} />
        </div>
        <button type="submit" className={OUTLINE_BUTTON}>
          보기
        </button>
      </form>

      {canCreate && (
        <details className="mb-8 rounded-2xl border border-navy-100 bg-white p-6">
          <summary className="min-h-11 cursor-pointer text-[19px] font-black text-navy-900">새 기획 등록</summary>
          <AssignmentForm mode="create" people={people} />
        </details>
      )}

      {groups.length === 0 && <EmptyNote>조건에 맞는 기획이 없습니다.</EmptyNote>}
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`month-${g.key}`} className="mb-10">
          <h2 id={`month-${g.key}`} className="mb-3 text-[19px] font-black text-navy-900">
            {g.label} <span className="font-mono text-[15px] text-navy-600">{g.items.length}건</span>
          </h2>
          <ul className="space-y-4">
            {g.items.map((a) => {
              const articles = linked.filter((x) => x.story_assignment_id === a.id);
              return (
                <li key={a.id} data-testid={`assignment-${a.id}`}>
                  <article aria-labelledby={`asg-title-${a.id}`} className="rounded-2xl border border-navy-100 bg-white p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>{labelOf(SECTION_LABELS, a.section)}</Chip>
                      <ToneChip tone={STATUS_TONE[a.status] ?? "navy"}>
                        <span className="sr-only">상태 </span>
                        <span data-testid="assignment-status">{labelOf(ASSIGNMENT_STATUS_LABELS, a.status)}</span>
                      </ToneChip>
                      {a.method && <ToneChip tone="plain">{labelOf(REPORTING_METHOD_LABELS, a.method)}</ToneChip>}
                      <span className="font-mono text-[13px] text-navy-600">기획 {a.id}</span>
                    </div>
                    <h3 id={`asg-title-${a.id}`} className="mt-2 text-[19px] font-black text-navy-900 [overflow-wrap:anywhere]">
                      {a.hypothesis || "가설 없음"}
                    </h3>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-[15px] text-navy-800 sm:grid-cols-2">
                      <Item term="마감" value={isoToKstDate(a.due_at) || "없음"} />
                      <Item term="담당 기자" value={a.reporter_id ? (names[a.reporter_id] ?? `인물 ${a.reporter_id}`) : "없음"} />
                      <Item term="담당 편집자" value={a.editor_id ? (names[a.editor_id] ?? `인물 ${a.editor_id}`) : "없음"} />
                      <Item term="이해관계" value={a.conflicts || "없음 — 적지 않음"} />
                      <Item term="공익성" value={a.public_interest || "없음"} />
                      <Item term="전문 분야 관련성" value={a.relevance || "없음"} />
                      {a.region_code && <Item term="지역" value={`${a.region_code} · ${labelOf(EDITORIAL_FIELD_LABELS, a.editorial_field)}`} />}
                      {a.status === "held" && <Item term="반려 사유" value={a.reject_reason || "없음"} />}
                    </dl>
                    {a.plan && <p className="mt-2 text-[15px] text-navy-700 [overflow-wrap:anywhere]">취재 계획: {a.plan}</p>}
                    {articles.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[14px] font-bold text-navy-600">이 기획의 기사</p>
                        <ul>
                          {articles.map((x) => (
                            <li key={x.id}>
                              <Link href={`/admin/articles/${x.id}`} className={TEXT_LINK}>
                                {x.title}
                              </Link>{" "}
                              <span className="text-[14px] text-navy-600">({labelOf(ARTICLE_STATUS_LABELS, x.status)})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {canUpdate && <AssignmentStatusControl assignmentId={a.id} status={a.status} />}
                      <div className="space-y-2">
                        {canWrite && a.status !== "published" && a.status !== "held" && (
                          <Link href={`/admin/articles/new?assignment=${a.id}`} className={TEXT_LINK}>
                            이 기획으로 기사 쓰기
                          </Link>
                        )}
                        {canUpdate && (
                          <details>
                            <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">기획 고치기</summary>
                            <AssignmentForm mode="patch" assignmentId={a.id} initial={assignmentFormFrom(a)} people={people} />
                          </details>
                        )}
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 font-bold text-navy-600">{term}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
