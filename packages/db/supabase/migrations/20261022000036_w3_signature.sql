-- W3 8단계 — 시그니처 칼럼 틀 2개 · '50년' 표기 막기 · 「그때와 지금」 비교 항목 · 편집 독립(필자 = 발행 승인자 거부)
-- (PRD-01C BR-01·04·07·08, PRD-01A ART-04, docs/dev/W3_설계.md 1장 8단계 · 2.1·2.2·2.6 · 12장 #11·#14·#25~#28)
-- · 연재 제목·발행 주기는 settings(series_title_signature · series_title_then_now · column_cadence) 한 곳에서 온다. 씨앗은 '50년' 글자 없는 중립 가제.
--   실제 가제·발행 주기는 편집국·PO가 넣는다. 경력·연수·'50년' 산정 기준은 이 파일에 없다.
-- · '50년' 표기(변형 포함 — 설계 2.6 표)는
--     연재 제목(settings): career_claim_approved 승인(근거 증빙이 지금도 승인) 뒤에만 저장, 공개 뷰는 brand_copy 켜짐 + 근거 링크(인물 페이지의 그 증빙 약력 줄)가 있을 때만 제목을 낸다.
--     시그니처 회차의 제목·요약·주소·본문, 모든 기사의 연재 이름 칸, 「그때와 지금」 항목: 승인과 상관없이 늘 거부
--       (메타·구조화 데이터·카드·URL에는 근거 링크를 붙일 수 없어서 — 12장 #26).
-- · 「그때와 지금」 비교 항목은 출처·기준연도가 둘 다 있어야 저장되고(제약), 공개 뷰도 둘 다 있는 줄만 낸다. 그때와 지금 회차는 항목 1개 이상이어야 발행.
-- · 칼럼(opinion) 필자의 계정이 발행 기록(check_log.publish.by)의 계정과 같으면 발행 거부 (BR-08). 편집 승인(desk_edit) 쪽은 W2-a 트리거가 이미 막는다.
-- · 기존 표·칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- '50년' 표기 검사 — 트리거 전용(anon·authenticated 실행 0). 공개 뷰는 같은 식을 직접 쓴다(anon 실행 가능 함수 허용 목록 때문).
--   준비: NFKC(전각 숫자·㊿ → 50) · 소문자 · 보이지 않는 글자(U+00AD·200B~200D·2060·FEFF) 지우기.
--   막는 것: 앞에 숫자가 없는 50 + [공백·_·.·-] + (여) + 년(뒤에 '대' 제외)·年·주년·years·yrs·nyeon·nyun / 오십(앞에 수 글자 없음) + 년·주년·해 / 쉰 해·쉰 년 / 五十年 / 반세기 / fifty years / half a century
--   웹 서버 검사(apps/web/lib/brand/claim.ts)와 같은 규칙 — 두 시험이 설계 2.6 표를 함께 읽는다.
-- ─────────────────────────────────────────────────────────────
create function public.brand_claim_token(t text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    regexp_replace(lower(normalize(coalesce(t, ''), NFKC)), '[­​-‍⁠﻿]', '', 'g')
      ~ '(?<![0-9])50[[:space:]_·.-]*(여[[:space:]_·.-]*)?(년(?!대)|年|주년|years?|yrs?|nyeon|nyun)|(?<![일이삼사오육칠팔구십백천만억])오십[[:space:]_·.-]*(여[[:space:]_·.-]*)?(년(?!대)|주년|해)|(?<![가-힣])쉰[[:space:]_·.-]*(해|년(?!대))|五十[[:space:]_·.-]*年|반세기|fifty[[:space:]_·.-]*years?|half[[:space:]_·.-]*(a[[:space:]_·.-]*)?century',
    false)
$$;
comment on function public.brand_claim_token(text) is '경력 연수 표기(''50년''과 변형 — 설계 2.6) 검사. 트리거 전용 — anon 실행 0';
revoke all on function public.brand_claim_token(text) from public, anon, authenticated;
grant execute on function public.brand_claim_token(text) to service_role;

-- 경력 표시 승인 — career_claim_approved.approved이고 근거 증빙이 지금도 승인 상태 (brand_settings_guard와 같은 조건)
create function public.brand_claim_open() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce((s.value ->> 'approved')::boolean, false)
           and exists (select 1 from public.people_evidence e where e.approved and e.id::text = btrim(coalesce(s.value ->> 'basis_evidence_id', '')))
      from public.settings s where s.key = 'career_claim_approved'), false)
