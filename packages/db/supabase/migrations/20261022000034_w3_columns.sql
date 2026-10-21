-- W3 6단계 — 칼럼 필자 체계: 필자 검증 author_verifications · 칼럼 계약 column_contracts · 칼럼 메타 column_meta(이해관계) · 정정 이력 column_meta_history
-- (PRD-01B TX-14~17, docs/dev/W3_설계.md 3장 · 12장 #8)
-- · 필자 약력·자격·계약 내용·이해관계 문구·의견 고지 문구는 이 파일에 없다 — 편집국이 입력하고, 고지 문구는 PO 감수본을 settings.column_opinion_notice에 넣는다(초기 빈 값).
-- · 칼럼 발행(published·scheduled로 바뀔 때) 검사: 칼럼 메타 · 필자(기사 author_id) 일치 · 만료 전 필자 검증 · 계약(같은 필자) · 이해관계(내용 또는 필자 '없음' 확인) · 의견 고지 문구.
--   대상 = column_meta가 있는 기사, 또는 기능 키 tax_columns가 켜진 뒤의 모든 opinion 기사. 이미 공개된 칼럼은 검증이 만료돼도 그대로 둔다(새 발행만 막힘).
-- · 발행 뒤 이해관계가 바뀌면 column_meta_history에 정정 이력 1건. 기존 표·제약·값은 바꾸지 않는다.

create table public.author_verifications (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people (id),
  evidence_kind text not null check (evidence_kind in ('license', 'registration', 'affiliation', 'other')),
  evidence_ref text not null check (length(btrim(evidence_ref)) > 0),
  verified_by text not null check (length(btrim(verified_by)) > 0),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > verified_at)
);

comment on table public.author_verifications is '칼럼 필자 검증 기록 (TX-14) — 증빙은 위치(참조)만, 자격 등록번호 전체는 넣지 않는다. 가장 최근 행이 만료 전이어야 새 칼럼 발행 가능';
create index author_verifications_person_idx on public.author_verifications (person_id, verified_at desc);

create table public.column_contracts (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people (id),
  doc_ref text not null check (length(btrim(doc_ref)) > 0),
  signed_on date not null,
  reuse_scope text[] not null check (cardinality(reuse_scope) > 0 and reuse_scope <@ array['print', 'online', 'book', 'external']::text[]),
  ai_index_scope text not null check (ai_index_scope in ('allow', 'deny')),
  book_titles text[] not null default '{}',
  created_at timestamptz not null default now(),
  check (cardinality(book_titles) = 0 or 'book' = any (reuse_scope))
);

comment on table public.column_contracts is '칼럼 기고 계약 (TX-15) — 계약 문서는 저장소 밖, 여기엔 위치(참조)·서명일·재수록 범위·AI 색인 범위. 도서 수록 목록은 재수록에 book이 있을 때만';

create table public.column_meta (
  article_id bigint primary key references public.articles (id) on delete cascade,
  person_id bigint not null references public.people (id),
  interest_state text not null check (interest_state in ('declared', 'none_confirmed')),
  interest_text text,
  interest_confirmed_by text,
  interest_confirmed_at timestamptz,
  contract_id bigint references public.column_contracts (id),
  updated_at timestamptz not null default now(),
  check (
    (interest_state = 'declared' and coalesce(btrim(interest_text), '') <> '')
    or (interest_state = 'none_confirmed' and coalesce(btrim(interest_confirmed_by), '') <> '' and interest_confirmed_at is not null)
  )
);

comment on table public.column_meta is '칼럼 이해관계·계약 연결 (TX-16·17) — declared는 내용 필수, none_confirmed(이해관계 없음)는 필자 확인자·시각 필수';

create table public.column_meta_history (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  before_state text not null,
  before_text text,
  after_state text not null,
  after_text text,
  changed_at timestamptz not null default now()
);

comment on table public.column_meta_history is '발행 뒤 이해관계 변경의 정정 이력 — 추가만';

-- 계약 필자 = 메타 필자
create function public.column_meta_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.contract_id is not null
     and not exists (select 1 from public.column_contracts c where c.id = new.contract_id and c.person_id = new.person_id) then
    raise exception '계약의 필자와 칼럼 필자가 다릅니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    select status into v_status from public.articles where id = new.article_id;
    if v_status in ('published', 'scheduled')
       and (new.interest_state is distinct from old.interest_state or new.interest_text is distinct from old.interest_text) then
      insert into public.column_meta_history (article_id, before_state, before_text, after_state, after_text)
      values (new.article_id, old.interest_state, old.interest_text, new.interest_state, new.interest_text);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.column_meta_guard() from public, anon, authenticated;

