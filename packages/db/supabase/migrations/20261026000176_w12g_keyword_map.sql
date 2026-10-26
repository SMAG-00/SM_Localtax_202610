-- W12-g g1 - 키워드 맵 집계 (PRD-04 CASE-06, docs/dev/W12-g_설계.md 1장·3장)
-- · 승인된 쟁점 태그가 붙은 공개 결정례만 센다. 원본은 W11-d의 공개 뷰 public_case_issue_tags(승인된 연결 + 지금 승인본 태그 + 공개 가능한 결정례)뿐이라
--   제안 상태 태그·폐기 태그·비공개 결정례는 어떤 뷰에도 0행이다.
-- · 노드 건수와 목록 건수는 같은 뷰(public_keyword_map_docs)를 세므로 어긋나지 않는다. 조회 때마다 세므로 '매일 재계산'은 공개 데이터 캐시 주기(30초)로 대신한다.
-- · settings.keyword_map_policy = { "max_nodes": 1~50, "min_docs": 1 이상 } (PO 입력 - 씨앗은 빈 값). 비어 있거나 기능 키 keyword_map이 꺼져 있으면 모든 뷰가 0행이다.
-- · 이 파일에 쟁점 태그 이름·결정례 내용은 없다. AI는 이 흐름에 없다.

create or replace function public.settings_keyword_map_policy_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
begin
  if new.key <> 'keyword_map_policy' then
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'object' then
    raise exception 'keyword_map_policy는 객체여야 합니다' using errcode = '23514';
  end if;
  if new.value = '{}'::jsonb then
    return new;
  end if;
  for k in select jsonb_object_keys(new.value) loop
    if k not in ('max_nodes', 'min_docs') then
      raise exception 'keyword_map_policy에 허용되지 않는 칸: %', k using errcode = '23514';
    end if;
  end loop;
  if not (new.value ? 'max_nodes') or jsonb_typeof(new.value -> 'max_nodes') <> 'number' or (new.value ->> 'max_nodes') !~ '^[0-9]+$'
     or (new.value ->> 'max_nodes')::numeric not between 1 and 50 then
    raise exception 'keyword_map_policy.max_nodes는 1~50 정수여야 합니다' using errcode = '23514';
  end if;
  if new.value ? 'min_docs' and (jsonb_typeof(new.value -> 'min_docs') <> 'number' or (new.value ->> 'min_docs') !~ '^[0-9]+$' or (new.value ->> 'min_docs')::numeric < 1) then
    raise exception 'keyword_map_policy.min_docs는 1 이상 정수여야 합니다' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.settings_keyword_map_policy_check() from public, anon, authenticated;

drop trigger if exists settings_keyword_map_policy_check on public.settings;
create trigger settings_keyword_map_policy_check
  before insert or update of value on public.settings
  for each row execute function public.settings_keyword_map_policy_check();

-- 정책 - 기능 키가 켜지고 max_nodes가 있을 때만 1행. 이 뷰가 비면 아래 뷰도 모두 비어 있다 (설정 표는 공개 읽기 목록 밖이라 뷰 소유자 권한으로 읽는다)
create view public.public_keyword_map_policy as
select (s.value ->> 'max_nodes')::int as max_nodes,
       coalesce((s.value ->> 'min_docs')::int, 1) as min_docs
  from public.settings s
 where s.key = 'keyword_map_policy'
   and jsonb_typeof(s.value) = 'object'
   and s.value ? 'max_nodes'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'keyword_map') = 'true'::jsonb);

-- 세목 x 결정례 1행 - 그 결정례에 붙은 승인 태그 키(정렬된 배열). 결정례가 여러 세목이면 세목마다 1행
create view public.public_keyword_map_docs as
select t.tax_kind,
       c.case_id,
       array_agg(c.tag_key order by c.tag_key) as tag_keys,
       array_agg(c.label order by c.tag_key) as labels,
       d.doc_type, d.issuer, d.doc_no, d.decided_on
  from public.public_case_issue_tags c
  join public.public_legal_docs d on d.id = c.case_id
 cross join lateral unnest(d.tax_kinds) as t(tax_kind)
 where exists (select 1 from public.public_keyword_map_policy)
 group by t.tax_kind, c.case_id, d.doc_type, d.issuer, d.doc_no, d.decided_on;

-- 노드 - 세목마다 결정례 수 상위 max_nodes개 (건수 같으면 태그 키 순), min_docs 미만 제외
create view public.public_keyword_map_nodes as
with src as (
  select d.tax_kind, u.tag_key, u.label, d.case_id
    from public.public_keyword_map_docs d
   cross join lateral unnest(d.tag_keys, d.labels) as u(tag_key, label)
), agg as (
  select tax_kind, tag_key, min(label) as label, count(distinct case_id)::int as n
    from src
   group by tax_kind, tag_key
), ranked as (
  select a.*, (row_number() over (partition by a.tax_kind order by a.n desc, a.tag_key))::int as rk
    from agg a
)
select r.tax_kind, r.tag_key, r.label, r.n, r.rk as rank
  from ranked r
  join public.public_keyword_map_policy p on r.rk <= p.max_nodes and r.n >= p.min_docs;

-- 연결선 - 같은 결정례에 함께 붙은 두 태그(둘 다 노드에 든 것만). 건수 = 둘이 함께 붙은 결정례 수
create view public.public_keyword_map_edges as
select d.tax_kind, a.tag_key as tag_a, b.tag_key as tag_b, count(*)::int as n
  from public.public_keyword_map_docs d
 cross join lateral unnest(d.tag_keys) as a(tag_key)
 cross join lateral unnest(d.tag_keys) as b(tag_key)
 where a.tag_key < b.tag_key
   and exists (select 1 from public.public_keyword_map_nodes x where x.tax_kind = d.tax_kind and x.tag_key = a.tag_key)
   and exists (select 1 from public.public_keyword_map_nodes x where x.tax_kind = d.tax_kind and x.tag_key = b.tag_key)
 group by d.tax_kind, a.tag_key, b.tag_key;

revoke all on table public.public_keyword_map_policy, public.public_keyword_map_docs, public.public_keyword_map_nodes, public.public_keyword_map_edges from public, anon, authenticated, service_role;
grant select on table public.public_keyword_map_policy, public.public_keyword_map_docs, public.public_keyword_map_nodes, public.public_keyword_map_edges to anon, authenticated, service_role;

comment on view public.public_keyword_map_docs is '키워드 맵 목록 원본(W12-g) - 승인 태그만, 세목 x 결정례 1행. 노드 건수와 같은 원본';
comment on view public.public_keyword_map_nodes is '키워드 맵 노드(W12-g) - 세목별 상위 max_nodes, 건수 = 이 노드 태그를 가진 목록 행 수';
