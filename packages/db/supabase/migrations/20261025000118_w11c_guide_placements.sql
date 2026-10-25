-- W11-c c1 - 가이드 배치 + DF-08 공개 관문 (PRD-03 TRU-01·02 · RDV-01·03 · DF-08, docs/dev/W11-c_설계.md 2장)
-- · 같은 해설이 두 경로에 따로 있으면 안 된다 - 원고는 guides/guide_versions(W11-a) 하나. 이 표는 "어느 화면에 어느 가이드를 붙일지"만 둔다 (원고·제목·숫자 칸 0).
-- · TRU-02 = DF-08: 신탁 주제는 허브 trust의 한 행. 허브 finance_tax에 주제 trust를 따로 만들 수 없다 (배치 트리거가 거부).
-- · DF-08 공개 관문: 설정 finance_tax_guide_review(자본시장법 검토 기록)가 approved + ref 없이는 기능 키 finance_tax_guide를 켜지 못한다. 공개 뷰는 키가 꺼진 화면 종류를 0행으로 낸다.
-- · 이 파일에 가이드 글도 법령도 숫자도 없다 (씨앗 0행).

create table public.guide_placements (
  id bigint generated always as identity primary key,
  guide_id bigint not null references public.guides (id),
  surface text not null check (surface in ('trust_type', 'finance_tax_hub', 'dev_method', 'stage', 'situation')),
  target_key text not null check (target_key ~ '^[a-z0-9]+([-_][a-z0-9]+)*$' and char_length(target_key) <= 100),
  sort int not null default 0 check (sort between 0 and 1000),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  unique (guide_id, surface, target_key)
);
comment on table public.guide_placements is '가이드 배치 (W11-c) - 화면 종류·대상 키에 어느 가이드를 붙일지만. 원고는 guide_versions 한 곳. 신탁 유형 페이지(trust_type)·금융 구조별 세금 가이드 허브(finance_tax_hub)·개발방법(dev_method)·단계(stage)·상황(situation)';
comment on column public.guide_placements.target_key is '화면 종류별 대상 - trust_type=구조 해설 slug, dev_method=방법 키, stage=사업유형:단계 대신 단계 키, situation=상황 slug, finance_tax_hub=주제 키';
create index guide_placements_lookup_idx on public.guide_placements (surface, target_key, sort);

-- 중복 원고 차단 - DF-08 신탁 주제는 허브 trust의 같은 행 (finance_tax 허브에 trust 주제를 따로 두지 못한다)
create function public.guide_placements_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
begin
  select hub, topic into g from public.guides where id = new.guide_id;
  if not found then
    raise exception '배치할 가이드가 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if g.hub = 'finance_tax' and g.topic = 'trust' then
    raise exception '신탁 주제 가이드는 허브 trust의 한 행입니다 - 금융 구조별 세금 가이드(finance_tax)에 같은 주제를 따로 만들지 마세요 (TRU-02 = DF-08)' using errcode = 'check_violation';
  end if;
  if new.surface = 'trust_type' and g.hub not in ('trust') then
    raise exception '신탁 유형 페이지에는 신탁 허브 가이드만 붙일 수 있습니다' using errcode = 'check_violation';
  end if;
  if new.surface in ('dev_method', 'stage') and g.hub not in ('redevelopment', 'realestate_tax') then
    raise exception '개발방법·단계 화면에는 정비 또는 부동산 세금 허브 가이드만 붙일 수 있습니다' using errcode = 'check_violation';
  end if;
  if new.surface = 'finance_tax_hub' and g.hub not in ('trust', 'finance_tax') then
    raise exception '금융 구조별 세금 가이드 허브에는 신탁 또는 금융 구조 허브 가이드만 붙일 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.guide_placements_guard() from public, anon, authenticated;
create trigger guide_placements_guard before insert or update on public.guide_placements for each row execute function public.guide_placements_guard();

-- DF-08 공개 관문 - 설정 모양 검사 (finance_legal_review와 같은 방식)
insert into public.settings (key, value, description, updated_by) values
  ('finance_tax_guide_review',
   '{}'::jsonb,
   '금융 구조별 세금 가이드(DF-08) 자본시장법 검토 기록 - { "reviewer": 검토자 이름, "reviewed_on": YYYY-MM-DD, "conclusion": "approved" 또는 "rejected", "ref": 검토 기록 위치 }. 비어 있거나 approved가 아니거나 ref가 없으면 기능 키 finance_tax_guide를 켤 수 없다',
   'migration:20261025000118')
