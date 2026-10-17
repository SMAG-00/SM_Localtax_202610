import type { Metadata } from "next";
import { Callout, TextField } from "@ltr/ui";
import { MemberRoles, MemberSuspension } from "@/components/admin/MemberControls";
import { EmptyNote, OUTLINE_BUTTON, PageTitle, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { memberSearchQuery, suspendBlocked } from "@/lib/admin/member-rules";
import { listMembers } from "@/lib/server/admin/members";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 회원·역할 (/admin/members, ADM-02 조회·정지·역할 부여) — 관리자만. 기본은 편집국 계정(역할 또는 인물이 있는 계정),
// 이메일 일부로 찾으면 모든 계정에서 찾는다(처음 역할을 받을 계정). 겸직 금지 조합은 화면이 먼저 막고 사유를 보인다.
export const metadata: Metadata = { title: "회원·역할" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MembersPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "member.read");
  requirePage(viewer, "role.grant");
  const raw = queryValue((await searchParams).q).trim();
  const q = raw === "" ? null : memberSearchQuery(raw);
  const members = raw !== "" && q === null ? [] : await listMembers(serviceDb(), q);

  return (
    <>
      <PageTitle title="회원·역할" description="편집국 계정의 역할을 주고 거두며, 계정을 정지합니다. 모든 변경은 감사 기록에 남습니다." />
      <Callout className="mb-6">편집 책임자(editor)와 편집국 외 역할(광고·협찬·스토어·구독·브랜드 관리·전문가 담당)은 한 사람에게 함께 줄 수 없습니다 (ACC-04).</Callout>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-navy-100 bg-white p-4" aria-label="계정 찾기">
        <div className="w-full sm:w-96">
          <TextField
            id="member-q"
            name="q"
            label="이메일로 찾기"
            hint="2자 이상 — 비우면 편집국 계정만 봅니다"
            defaultValue={raw}
            error={raw !== "" && q === null ? "공백·쉼표 없이 2~100자로 적어 주세요" : undefined}
          />
        </div>
        <button type="submit" className={OUTLINE_BUTTON}>
          찾기
        </button>
      </form>

      <h2 className="mb-3 text-[19px] font-black text-navy-900">
        {q ? `‘${q}’ 검색 결과` : "편집국 계정"} <span className="font-mono text-[15px] text-navy-600">{members.length}명</span>
      </h2>
      {members.length === 0 && <EmptyNote>{q ? "맞는 계정이 없습니다." : "편집국 계정이 없습니다."}</EmptyNote>}
      <ul className="space-y-4">
        {members.map((m) => (
          <li key={m.userId} data-testid={`member-${m.userId}`} className="rounded-2xl border border-navy-100 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="member-email" className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">
                {m.email ?? "이메일 없음"}
              </span>
              {m.isAdmin && <ToneChip tone="navy">관리자</ToneChip>}
              {m.suspended && <ToneChip tone="rose">정지됨</ToneChip>}
              <ToneChip tone="plain">{m.isStaff ? "편집국 계정" : "일반 회원"}</ToneChip>
            </div>
            <p className="mt-1 text-[14px] text-navy-600 [overflow-wrap:anywhere]">
              인물 {m.person ? m.person.name : "연결 안 됨"} · 마지막 로그인 {m.lastSignInAt ? isoToKstDateTime(m.lastSignInAt) : "없음"}
            </p>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <MemberRoles userId={m.userId} email={m.email ?? m.userId} roles={m.roles} />
              <MemberSuspension
                userId={m.userId}
                email={m.email ?? m.userId}
                suspended={m.suspended}
                blockedReason={suspendBlocked({ targetId: m.userId, viewerId: viewer.userId, targetIsAdmin: m.isAdmin })}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
