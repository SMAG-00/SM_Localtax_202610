-- W4 17단계 — 분양 정보 (PRD-01B PR-04 · PR-01 · PR-05 · REG1-10, docs/dev/W4_설계.md 1장 17단계 · 2.1 · 2.3 · 2.4 · 2.10 · 3장 · 12장 #11·#12·#140~)
-- 이 파일에 실제 분양 공고·사업명·공급 규모·공고 기관은 없다 — 편집국이 공식 공고를 보고 넣는다(7장 5).
-- · 기능 키 supply_notices (2.4) — 꺼진 채로 더한다. 분양 광고 표시 기준 법률 검토 기록(12장 #12) 전에는 켜지 않는다.
--     꺼져 있으면 공개 뷰 public_supply_notices가 0행(목록 /realestate/supply는 지금처럼 하위 분야 목록·허브 ③·프로젝트 화면 분양 정보 요소 0)
-- · article_sources.kind에 sponsor_material(시행사·분양대행사가 준 분양 홍보 원고) — 값 목록 제약을 같은 이름으로 바꿔 적는다(값 더하기만)
-- · 발행 검사 — sponsor_material 출처가 있는 기사는 content_type = sponsored일 때만 발행·예약된다(보도·해설·가이드·오피니언·digest 거부).
--     이미 공개(예약)된 sponsored 밖 기사에 sponsor_material 출처를 넣거나, 공개 중인 그 기사의 유형을 sponsored 밖으로 바꾸는 것도 거부(한쪽만 우회한 쓰기도 실패 — 설계 8장)
--     발행 서비스(@ltr/editorial checks/sponsor-material.ts — pr04.sponsor-material-sponsored)와 같은 규칙
-- · supply_notices — 분양 정보 항목(기사와 분리한 정보 목록 — 원칙 ⑥). 칸 = 사업명·지역·연결 프로젝트(선택)·공급 규모·청약 일정(시작·마감)·
--     모집공고일·공고 기관·공식 공고 URL·확인일·공공누리 유형·상태. 공식 공고 URL·공고 기관·모집공고일·청약 일정·공공누리 유형은 늘 필수(제약),
--     공개(status public)는 확인일·공급 규모까지 있어야 한다. 지역 = 오늘(KST) 유효한 행정구역. 사업명·공급 규모·공고 기관 글자에 금액(숫자 + 원)·가격 낱말 0(트리거)
--     가격·분양가·분담금·수익률·시세 칸 0 (PR-05 — 시험 w4-price-fields가 표·공개 뷰의 칸 이름·칸 설명을 2.10 사전으로 본다). 분양가는 공식 공고 링크로만(12장 #11)
-- · 공개 뷰 public_supply_notices (anon) — 기능 키가 켜졌고 공개 + 확인일이 있는 항목만, 청약이 끝난 항목도 남는다(프로젝트 화면 기록 — PR-04).
--     '예정 목록'(/realestate/supply·지역 허브 ③)은 청약 마감일 다음 날 00:00(KST)부터 빠진다 — 공개 화면 함수가 그날 한국 날짜로 거른다(2.3 · 12장 #142)
--     연결 프로젝트는 공개 프로젝트(public_projects)일 때만 번호·주소·이름을 낸다. 작성자·상태 칸 0
-- · 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (article_sources.kind 값 목록에 한 값을 더하는 것만 같은 이름의 제약으로 바꿔 적는다)

-- ─────────────────────────────────────────────────────────────
-- 기능 키 supply_notices — 없을 때만 false로 더한다 (이미 있는 값은 그대로)
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = s.value || jsonb_build_object('supply_notices', false),
       updated_by = 'migration:20261023000051'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and not (s.value ? 'supply_notices');

-- ─────────────────────────────────────────────────────────────
-- 출처 종류 sponsor_material (2.1 article_source.kind — W2-a 7개 + 17단계)
-- ─────────────────────────────────────────────────────────────
alter table public.article_sources drop constraint article_sources_kind_check;
alter table public.article_sources
  add constraint article_sources_kind_check
  check (kind in ('official_doc', 'dataset', 'press_release', 'interview', 'field', 'photo', 'other', 'sponsor_material'));

comment on column public.article_sources.kind is '출처 종류 — official_doc 공식 문서 · dataset 공공 데이터 · press_release 보도자료 · interview 인터뷰 · field 현장 취재 · photo 사진 · other 기타 · sponsor_material 시행사·분양대행사가 준 분양 홍보 원고(이 출처가 있는 기사는 광고·협찬 sponsored로만 발행 — PR-04)';

-- ─────────────────────────────────────────────────────────────
-- 발행 검사 — 분양 홍보 원고는 sponsored로만 (PR-04)
-- ─────────────────────────────────────────────────────────────
create function public.sponsor_material_problem(p_article public.articles) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_article.content_type is distinct from 'sponsored'
     and exists (select 1 from public.article_sources s
                  where s.article_id = p_article.id and s.kind = 'sponsor_material'
                    and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id))
    then format('시행사·분양대행사가 준 분양 홍보 원고(출처 종류 sponsor_material)를 쓴 기사는 광고·협찬(sponsored)으로만 발행합니다 — 지금 유형 %s (PR-04, 기사 %s)',
                coalesce(p_article.content_type, '없음'), p_article.id)
  end;
$$;
revoke all on function public.sponsor_material_problem(public.articles) from public, anon, authenticated;

create function public.articles_sponsor_material_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.status in ('published', 'scheduled')
     and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled') or new.content_type is distinct from old.content_type) then
    v_problem := public.sponsor_material_problem(new);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.articles_sponsor_material_guard() from public, anon, authenticated;
create trigger articles_sponsor_material_guard
  before insert or update on public.articles
  for each row execute function public.articles_sponsor_material_guard();

-- 이미 공개(예약)된 sponsored 밖 기사에 분양 홍보 원고 출처를 넣거나 바꿔 다는 쓰기도 같은 규칙
create function public.article_sources_sponsor_material_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.articles;
begin
  if new.kind = 'sponsor_material'
     and (tg_op = 'INSERT' or old.kind is distinct from 'sponsor_material' or new.article_id is distinct from old.article_id) then
    select * into v_article from public.articles where id = new.article_id;
    if v_article.status in ('published', 'scheduled') and v_article.content_type is distinct from 'sponsored' then
      raise exception '공개(예약) 중인 기사(%)는 유형이 %이라 분양 홍보 원고(sponsor_material) 출처를 달 수 없습니다 — 광고·협찬(sponsored)으로만 발행합니다 (PR-04)',
        v_article.id, coalesce(v_article.content_type, '없음')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.article_sources_sponsor_material_guard() from public, anon, authenticated;
create trigger article_sources_sponsor_material_guard
  before insert or update on public.article_sources
  for each row execute function public.article_sources_sponsor_material_guard();

-- ─────────────────────────────────────────────────────────────
-- 분양 정보 항목
-- ─────────────────────────────────────────────────────────────
create table public.supply_notices (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  region_code text not null references public.regions (code),
  project_id bigint references public.projects (id),
  supply_scale text check (supply_scale is null or length(btrim(supply_scale)) between 1 and 200),
  apply_start date not null,
  apply_end date not null,
  notice_date date not null,
  notice_issuer text not null check (length(btrim(notice_issuer)) between 1 and 80),
  official_notice_url text not null check (official_notice_url ~* '^https?://[^[:space:]]+$' and length(official_notice_url) <= 500),
  verified_at timestamptz,
  license_type text not null check (license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  status text not null default 'draft' check (status in ('draft', 'public', 'hidden')),
  created_by text not null check (length(btrim(created_by)) > 0),
  updated_by text not null check (length(btrim(updated_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_notices_schedule check (apply_end >= apply_start),
  constraint supply_notices_public_record check (status <> 'public' or (verified_at is not null and supply_scale is not null))
);

comment on table public.supply_notices is '분양 정보 (PR-04) — 기사와 분리한 정보 목록. 가격·분양가·분담금·수익률·시세 칸 없음(PR-05, 시험 w4-price-fields) — 분양가는 공식 공고 링크로만(12장 #11). 공개는 status=public + 확인일 + 공급 규모, 공개 읽기는 뷰 public_supply_notices(기능 키 supply_notices)';
comment on column public.supply_notices.name is '사업명 — 공식 공고의 이름 그대로 (금액·가격 낱말 0)';
comment on column public.supply_notices.region_code is '지역 — 오늘(KST) 유효한 행정구역 코드만';
comment on column public.supply_notices.project_id is '연결 프로젝트 (PR-02, 선택) — 공개 화면에는 그 프로젝트가 공개일 때만 이어진다';
comment on column public.supply_notices.supply_scale is '공급 규모 — 공고에 적힌 세대 수 글자. 공개 전 필수';
comment on column public.supply_notices.apply_start is '청약 시작일 (공고 기준 한국 날짜)';
comment on column public.supply_notices.apply_end is '청약 마감일 — 다음 날 00:00(KST)부터 예정 목록에서 빠지고 프로젝트 화면 기록으로 남는다';
comment on column public.supply_notices.notice_date is '모집공고일 — 카드의 기준일';
comment on column public.supply_notices.notice_issuer is '공고 기관 — 카드의 출처';
comment on column public.supply_notices.official_notice_url is '공식 공고 주소 — 공개 화면은 링크만(원문 전재 0)';
comment on column public.supply_notices.verified_at is '확인일 — 편집자가 공식 공고와 대조한 시각. 공개 전 필수';
comment on column public.supply_notices.license_type is '공고의 공공누리 유형 (PR-07)';

create trigger supply_notices_touch before update on public.supply_notices
  for each row execute function public.touch_updated_at();

-- 글자의 금액·가격 표현 — 숫자(쉼표·소수점) + 큰 수 낱말 + 원('원문'·'원본'의 원은 금액이 아니다) · 가격 낱말.
-- 웹 규칙(apps/web/lib/admin/supply-rules.ts SUPPLY_PRICE_TEXT_RE)과 같은 식 — 시험이 같은 견본으로 둘을 본다
create function public.supply_text_has_price(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ '[0-9][0-9,.]*([[:space:]]*(조|억|천|백|만))*[[:space:]]*원(?!문|본)'
      or coalesce(p_text, '') ~ '(분양가|분담금|시세|프리미엄|웃돈|수익|가격)';
$$;
revoke all on function public.supply_text_has_price(text) from public, anon, authenticated;
grant execute on function public.supply_text_has_price(text) to service_role;

-- 저장 검사 — 지역(오늘 유효) · 글자의 금액·가격 표현
create function public.supply_notices_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if (tg_op = 'INSERT' or new.region_code is distinct from old.region_code) and not exists (
    select 1 from public.regions r
     where r.code = new.region_code
       and (r.valid_from is null or r.valid_from <= v_today)
       and (r.valid_to is null or r.valid_to >= v_today)
  ) then
    raise exception '분양 정보 지역 코드 %는 오늘 유효한 행정구역(regions)이 아닙니다', new.region_code using errcode = 'check_violation';
  end if;
  if public.supply_text_has_price(new.name) then
    raise exception '사업명(name)에 금액·가격 표현이 있습니다 — 분양 정보에는 가격을 싣지 않고 공식 공고 링크로만 잇습니다 (PR-04 · PR-05)' using errcode = 'check_violation';
  end if;
  if public.supply_text_has_price(new.supply_scale) then
    raise exception '공급 규모(supply_scale)에 금액·가격 표현이 있습니다 — 세대 수만 적습니다 (PR-04 · PR-05)' using errcode = 'check_violation';
  end if;
  if public.supply_text_has_price(new.notice_issuer) then
    raise exception '공고 기관(notice_issuer)에 금액·가격 표현이 있습니다 (PR-04 · PR-05)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.supply_notices_guard() from public, anon, authenticated;
create trigger supply_notices_guard
  before insert or update on public.supply_notices
  for each row execute function public.supply_notices_guard();

create index supply_notices_region_idx on public.supply_notices (region_code, apply_end);
create index supply_notices_project_idx on public.supply_notices (project_id) where project_id is not null;

-- 권한·RLS — 표는 service_role만
alter table public.supply_notices enable row level security;
revoke all on table public.supply_notices from anon, authenticated, service_role;
grant select, insert, update, delete on table public.supply_notices to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 기능 키 supply_notices 켜짐 + 공개 + 확인일. 청약이 끝난 항목도 남는다(프로젝트 화면 기록)
-- ─────────────────────────────────────────────────────────────
create view public.public_supply_notices as
select
  n.id,
  n.name,
  n.region_code,
  n.supply_scale,
  n.apply_start,
  n.apply_end,
  n.notice_date,
  n.notice_issuer,
  n.official_notice_url,
  n.verified_at,
  n.license_type,
  pp.id as project_id,
  pp.slug as project_slug,
  pp.name as project_name
from public.supply_notices n
left join public.public_projects pp on pp.id = n.project_id
where n.status = 'public'
  and n.verified_at is not null
  and n.supply_scale is not null
  and coalesce((select (f.value -> 'supply_notices') = 'true'::jsonb from public.settings f where f.key = 'feature_flags'), false);

comment on view public.public_supply_notices is '공개 분양 정보 (PR-04 · W4 17단계) — 기능 키 supply_notices가 켜졌고 공개 + 확인일 + 공급 규모가 있는 항목. 청약이 끝난 항목도 남는다(예정 목록은 화면 함수가 마감일 다음 날 00:00 KST부터 거른다). 연결 프로젝트는 공개 프로젝트일 때만. 작성자·상태 칸 0';
revoke all on table public.public_supply_notices from public, anon, authenticated, service_role;
grant select on table public.public_supply_notices to anon, authenticated, service_role;
