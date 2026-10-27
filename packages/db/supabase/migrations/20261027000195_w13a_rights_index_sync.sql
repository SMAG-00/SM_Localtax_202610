-- W13-a a8 - 권리 기록 함수 · 철회 -> 색인 제외 배치 · 색인 원천 읽기 (PRD-05 LIB-06, 5단계 설계 1.1 a8)
-- 이 파일에 본문·법령 글은 없다.
-- · library_rights_set - 용도별 권리 한 칸을 바꾼다 (확인은 근거·확인일 필수, 거부는 { ok:false, code }). 변경 기록은 191 트리거가 자동으로 남긴다.
--   공개 뷰·library_read는 요청마다 권리를 다시 읽으므로, 확인에서 다른 값으로 바꾸면 다음 요청부터 공개 응답에서 빠진다.
--   칼럼(kind column)의 유료 판매 권리는 paid_bodies.sale_allowed 한 칸이다.
-- · library_index_sync - 색인에서 뺄 청크(권리 철회·승인 취소·등급 변경)는 즉시 retired_at을 채우고, 색인할 원천은 W12-a 색인 대기열에 쌓는다.
--   색인 자격 = 승인 ∧ rights_index = confirmed ∧ 프리미엄 등급 (chunks_publication_gate와 같은 조건). 출처 번호는 node:<번호> · issue_article:<번호>.
-- · library_chunk_source_load - 색인 일꾼이 읽는 원천 한 건 (W12-a chunk_source_load와 같은 모양). 자격이 없으면 null.
-- W12-a 파일(chunk_sources 뷰·index_queue_scan)은 고치지 않는다.

create function public.library_rights_set(p_kind text, p_id bigint, p_field text, p_value text, p_ref text, p_confirmed_on date, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_ref text := nullif(btrim(p_ref), ''); v_n int;
begin
  if coalesce(btrim(p_actor), '') = '' then return jsonb_build_object('ok', false, 'code', 'bad_input'); end if;
  if p_value not in ('unchecked', 'confirmed', 'restricted') then return jsonb_build_object('ok', false, 'code', 'bad_value'); end if;
  if p_field not in ('rights_public', 'rights_index', 'rights_summary', 'rights_sale', 'rights_pdf') then return jsonb_build_object('ok', false, 'code', 'bad_field'); end if;
  if p_value = 'confirmed' and (v_ref is null or p_confirmed_on is null) and p_kind <> 'column' then
    -- 이미 근거·확인일이 있는 행이면 새 값 없이도 확인할 수 있다
    if not exists (
      select 1 from (
        select rights_ref, rights_confirmed_on from public.pub_nodes where p_kind = 'node' and id = p_id
        union all select rights_ref, rights_confirmed_on from public.magazine_issues where p_kind = 'issue' and id = p_id
        union all select rights_ref, rights_confirmed_on from public.magazine_articles where p_kind = 'issue_article' and id = p_id) t
       where (v_ref is not null or t.rights_ref is not null) and (p_confirmed_on is not null or t.rights_confirmed_on is not null)) then
      return jsonb_build_object('ok', false, 'code', 'record_required');
    end if;
  end if;
  perform set_config('ltr.actor', p_actor, true);
  if p_kind = 'node' and p_field <> 'rights_pdf' then
    execute format('update public.pub_nodes set %I = $1, rights_ref = coalesce($2, rights_ref), rights_confirmed_on = coalesce($3, rights_confirmed_on) where id = $4', p_field) using p_value, v_ref, p_confirmed_on, p_id;
  elsif p_kind = 'issue' then
    execute format('update public.magazine_issues set %I = $1, rights_ref = coalesce($2, rights_ref), rights_confirmed_on = coalesce($3, rights_confirmed_on) where id = $4', p_field) using p_value, v_ref, p_confirmed_on, p_id;
  elsif p_kind = 'issue_article' and p_field <> 'rights_pdf' then
    execute format('update public.magazine_articles set %I = $1, rights_ref = coalesce($2, rights_ref), rights_confirmed_on = coalesce($3, rights_confirmed_on) where id = $4', p_field) using p_value, v_ref, p_confirmed_on, p_id;
  elsif p_kind = 'column' and p_field = 'rights_sale' then
    if p_value = 'confirmed' then
      if v_ref is null or p_confirmed_on is null then return jsonb_build_object('ok', false, 'code', 'record_required'); end if;
      update public.paid_bodies set sale_allowed = true, rights_ref = v_ref, sale_confirmed_on = p_confirmed_on where kind = 'column' and article_id = p_id;
    else
      update public.paid_bodies set sale_allowed = false where kind = 'column' and article_id = p_id;
    end if;
    insert into public.library_rights_log (item_kind, item_id, field, old_value, new_value, actor) values ('column', p_id, 'rights_sale', null, p_value, p_actor);
  else
    return jsonb_build_object('ok', false, 'code', 'bad_field');
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'no_target'); end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
exception when check_violation then
  return jsonb_build_object('ok', false, 'code', 'record_required');
