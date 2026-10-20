-- W2-e 6단계 DB — 보존 기한 지난 것 비우기 (docs/dev/W2-e_설계.md 9.3 · 11.6)
-- · inquiries.done_at: 완료로 바뀐 시각 — '완료 후 365일'의 기준. updated_at은 메모만 고쳐도 움직여서 쓰지 않는다. 이미 완료인 행은 updated_at으로 채운다
-- · inquiries_contact_email_required: 연락처를 비운 행(contact_cleared_at)은 연락 이메일이 없어도 된다 (비우는 UPDATE가 NOT VALID 제약에도 걸리므로)
-- · privacy_purge_rows(): 확인 안 된 사전 알림 신청 · 철회된 사전 알림 동의 삭제 + 완료 문의 연락처 비움. 기준 시각과 일수를 인자로 받는다(경계 시험)
--   첨부 파일은 저장소 API로만 지울 수 있어 앱 코드(lib/server/accounts/retention.ts)가 맡는다. 시도 기록은 기존 throttle_purge
-- · service_role만 실행한다. anon·authenticated 0

alter table public.inquiries add column done_at timestamptz;
update public.inquiries set done_at = updated_at where status = 'done' and done_at is null;
create index inquiries_done_at_idx on public.inquiries (done_at) where done_at is not null;

create function public.inquiries_set_done_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'done' then
    new.done_at := null;
  elsif tg_op = 'INSERT' then
    new.done_at := coalesce(new.done_at, now());
  elsif old.status <> 'done' and new.done_at is not distinct from old.done_at then
    new.done_at := now();
  end if;
  return new;
end;
$$;
create trigger inquiries_done_at before insert or update on public.inquiries
  for each row execute function public.inquiries_set_done_at();

alter table public.inquiries drop constraint inquiries_contact_email_required;
alter table public.inquiries add constraint inquiries_contact_email_required
  check (kind not in ('subscription', 'advertising', 'reader_submission') or contact_email is not null or contact_cleared_at is not null) not valid;

create function public.privacy_purge_rows(
  p_now timestamptz,
  p_unconfirmed_prereg_days integer,
  p_revoked_days integer,
  p_contact_days integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prereg integer;
  v_revoked integer;
  v_contacts integer;
begin
  if p_now is null
     or p_unconfirmed_prereg_days is null or p_unconfirmed_prereg_days not between 1 and 3650
     or p_revoked_days is null or p_revoked_days not between 1 and 3650
     or p_contact_days is null or p_contact_days not between 1 and 3650 then
    raise exception 'privacy_purge_rows: 기준 시각 또는 일수가 맞지 않습니다' using errcode = '22023';
  end if;

  -- 확인 메일을 누르지 않은 사전 알림 신청 (회원의 사전 알림 동의는 계정과 함께 관리한다 — email이 있는 행만)
  delete from public.consents
   where kind = 'brief_prereg' and email is not null and confirmed_at is null and revoked_at is null
     and created_at <= p_now - make_interval(days => p_unconfirmed_prereg_days);
  get diagnostics v_prereg = row_count;

  -- 철회된 사전 알림 동의 — 철회한 날부터 센다
  delete from public.consents
   where kind = 'brief_prereg' and revoked_at is not null
     and revoked_at <= p_now - make_interval(days => p_revoked_days);
  get diagnostics v_revoked = row_count;

  -- 완료된 문의의 연락처 — 본문(가려진 값)은 남기고 연락 칸만 비운다
  update public.inquiries
     set contact_name = null, organization = null, contact_email = null, contact_cleared_at = now()
   where status = 'done' and done_at is not null and done_at <= p_now - make_interval(days => p_contact_days)
     and contact_cleared_at is null
     and (contact_name is not null or organization is not null or contact_email is not null);
  get diagnostics v_contacts = row_count;

  return jsonb_build_object('unconfirmed_prereg', v_prereg, 'revoked_consents', v_revoked, 'contacts_cleared', v_contacts);
end;
$$;

revoke all on function public.privacy_purge_rows(timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.privacy_purge_rows(timestamptz, integer, integer, integer) to service_role;
revoke all on function public.inquiries_set_done_at() from public, anon, authenticated;
