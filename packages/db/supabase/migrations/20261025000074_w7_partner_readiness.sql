-- W7 5단계 — 제휴 준비 월 마감·규정 판단 값·알림 (PRD-01A NAV-16~20, docs/dev/W7_설계.md 2장)
-- 규정의 숫자(유사 판정 비율·부정평가 기준 점수·기간)는 이 표의 칸에 담당자가 원문을 보고 적는다 — 이 파일에 기본값·합격선·배점 숫자 0.
--
-- · news_partner_requirement_rules — 규정 버전마다 코드가 읽는 판단 값 3종(유사도 기준 · 부정평가 창/경고 · 외부 기고자 합산 여부).
--   규정 버전이 확정되면 고칠 수 없다(트리거). 비어 있으면 내부 기준(유사도)·'규정 값 없음'(부정평가)·합산 안 함.
-- · partner_readiness_monthly — 월 마감 행. 마감 행은 수정·삭제 거부, 재계산은 새 version 행. 규정 버전이 없으면 platform=internal 행(내부 정의만).
-- · partner_readiness_alerts — 같은 사유(종류·달·열쇠)의 알림은 1건. 확인 처리만 고칠 수 있다.

create table public.news_partner_requirement_rules (
  requirement_id bigint primary key references public.news_partner_requirements (id) on delete cascade,
  similarity_rule jsonb,
  penalty_rule jsonb,
  contributor_rule jsonb,
  updated_by text not null check (length(btrim(updated_by)) > 0),
  updated_at timestamptz not null default now(),
  constraint news_partner_requirement_rules_similarity_shape check (
    similarity_rule is null or (
      jsonb_typeof(similarity_rule) = 'object'
      and jsonb_typeof(similarity_rule -> 'sentence_similarity') = 'number'
      and (similarity_rule ->> 'sentence_similarity')::numeric between 0 and 1
      and jsonb_typeof(similarity_rule -> 'article_ratio') = 'number'
      and (similarity_rule ->> 'article_ratio')::numeric between 0 and 1
      and coalesce(similarity_rule ->> 'sentence_comparator', '') in ('gt', 'gte')
      and coalesce(similarity_rule ->> 'article_comparator', '') in ('gt', 'gte'))),
  constraint news_partner_requirement_rules_penalty_shape check (
    penalty_rule is null or (
      jsonb_typeof(penalty_rule) = 'object'
      and jsonb_typeof(penalty_rule -> 'window_months') = 'number'
      and (penalty_rule ->> 'window_months') ~ '^[0-9]{1,2}$'
      and (penalty_rule ->> 'window_months')::integer between 1 and 60
      and jsonb_typeof(penalty_rule -> 'warn_points') = 'number'
      and (penalty_rule ->> 'warn_points')::numeric > 0
      and coalesce(penalty_rule ->> 'comparator', '') in ('gt', 'gte'))),
  constraint news_partner_requirement_rules_contributor_shape check (
    contributor_rule is null or (jsonb_typeof(contributor_rule) = 'object' and jsonb_typeof(contributor_rule -> 'merge_external') = 'boolean'))
);

comment on table public.news_partner_requirement_rules is '규정 버전별 판단 값 (NAV-16·18·19·20) — 유사도 기준·부정평가 창·외부 기고자 합산. 확정 버전은 고칠 수 없다. 숫자는 담당자가 원문을 보고 입력';

create function public.news_partner_requirement_rules_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_id bigint;
begin
  v_id := case when tg_op = 'DELETE' then old.requirement_id else new.requirement_id end;
  select r.status into v_status from public.news_partner_requirements r where r.id = v_id;
  if v_status = 'confirmed' then
    raise exception '확정된 규정 버전의 판단 값은 고칠 수 없습니다 — 새 규정 버전으로 적으세요 (NAV-13)' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.news_partner_requirement_rules_guard() from public, anon, authenticated;

create trigger news_partner_requirement_rules_guard before insert or update or delete on public.news_partner_requirement_rules
  for each row execute function public.news_partner_requirement_rules_guard();

