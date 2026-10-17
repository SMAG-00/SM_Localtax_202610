-- W2-b 1단계 DB — 홈 배치 home_curations (PRD-01A HOME-03 · ADM-01 홈 큐레이션). PRD에 표 이름이 없어 이 이름으로 정했다 (설계 6장)
-- · kind 2종: tracker(개정 트래커 하이라이트 — amendment_id) · story(해설 스토리 — article_id). 대상은 하나만
-- · 노출 기간 = 한국 날짜 starts_on ~ ends_on (그날까지, ends_on이 비면 끝 없음). ends_on ≥ starts_on
-- · 같은 날 보이는 카드 수: tracker 3장, story 6장까지 — 기간이 겹치는 날마다 센다 (7장째 스토리 거부). 끝난 카드는 겹치지 않으면 세지 않는다
-- · 같은 대상을 기간이 겹치게 두 번 지정하면 거부. 스토리 대상이 광고(sponsored)·금주 핫뉴스(digest)면 거부
-- · 순서는 sort(작은 것부터, 같으면 번호). 대상이 지워지면 배치도 지워진다

create table public.home_curations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('tracker', 'story')),
  amendment_id bigint references public.amendments (id) on delete cascade,
  article_id bigint references public.articles (id) on delete cascade,
  sort integer not null default 0,
  starts_on date not null,
  ends_on date,
  created_by text not null check (length(btrim(created_by)) > 0),   -- user:<uuid> · admin:<이메일>
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_curations_target check (
    (kind = 'tracker' and amendment_id is not null and article_id is null)
    or (kind = 'story' and article_id is not null and amendment_id is null)),
  constraint home_curations_period check (ends_on is null or ends_on >= starts_on)
);

comment on table public.home_curations is '홈 배치 (HOME-03) — 트래커 하이라이트 하루 3장·해설 스토리 하루 6장까지, 노출 기간(한국 날짜)이 끝나면 공개 0';

create index home_curations_kind_idx on public.home_curations (kind, starts_on, ends_on);
create index home_curations_article_idx on public.home_curations (article_id);
create index home_curations_amendment_idx on public.home_curations (amendment_id);

create trigger home_curations_touch before update on public.home_curations
  for each row execute function public.touch_updated_at();

create function public.home_curations_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := case new.kind when 'tracker' then 3 else 6 end;
  v_end date := coalesce(new.ends_on, 'infinity'::date);
  v_day date;
  v_count integer;
  v_type text;
  v_label text := case new.kind when 'tracker' then '개정 트래커 하이라이트' else '해설 스토리' end;
begin
  -- 배치를 동시에 더하는 두 요청이 서로를 못 보는 일을 막는다. 종류와 상관없이 잠금 하나 — 두 종류를 한 트랜잭션에서
  -- 다른 순서로 더해도 교착(deadlock)이 생기지 않게
  perform pg_advisory_xact_lock(hashtextextended('home_curations', 0));

  if new.kind = 'story' then
    select a.content_type into v_type from public.articles a where a.id = new.article_id;
    if v_type in ('sponsored', 'digest') then
      raise exception '광고(sponsored)·금주 핫뉴스(digest)는 해설 스토리 카드로 둘 수 없습니다 (HOME-03 · 원칙 ⑥)'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 같은 대상의 기간 겹침
  if exists (
    select 1 from public.home_curations h
     where h.kind = new.kind and h.id is distinct from new.id
       and h.amendment_id is not distinct from new.amendment_id
       and h.article_id is not distinct from new.article_id
       and h.starts_on <= v_end and new.starts_on <= coalesce(h.ends_on, 'infinity'::date)
  ) then
    raise exception '같은 대상이 겹치는 기간에 이미 배치되어 있습니다 — 기간을 고치세요 (HOME-03)'
      using errcode = 'check_violation';
  end if;

  -- 같은 날 보이는 카드 수 — 겹치는 구간의 시작일마다 세면 최대값을 놓치지 않는다
  for v_day in
    select new.starts_on
    union
    select h.starts_on from public.home_curations h
     where h.kind = new.kind and h.id is distinct from new.id
       and h.starts_on > new.starts_on and h.starts_on <= v_end
  loop
    select count(*) + 1 into v_count from public.home_curations h
     where h.kind = new.kind and h.id is distinct from new.id
       and h.starts_on <= v_day and coalesce(h.ends_on, 'infinity'::date) >= v_day;
    if v_count > v_limit then
      raise exception '%는 같은 날 %장까지입니다 — %에 %장째가 됩니다. 끝나는 카드를 빼거나 기간을 고치세요 (HOME-03)', v_label, v_limit, v_day, v_count
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.home_curations_guard() from public, anon, authenticated;

create trigger home_curations_guard
  before insert or update on public.home_curations
  for each row execute function public.home_curations_guard();

alter table public.home_curations enable row level security;
revoke all on table public.home_curations from anon, authenticated, service_role;
grant select, insert, update, delete on table public.home_curations to service_role;
