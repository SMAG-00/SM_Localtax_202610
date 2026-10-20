import type { Metadata } from "next";
import { Callout, TextField } from "@ltr/ui";
import Link from "next/link";
import { MemberDelete, MemberRoles, MemberSuspension } from "@/components/admin/MemberControls";
import { EmptyNote, OUTLINE_BUTTON, PageTitle, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { memberSearchQuery, suspendBlocked } from "@/lib/admin/member-rules";
import { listMembers, listRegularMembers } from "@/lib/server/admin/members";
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
  const sp = await searchParams;
  const tab = queryValue(sp.tab) === "member" ? "member" : "staff";
  const raw = queryValue(sp.q).trim();
  const q = raw === "" ? null : memberSearchQuery(raw);
  const pageNo = Math.max(1, Math.min(10000, Number.parseInt(queryValue(sp.page), 10) || 1));
  const bad = raw !== "" && q === null;
  const members = tab === "staff" && !bad ? await listMembers(serviceDb(), q) : [];
  const regular = tab === "member" && !bad ? await listRegularMembers(serviceDb(), q, pageNo) : { members: [], page: 1, hasNext: false };
  const tabClass = (on: boolean) => `inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-[15px] font-bold ${on ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800"}`;

  return (
    <>
      <PageTitle title="회원·역할" description="편집국 계정의 역할을 주고 거두며, 계정을 정지합니다. 모든 변경은 감사 기록에 남습니다." />
      <Callout className="mb-6">편집 책임자(editor)와 편집국 외 역할(광고·협찬·스토어·구독·브랜드 관리·전문가 담당)은 한 사람에게 함께 줄 수 없습니다 (ACC-04).</Callout>
      <nav aria-label="계정 종류" className="mb-4 flex flex-wrap gap-2">
        <Link href="/admin/members" aria-current={tab === "staff" ? "page" : undefined} className={tabClass(tab === "staff")}>
          편집국 계정
        </Link>
        <Link href="/admin/members?tab=member" aria-current={tab === "member" ? "page" : undefined} className={tabClass(tab === "member")}>
          회원
        </Link>
      </nav>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-navy-100 bg-white p-4" aria-label="계정 찾기">
        {tab === "member" && <input type="hidden" name="tab" value="member" />}
        <div className="w-full sm:w-96">
          <TextField
            id="member-q"
            name="q"
            label="이메일로 찾기"
            hint={tab === "member" ? "2자 이상 — 비우면 가입 최신순 50명" : "2자 이상 — 비우면 편집국 계정만 봅니다"}
            defaultValue={raw}
            error={raw !== "" && q === null ? "공백·쉼표 없이 2~100자로 적어 주세요" : undefined}
          />
        </div>
        <button type="submit" className={OUTLINE_BUTTON}>
          찾기
        </button>
      </form>

      {tab === "member" ? (
        <RegularList data={regular} q={q} viewerId={viewer.userId} />
      ) : (
        <>
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
      )}
    </>
  );
}

const CONSENT_LABEL: Record<string, string> = { receive: "수신", marketing: "마케팅" };

function RegularList({ data, q, viewerId }: { data: Awaited<ReturnType<typeof listRegularMembers>>; q: string | null; viewerId: string }) {
  const href = (page: number) => `/admin/members?tab=member${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page}`;
  return (
    <>
      <h2 className="mb-3 text-[19px] font-black text-navy-900">
        {q ? `‘${q}’ 회원 검색 결과` : "회원"} <span className="font-mono text-[15px] text-navy-600">{data.members.length}명{data.page > 1 || data.hasNext ? ` (${data.page}쪽)` : ""}</span>
      </h2>
      {data.members.length === 0 && <EmptyNote>{q ? "맞는 회원이 없습니다." : "회원이 없습니다."}</EmptyNote>}
      <ul className="space-y-4" aria-label="회원 목록">
        {data.members.map((m) => (
          <li key={m.userId} data-testid={`member-${m.userId}`} className="rounded-2xl border border-navy-100 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="member-email" className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">
                {m.email ?? "이메일 없음"}
              </span>
              {m.isAdmin && <ToneChip tone="navy">관리자</ToneChip>}
              {m.suspended && <ToneChip tone="rose">정지됨</ToneChip>}
            </div>
            <dl data-testid="member-summary" className="mt-2 grid gap-x-6 gap-y-1 text-[14px] text-navy-700 sm:grid-cols-2">
              <div><dt className="inline font-bold">가입일 </dt><dd className="inline">{m.createdAt ? isoToKstDateTime(m.createdAt) : "없음"}</dd></div>
              <div><dt className="inline font-bold">마지막 로그인 </dt><dd className="inline">{m.lastSignInAt ? isoToKstDateTime(m.lastSignInAt) : "없음"}</dd></div>
              <div><dt className="inline font-bold">이메일 확인 </dt><dd className="inline" data-field="confirmed">{m.emailConfirmed ? "확인됨" : "미확인"}</dd></div>
              <div><dt className="inline font-bold">정지 </dt><dd className="inline" data-field="suspended">{m.suspended ? "정지됨" : "아니오"}</dd></div>
              <div><dt className="inline font-bold">관심 분야 </dt><dd className="inline" data-field="interests">{m.interestCount}개</dd></div>
              <div><dt className="inline font-bold">관심 지역 </dt><dd className="inline" data-field="regions">{m.regionCount}개</dd></div>
              <div><dt className="inline font-bold">수신 동의 </dt><dd className="inline" data-field="consents">{m.consents.length ? m.consents.map((k) => CONSENT_LABEL[k] ?? k).join("·") : "없음"}</dd></div>
            </dl>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <MemberSuspension
                userId={m.userId}
                email={m.email ?? m.userId}
                suspended={m.suspended}
                blockedReason={suspendBlocked({ targetId: m.userId, viewerId, targetIsAdmin: m.isAdmin })}
              />
              {m.isAdmin || m.userId === viewerId ? <p className="text-[15px] text-navy-700">관리자 계정은 여기서 지우지 않습니다</p> : <MemberDelete userId={m.userId} email={m.email ?? m.userId} />}
            </div>
          </li>
        ))}
      </ul>
      {(data.page > 1 || data.hasNext) && (
        <nav aria-label="쪽 이동" className="mt-4 flex gap-4">
          {data.page > 1 && <Link className={TEXT_LINK} href={href(data.page - 1)}>이전 쪽</Link>}
          {data.hasNext && <Link className={TEXT_LINK} href={href(data.page + 1)}>다음 쪽</Link>}
        </nav>
      )}
    </>
  );
}
