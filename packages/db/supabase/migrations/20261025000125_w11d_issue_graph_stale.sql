-- W11-d d7 - 연결 조문 개정 신호 (PRD-03 AIOPS-11 · LINK-01 '개정 반영 검토 중' 배지, docs/dev/W11-d_설계.md 5장)
-- 이 파일에 법령 문장은 없다. 지도 노드가 가리키는 조문(law_articles)과 같은 법령의 더 새로운 개정판(law_events kind revision)에 같은 조 번호의 글이 달라졌거나 없어졌으면
-- 지도에 개정 신호(stale_reason)를 달고 검수 큐(review_items kind issue_graph_stale) 항목을 만든다.
--
-- · 개정 판정 - 해시만 바뀐 body_only 사건은 개정이 아니다 (law_events kind revision인 개정판만 본다). 조 글이 같으면 신호 0.
-- · (지도 버전, 새 개정판) 하나에 검수 항목 1건 - 크론이 매일 돌아도 중복 0 (review_items (kind, source_key) 유일 + 신호 표 유일).
-- · 신호 행은 추가만. 검수 항목이 끝나면(published·rejected) 지도의 stale_reason을 비운다 - 다음 실행 때 같은 항목을 다시 만들지 않는다.
-- · 룰셋·가이드·지도 본문은 자동으로 바뀌지 않는다 (사람이 새 버전을 만들어 서명). AI는 쓰지 않는다.
-- service_role만 실행한다.

create table public.issue_graph_signals (
  id bigint generated always as identity primary key,
  graph_id bigint not null references public.issue_graphs (id),
  node_id text not null check (node_id ~ '^n[0-9]{1,3}$'),
  law_id bigint not null references public.laws (id),
  article_no int not null check (article_no > 0),
  branch_no int not null check (branch_no >= 0),
  from_version_id bigint not null references public.law_versions (id),
  to_version_id bigint not null references public.law_versions (id),
  change text not null check (change in ('text_changed', 'removed')),
  review_item_id bigint not null references public.review_items (id),
  detected_at timestamptz not null default now(),
  unique (graph_id, node_id, to_version_id)
);
comment on table public.issue_graph_signals is '쟁점 지도 개정 신호 기록 - 추가만. 어느 노드의 조문이 어느 새 개정판에서 바뀌었는지와 만든 검수 항목';
create trigger issue_graph_signals_append_only before update or delete on public.issue_graph_signals for each row execute function public.append_only_guard();
alter table public.issue_graph_signals enable row level security;
revoke all on table public.issue_graph_signals from anon, authenticated, service_role;
grant select on table public.issue_graph_signals to service_role;

-- 바뀐 노드 목록 (내부용 뷰 - 권한 없음). 지도 노드 조문이 속한 개정판보다 새 '개정' 사건 개정판(가장 최근 1개)에서 같은 조 글이 다르거나 없는 경우
create view public.issue_graph_changes as
  select g.id as graph_id, g.slug, g.version as graph_version, x.node ->> 'node_id' as node_id,
         v.law_id, a.article_no, a.branch_no, v.id as from_version_id, lv.id as to_version_id,
         case when na.id is null then 'removed' else 'text_changed' end as change
    from public.issue_graphs g
   cross join lateral jsonb_array_elements(g.nodes) as x(node)
    join public.law_articles a on x.node ->> 'kind' = 'law_article' and a.id = (x.node ->> 'ref_id')::bigint
    join public.law_versions v on v.id = a.version_id
   cross join lateral (
     select nv.id
       from public.law_versions nv
       join public.law_events ev on ev.version_id = nv.id and ev.kind = 'revision'
      where nv.law_id = v.law_id and (nv.effective_on > v.effective_on or (nv.effective_on = v.effective_on and nv.id > v.id))
      order by nv.effective_on desc, nv.id desc
      limit 1) as lv
    left join public.law_articles na on na.version_id = lv.id and na.article_no = a.article_no and na.branch_no = a.branch_no
   where g.status in ('in_review', 'signed', 'published')
     and (na.id is null or na.body is distinct from a.body);
