-- W4 23단계 — 상속·증여 안내 (FAM-01 · FAM-02 · FAM-08, docs/dev/W4_설계.md 1장 23단계 · 2.2 · 2.4 · 11.23)
-- · 기능 키 inheritance_gift — feature_flags에 꺼진 채로 더한다(이미 있는 값은 그대로). 22단계 허브 링크 카드도 이 키를 설정의 기능 목록으로 읽는다
-- · 설정 inheritance_gift_notice — PRD FAM-01 문장 씨앗. 저장 검사: 글자 1~100자, 숫자 0(고정 문구에 기한·공제·세율 숫자 0 — 화면 고정 문구 검사와 같은 뜻)
-- · 설정 inheritance_gift_situations — 상황 slug 목록, 씨앗 [] (편집국이 상황 4종을 쓰고 감수한 뒤 채운다)
--     저장 검사: 목록 0~4개 · slug 모양(situations.slug와 같다) · 같은 slug 두 번 0 · 목록의 상황은 이미 있는 부동산 분야 상황이고
--     외부 계산기 연결(official_links kind external_calculator·key inheritance_gift)과 일반적 체크리스트 고지가 있어야 한다 (TypeScript 설정 API가 같은 규칙을 한 번 더 본다)
-- · 상황 공개 검사 — 목록에 든 상황을 공개(visible)로 두려면 같은 조건(외부 계산기 연결 + 체크리스트 고지)이 필요하다. 목록에 없는 상황은 달라지지 않는다
-- · 공개 읽기 — anon이 두 설정 키만 읽는 정책 한 개. 공개 뷰 public_inheritance_intro — 하위 분야 realestate/inheritance-gift의 공개 해설 기사 가운데
--     세무 감수가 승인된 것과 최종 감수일(세무 감수 승인 기록 가운데 가장 늦은 시각). 기능 키가 꺼지면 0행
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- 기능 키 — 없을 때만 false로
update public.settings s
   set value = s.value || jsonb_build_object('inheritance_gift', false),
       updated_by = 'migration:20261023000056'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and not (s.value ? 'inheritance_gift');

insert into public.settings (key, value, description, updated_by) values
  ('inheritance_gift_notice',
   to_jsonb('상속세·증여세는 이 사이트에서 계산하지 않습니다'::text),
   '상속·증여 안내 페이지의 고지 문구 (FAM-01) — 감수본. 세 경로(/realestate/inheritance-gift·/inheritance·/gift)에 한 번씩 나온다. 글자 1~100자, 숫자 0',
   'migration:20261023000056'),
  ('inheritance_gift_situations',
   '[]'::jsonb,
   '상속·증여 안내에 보이는 상황 slug 목록 (FAM-02 — 상황 4종, 0~4개). 목록에 든 상황은 외부 계산기 연결과 체크리스트 고지가 있어야 공개된다',
   'migration:20261023000056')
on conflict (key) do nothing;

-- 목록에 든 상황이 갖춰야 할 것 중 빠진 것 (없으면 null) — 저장 전 값을 받는다. 설정 저장 검사와 상황 공개 검사가 함께 쓴다
create function public.inheritance_situation_missing_for(p_section text, p_checklist jsonb, p_link_id bigint) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
begin
  if p_section is distinct from 'realestate' then
    v_missing := v_missing || '부동산 분야 상황'::text;
  end if;
  if p_link_id is null
     or not exists (select 1 from public.official_links l where l.id = p_link_id and l.kind = 'external_calculator' and l.key = 'inheritance_gift') then
    v_missing := v_missing || '외부 계산기 연결'::text;
  end if;
  if jsonb_typeof(p_checklist) is distinct from 'object' or coalesce(btrim(p_checklist ->> 'notice'), '') = '' then
    v_missing := v_missing || '체크리스트 고지'::text;
  end if;
  if cardinality(v_missing) = 0 then
    return null;
  end if;
  return array_to_string(v_missing, '·') || '이(가) 필요합니다';
end;
$$;
revoke all on function public.inheritance_situation_missing_for(text, jsonb, bigint) from public, anon, authenticated;

-- 설정 저장 검사 (TypeScript inheritance-gift-logic.ts 와 같은 규칙)
create function public.inheritance_gift_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_notice constant integer := 100;
  c_max_situations constant integer := 4;
  v_text text;
  v_item jsonb;
  v_slug text;
  v_seen text[] := '{}';
  v_sit record;
  v_missing text;
