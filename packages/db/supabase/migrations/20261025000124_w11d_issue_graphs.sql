-- W11-d d4 - 쟁점 연결 지도 저장·검토·서명·공개 (PRD-03 LINK-01 · 7장 issue_graph, docs/dev/W11-d_설계.md 4장)
-- 이 파일에 쟁점 이름·조문 내용·법령 문장은 없다 (씨앗 0행). 지도는 편집자가 초안을 만들고 감수위원이 서명한 뒤에만 공개된다.
--
-- · issue_graphs - 버전마다 새 행. 노드는 { node_id, kind(law_article|case), ref_id } 세 칸뿐이다 - 법령명·조문 번호·시행일·결정일은 저장하지 않고 렌더러가 원문 DB에서 읽는다.
--   저장할 때 노드가 가리키는 조문(law_articles)·결정례(legal_docs)와 가이드(guides.slug)가 실제로 있는지 검사하고, 없으면 거부한다. 연결선 관계는 4종(delegation·mutatis·requirement·precedent).
--   내용은 만든 뒤 바꾸지 못한다 (고치려면 새 버전). 본문 해시는 DB가 계산한다.
-- · 상태 5단계 draft -> in_review -> signed -> published -> retired. 전이는 issue_graph_submit/sign/publish/retire 함수 안에서만 일어난다 (service_role도 UPDATE 권한 없음).
--   서명은 세무 감수위원(rules_is_reviewer)만, 서명하지 않은 지도는 공개 호출이 거부된다. 거부해도 예외 대신 { ok, code, message }와 issue_audit 1행.
-- · stale_reason - 연결 조문 개정 신호(125번 issue_graph_stale_detect가 gate 안에서만 쓴다). 공개 뷰에는 stale(참/거짓)로만 나온다.
-- · 공개 뷰 public_issue_graphs(공개 버전만) · public_issue_graph_nodes(공개 가능한 조문·결정례로 해석되는 노드만 - 서명자 계정·시트 위치 칸 없음).

create function public.issue_graph_check(p_nodes jsonb, p_edges jsonb, p_guide_refs jsonb) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n jsonb;
  e jsonb;
  g jsonb;
  k text;
  v_ids text[] := '{}';
  v_kinds text[] := '{}';
  v_refs text[] := '{}';
  v_pairs text[] := '{}';
  v_id text;
  v_kind text;
  v_ref bigint;
  v_from text;
  v_to text;
  v_rel text;
  v_fk text;
  v_tk text;
  v_slug text;