create trigger column_meta_guard
  before insert or update on public.column_meta
  for each row execute function public.column_meta_guard();

-- 칼럼 발행 검사
create function public.column_publish_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.column_meta;
  v_flag boolean;
  v_notice text;
begin
  if new.status not in ('published', 'scheduled') or new.content_type is distinct from 'opinion' then
    return new;
  end if;
  -- 이미 공개된 칼럼은 그대로 둔다 (검증 만료 = 새 발행만 막힘)
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') then
    return new;
  end if;
  select * into m from public.column_meta where article_id = new.id;
  select coalesce((value ->> 'tax_columns')::boolean, false) into v_flag from public.settings where key = 'feature_flags';
  if m.article_id is null and not coalesce(v_flag, false) then
    return new;
  end if;
  if m.article_id is null then
    raise exception '칼럼은 필자·계약·이해관계 기록(column_meta) 뒤에만 발행할 수 있습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if new.author_id is distinct from m.person_id then
    raise exception '칼럼 기록의 필자와 기사 필자가 다릅니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.author_verifications v where v.person_id = m.person_id and v.expires_at > now()
  ) then
    raise exception '필자 검증이 없거나 재검증 기한이 지났습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if m.contract_id is null then
    raise exception '기고 계약 기록이 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  select coalesce(btrim(value #>> '{}'), '') into v_notice from public.settings where key = 'column_opinion_notice';
  if coalesce(v_notice, '') = '' then
    raise exception '의견 고지 문구(column_opinion_notice)가 비어 있어 칼럼을 발행할 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.column_publish_guard() from public, anon, authenticated;

create trigger articles_column_guard
  before insert or update on public.articles
  for each row execute function public.column_publish_guard();

-- 권한·RLS: 표는 service_role만. 공개 읽기는 아래 뷰 하나(공개 기사의 이해관계·고지·필자 자격 줄만)
alter table public.author_verifications enable row level security;
alter table public.column_contracts enable row level security;
alter table public.column_meta enable row level security;
alter table public.column_meta_history enable row level security;
revoke all on table public.author_verifications, public.column_contracts, public.column_meta, public.column_meta_history from anon, authenticated, service_role;
grant select, insert, update, delete on table public.author_verifications, public.column_contracts, public.column_meta, public.column_meta_history to service_role;

-- 공개 뷰 — 소유자 권한으로 읽되 공개 기사만, 계약 위치·증빙 위치·확인자는 빼고 AI 색인 범위(공개 판정용)만 낸다
create view public.public_column_disclosures as
select m.article_id,
       m.person_id,
       m.interest_state,
       case when m.interest_state = 'declared' then m.interest_text else null end as interest_text,
       c.ai_index_scope,
       (select btrim(s.value #>> '{}') from public.settings s where s.key = 'column_opinion_notice') as opinion_notice
  from public.column_meta m
  join public.public_articles a on a.id = m.article_id
  left join public.column_contracts c on c.id = m.contract_id;

revoke all on table public.public_column_disclosures from public, anon, authenticated, service_role;
grant select on table public.public_column_disclosures to anon, authenticated, service_role;

-- 설정 씨앗: 고지 문구는 빈 값(PO 감수본을 넣을 때까지 칼럼 발행 막힘), 재검증 기한 365일
insert into public.settings (key, value, description, updated_by) values
  ('column_opinion_notice', '""'::jsonb, '칼럼 의견 고지 문구 — PO 감수본. 비면 칼럼 발행 거부 (TX-16)', 'migration:20261022000034'),
  ('column_reverify_days', '365'::jsonb, '칼럼 필자 재검증 기한(일) — EXPL-03과 같은 값 (TX-14)', 'migration:20261022000034')
on conflict (key) do nothing;

-- 기능 키 tax_columns — 꺼진 채로
update public.settings
   set value = value || jsonb_build_object('tax_columns', false),
       updated_by = 'migration:20261022000034'
 where key = 'feature_flags'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'tax_columns');
