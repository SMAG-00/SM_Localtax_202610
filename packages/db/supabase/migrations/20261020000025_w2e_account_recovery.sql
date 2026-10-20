-- W2-e 2-B: 확인 안 된 가입 정리 — 기준 시각 이전에 만들어진 이메일 미확인 계정의 번호 목록 (역할이 있는 계정은 제외).
-- service_role만 실행한다. 이메일은 돌려주지 않고 번호만 준다. 기준 시각과 같은 시각에 만든 계정도 포함한다(당일 지움).
create or replace function public.unconfirmed_account_ids(p_before timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where u.email_confirmed_at is null
     and u.created_at <= p_before
     and not exists (select 1 from public.staff_roles r where r.user_id = u.id)
   order by u.created_at
   limit 1000;
$$;

revoke all on function public.unconfirmed_account_ids(timestamptz) from public, anon, authenticated;
grant execute on function public.unconfirmed_account_ids(timestamptz) to service_role;
