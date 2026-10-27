-- W13-c 5단계 - 계정과목 연결 account_mappings (PRD-05 LINK-02, docs/dev/W13-c_설계.md)
-- 계정과목(예: 토지·건물 - 감수 필요) -> 관련 지방세 조문·결정례·지식창고 노드. 회계기준 원문은 싣지 않고 기준 이름과 조항 번호만 참조한다.
-- 이 파일에 회계·세법 문장은 없다 - 표와 규칙만. 시험 자료는 시험용 표시와 지어낸 값이다.
--
-- · 본문 칸 없음: std_ref는 기준 이름+조항 번호용 짧은 칸(80자)이고 문장 부호로 이어진 긴 글을 거부한다.
-- · 버전: 같은 (계정과목, 대상, 관계)의 고침은 새 버전 행. 행은 지울 수 없고, 서명 칸만 한 번 채울 수 있다.
-- · 공개: 감수 서명(signed_by·signed_at)이 있는 행 + 기능 키 account_links 켜짐 + 대상이 공개 상태일 때만. 서명 없는 매핑은 공개 0.
-- · 서명은 service_role 함수 account_mapping_sign만 한다 (감사 1행은 서버가 audit_log에 남긴다). anon·authenticated 직접 권한 0.

create table public.account_mappings (
  id bigint generated always as identity primary key,
  account_code text not null check (account_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  account_name text not null check (char_length(btrim(account_name)) between 1 and 60),
  target_type text not null check (target_type in ('law_provision', 'legal_doc', 'pub_node')),
  target_id bigint not null check (target_id > 0),
  target_article_no integer check (target_article_no is null or target_article_no > 0),
  target_branch_no integer check (target_branch_no is null or target_branch_no >= 0),
  relation text not null check (relation in ('related', 'applies', 'explains')),
  std_ref text check (std_ref is null or (char_length(btrim(std_ref)) between 1 and 80 and std_ref !~ '[.。!?]\s')),
  version integer not null default 1 check (version >= 1),
  signed_by text check (signed_by is null or char_length(btrim(signed_by)) > 0),
  signed_at timestamptz,
  created_by text not null default 'system' check (char_length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  constraint account_mappings_provision_cols check ((target_type = 'law_provision') = (target_article_no is not null and target_branch_no is not null)),
  constraint account_mappings_signed check ((signed_by is null) = (signed_at is null))
);

create unique index account_mappings_once on public.account_mappings (account_code, target_type, target_id, coalesce(target_article_no, 0), coalesce(target_branch_no, 0), relation, version);

comment on table public.account_mappings is '계정과목 연결(LINK-02) - 회계기준 본문 칸 없음(std_ref는 기준 이름+조항 번호 80자). 감수 서명 없는 행은 공개 0. 행 삭제 불가, 서명만 한 번 채움';
create index account_mappings_account_idx on public.account_mappings (account_code, version desc);
create index account_mappings_target_idx on public.account_mappings (target_type, target_id, target_article_no, target_branch_no);

alter table public.account_mappings enable row level security;
revoke all on table public.account_mappings from public, anon, authenticated;
grant select, insert, update on table public.account_mappings to service_role;

create function public.account_mappings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception '계정과목 연결은 지울 수 없습니다 - 새 버전으로 대체하세요 (연결 %)', old.id using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if (new.account_code, new.account_name, new.target_type, new.target_id, new.target_article_no, new.target_branch_no, new.relation, new.std_ref, new.version, new.created_at)
         is distinct from (old.account_code, old.account_name, old.target_type, old.target_id, old.target_article_no, old.target_branch_no, old.relation, old.std_ref, old.version, old.created_at) then
      raise exception '계정과목 연결의 내용은 고칠 수 없습니다 - 새 버전 행으로 넣으세요 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    if old.signed_at is not null and (new.signed_by, new.signed_at) is distinct from (old.signed_by, old.signed_at) then
      raise exception '서명은 한 번만 채울 수 있습니다 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  ok := case new.target_type
    when 'legal_doc' then exists (select 1 from public.legal_docs where id = new.target_id)
    when 'pub_node' then exists (select 1 from public.pub_nodes where id = new.target_id)
    else public.law_provision_exists(new.target_id, new.target_article_no, new.target_branch_no) end;
  if not ok then
    raise exception '없는 대상을 가리키는 계정과목 연결은 저장할 수 없습니다 (% %)', new.target_type, new.target_id using errcode = 'check_violation';
  end if;
  if new.signed_at is not null then
    raise exception '서명은 account_mapping_sign으로만 채웁니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.account_mappings_guard() from public, anon, authenticated;
create trigger account_mappings_guard before insert or update or delete on public.account_mappings
  for each row execute function public.account_mappings_guard();

-- 감수 서명 - 서명자 이름이 있어야 하고, 이미 서명된 행은 거부. 결과는 {ok, code}
create function public.account_mapping_sign(p_id bigint, p_by text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_signed timestamptz;
begin
  if p_by is null or char_length(btrim(p_by)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'signer_required');
  end if;
  select signed_at into v_signed from public.account_mappings where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_signed is not null then
    return jsonb_build_object('ok', false, 'code', 'already_signed');
  end if;
  update public.account_mappings set signed_by = btrim(p_by), signed_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.account_mapping_sign(bigint, text) from public, anon, authenticated;
grant execute on function public.account_mapping_sign(bigint, text) to service_role;

-- 공개 뷰 - 서명된 것 중 계정과목마다 가장 높은 서명 버전만, 대상이 공개일 때만, 기능 키 account_links 켜짐 때만
create view public.public_account_mappings as
select m.id, m.account_code, m.account_name, m.target_type, m.target_id, m.target_article_no, m.target_branch_no, m.relation, m.std_ref, m.version, m.signed_at
  from public.account_mappings m
 where m.signed_at is not null
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'account_links') = 'true'::jsonb)
   and m.version = (select max(m2.version) from public.account_mappings m2 where m2.account_code = m.account_code and m2.signed_at is not null)
   and ((m.target_type = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = m.target_id))
     or (m.target_type = 'pub_node' and exists (select 1 from public.public_library_nodes n where n.id = m.target_id))
     or (m.target_type = 'law_provision' and exists (
           select 1 from public.public_law_articles a where a.law_id = m.target_id and a.article_no = m.target_article_no and a.branch_no = m.target_branch_no)));

comment on view public.public_account_mappings is '공개 계정과목 연결 - 감수 서명 + 기능 키 account_links + 대상 공개. 계정과목마다 서명된 가장 높은 버전. 회계기준 본문 칸 없음';
revoke all on table public.public_account_mappings from public, anon, authenticated, service_role;
grant select on table public.public_account_mappings to anon, authenticated, service_role;