revoke all on table public.issue_graph_changes from public, anon, authenticated, service_role;

create function public.issue_graph_stale_detect()
returns table (items_created integer, items_existing integer, graphs_stale integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_item bigint;
  v_rows integer;
  v_created integer := 0;
  v_existing integer := 0;
  v_stale integer;
  v_key text;
begin
  for r in
    select c.graph_id, c.slug, c.graph_version, c.to_version_id, c.law_id, l.name as law_name, nv.promulgation_no, nv.effective_on,
           jsonb_agg(jsonb_build_object('nodeId', c.node_id, 'articleNo', c.article_no, 'branchNo', c.branch_no, 'change', c.change) order by c.node_id) as nodes,
           (select ev.snapshot_id from public.law_events ev where ev.version_id = c.to_version_id and ev.kind = 'revision' order by ev.id limit 1) as snapshot_id
      from public.issue_graph_changes c
      join public.laws l on l.id = c.law_id
      join public.law_versions nv on nv.id = c.to_version_id
     group by c.graph_id, c.slug, c.graph_version, c.to_version_id, c.law_id, l.name, nv.promulgation_no, nv.effective_on
     order by c.graph_id, c.to_version_id
  loop
    v_key := format('issue_graph:%s:%s', r.graph_id, r.to_version_id);
    insert into public.review_items (kind, source_key, title, data_source_key, snapshot_id, payload, created_by)
    values ('issue_graph_stale', v_key, left(format('쟁점 지도 %s v%s - %s 개정 반영 검토', r.slug, r.graph_version, r.law_name), 200), 'law_api', r.snapshot_id,
            jsonb_build_object('graphId', r.graph_id, 'slug', r.slug, 'graphVersion', r.graph_version, 'lawId', r.law_id, 'lawName', r.law_name,
                               'toVersionId', r.to_version_id, 'promulgationNo', r.promulgation_no, 'effectiveOn', r.effective_on, 'nodes', r.nodes),
            'job:issue-graph-stale')
    on conflict (kind, source_key) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
    select i.id into v_item from public.review_items i where i.kind = 'issue_graph_stale' and i.source_key = v_key;
    insert into public.issue_graph_signals (graph_id, node_id, law_id, article_no, branch_no, from_version_id, to_version_id, change, review_item_id)
    select c.graph_id, c.node_id, c.law_id, c.article_no, c.branch_no, c.from_version_id, c.to_version_id, c.change, v_item
      from public.issue_graph_changes c
     where c.graph_id = r.graph_id and c.to_version_id = r.to_version_id
    on conflict (graph_id, node_id, to_version_id) do nothing;
  end loop;

  -- 배지 맞추기 - 열린 검수 항목이 하나라도 있으면 켜고, 모두 끝났으면 끈다
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_graphs g set stale_reason = 'law_article_amended'
   where g.stale_reason is distinct from 'law_article_amended'
     and exists (select 1 from public.issue_graph_signals s join public.review_items i on i.id = s.review_item_id
                  where s.graph_id = g.id and i.status in ('drafted', 'in_review', 'approved', 'failed'));
  update public.issue_graphs g set stale_reason = null
   where g.stale_reason is not null
     and not exists (select 1 from public.issue_graph_signals s join public.review_items i on i.id = s.review_item_id
                      where s.graph_id = g.id and i.status in ('drafted', 'in_review', 'approved', 'failed'));
  perform set_config('ltr.issue_gate', '', true);

  select count(*)::integer into v_stale from public.issue_graphs g where g.stale_reason is not null and g.status in ('in_review', 'signed', 'published');
  return query select v_created, v_existing, v_stale;
end;
$$;
revoke all on function public.issue_graph_stale_detect() from public, anon, authenticated;
grant execute on function public.issue_graph_stale_detect() to service_role;
