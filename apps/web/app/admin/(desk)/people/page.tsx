import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { PersonAccountLink, PersonCreateForm } from "@/components/admin/PeopleControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { EMPLOYMENT_LABELS, PERSON_ROLE_LABELS, PERSON_VISIBILITY_LABELS } from "@/lib/admin/people-rules";
import { labelOf } from "@/lib/admin/labels";
import { listMembers } from "@/lib/server/admin/members";
import { listPeople } from "@/lib/server/admin/people-store";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 기자·기고자 등록부 (/admin/people, F2 · NAV-19) — 관리자만. 인물을 등록하고 편집국 계정에 잇는다(한 계정에 인물 하나).
// 계정에 인물이 연결되어야 그 계정이 기사를 만들 수 있다. 약력·동의서는 /admin/brand에서 다룬다.
export const metadata: Metadata = { title: "기자·기고자 등록부" };

export default async function PeoplePage() {
  const viewer = await pageViewer();
  requirePage(viewer, "people.manage");
  const db = serviceDb();
  const [people, members] = await Promise.all([listPeople(db), listMembers(db, null)]);
  // 연결되지 않은 계정 + 이미 연결된 계정(이메일 표시용)
  const accounts = members.map((m) => ({ userId: m.userId, email: m.email }));
  const linkedIds = new Set(people.map((p) => p.staff_user_id).filter((x): x is string => x !== null));
  const free = accounts.filter((a) => !linkedIds.has(a.userId));

  return (
    <>
      <PageTitle title="기자·기고자 등록부" description="기자·편집자·필자·감수자·전문가를 등록하고 편집국 계정에 연결합니다. 모든 변경은 감사 기록에 남습니다." />
      <Callout className="mb-6">
        계정에 인물이 연결되어야 그 계정으로 기사를 만들 수 있습니다. 한 계정에는 인물 하나만 연결됩니다. 약력·동의서는 브랜드 관리 화면에서 다룹니다.
      </Callout>
      <Panel id="person-new" title="인물 등록" className="mb-8">
        <PersonCreateForm />
      </Panel>
      {people.length === 0 && <EmptyNote>등록된 인물이 없습니다.</EmptyNote>}
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="people-list">
        {people.map((p) => (
          <li key={p.id} data-testid={`person-${p.id}`} data-slug={p.slug} className="min-w-0 rounded-2xl border border-navy-100 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-navy-600 ${MONO}`}>번호 {p.id}</span>
              <ToneChip tone={p.visibility === "public" ? "emerald" : "plain"}>{labelOf(PERSON_VISIBILITY_LABELS, p.visibility)}</ToneChip>
              {p.employment && <ToneChip tone="plain">{labelOf(EMPLOYMENT_LABELS, p.employment)}</ToneChip>}
            </div>
            <p className="mt-2 text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">{p.name}</p>
            <p className={`text-navy-600 [overflow-wrap:anywhere] ${MONO}`}>{p.slug}</p>
            <dl className="mt-2 space-y-1 text-[14px] text-navy-800">
              <Row term="역할" value={p.roles.map((r) => labelOf(PERSON_ROLE_LABELS, r)).join("·")} />
              <Row term="소속" value={p.affiliation} />
              <Row term="담당" value={p.beat} />
              <Row term="이해관계" value={p.conflicts} />
            </dl>
            <div className="mt-3">
              <PersonAccountLink id={p.id} name={p.name} linkedUserId={p.staff_user_id} accounts={p.staff_user_id ? accounts : free} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Row({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 font-bold text-navy-600">{term}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value || "없음"}</dd>
    </div>
  );
}
