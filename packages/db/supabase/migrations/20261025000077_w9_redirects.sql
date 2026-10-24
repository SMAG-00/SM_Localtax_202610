-- W9 준비 — 옛 주소 이동표 redirects (PRD-01A 6.1 · MIG-02, docs/dev/W9_설계.md 3장)
-- 표만 만든다. 행은 0 — 전환 때 scripts/migration이 만든 redirects.sql로 채운다. 이 마이그레이션은 W9 실행 전까지 원격에 적용하지 않는다(PO 결정 2026-10-25).
--  · 상태 301·308 = 새 주소로, 404·410 = 이관하지 않는 쪽(사유 필수)
--  · 옛 기사 주소가 새 홈('/')으로 가는 행 0, 제자리 이동 0, 연쇄 0(도착이 다른 행의 옛 주소이거나 이 행의 옛 주소가 다른 행의 도착이면 거부)
--  · origin: legacy_site(현 사이트 이관) · v12_deploy(v1.2 문서 경로가 배포된 적이 있을 때, 예: /region → /local)
--  · region_slug_redirects(지역 slug 변경)와 다른 표다. 읽기는 service_role만 — proxy가 서버 키로 한 건씩 찾는다

create table public.redirects (
  id bigint generated always as identity primary key,
  old_path text not null unique check (old_path ~ '^/[^[:space:]#]*$' and length(old_path) <= 500),
  new_path text check (new_path is null or (new_path ~ '^/[^[:space:]?#]*$' and length(new_path) <= 500)),
  status smallint not null check (status in (301, 308, 404, 410)),
  reason text,
  origin text not null check (origin in ('legacy_site', 'v12_deploy')),
  created_at timestamptz not null default now(),
  constraint redirects_target_by_status check ((status in (301, 308)) = (new_path is not null)),
  constraint redirects_reason_for_gone check (status in (301, 308) or length(btrim(coalesce(reason, ''))) > 0),
  constraint redirects_not_in_place check (new_path is null or new_path <> old_path),
  constraint redirects_home_only_for_home check (new_path is distinct from '/' or old_path = '/')
);

comment on table public.redirects is '옛 주소 이동표 (MIG-02) — 301·308은 새 주소로 한 번에, 404·410은 사유 필수. 연쇄 0(트리거). service_role만 읽는다';

create function public.redirects_no_chain() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.new_path is not null and exists (select 1 from public.redirects r where r.old_path = new.new_path and r.id is distinct from new.id) then
    raise exception '연쇄 이동입니다: % 는 다른 행의 옛 주소입니다 (MIG-02 연쇄 0)', new.new_path
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.redirects r where r.new_path = new.old_path and r.id is distinct from new.id) then
    raise exception '연쇄 이동입니다: % 로 가는 다른 행이 있습니다 (MIG-02 연쇄 0)', new.old_path
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.redirects_no_chain() from public, anon, authenticated;

create trigger redirects_no_chain
  before insert or update on public.redirects
  for each row execute function public.redirects_no_chain();

alter table public.redirects enable row level security;
revoke all on table public.redirects from anon, authenticated, service_role;
grant select, insert, update, delete on table public.redirects to service_role;