begin
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_typeof(p_edges) <> 'array' or jsonb_typeof(p_guide_refs) <> 'array' then
    return 'nodes·edges·guide_refs는 배열입니다';
  end if;
  for n in select value from jsonb_array_elements(p_nodes) loop
    if jsonb_typeof(n) <> 'object' then
      return '노드는 객체입니다';
    end if;
    for k in select jsonb_object_keys(n) loop
      if k not in ('node_id', 'kind', 'ref_id') then
        return format('노드에는 node_id·kind·ref_id만 둘 수 있습니다 (%s 거부) - 법령명·번호·날짜는 원문 DB에서 읽습니다', k);
      end if;
    end loop;
    v_id := n ->> 'node_id';
    v_kind := n ->> 'kind';
    if v_id is null or v_id !~ '^n[0-9]{1,3}$' then
      return 'node_id는 n1, n2처럼 n과 숫자입니다';
    end if;
    if v_id = any(v_ids) then
      return format('node_id %s가 겹칩니다', v_id);
    end if;
    if v_kind is null or v_kind not in ('law_article', 'case') then
      return 'kind는 law_article·case 중 하나입니다';
    end if;
    if coalesce(jsonb_typeof(n -> 'ref_id'), '') <> 'number' or coalesce(n ->> 'ref_id', '') !~ '^[1-9][0-9]{0,17}$' then
      return 'ref_id는 1 이상의 정수 번호입니다';
    end if;
    v_ref := (n ->> 'ref_id')::bigint;
    if v_kind = 'law_article' then
      if not exists (select 1 from public.law_articles a where a.id = v_ref) then
        return format('없는 조문 번호입니다 (law_articles %s)', v_ref);
      end if;
    elsif not exists (select 1 from public.legal_docs d where d.id = v_ref) then
      return format('없는 결정례·해석 번호입니다 (legal_docs %s)', v_ref);
    end if;
    if (v_kind || ':' || v_ref) = any(v_refs) then
      return format('같은 대상을 가리키는 노드가 둘입니다 (%s %s)', v_kind, v_ref);
    end if;
    v_ids := v_ids || v_id;
    v_kinds := v_kinds || v_kind;
    v_refs := v_refs || (v_kind || ':' || v_ref);
  end loop;
  for e in select value from jsonb_array_elements(p_edges) loop
    if jsonb_typeof(e) <> 'object' then
      return '연결선은 객체입니다';
    end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('from', 'to', 'relation', 'note') then
        return format('연결선에는 from·to·relation·note만 둘 수 있습니다 (%s 거부)', k);
      end if;
    end loop;
    v_from := e ->> 'from';
    v_to := e ->> 'to';
    v_rel := e ->> 'relation';
    if v_from is null or v_to is null or array_position(v_ids, v_from) is null or array_position(v_ids, v_to) is null then
      return '연결선의 from·to는 이 지도의 node_id여야 합니다';
    end if;
    if v_from = v_to then
      return '자기 자신을 잇는 연결선은 저장할 수 없습니다';
    end if;
    if v_rel is null or v_rel not in ('delegation', 'mutatis', 'requirement', 'precedent') then
      return '관계 라벨은 delegation·mutatis·requirement·precedent 중 하나입니다';
    end if;
    v_fk := v_kinds[array_position(v_ids, v_from)];
    v_tk := v_kinds[array_position(v_ids, v_to)];
    if v_rel = 'precedent' then
      if (v_fk = 'case') = (v_tk = 'case') then
        return 'precedent는 조문과 결정례·해석 사이에만 씁니다';
      end if;
    elsif v_fk <> 'law_article' or v_tk <> 'law_article' then
      return format('%s는 조문과 조문 사이에만 씁니다', v_rel);
    end if;
    if e ? 'note' and (jsonb_typeof(e -> 'note') <> 'string' or char_length(e ->> 'note') > 200) then
      return 'note는 200자 이하 글자입니다';
    end if;
    if (v_from || '>' || v_to || '>' || v_rel) = any(v_pairs) then
      return '같은 연결선이 둘입니다';
    end if;
    v_pairs := v_pairs || (v_from || '>' || v_to || '>' || v_rel);
  end loop;
  for g in select value from jsonb_array_elements(p_guide_refs) loop
    if jsonb_typeof(g) <> 'object' then
      return 'guide_refs 항목은 객체입니다';
    end if;
    for k in select jsonb_object_keys(g) loop
      if k not in ('slug', 'anchor') then
        return format('guide_refs에는 slug·anchor만 둘 수 있습니다 (%s 거부)', k);
      end if;
    end loop;
    v_slug := g ->> 'slug';
    if v_slug is null or not exists (select 1 from public.guides gd where gd.slug = v_slug) then
      return format('없는 가이드 주소입니다 (%s)', coalesce(v_slug, ''));
    end if;
    if g ? 'anchor' and (jsonb_typeof(g -> 'anchor') <> 'string' or (g ->> 'anchor') !~ '^[A-Za-z0-9가-힣_-]{1,60}$') then
      return 'anchor는 글자·숫자·_- 60자 이하입니다';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.issue_graph_check(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.issue_graph_check(jsonb, jsonb, jsonb) to service_role;

create table public.issue_graphs (
  id bigint generated always as identity primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100 and slug <> 'cases'),
  version int not null check (version >= 1),
  hub text not null check (hub in ('trust', 'redevelopment', 'inheritance_gift')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 500),
  nodes jsonb not null default '[]'::jsonb check (jsonb_typeof(nodes) = 'array' and jsonb_array_length(nodes) <= 40),
  edges jsonb not null default '[]'::jsonb check (jsonb_typeof(edges) = 'array' and jsonb_array_length(edges) <= 80),
  guide_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(guide_refs) = 'array' and jsonb_array_length(guide_refs) <= 20),
  as_of date,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'signed', 'published', 'retired')),
  body_sha256 text not null,
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  created_at timestamptz not null default now(),
  submitted_by text,
  submitted_at timestamptz,
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  published_by text,
  published_at timestamptz,
  retired_at timestamptz,
  stale_reason text check (stale_reason is null or char_length(stale_reason) <= 200),
  unique (slug, version),
  constraint issue_graphs_signed_record check (
    status in ('draft', 'in_review', 'retired') or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint issue_graphs_published_record check (status <> 'published' or (published_by is not null and published_at is not null)),
  constraint issue_graphs_draft_clean check (status <> 'draft' or (submitted_at is null and signed_by is null and signed_at is null and published_by is null and published_at is null))
);
comment on table public.issue_graphs is '쟁점 연결 지도 (LINK-01) - 버전마다 새 행, 노드는 번호만. draft -> in_review -> signed(감수 서명) -> published -> retired. 내용 불변, 슬러그마다 공개 1행';
comment on column public.issue_graphs.stale_reason is '연결 조문 개정 신호 - issue_graph_stale_detect()만 쓴다. 비어 있지 않으면 화면에 "개정 반영 검토 중" 배지';
create unique index issue_graphs_one_published on public.issue_graphs (slug) where status = 'published';