end;
$$;
revoke all on function public.library_rights_set(text, bigint, text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.library_rights_set(text, bigint, text, text, text, date, text) to service_role;

-- 색인 자격이 있는 지식창고 원천 (내부 뷰)
create view public.library_index_sources as
select 'node:' || n.id as source_id, 'node'::text as kind, n.id as ref_id, n.title,
       e.as_of as valid_from, b.body_hash as source_hash,
       p.title || ' ' || e.edition_label || ' > ' || n.title as path
  from public.pub_nodes n
  join public.editions e on e.id = n.edition_id
  join public.publications p on p.id = e.publication_id
  join public.library_bodies b on b.kind = 'node' and b.ref_id = n.id
 where n.status = 'approved' and n.rights_index = 'confirmed' and n.access_tier = 'premium'
union all
select 'issue_article:' || a.id, 'issue_article', a.id, a.title,
       i.as_of, b.body_hash,
       p.title || ' ' || i.issue_no || ' > ' || a.title
  from public.magazine_articles a
  join public.magazine_issues i on i.id = a.issue_id
  join public.publications p on p.id = i.publication_id
  join public.library_bodies b on b.kind = 'issue_article' and b.ref_id = a.id
 where a.status = 'approved' and a.rights_index = 'confirmed' and a.access_tier = 'premium' and i.status = 'approved';
revoke all on table public.library_index_sources from public, anon, authenticated, service_role;
grant select on table public.library_index_sources to service_role;

create function public.library_index_sync(p_index_version text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_ret int := 0; v_enq int := 0;
begin
  if coalesce(btrim(p_index_version), '') = '' then return jsonb_build_object('ok', false, 'code', 'bad_input'); end if;
  update public.chunks c set retired_at = p_now
   where c.retired_at is null and c.source_type = 'publication'
     and not exists (select 1 from public.library_index_sources s where s.source_id = c.source_id);
  get diagnostics v_ret = row_count;
  with cand as (
    select s.source_id, s.source_hash from public.library_index_sources s
     where not exists (select 1 from public.chunks c where c.source_type = 'publication' and c.source_id = s.source_id and c.retired_at is null
                         and c.source_hash = s.source_hash and c.index_version = p_index_version)
       and not exists (select 1 from public.index_queue q where q.source_type = 'publication' and q.source_id = s.source_id
                         and ((q.done_at is not null and q.source_hash = s.source_hash and q.index_version = p_index_version) or q.done_at is null))
  ), ins as (
    insert into public.index_queue (source_type, source_id, reason, source_hash, index_version, enqueued_at)
    select 'publication', c.source_id,
           case when exists (select 1 from public.chunks x where x.source_type = 'publication' and x.source_id = c.source_id) then 'changed' else 'new' end,
           c.source_hash, p_index_version, p_now from cand c
    returning 1)
  select count(*) into v_enq from ins;
  return jsonb_build_object('ok', true, 'retired', v_ret, 'enqueued', v_enq);
end;
$$;
revoke all on function public.library_index_sync(text, timestamptz) from public, anon, authenticated;
grant execute on function public.library_index_sync(text, timestamptz) to service_role;

create function public.library_chunk_source_load(p_source_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare s record; v_body text;
begin
  select * into s from public.library_index_sources where source_id = p_source_id;
  if not found then return null; end if;
  select b.body into v_body from public.library_bodies b where b.kind = s.kind and b.ref_id = s.ref_id;
  return jsonb_build_object('sourceType', 'publication', 'sourceId', s.source_id, 'docType', 'publication',
    'taxItems', jsonb_build_array('지식창고'), 'validFrom', s.valid_from, 'accessTier', 'premium', 'rightsStatus', 'confirmed', 'scope', 'base',
    'sourceHash', s.source_hash, 'title', s.title, 'path', s.path, 'body', v_body);
end;
$$;
comment on function public.library_chunk_source_load(text) is '지식창고 색인 원천 한 건 (W13-a) - tax_items는 거친 자리 값 [확인 필요: 세목 분류는 감수 입력]. 서버 색인 일꾼만 부른다';
revoke all on function public.library_chunk_source_load(text) from public, anon, authenticated;
grant execute on function public.library_chunk_source_load(text) to service_role;

-- 노드 상호참조 (LIB-02) - 제목만. 양쪽 노드가 모두 공개 조건(기능 키·승인·공개 권리 확인)일 때만 나온다. cross_refs 원소 모양: { "node_id": 번호 }
create view public.public_library_node_refs as
select n.id as node_id, t.id as ref_id, t.title as ref_title
  from public.pub_nodes n
  cross join lateral jsonb_array_elements(n.cross_refs) e
  join public.pub_nodes t on jsonb_typeof(e -> 'node_id') = 'number' and t.id = (e ->> 'node_id')::bigint
 where n.status = 'approved' and n.rights_public = 'confirmed'
   and t.status = 'approved' and t.rights_public = 'confirmed'
   and public.library_feature_on();
revoke all on table public.public_library_node_refs from public, anon, authenticated, service_role;
grant select on table public.public_library_node_refs to anon, authenticated, service_role;
