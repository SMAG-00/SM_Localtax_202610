-- W4 8단계 — 편집 경고·별도 상품 검토 큐·단계 순서·AI 초안 역할 (PRD-01B REG1-14 · REG1-17, docs/dev/W4_설계.md 1장 8단계 · 2.1 · 2.2 · 3장 · 6장 · 12장)
-- 이 파일에 실제 지역·기사 내용은 없다 — 값 목록과 저장·공개 규칙만 정한다. 발행 서비스(@ltr/editorial checks/regional-warnings.ts)와 같은 규칙을 DB가 한 번 더 본다.
-- · 설정 씨앗 stale_statistics_days(2.2 — 365, 1~3650 정수) — 오래된 통계 경고 기준(경고 자체는 편집 화면·발행 판정이 낸다, DB는 막지 않는다)
-- · separate_product_queue — 편집자가 여행 후기·맛집 추천·행사 홍보(비보도)로 판정한 원고마다 열린 항목 하나(원고·판정·판정자·시각·상태·메모 + 닫은 사람·시각).
--     판정이 비보도가 되면 트리거가 열린 항목 1건을 만들고(이미 열려 있으면 판정만 맞춘다), 판정이 기사 후보·없음으로 바뀌면 닫는다.
--     열린 항목이 있는 원고는 어떤 유형으로도 공개(발행·예약)되지 않는다 — 허브·뉴스 전체·공개 뷰(사이트맵 원본)·자체 취재 집계에 0.
--     공개(예약) 중인 원고는 비보도로 판정할 수 없다(유형과 상관없이 — 먼저 내린다). 닫힌 항목은 고치지 않는다. 표는 RLS 기본 거부·service_role만(관리 화면·API에 지우기 0).
-- · 단계 순서 (REG1-14 '초안 → 취재 검증 → 편집/세무 감수 → 승인 → 공개') — 지역 기사(지역 태그 또는 지자체뉴스, 광고·협찬 제외)의 상태 바꾸기:
--     처음 공개(발행·예약)는 승인(approved)에서만 · 승인(approved)은 현재 판 편집 승인(editorial_status = approved)이 있어야, 세무 감수 반려·보류면 거부.
--     이미 공개된 적 있는 기사의 다시 공개·새 행 넣기(이관·시드 — 7단계 발행 검사는 그대로)는 이 규칙 밖.
-- · AI 초안 역할 ai_drafter — 로그인 0·RLS 우회 0·표 쓰기 권한 0. articles·article_sources에는 이 역할에 대한 제한 정책(using false · with check false)을 더해
--     권한을 잘못 주더라도 RLS가 쓰기를 거부한다 (REG1-14 'AI 초안은 공개 테이블에 직접 쓰지 않는다' · PRD-00 원칙 5)
-- · 기존 표·칸·제약·값은 바꾸지 않는다

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 2.2 stale_statistics_days (12장 #23 — 365, 설정으로 바꿈)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('stale_statistics_days', '365'::jsonb,
   '오래된 통계 경고 기준 (REG1-14) — 통계 자료의 기준일이 오늘(한국 날짜)보다 이 일수를 넘겨 앞서면 지역 기사 편집 화면에 경고. 기준 당일은 0건, 하루 넘김 1건. 1~3650 정수',
   'migration:20261022000044')
on conflict (key) do nothing;

