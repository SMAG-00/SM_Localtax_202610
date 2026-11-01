-- 전문가 상담 바로 연락 (PO 결정 2026-11-01 — "상담내용을 남기는 게 불편한 고객은 직접 전화 가능")
-- · expert_direct_contact — { phone, kakaoUrl, freeScope }. 상담 요청 양식 위와 칼럼 끝 상담 상자에 '바로 전화'·'카카오톡 상담'·무료 범위 한 줄로 보인다
--     phone: 숫자·하이픈 9~13자 (앞자리 0) · kakaoUrl: https://open.kakao.com/ 오픈채팅 주소(쿼리 없음) · freeScope: 80자 이하 한 줄
--     칸마다 비우면(빈 글자) 그 줄을 숨긴다. 씨앗은 빈 객체(아무것도 보이지 않음) — 값은 관리자 설정에서 넣는다
--     저장 검사(트리거)는 apps/web/lib/experts/direct-contact.ts와 같다
--     공개 읽기 — anon이 이 키 한 줄만 읽는 정책. 기존 settings_public_read는 그대로
-- · 기존 표·칸·제약은 바꾸지 않는다 (씨앗 한 줄 · 트리거 · 정책만 더한다)

create function public.expert_direct_contact_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(new.value) k where k not in ('phone', 'kakaoUrl', 'freeScope'))
     or exists (select 1 from jsonb_each(new.value) e where jsonb_typeof(e.value) is distinct from 'string') then
    raise exception '바로 연락(expert_direct_contact)은 { phone, kakaoUrl, freeScope } 글자 칸만 씁니다' using errcode = 'check_violation';
  end if;
  if coalesce(new.value ->> 'phone', '') <> '' and (new.value ->> 'phone') !~ '^0[0-9-]{8,12}$' then
    raise exception '바로 연락 전화번호는 0으로 시작하는 숫자·하이픈 9~13자입니다 (예: 010-1234-5678)' using errcode = 'check_violation';
  end if;
  if coalesce(new.value ->> 'kakaoUrl', '') <> '' and (new.value ->> 'kakaoUrl') !~ '^https://open\.kakao\.com/[A-Za-z0-9/_-]+$' then
    raise exception '카카오톡 상담 주소는 https://open.kakao.com/ 오픈채팅 주소(쿼리 없음)입니다' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(new.value ->> 'freeScope', '')) > 80 then
    raise exception '무료 상담 범위는 80자 이하 한 줄입니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.expert_direct_contact_guard() from public, anon, authenticated;
create trigger settings_expert_direct_contact_guard
  before insert or update on public.settings
  for each row when (new.key = 'expert_direct_contact')
  execute function public.expert_direct_contact_guard();

insert into public.settings (key, value, description, updated_by) values (
  'expert_direct_contact',
  '{}'::jsonb,
  '전문가 상담 바로 연락 — { "phone": "010-…", "kakaoUrl": "https://open.kakao.com/o/…", "freeScope": "첫 상담 30분 전화 무료 …" }. 상담 요청 양식 위·칼럼 끝 상담 상자에 보입니다. 칸을 비우면 그 줄을 숨깁니다',
  'migration:20261101000239'
) on conflict (key) do nothing;

create policy settings_public_expert_direct_contact on public.settings
  for select to anon, authenticated
  using (key = 'expert_direct_contact');
