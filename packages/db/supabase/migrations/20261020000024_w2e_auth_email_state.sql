-- W2-e 2-A: 가입 API가 이메일의 계정 상태를 확인하는 함수.
-- auth.admin.generateLink({type:"signup"})는 이미 있는 이메일이어도 오류 없이 그 계정을 돌려준다 — 그대로 쓰면 기존 계정을 건드리거나(비밀번호 덮어쓰기)
-- 실패 정리 때 지울 수 있다. 그래서 앱이 먼저 상태를 묻고, 계정이 이미 있으면 generateLink를 부르지 않는다.
--  · 'none' 계정 없음 · 'unconfirmed' 있으나 이메일 미확인 · 'confirmed' 이메일 확인됨
--  · service_role만 실행한다(anon·authenticated 0) — 계정 유무를 공개 키로 물을 수 없다. 이메일은 인자로만 받고 어디에도 저장하지 않는다.
create or replace function public.auth_email_state(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when u.email_confirmed_at is null then 'unconfirmed' else 'confirmed' end
       from auth.users u
      where lower(u.email) = lower(btrim(p_email))
      limit 1),
    'none');
$$;

revoke all on function public.auth_email_state(text) from public, anon, authenticated;
grant execute on function public.auth_email_state(text) to service_role;