$$;
revoke all on function public.brand_claim_open() from public, anon, authenticated;
grant execute on function public.brand_claim_open() to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 연재 제목 2개(중립 가제, '50년' 0)·발행 주기(빈 값 — 결정 안건). 이미 있으면 그대로
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('series_title_signature', to_jsonb('시그니처 칼럼'::text),
   '시그니처 칼럼 연재 제목 (BR-04) — 편집국 입력. 경력 연수 표기(''50년'' 등)는 career_claim_approved 승인 뒤에만, 화면에는 근거 링크와 함께', 'migration:20261022000036'),
  ('series_title_then_now', to_jsonb('그때와 지금'::text),
   '「그때와 지금」 꼭지 연재 제목 (BR-04) — 편집국 입력. 경력 연수 표기 규칙은 시그니처 칼럼과 같다', 'migration:20261022000036'),
  ('column_cadence', '""'::jsonb,
   '시그니처 칼럼 발행 주기 (BR-04 [결정 안건]) — 비면 화면에 주기 줄 없음', 'migration:20261022000036')
on conflict (key) do nothing;

-- 연재 제목·발행 주기 검사: 글자 한 줄(제목 1~100자, 주기 0~100자), 제목의 경력 연수 표기는 경력 표시 승인 뒤에만
create function public.signature_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text;
begin
  if jsonb_typeof(new.value) is distinct from 'string' then
    raise exception '%은(는) 글자 한 줄이어야 합니다', new.key using errcode = 'check_violation';
  end if;
  v_text := btrim(new.value #>> '{}');
  if new.key = 'column_cadence' then
    if length(v_text) > 100 then
      raise exception '발행 주기(column_cadence)는 100자까지입니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if length(v_text) not between 1 and 100 then
    raise exception '연재 제목(%)은 1~100자여야 합니다', new.key using errcode = 'check_violation';
  end if;
  if public.brand_claim_token(v_text) and not public.brand_claim_open() then
    raise exception '연재 제목의 경력 연수 표기(''50년'' 등)는 경력 표시 승인(career_claim_approved — 승인된 근거 증빙) 뒤에만 쓸 수 있습니다 (BR-04)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.signature_settings_guard() from public, anon, authenticated;
create trigger settings_signature_guard
  before insert or update on public.settings
  for each row when (new.key in ('series_title_signature', 'series_title_then_now', 'column_cadence'))
  execute function public.signature_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- signature_episodes — 시그니처 연재 회차 (기사 하나가 한 연재의 한 회차). 연재 이름은 기사 칸이 아니라 설정에서 온다
-- ─────────────────────────────────────────────────────────────
create table public.signature_episodes (
  article_id bigint primary key references public.articles (id) on delete cascade,
  series_key text not null check (series_key in ('signature', 'then_now')),
  episode integer not null check (episode between 1 and 9999),
  assigned_by text not null check (length(btrim(assigned_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signature_episodes_series_episode unique (series_key, episode)
);
comment on table public.signature_episodes is '시그니처 연재 회차 (BR-04 · ART-04) — 칼럼(opinion)만, 연재 이름은 settings.series_title_*. 회차 글에는 경력 연수 표기 0. service_role만';

-- 「그때와 지금」 비교 항목 — 과거 수치·제도는 출처·기준연도가 둘 다 있어야 한다 (BR-04)
create table public.then_now_items (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  position integer not null check (position between 1 and 50),
  label text check (label is null or length(btrim(label)) between 1 and 100),
  then_text text not null check (length(btrim(then_text)) between 1 and 500),
  now_text text not null check (length(btrim(now_text)) between 1 and 500),
  source text not null check (length(btrim(source)) between 1 and 300),
  source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
  base_year integer not null check (base_year between 1900 and 2100),
  created_at timestamptz not null default now(),
  constraint then_now_items_position unique (article_id, position)
);
comment on table public.then_now_items is '「그때와 지금」 비교 항목 (BR-04) — 출처·기준연도 필수, 그때와 지금 회차에만. service_role만';
create index then_now_items_article_idx on public.then_now_items (article_id, position);

alter table public.signature_episodes enable row level security;
alter table public.then_now_items enable row level security;
revoke all on table public.signature_episodes, public.then_now_items from anon, authenticated, service_role;
grant select, insert, update, delete on table public.signature_episodes, public.then_now_items to service_role;

-- 회차 지정 검사: 칼럼(opinion)·삭제 아님 · 기사 연재 이름 칸은 비움 · 회차 글에 경력 연수 표기 0 · 그때와 지금 항목이 있으면 다른 연재로 못 옮김
create function public.signature_episodes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
begin
  if tg_op = 'DELETE' then
    -- 기사째 지울 때(외래 키 cascade)는 기사 행이 이미 없다 — 그때는 막지 않는다
    if old.series_key = 'then_now' and exists (select 1 from public.articles x where x.id = old.article_id)
       and exists (select 1 from public.then_now_items i where i.article_id = old.article_id) then
      raise exception '「그때와 지금」 비교 항목이 있는 회차는 연재에서 뺄 수 없습니다 — 항목을 먼저 지우세요 (기사 %)', old.article_id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.article_id is distinct from old.article_id then
      raise exception '회차의 기사 번호는 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.series_key = 'then_now' and new.series_key <> 'then_now' and exists (select 1 from public.then_now_items i where i.article_id = old.article_id) then
      raise exception '「그때와 지금」 비교 항목이 있는 회차는 다른 연재로 옮길 수 없습니다 — 항목을 먼저 지우세요 (기사 %)', old.article_id using errcode = 'check_violation';
    end if;
  end if;
  select * into a from public.articles where id = new.article_id;
  if a.id is null or a.content_type is distinct from 'opinion' or a.status = 'deleted' then
    raise exception '시그니처 연재 회차는 칼럼(opinion) 기사만 됩니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  if a.series_title is not null then
    raise exception '시그니처 연재 회차는 기사의 연재 이름·회차 칸을 비웁니다 — 연재 이름은 설정에서 옵니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  if public.brand_claim_token(a.title) or public.brand_claim_token(a.summary) or public.brand_claim_token(a.slug) or public.brand_claim_token(a.body::text) then
    raise exception '시그니처 연재 회차의 제목·요약·주소·본문에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.signature_episodes_guard() from public, anon, authenticated;
create trigger signature_episodes_guard
  before insert or update or delete on public.signature_episodes
  for each row execute function public.signature_episodes_guard();

-- 비교 항목 검사: 그때와 지금 회차에만 · 기준연도는 올해(한국) 이하 · 경력 연수 표기 0 · 발행된 회차의 마지막 항목은 못 지움
create function public.then_now_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    -- 한 벌 바꾸기(then_now_replace) 안에서는 함수가 끝에 개수를 다시 본다 · 기사째 지울 때는 기사 행이 없어 v_status가 null
    if coalesce(current_setting('ltr.then_now_replace', true), '') = old.article_id::text then
      return old;
    end if;
    select a.status into v_status from public.articles a where a.id = old.article_id;
    if v_status in ('published', 'scheduled')
       and not exists (select 1 from public.then_now_items i where i.article_id = old.article_id and i.id <> old.id) then
      raise exception '발행된 「그때와 지금」 회차의 마지막 비교 항목은 지울 수 없습니다 (기사 %)', old.article_id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if not exists (select 1 from public.signature_episodes e where e.article_id = new.article_id and e.series_key = 'then_now') then
    raise exception '「그때와 지금」 비교 항목은 그때와 지금 연재 회차에만 넣습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  if new.base_year > extract(year from (now() at time zone 'Asia/Seoul'))::integer then
    raise exception '기준연도(%)는 올해보다 뒤일 수 없습니다', new.base_year using errcode = 'check_violation';
  end if;
  if public.brand_claim_token(new.label) or public.brand_claim_token(new.then_text) or public.brand_claim_token(new.now_text) or public.brand_claim_token(new.source) then
    raise exception '「그때와 지금」 항목에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 — 연도는 기준연도 칸에 적습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.then_now_items_guard() from public, anon, authenticated;
create trigger then_now_items_guard
  before insert or update or delete on public.then_now_items
  for each row execute function public.then_now_items_guard();

-- 비교 항목 한 벌 바꾸기 — 지우고 새로 넣기를 한 번에(한쪽만 되는 일 없음). 관리 API(service_role)만 부른다
create function public.then_now_replace(p_article_id bigint, p_items jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_status text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception '비교 항목은 목록이어야 합니다' using errcode = 'check_violation';
  end if;
  -- 지우는 동안은 '마지막 항목' 검사를 쉬고(이 기사만, 이 트랜잭션만), 다 넣은 뒤 개수를 다시 본다
  perform set_config('ltr.then_now_replace', p_article_id::text, true);
  delete from public.then_now_items where article_id = p_article_id;
  insert into public.then_now_items (article_id, position, label, then_text, now_text, source, source_url, base_year)
  select p_article_id, (x.ord)::integer, nullif(btrim(x.item ->> 'label'), ''), x.item ->> 'then_text', x.item ->> 'now_text',
         x.item ->> 'source', nullif(btrim(x.item ->> 'source_url'), ''), (x.item ->> 'base_year')::integer
    from jsonb_array_elements(p_items) with ordinality as x(item, ord);
  perform set_config('ltr.then_now_replace', '', true);
  select count(*) into v_count from public.then_now_items where article_id = p_article_id;
  select a.status into v_status from public.articles a where a.id = p_article_id;
  if v_count = 0 and v_status in ('published', 'scheduled') then
    raise exception '발행된 「그때와 지금」 회차는 비교 항목이 1개 이상이어야 합니다 (기사 %)', p_article_id using errcode = 'check_violation';
  end if;
  return v_count;
end;
$$;
revoke all on function public.then_now_replace(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.then_now_replace(bigint, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 기사 쪽 검사
--   · 연재 이름 칸(series_title) — 어떤 기사든 경력 연수 표기 0 (넣거나 바꿀 때)
--   · 시그니처 회차 — 칼럼 유지 · 연재 이름 칸 비움 · 제목·요약·주소·본문에 경력 연수 표기 0 · 그때와 지금은 항목 1개 이상이어야 발행
--   · 칼럼(opinion) 발행 — 발행 기록의 계정(check_log.publish.by)이 필자 계정이면 거부 (BR-08)
-- ─────────────────────────────────────────────────────────────
create function public.signature_article_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_author_user uuid;
  v_publishing boolean;
begin
  if new.series_title is not null and (tg_op = 'INSERT' or new.series_title is distinct from old.series_title)
     and public.brand_claim_token(new.series_title) then
    raise exception '연재 이름에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 — 시그니처 연재 제목(설정)에서만, 승인 뒤에 씁니다 (BR-04)'
      using errcode = 'check_violation';
  end if;

  v_publishing := new.status in ('published', 'scheduled') and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled'));

  if v_publishing and new.content_type is not distinct from 'opinion' and new.author_id is not null
     and new.check_log ? 'publish' and length(btrim(coalesce(new.check_log -> 'publish' ->> 'by', ''))) > 0 then
    select p.staff_user_id into v_author_user from public.people p where p.id = new.author_id;
    if v_author_user is not null and btrim(new.check_log -> 'publish' ->> 'by') = 'user:' || v_author_user::text then
      raise exception '칼럼 필자 본인은 자기 칼럼을 발행할 수 없습니다 — 다른 편집 책임자가 발행합니다 (BR-08, 기사 %)', new.id using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;
  select e.series_key into v_key from public.signature_episodes e where e.article_id = new.id;
  if v_key is null then
    return new;
  end if;
  if new.content_type is distinct from 'opinion' then
    raise exception '시그니처 연재 회차는 칼럼(opinion)이어야 합니다 — 연재에서 먼저 빼세요 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if new.series_title is not null then
    raise exception '시그니처 연재 회차는 기사의 연재 이름·회차 칸을 비웁니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if (new.title, new.summary, new.slug, new.body) is distinct from (old.title, old.summary, old.slug, old.body)
     and (public.brand_claim_token(new.title) or public.brand_claim_token(new.summary) or public.brand_claim_token(new.slug) or public.brand_claim_token(new.body::text)) then
    raise exception '시그니처 연재 회차의 제목·요약·주소·본문에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if v_publishing and v_key = 'then_now' and not exists (select 1 from public.then_now_items i where i.article_id = new.id) then
    raise exception '「그때와 지금」 회차는 출처·기준연도가 있는 비교 항목이 1개 이상이어야 발행합니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.signature_article_guard() from public, anon, authenticated;
create trigger articles_signature_guard
  before insert or update on public.articles
  for each row execute function public.signature_article_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 (anon) — 공개 기사의 회차 번호 · 연재 틀(제목은 막히면 null, 근거 링크 재료) · 비교 항목(출처·기준연도가 둘 다 있는 줄만)
-- ─────────────────────────────────────────────────────────────
create view public.public_signature_episodes as
select e.article_id, e.series_key, e.episode
  from public.signature_episodes e
  join public.public_articles a on a.id = e.article_id;
revoke all on table public.public_signature_episodes from public, anon, authenticated, service_role;
grant select on table public.public_signature_episodes to anon, authenticated, service_role;

-- 연재 틀: 제목에 경력 연수 표기가 없으면 그대로, 있으면 (경력 표시 승인 + 근거 증빙 승인 + brand_copy 켜짐 + 근거 증빙이 인물 페이지의 약력 줄)일 때만 제목·근거 링크 재료를 낸다.
-- 표기 검사식은 brand_claim_token과 같다(anon 실행 함수를 늘리지 않으려고 식을 그대로 쓴다 — DB 시험이 둘을 대조한다)
create view public.public_signature_series as
with frames as (
  select k.series_key, k.ord, btrim(coalesce(s.value #>> '{}', '')) as title
    from (values ('signature', 'series_title_signature', 1), ('then_now', 'series_title_then_now', 2)) as k(series_key, setting_key, ord)
    left join public.settings s on s.key = k.setting_key
),
marked as (
  select f.*,
         regexp_replace(lower(normalize(f.title, NFKC)), '[­​-‍⁠﻿]', '', 'g')
           ~ '(?<![0-9])50[[:space:]_·.-]*(여[[:space:]_·.-]*)?(년(?!대)|年|주년|years?|yrs?|nyeon|nyun)|(?<![일이삼사오육칠팔구십백천만억])오십[[:space:]_·.-]*(여[[:space:]_·.-]*)?(년(?!대)|주년|해)|(?<![가-힣])쉰[[:space:]_·.-]*(해|년(?!대))|五十[[:space:]_·.-]*年|반세기|fifty[[:space:]_·.-]*years?|half[[:space:]_·.-]*(a[[:space:]_·.-]*)?century' as claim
    from frames f
),
basis as (
  select e.id as evidence_id, pp.slug
    from public.settings c
    join public.people_evidence e on e.approved and e.id::text = btrim(coalesce(c.value ->> 'basis_evidence_id', ''))
    join public.public_profile_pages pp on pp.person_id = e.person_id
    join public.public_person_bio b on b.person_id = e.person_id
   where c.key = 'career_claim_approved'
     and coalesce((c.value ->> 'approved')::boolean, false)
     and b.bio_items @> jsonb_build_array(jsonb_build_object('evidence_id', e.id::text))
     and exists (select 1 from public.settings f where f.key = 'feature_flags' and coalesce((f.value ->> 'brand_copy')::boolean, false))
   limit 1
)
select m.series_key,
       m.ord,
       case when m.title = '' then null
            when not m.claim then m.title
            when exists (select 1 from basis) then m.title
            else null end as title,
       m.claim and m.title <> '' and exists (select 1 from basis) as claim_shown,
       case when m.claim and m.title <> '' then (select b.slug from basis b) end as basis_person_slug,
       case when m.claim and m.title <> '' then (select b.evidence_id from basis b) end as basis_evidence_id,
       nullif(btrim(coalesce((select s.value #>> '{}' from public.settings s where s.key = 'column_cadence'), '')), '') as cadence,
       (select count(*) from public.public_signature_episodes pe where pe.series_key = m.series_key)::integer as episodes
  from marked m;
revoke all on table public.public_signature_series from public, anon, authenticated, service_role;
grant select on table public.public_signature_series to anon, authenticated, service_role;

create view public.public_then_now_items as
select i.article_id, i.position, i.label, i.then_text, i.now_text, i.source, i.source_url, i.base_year
  from public.then_now_items i
  join public.public_signature_episodes e on e.article_id = i.article_id and e.series_key = 'then_now'
 where length(btrim(i.source)) > 0 and i.base_year is not null;
revoke all on table public.public_then_now_items from public, anon, authenticated, service_role;
grant select on table public.public_then_now_items to anon, authenticated, service_role;