on conflict (key) do nothing;

create function public.finance_tax_guide_review_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '금융 구조별 세금 가이드 검토 기록은 { reviewer, reviewed_on, conclusion, ref } 객체(또는 빈 객체)입니다' using errcode = 'check_violation';
  end if;
  if new.value <> '{}'::jsonb then
    if (select array_agg(k order by k) from jsonb_object_keys(new.value) k) is distinct from array['conclusion', 'ref', 'reviewed_on', 'reviewer'] then
      raise exception '금융 구조별 세금 가이드 검토 기록은 reviewer·reviewed_on·conclusion·ref 네 칸입니다' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(new.value -> 'reviewer') is distinct from 'string' or char_length(btrim(new.value ->> 'reviewer')) not between 1 and 60 then
      raise exception '검토자 이름(reviewer)은 1~60자 글자입니다' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(new.value -> 'reviewed_on') is distinct from 'string' or (new.value ->> 'reviewed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '검토일(reviewed_on)은 YYYY-MM-DD입니다' using errcode = 'check_violation';
    end if;
    if (new.value ->> 'conclusion') not in ('approved', 'rejected') then
      raise exception '검토 결론(conclusion)은 approved 또는 rejected입니다' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(new.value -> 'ref') is distinct from 'string' or char_length(btrim(new.value ->> 'ref')) not between 1 and 200 then
      raise exception '검토 기록 위치(ref)는 1~200자 글자입니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finance_tax_guide_review_guard() from public, anon, authenticated;
create trigger settings_finance_tax_guide_review_guard
  before insert or update on public.settings
  for each row when (new.key = 'finance_tax_guide_review')
  execute function public.finance_tax_guide_review_guard();

-- 기능 키 켜기 검사 - 검토 기록(approved + ref) 없이는 finance_tax_guide를 켜지 못한다. 끄기·이미 켜진 값은 검사하지 않는다
create function public.finance_tax_guide_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'finance_tax_guide') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'finance_tax_guide') is distinct from 'true'::jsonb) then
    select s.value into v_review from public.settings s where s.key = 'finance_tax_guide_review';
    if jsonb_typeof(v_review) is distinct from 'object'
       or (v_review ->> 'conclusion') is distinct from 'approved'
       or coalesce(btrim(v_review ->> 'reviewer'), '') = ''
       or coalesce(btrim(v_review ->> 'ref'), '') = ''
       or (v_review ->> 'reviewed_on') is null then
      raise exception '금융 구조별 세금 가이드(finance_tax_guide)는 자본시장법 검토 기록(검토자·일자·결론 approved·기록 위치)이 있어야 켭니다 (DF-08 · 3단계 설계 5장 #5)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finance_tax_guide_flag_guard() from public, anon, authenticated;
create trigger settings_finance_tax_guide_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.finance_tax_guide_flag_guard();

-- 공개 뷰 - 서명 뒤 공개(published)된 가이드의 배치만, 화면 종류별 기능 키가 켜졌을 때만. 서명 전·꺼짐은 0행(빈 상자·준비 중 표시 0)
create view public.public_guide_placements as
  select p.surface, p.target_key, p.sort, g.hub, g.topic, g.slug, v.version, v.body_sha256
    from public.guide_placements p
    join public.guides g on g.id = p.guide_id
    join public.guide_versions v on v.guide_id = g.id and v.status = 'published'
   where coalesce((
           select case p.surface
                    when 'trust_type' then (s.value ->> 'trust_tax_guide')
                    when 'finance_tax_hub' then (s.value ->> 'finance_tax_guide')
                    when 'dev_method' then (s.value ->> 'redevelopment_tax')
                    when 'stage' then (s.value ->> 'redevelopment_tax')
                    when 'situation' then (s.value ->> 'tax_lifecycle')
                  end = 'true'
             from public.settings s where s.key = 'feature_flags'), false);
revoke all on table public.public_guide_placements from public, anon, authenticated;
grant select on table public.public_guide_placements to anon, authenticated, service_role;

-- 권한 - 서버(service_role)는 읽기·추가·삭제. 가이드 원고는 불변이므로 배치만 지울 수 있다. 공개 읽기는 위 뷰만
alter table public.guide_placements enable row level security;
revoke all on table public.guide_placements from anon, authenticated, service_role;
grant select, insert, update (sort), delete on table public.guide_placements to service_role;