create function public.issue_graphs_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_hub text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '쟁점 지도는 초안(draft)으로만 만들 수 있습니다 - 검토·서명·공개는 함수로만 합니다' using errcode = 'check_violation';
    end if;
    v_err := public.issue_graph_check(new.nodes, new.edges, new.guide_refs);
    if v_err is not null then
      raise exception '%', v_err using errcode = 'check_violation';
    end if;
    new.version := coalesce((select max(g.version) from public.issue_graphs g where g.slug = new.slug), 0) + 1;
    select g.hub into v_hub from public.issue_graphs g where g.slug = new.slug order by g.version desc limit 1;
    if v_hub is not null and v_hub <> new.hub then
      raise exception '같은 쟁점의 허브는 새 버전에서 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
    new.stale_reason := null;
    new.body_sha256 := encode(sha256(convert_to(jsonb_build_object('title', new.title, 'summary', new.summary, 'hub', new.hub, 'nodes', new.nodes,
      'edges', new.edges, 'guide_refs', new.guide_refs, 'as_of', new.as_of)::text, 'UTF8')), 'hex');
    return new;
  end if;
  if new.slug is distinct from old.slug or new.version is distinct from old.version or new.hub is distinct from old.hub or new.title is distinct from old.title
     or new.summary is distinct from old.summary or new.nodes is distinct from old.nodes or new.edges is distinct from old.edges
     or new.guide_refs is distinct from old.guide_refs or new.as_of is distinct from old.as_of or new.body_sha256 is distinct from old.body_sha256
     or new.drafted_by is distinct from old.drafted_by or new.created_at is distinct from old.created_at then
    raise exception '쟁점 지도 버전의 내용은 고칠 수 없습니다 - 새 버전으로 만드세요' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at
     or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at or new.sheet_ref is distinct from old.sheet_ref
     or new.signed_body_sha256 is distinct from old.signed_body_sha256 or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at or new.retired_at is distinct from old.retired_at or new.stale_reason is distinct from old.stale_reason then
    if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
      raise exception '검토·서명·공개 상태와 개정 신호는 전용 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.issue_graphs_guard() from public, anon, authenticated;
create trigger issue_graphs_guard before insert or update on public.issue_graphs for each row execute function public.issue_graphs_guard();
create trigger issue_graphs_no_delete before delete on public.issue_graphs for each row execute function public.issue_no_delete();
create trigger issue_graphs_no_truncate before truncate on public.issue_graphs for each statement execute function public.issue_no_delete();