begin
  if new.key = 'inheritance_gift_notice' then
    if jsonb_typeof(new.value) is distinct from 'string' then
      raise exception '상속·증여 고지 문구(inheritance_gift_notice)는 글자여야 합니다' using errcode = 'check_violation';
    end if;
    v_text := btrim(new.value #>> '{}');
    if char_length(v_text) not between 1 and c_max_notice then
      raise exception '상속·증여 고지 문구는 1~%자입니다', c_max_notice using errcode = 'check_violation';
    end if;
    if v_text ~ '[0-9]' then
      raise exception '상속·증여 고지 문구에는 숫자를 넣을 수 없습니다 — 기한·공제·세율 숫자는 고정 문구에 두지 않습니다' using errcode = 'check_violation';
    end if;
  elsif new.key = 'inheritance_gift_situations' then
    if jsonb_typeof(new.value) is distinct from 'array' then
      raise exception '상속·증여 상황 목록(inheritance_gift_situations)은 상황 slug 목록이어야 합니다' using errcode = 'check_violation';
    end if;
    if jsonb_array_length(new.value) > c_max_situations then
      raise exception '상속·증여 상황은 %개까지입니다', c_max_situations using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        raise exception '상속·증여 상황 slug는 영문 소문자·숫자·하이픈 글자입니다 (지금 %)', v_item using errcode = 'check_violation';
      end if;
      v_slug := v_item #>> '{}';
      if v_slug = any (v_seen) then
        raise exception '상속·증여 상황 %가 목록에 두 번 있습니다', v_slug using errcode = 'check_violation';
      end if;
      v_seen := v_seen || v_slug;
      select s.section, s.checklist, s.external_link_id into v_sit from public.situations s where s.slug = v_slug;
      if not found then
        raise exception '상속·증여 상황 %: 상황이 없습니다', v_slug using errcode = 'check_violation';
      end if;
      v_missing := public.inheritance_situation_missing_for(v_sit.section, v_sit.checklist, v_sit.external_link_id);
      if v_missing is not null then
        raise exception '상속·증여 상황 %: %', v_slug, v_missing using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.inheritance_gift_settings_guard() from public, anon, authenticated;
create trigger settings_inheritance_gift_guard
  before insert or update on public.settings
  for each row when (new.key in ('inheritance_gift_notice', 'inheritance_gift_situations'))
  execute function public.inheritance_gift_settings_guard();

-- 상황 공개 검사 — 목록에 든 상황을 공개로 두려면 외부 계산기 연결·체크리스트 고지가 있어야 한다 (공개된 행의 연결·고지를 지우는 고침도 막는다)
create function public.situations_inheritance_gift_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
  v_missing text;
begin
  if new.visible then
    select s.value into v_list from public.settings s where s.key = 'inheritance_gift_situations';
    if jsonb_typeof(v_list) = 'array' and v_list ? new.slug then
      v_missing := public.inheritance_situation_missing_for(new.section, new.checklist, new.external_link_id);
      if v_missing is not null then
        raise exception '상속·증여 안내 목록에 든 상황은 공개 전에 갖춰야 합니다 — %', v_missing using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.situations_inheritance_gift_guard() from public, anon, authenticated;
create trigger situations_inheritance_gift_guard
  before insert or update on public.situations
  for each row execute function public.situations_inheritance_gift_guard();

-- 공개 읽기 — 두 설정 키만
create policy settings_public_inheritance_gift on public.settings
  for select to anon, authenticated
  using (key in ('inheritance_gift_notice', 'inheritance_gift_situations'));

-- 공개 뷰 — 기능 키 켜짐 + 하위 분야 realestate/inheritance-gift의 공개 해설 기사 + 세무 감수 승인(최종 감수일이 있는 것만)
create view public.public_inheritance_intro as
select a.id as article_id, r.reviewed_at
  from public.public_articles a
  join public.articles x on x.id = a.id and x.tax_review_status = 'approved'
  join public.categories c on c.id = a.category_id and c.section = 'realestate' and c.slug = 'inheritance-gift'
  cross join lateral (
    select max(er.at) as reviewed_at
      from public.editorial_reviews er
     where er.article_id = a.id and er.kind = 'tax_review' and er.decision = 'approve') r
 where a.content_type = 'explainer'
   and r.reviewed_at is not null
   and exists (select 1 from public.settings s where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and (s.value -> 'inheritance_gift') = 'true'::jsonb);

comment on view public.public_inheritance_intro is '상속·증여 안내 입문 기사 (FAM-01) — 기능 키 inheritance_gift 켜짐 + 세무 감수 승인된 공개 해설 기사와 최종 감수일. 승인 전 기사는 0행';
revoke all on table public.public_inheritance_intro from public, anon, authenticated, service_role;
grant select on table public.public_inheritance_intro to anon, authenticated, service_role;
