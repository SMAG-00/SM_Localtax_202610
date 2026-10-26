-- W12-h h3 - 기사에 붙는 데이터 차트 (PRD-04 DATA-01 "기사의 차트는 stats_series ID와 기준연도로 고정")
-- 기사 본문 블록 형식(@ltr/editorial)은 건드리지 않고, 기사와 시계열의 연결 표를 따로 둔다. 연결은 승인된 시계열만 가능하고 기준연도는 그 시계열의 값으로 고정된다.
-- 새 기준연도가 승인되면 이전 승인본은 superseded로 남아 기사 차트는 그대로 열리고, 관리 화면이 "새 기준연도가 있는 기사"를 보인다.

create table public.article_data_charts (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id),
  series_id bigint not null references public.stats_series (id),
  base_year int not null check (base_year between 1990 and 2100),
  caption text check (caption is null or char_length(btrim(caption)) between 1 and 120),
  position int not null default 0 check (position between 0 and 50),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  unique (article_id, series_id)
);
comment on table public.article_data_charts is '기사-통계 시계열 연결(DATA-01) - 시계열 ID와 기준연도로 고정. 승인된 시계열만 연결, 연결 뒤 고치지 못하고 지우기만 가능';
create index article_data_charts_series_idx on public.article_data_charts (series_id);

create function public.article_data_charts_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.stats_series;
begin
  if tg_op = 'UPDATE' then
    raise exception '기사 차트 연결은 고칠 수 없습니다 - 지우고 다시 연결하세요' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.stats_series where id = new.series_id;
  if s.status not in ('approved', 'superseded') then
    raise exception '승인된 통계 시계열만 기사에 붙일 수 있습니다' using errcode = 'check_violation';
  end if;
  new.base_year := s.base_year;
  return new;
end;
$$;
revoke all on function public.article_data_charts_guard() from public, anon, authenticated;
create trigger article_data_charts_guard before insert or update on public.article_data_charts for each row execute function public.article_data_charts_guard();

alter table public.article_data_charts enable row level security;
revoke all on table public.article_data_charts from anon, authenticated, service_role;
grant select, insert, delete on table public.article_data_charts to service_role;

-- 공개 뷰 - 공개 기사에 붙은 승인 시계열만 (public_stats_series가 기능 키·승인 조건을 이미 건다). 새 기준연도 표시는 newer_base_year
create view public.public_article_data_charts as
select c.article_id, c.series_id, c.base_year, c.caption, c.position,
       (select max(n.base_year) from public.public_stats_series n where n.series_key = s.series_key and n.base_year > c.base_year) as newer_base_year
  from public.article_data_charts c
  join public.public_stats_series s on s.id = c.series_id
  join public.public_articles a on a.id = c.article_id;

revoke all on table public.public_article_data_charts from public, anon, authenticated, service_role;
grant select on table public.public_article_data_charts to anon, authenticated, service_role;