-- 검토 요청 - 초안만, 노드 2개와 연결선 1개 이상
create function public.issue_graph_submit(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.issue_graphs;
  v_code text;
  v_msg text;
begin
  select * into g from public.issue_graphs where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '요청자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif g.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안(draft)만 검토를 요청할 수 있습니다';
  elsif jsonb_array_length(g.nodes) < 2 or jsonb_array_length(g.edges) < 1 then
    v_code := 'graph_empty'; v_msg := '노드 2개와 연결선 1개 이상이 있어야 검토를 요청할 수 있습니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_graph', p_id, 'submit', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_graphs set status = 'in_review', submitted_by = p_actor, submitted_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_graph', p_id, 'submit', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '검토를 요청했습니다');
end;
$$;

-- 서명 - 세무 감수위원만, 검토 중(in_review)만, 감수 시트 위치 필수
create function public.issue_graph_sign(p_id bigint, p_signer text, p_sheet_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.issue_graphs;
  v_code text;
  v_msg text;
begin
  select * into g from public.issue_graphs where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif not public.rules_is_reviewer(p_signer) then
    v_code := 'signer_not_reviewer'; v_msg := '쟁점 지도 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다';
  elsif g.status <> 'in_review' then
    v_code := 'not_in_review'; v_msg := '검토 중(in_review)인 지도만 서명할 수 있습니다';
  elsif char_length(btrim(coalesce(p_sheet_ref, ''))) not between 1 and 200 then
    v_code := 'sheet_missing'; v_msg := '감수 시트 위치(1~200자)가 필요합니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_graph', p_id, 'sign', false, v_code, p_signer, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_graphs set status = 'signed', signed_by = p_signer, signed_at = now(), sheet_ref = btrim(p_sheet_ref), signed_body_sha256 = body_sha256 where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_graph', p_id, 'sign', true, 'ok', p_signer, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '서명했습니다');
end;
$$;

-- 공개 - 서명 뒤에만, 서명한 본문과 같을 때만. 같은 슬러그의 이전 공개본은 retired
create function public.issue_graph_publish(p_id bigint, p_publisher text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.issue_graphs;
  v_code text;
  v_msg text;
begin
  select * into g from public.issue_graphs where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_publisher is null or p_publisher !~ '^(user|admin):.+' then
    v_code := 'publisher_invalid'; v_msg := '공개자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif g.status = 'published' then
    v_code := 'already_published'; v_msg := '이미 공개된 버전입니다';
  elsif g.status = 'retired' then
    v_code := 'retired'; v_msg := '내려간 버전은 다시 공개할 수 없습니다 - 새 버전을 만드세요';
  elsif g.status <> 'signed' or g.signed_at is null then
    v_code := 'not_signed'; v_msg := '감수 서명이 없는 쟁점 지도는 공개할 수 없습니다';
  elsif g.signed_body_sha256 is distinct from g.body_sha256 then
    v_code := 'signature_stale'; v_msg := '서명한 본문과 지금 본문이 다릅니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_graph', p_id, 'publish', false, v_code, p_publisher, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_graphs set status = 'retired', retired_at = now() where slug = g.slug and status = 'published' and id <> p_id;
  update public.issue_graphs set status = 'published', published_by = p_publisher, published_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_graph', p_id, 'publish', true, 'ok', p_publisher, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '공개했습니다');
end;
$$;

-- 내리기 - 공개본만
create function public.issue_graph_retire(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.issue_graphs;
  v_code text;
  v_msg text;
begin
  select * into g from public.issue_graphs where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif g.status <> 'published' then
    v_code := 'not_published'; v_msg := '공개된 지도만 내릴 수 있습니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_graph', p_id, 'unpublish', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_graphs set status = 'retired', retired_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_graph', p_id, 'unpublish', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '내렸습니다');
end;
$$;
revoke all on function public.issue_graph_submit(bigint, text), public.issue_graph_sign(bigint, text, text), public.issue_graph_publish(bigint, text), public.issue_graph_retire(bigint, text) from public, anon, authenticated;
grant execute on function public.issue_graph_submit(bigint, text), public.issue_graph_sign(bigint, text, text), public.issue_graph_publish(bigint, text), public.issue_graph_retire(bigint, text) to service_role;

alter table public.issue_graphs enable row level security;
revoke all on table public.issue_graphs from anon, authenticated, service_role;
grant select, insert on table public.issue_graphs to service_role;

-- 공개 뷰 - 서명 뒤 공개(published) 버전만. 서명자 계정·시트 위치·내부 사유 칸 없음. 감수일은 서명 시각에서 낸다
create view public.public_issue_graphs as
  select slug, version, hub, title, summary, nodes, edges, guide_refs, as_of, body_sha256,
         signed_at as last_reviewed_at, published_at, (stale_reason is not null) as stale
    from public.issue_graphs
   where status = 'published';

-- 노드 해석 - 공개 가능한 조문(public_law_articles)·결정례(public_legal_docs)로 풀리는 노드만. 풀리지 않는 노드는 화면의 그림과 표 양쪽에서 함께 빠진다
create view public.public_issue_graph_nodes as
  select g.slug, g.version, x.ord::int as ord, x.node ->> 'node_id' as node_id, x.node ->> 'kind' as kind, (x.node ->> 'ref_id')::bigint as ref_id,
         l.id as law_id, l.name as law_name, a.article_no, a.branch_no, a.title as article_title,
         v.promulgation_no, v.effective_on,
         d.doc_type, d.issuer, d.doc_no, d.decided_on
    from public.issue_graphs g
   cross join lateral jsonb_array_elements(g.nodes) with ordinality as x(node, ord)
    left join public.public_law_articles a on x.node ->> 'kind' = 'law_article' and a.id = (x.node ->> 'ref_id')::bigint
    left join public.public_law_versions v on v.id = a.version_id
    left join public.public_laws l on l.id = a.law_id
    left join public.public_legal_docs d on x.node ->> 'kind' = 'case' and d.id = (x.node ->> 'ref_id')::bigint
   where g.status = 'published'
     and ((x.node ->> 'kind' = 'law_article' and a.id is not null and l.id is not null) or (x.node ->> 'kind' = 'case' and d.id is not null));

revoke all on table public.public_issue_graphs, public.public_issue_graph_nodes from public, anon, authenticated, service_role;
grant select on table public.public_issue_graphs, public.public_issue_graph_nodes to anon, authenticated, service_role;