alter table public.news_partner_requirement_rules enable row level security;
revoke all on table public.news_partner_requirement_rules from anon, authenticated, service_role;
grant select, insert, update, delete on table public.news_partner_requirement_rules to service_role;

-- ─────────────────────────────────────────────────────────────
-- 월 마감 행 (NAV-17)
-- ─────────────────────────────────────────────────────────────
create table public.partner_readiness_monthly (
  id bigint generated always as identity primary key,
  month date not null check (month = date_trunc('month', month)::date),
  platform text not null check (platform in ('internal', 'naver', 'kakao')),
  requirement_id bigint references public.news_partner_requirements (id),
  requirement_version integer,
  version integer not null default 1 check (version >= 1),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  recompute_reason text,
  computed_at timestamptz not null default now(),
  frozen boolean not null default true,
  constraint partner_readiness_monthly_platform_requirement check ((platform = 'internal') = (requirement_id is null)),
  constraint partner_readiness_monthly_recompute check (version = 1 or length(btrim(coalesce(recompute_reason, ''))) > 0)
);

comment on table public.partner_readiness_monthly is '월별 제휴 준비 지표 (NAV-17) — 지표마다 분자·분모·정의. 마감 행은 바꾸지 않고 재계산은 새 version. 자체 생산 분자에 digest·정보 목록·opinion·sponsored 0';

create unique index partner_readiness_monthly_once on public.partner_readiness_monthly (month, platform, coalesce(requirement_id, 0), version);
create index partner_readiness_monthly_month_idx on public.partner_readiness_monthly (platform, month desc, version desc);

create function public.partner_readiness_monthly_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '마감된 월 지표 행은 고치거나 지울 수 없습니다 — 재계산은 새 version 행으로 (NAV-17)' using errcode = 'check_violation';
end;
$$;

revoke all on function public.partner_readiness_monthly_guard() from public, anon, authenticated;

create trigger partner_readiness_monthly_guard before update or delete on public.partner_readiness_monthly
  for each row execute function public.partner_readiness_monthly_guard();
create trigger partner_readiness_monthly_no_truncate before truncate on public.partner_readiness_monthly
  for each statement execute function public.partner_readiness_monthly_guard();

alter table public.partner_readiness_monthly enable row level security;
revoke all on table public.partner_readiness_monthly from anon, authenticated, service_role;
grant select, insert on table public.partner_readiness_monthly to service_role;

-- ─────────────────────────────────────────────────────────────
-- 알림 (NAV-17·19·20) — 같은 사유 1건
-- ─────────────────────────────────────────────────────────────
create table public.partner_readiness_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('penalty', 'column_share', 'zero_metric')),
  month date not null check (month = date_trunc('month', month)::date),
  key text not null check (length(btrim(key)) between 1 and 100),
  detail text not null check (length(btrim(detail)) between 1 and 500),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  constraint partner_readiness_alerts_once unique (kind, month, key),
  constraint partner_readiness_alerts_ack check ((acknowledged_at is null) = (acknowledged_by is null))
);

comment on table public.partner_readiness_alerts is '제휴 준비 경고 알림 (부정평가 누적·칼럼 비중·0 지표) — 같은 (종류, 달, 열쇠) 1건. 확인 처리만 고친다';

alter table public.partner_readiness_alerts enable row level security;
revoke all on table public.partner_readiness_alerts from anon, authenticated, service_role;
grant select, insert on table public.partner_readiness_alerts to service_role;
grant update (acknowledged_at, acknowledged_by) on table public.partner_readiness_alerts to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 경고 기준·다음 접수 목표 (둘 다 비어서 시작. 기준 숫자는 규정 원문을 보고 담당자가 정한다)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('readiness_warn', '{}'::jsonb, '제휴 준비 경고 기준 (NAV-17) — { "columnShareMax": 0~1 }. 비어 있으면 칼럼 비중 경고 기준 없음', 'migration:20261025000074'),
  ('news_next_intake', '{}'::jsonb, '다음 접수 목표 (NAV-16) — { "label", "target_month" }. 비어 있으면 대시보드 머리에 목표 접수 미정', 'migration:20261025000074')
on conflict (key) do nothing;