create function public.stale_statistics_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'number'
     or (new.value #>> '{}') !~ '^[0-9]+$'
     or (new.value #>> '{}')::numeric < 1 or (new.value #>> '{}')::numeric > 3650 then
    raise exception '오래된 통계 경고 기준(stale_statistics_days)은 1~3650 정수입니다 (지금 %)', new.value using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.stale_statistics_settings_guard() from public, anon, authenticated;
create trigger settings_stale_statistics_guard
  before insert or update on public.settings
  for each row when (new.key = 'stale_statistics_days')
  execute function public.stale_statistics_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 지역 기사 — 지역 태그 또는 지자체뉴스, 광고·협찬 제외 (7단계 편집 승인 검사와 같은 범위, @ltr/editorial isRegionalArticle)
-- ─────────────────────────────────────────────────────────────
create function public.is_regional_article(p_article public.articles) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_article.content_type is distinct from 'sponsored'
     and (cardinality(p_article.region_codes) > 0 or p_article.section = 'local');
$$;
revoke all on function public.is_regional_article(public.articles) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- separate_product_queue — 별도 상품 검토 큐 (3장 44 · 2.1 separate_product_queue.status)
-- ─────────────────────────────────────────────────────────────
create table public.separate_product_queue (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  judgement text not null constraint separate_product_queue_judgement_check
    check (judgement in ('travel_review', 'restaurant_pick', 'event_promo')),
  judged_by text not null check (length(btrim(judged_by)) > 0),          -- user:<uuid> (audit_logs와 같은 형식)
  at timestamptz not null default now(),                                  -- 판정 시각
  status text not null default 'open' constraint separate_product_queue_status_check check (status in ('open', 'closed')),
  note text check (note is null or length(note) <= 500),                 -- 닫을 때 사유(결정 — 광고·협찬 상품으로 전환·행사안내 등록(W6)·폐기 등)
  closed_by text,
  closed_at timestamptz,
  constraint separate_product_queue_closed_record check (
    (status = 'open' and closed_by is null and closed_at is null)
    or (status = 'closed' and length(btrim(coalesce(closed_by, ''))) > 0 and closed_at is not null and length(btrim(coalesce(note, ''))) > 0))
);

comment on table public.separate_product_queue is '별도 상품 검토 큐 (REG1-14·17 — W4 8단계). 여행 후기·맛집 추천·행사 홍보로 판정한 원고마다 열린 항목 하나. 열린 항목이 있는 원고는 공개되지 않는다. 공개 뷰·집계에 없다';
comment on column public.separate_product_queue.note is '메모 — 닫을 때 필수(결정 사유)';

create unique index separate_product_queue_one_open on public.separate_product_queue (article_id) where status = 'open';
create index separate_product_queue_status_idx on public.separate_product_queue (status, at desc);

-- 넣기: 열린 항목으로만, 판정은 그 원고의 지금 판정과 같아야 / 고치기: 닫힌 항목·원고 번호는 그대로, 닫힘 → 열림 0
create function public.separate_product_queue_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judgement text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception '별도 상품 검토 항목은 열린 상태(open)로만 넣습니다' using errcode = 'check_violation';
    end if;
    select a.editorial_judgement into v_judgement from public.articles a where a.id = new.article_id;
    if v_judgement is distinct from new.judgement then
      raise exception '별도 상품 검토 항목의 판정(%)이 기사 %의 편집자 판정(%)과 다릅니다 — 판정은 /api/admin/regions op judge로 합니다', new.judgement, new.article_id, coalesce(v_judgement, '없음')
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'closed' then
    raise exception '닫힌 별도 상품 검토 항목(%)은 고칠 수 없습니다 — 다시 판정하면 새 항목이 열립니다', old.id using errcode = 'check_violation';
  end if;
  if new.article_id is distinct from old.article_id then
    raise exception '별도 상품 검토 항목의 기사 번호는 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.separate_product_queue_guard() from public, anon, authenticated;
create trigger separate_product_queue_guard
  before insert or update on public.separate_product_queue
  for each row execute function public.separate_product_queue_guard();

alter table public.separate_product_queue enable row level security;
revoke all on table public.separate_product_queue from anon, authenticated, service_role;
grant select, insert, update, delete on table public.separate_product_queue to service_role;   -- 관리자 전체 권한(ADM) — 지우기는 화면·API에 없다

-- 판정 ↔ 큐 맞추기 — 비보도 판정이 되면 열린 항목 1건(있으면 판정만 맞춤), 기사 후보·없음으로 바뀌면 열린 항목을 닫는다
create function public.articles_separate_product_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.separate_product_queue;
begin
  select * into v_open from public.separate_product_queue q where q.article_id = new.id and q.status = 'open' for update;
  if new.editorial_judgement in ('travel_review', 'restaurant_pick', 'event_promo') then
    if v_open.id is null then
      insert into public.separate_product_queue (article_id, judgement, judged_by, at)
      values (new.id, new.editorial_judgement, new.judged_by, coalesce(new.judged_at, now()));
    elsif v_open.judgement is distinct from new.editorial_judgement then
      update public.separate_product_queue
         set judgement = new.editorial_judgement, judged_by = new.judged_by, at = coalesce(new.judged_at, now())
       where id = v_open.id;
    end if;
  elsif v_open.id is not null then
    update public.separate_product_queue
       set status = 'closed',
           closed_by = coalesce(nullif(btrim(coalesce(new.judged_by, '')), ''), v_open.judged_by),
           closed_at = now(),
           note = format('편집자 판정이 %s(으)로 바뀌어 닫힘', coalesce(new.editorial_judgement, '없음'))
     where id = v_open.id;
  end if;
  return null;
end;
$$;
revoke all on function public.articles_separate_product_sync() from public, anon, authenticated;
create trigger articles_separate_product_sync_insert
  after insert on public.articles
  for each row when (new.editorial_judgement is not null)
  execute function public.articles_separate_product_sync();
create trigger articles_separate_product_sync_update
  after update of editorial_judgement on public.articles
  for each row when (old.editorial_judgement is distinct from new.editorial_judgement)
  execute function public.articles_separate_product_sync();

-- ─────────────────────────────────────────────────────────────
-- 공개 검사 — 별도 상품 검토 큐 · 단계 순서 (트리거 이름 순서상 7단계 articles_regional_gate 뒤에 돈다 — 7단계 문장이 먼저 나온다)
-- ─────────────────────────────────────────────────────────────
create function public.articles_stage_order() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entering boolean := new.status in ('published', 'scheduled') and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled'));
  v_item bigint;
begin
  -- ① 공개(예약) 중인 원고를 비보도로 판정해 큐로 보내지 않는다 (유형과 상관없이 — 먼저 내린다)
  if new.status in ('published', 'scheduled')
     and new.editorial_judgement in ('travel_review', 'restaurant_pick', 'event_promo')
     and (tg_op = 'INSERT' or new.editorial_judgement is distinct from old.editorial_judgement) then
    raise exception '공개(예약) 중인 원고는 여행 후기·맛집 추천·행사 홍보로 판정해 별도 상품 검토 큐로 보낼 수 없습니다 — 먼저 내린 뒤 판정하세요 (REG1-14·17, 기사 %)', new.id
      using errcode = 'check_violation';
  end if;
  -- ② 별도 상품 검토 큐에 열린 항목이 있는 원고는 공개하지 않는다
  if v_entering and tg_op = 'UPDATE' then
    select q.id into v_item from public.separate_product_queue q where q.article_id = new.id and q.status = 'open' limit 1;
    if v_item is not null then
      raise exception '별도 상품 검토 큐에 열린 항목(%)이 있는 원고는 공개할 수 없습니다 — /admin/regions에서 검토를 닫은 뒤 발행하세요 (REG1-14·17, 기사 %)', v_item, new.id
        using errcode = 'check_violation';
    end if;
  end if;
  -- ③ 단계 순서 — 지역 기사의 상태 바꾸기만 (새 행 넣기는 이관·시드)
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and (public.is_regional_article(old) or public.is_regional_article(new)) then
    if v_entering and old.status <> 'approved' and old.first_published_at is null then
      raise exception '지역 기사는 승인 단계를 거쳐야 공개합니다 — 지금 상태(%)에서 바로 공개할 수 없습니다 (초안 → 취재 검증 → 편집/세무 감수 → 승인 → 공개, REG1-14, 기사 %)', old.status, new.id
        using errcode = 'check_violation';
    end if;
    if new.status = 'approved' then
      if new.editorial_status is distinct from 'approved' then
        raise exception '편집 승인 기록 없이 승인 단계로 갈 수 없습니다 — 편집 감수를 먼저 받으세요 (취재 검증 → 승인 건너뛰기 금지, REG1-14, 기사 %)', new.id
          using errcode = 'check_violation';
      end if;
      if new.tax_review_status in ('rejected', 'held') then
        raise exception '세무 감수가 반려·보류된 원고는 승인 단계로 갈 수 없습니다 (REG1-14, 기사 %)', new.id using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.articles_stage_order() from public, anon, authenticated;
create trigger articles_stage_order
  before insert or update on public.articles
  for each row execute function public.articles_stage_order();

-- ─────────────────────────────────────────────────────────────
-- AI 초안 역할 — 공개 표 쓰기 0 (REG1-14 · PRD-00 원칙 5 · PRD-01A RLS 표 'AI 초안 역할의 공개 테이블 쓰기 0')
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'ai_drafter') then
    create role ai_drafter nologin noinherit nobypassrls;
  end if;
end
$$;
comment on role ai_drafter is 'AI 초안·자동 수집 역할 (REG1-14) — 로그인 0·RLS 우회 0·공개 표 쓰기 권한 0. articles·article_sources에는 쓰기 거부 제한 정책. 초안 저장 자리는 2단계 workflows(초안·검수 큐 전용)에서 정한다';
-- 시험(로컬 DB의 postgres 연결)이 이 역할로 바꿔 쓰기를 시도할 수 있게 — 이 역할의 권한은 없으므로 물려받는 것도 없다
grant ai_drafter to postgres;
grant usage on schema public to ai_drafter;

create policy articles_ai_drafter_deny on public.articles
  as restrictive for all to ai_drafter using (false) with check (false);
create policy article_sources_ai_drafter_deny on public.article_sources
  as restrictive for all to ai_drafter using (false) with check (false);
