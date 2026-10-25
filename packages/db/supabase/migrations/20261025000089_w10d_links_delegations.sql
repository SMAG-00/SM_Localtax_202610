-- W10-d 1단계 - 지식 그래프 links · 위임 매핑 law_delegations · 표본 검사 quality_samples · 해석 문서 본문 legal_doc_texts · 공개 보류 legal_doc_holds
-- (PRD-02 LAW-05 · LAW-06 · CASE-02 · CASE-03 · TX-10 · TX-11 · ART-12, 2단계_설계 3장 W10-d, docs/dev/W10-d_설계.md)
-- 이 파일에 법령·해석 문장, 세율·기한 값은 없다 - 표와 규칙만. 시험 자료는 시험용 표시와 지어낸 값이다.
--
-- · links - 조문 <-> 결정례·해석 <-> 기사 연결. 대상이 실제로 있어야 저장되고(트리거), 공개는 편집자가 확인한 것(confirmed)만이다.
--   조문 끝점은 개정판 행이 아니라 (법령, 조, 가지 번호)로 가리킨다 - 개정판이 새 행으로 늘어도 연결이 끊어지지 않는다.
-- · law_delegations - 법률 -> 시행령 -> 시행규칙 위임 조문 연결. 출처(api·parsed·editor)와 출처 기록이 필수, 공개는 확인된 것만.
-- · quality_samples - 공개 전 표본 검사(위임 매핑 50건 중 48, 조문 인용 100건 중 95 등). 합격 판정은 DB 생성 칸 하나, 가장 최근 표본이 기준(더 나쁜 표본을 나중에 넣으면 닫힌다).
-- · legal_doc_texts - 해석 문서 원문의 일반 글자(스냅샷에서 뽑음)와 검색 칸. 스냅샷이 있어야만 생긴다(트리거).
-- · legal_doc_holds - 실명·주민등록번호 패턴이 검출된 문서의 공개 보류(+ 공통 검수 큐 legal_doc 항목). 풀려면 검수 승인이 필요하다.
-- 모든 표는 RLS 기본 거부, anon·authenticated 권한 0. 공개는 마이그레이션 90의 칸 지정 뷰만.

-- ─────────────────────────────────────────────────────────────
-- 표본 검사 quality_samples
-- ─────────────────────────────────────────────────────────────
-- 합격 기준: 위임 매핑 표본 50건 이상 + 일치 95% 이상(50건 중 48 합격 · 47 보류), 조문 인용·기사 패턴 표본 100건 이상 + 일치 95% 이상(100건 중 95 합격 · 94 보류)
create function public.quality_sample_passes(p_kind text, p_size integer, p_matched integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'delegation_mapping' then p_size >= 50 and p_matched * 100 >= p_size * 95
    when 'case_citation' then p_size >= 100 and p_matched * 100 >= p_size * 95
    when 'article_pattern' then p_size >= 100 and p_matched * 100 >= p_size * 95
    else false
  end
$$;

revoke all on function public.quality_sample_passes(text, integer, integer) from public, anon, authenticated;
grant execute on function public.quality_sample_passes(text, integer, integer) to service_role;

create table public.quality_samples (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('delegation_mapping', 'case_citation', 'article_pattern')),
  sample_size integer not null check (sample_size > 0),
  matched integer not null check (matched >= 0),
  sampled_by text not null check (length(btrim(sampled_by)) > 0),
  note text check (note is null or length(note) <= 500),
  sampled_at timestamptz not null default now(),
  passed boolean generated always as (public.quality_sample_passes(kind, sample_size, matched)) stored,
  constraint quality_samples_matched_le_size check (matched <= sample_size)
);

comment on table public.quality_samples is '공개 전 표본 검사 기록(추가만) - 가장 최근 행의 passed가 그 종류의 공개 관문이다. 설정·수동 칸 없음';
create index quality_samples_kind_idx on public.quality_samples (kind, id desc);

create trigger quality_samples_append_only before update or delete on public.quality_samples
  for each row execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 위임 매핑 law_delegations
-- ─────────────────────────────────────────────────────────────
create table public.law_delegations (
  id bigint generated always as identity primary key,
  parent_law_id bigint not null references public.laws (id),
  parent_article_no integer not null check (parent_article_no > 0),
  parent_branch_no integer not null default 0 check (parent_branch_no >= 0),
  child_law_id bigint not null references public.laws (id),
  child_article_no integer not null check (child_article_no > 0),
  child_branch_no integer not null default 0 check (child_branch_no >= 0),
  source text not null check (source in ('api', 'parsed', 'editor')),
  source_ref text not null check (length(btrim(source_ref)) between 1 and 300),
  status text not null default 'candidate' check (status in ('candidate', 'confirmed')),
  confirmed_by text check (confirmed_by is null or length(btrim(confirmed_by)) > 0),
  confirmed_at timestamptz,
  created_by text not null default 'system' check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  constraint law_delegations_once unique (parent_law_id, parent_article_no, parent_branch_no, child_law_id, child_article_no, child_branch_no),
  constraint law_delegations_confirmed check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

comment on table public.law_delegations is '위임 조문 매핑(LAW-05) - 출처(api·parsed·editor)와 출처 기록 필수. 공개는 confirmed만, 게다가 표본 검사 관문(delegation_mapping)을 통과해야 3단 보기가 열린다';
comment on column public.law_delegations.source_ref is '출처 기록 - API 응답 스냅샷 번호·파서 실행 이름·편집자 이름 같은 추적 값. 법령 문장은 넣지 않는다';
create index law_delegations_parent_idx on public.law_delegations (parent_law_id, parent_article_no, parent_branch_no);
create index law_delegations_child_idx on public.law_delegations (child_law_id, child_article_no, child_branch_no);

-- 조문이 실제로 있는지 - 개정판 어느 쪽이든 그 (법령, 조, 가지)가 한 번이라도 있으면 된다
create function public.law_provision_exists(p_law_id bigint, p_article_no integer, p_branch_no integer) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.law_articles a join public.law_versions v on v.id = a.version_id
     where v.law_id = p_law_id and a.article_no = p_article_no and a.branch_no = p_branch_no)
$$;

revoke all on function public.law_provision_exists(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.law_provision_exists(bigint, integer, integer) to service_role;

create function public.law_delegations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.laws;
  c public.laws;
  rank_p integer;
  rank_c integer;
begin
  if tg_op = 'UPDATE' and (new.parent_law_id, new.parent_article_no, new.parent_branch_no, new.child_law_id, new.child_article_no, new.child_branch_no, new.source)
       is distinct from (old.parent_law_id, old.parent_article_no, old.parent_branch_no, old.child_law_id, old.child_article_no, old.child_branch_no, old.source) then
    raise exception '위임 매핑의 상위·하위 조문과 출처 구분은 고칠 수 없습니다 - 새 행으로 넣으세요 (위임 매핑 %)', old.id using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    select * into p from public.laws where id = new.parent_law_id;
    select * into c from public.laws where id = new.child_law_id;
    rank_p := case p.tier when 'statute' then 1 when 'decree' then 2 else 3 end;
    rank_c := case c.tier when 'statute' then 1 when 'decree' then 2 else 3 end;
    if rank_c <= rank_p then
      raise exception '위임은 법률 -> 시행령 -> 시행규칙 방향이어야 합니다 (상위 %, 하위 %)', p.name, c.name using errcode = 'check_violation';
    end if;
    if regexp_replace(p.name, ' 시행(령|규칙)$', '') <> regexp_replace(c.name, ' 시행(령|규칙)$', '') then
      raise exception '위임 매핑은 같은 법령 묶음(법·시행령·시행규칙)의 조문끼리만 잇습니다 (상위 %, 하위 %)', p.name, c.name using errcode = 'check_violation';
    end if;
    if not public.law_provision_exists(new.parent_law_id, new.parent_article_no, new.parent_branch_no) then
      raise exception '없는 상위 조문을 가리키는 위임 매핑은 저장할 수 없습니다 (법령 %, 제%조)', new.parent_law_id, new.parent_article_no using errcode = 'check_violation';
    end if;
    if not public.law_provision_exists(new.child_law_id, new.child_article_no, new.child_branch_no) then
      raise exception '없는 하위 조문을 가리키는 위임 매핑은 저장할 수 없습니다 (법령 %, 제%조)', new.child_law_id, new.child_article_no using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.law_delegations_guard() from public, anon, authenticated;
create trigger law_delegations_guard before insert or update on public.law_delegations
  for each row execute function public.law_delegations_guard();

-- ─────────────────────────────────────────────────────────────
-- 지식 그래프 links
-- ─────────────────────────────────────────────────────────────
create table public.links (
  id bigint generated always as identity primary key,
  src_kind text not null check (src_kind in ('legal_doc', 'article')),
  src_id bigint not null check (src_id > 0),
  dst_kind text not null check (dst_kind in ('law_provision', 'legal_doc')),
  dst_id bigint not null check (dst_id > 0),
  dst_article_no integer check (dst_article_no is null or dst_article_no > 0),
  dst_branch_no integer check (dst_branch_no is null or dst_branch_no >= 0),
  relation text not null check (relation in ('cites', 'interprets', 'explains')),
  origin text not null check (origin in ('auto', 'editor')),
  status text not null default 'candidate' check (status in ('candidate', 'confirmed', 'rejected')),
  evidence text check (evidence is null or length(evidence) <= 200),
  confirmed_by text check (confirmed_by is null or length(btrim(confirmed_by)) > 0),
  confirmed_at timestamptz,
  review_item_id bigint references public.review_items (id),
  created_by text not null default 'system' check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  constraint links_pair check (
    (src_kind = 'legal_doc' and dst_kind = 'law_provision')
    or (src_kind = 'article' and dst_kind in ('law_provision', 'legal_doc'))),
  constraint links_provision_cols check (
    (dst_kind = 'law_provision') = (dst_article_no is not null and dst_branch_no is not null)),
  constraint links_confirmed check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

comment on table public.links is '지식 그래프(CASE-03) - 출처(auto·editor)와 관계 값(cites·interprets·explains)이 있는 연결. 없는 대상은 저장 거부, 공개는 confirmed만. dst_kind=law_provision이면 dst_id는 법령 번호(laws.id)';
comment on column public.links.evidence is '자동 추출이 본문에서 찾은 표기 그대로(예: 조문·사건번호 표기) - 편집자 확인 때 대조용. 200자까지';
create unique index links_once on public.links (src_kind, src_id, dst_kind, dst_id, coalesce(dst_article_no, 0), coalesce(dst_branch_no, 0), relation);
create index links_dst_idx on public.links (dst_kind, dst_id, dst_article_no, dst_branch_no) where status = 'confirmed';
create index links_src_idx on public.links (src_kind, src_id) where status = 'confirmed';
create index links_candidates_idx on public.links (src_kind, src_id) where status = 'candidate';

create function public.links_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ok boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.src_kind, new.src_id, new.dst_kind, new.dst_id, new.dst_article_no, new.dst_branch_no, new.relation, new.origin)
         is distinct from (old.src_kind, old.src_id, old.dst_kind, old.dst_id, old.dst_article_no, old.dst_branch_no, old.relation, old.origin) then
      raise exception '연결의 양 끝·관계·출처는 고칠 수 없습니다 - 새 연결로 넣으세요 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    if old.status = 'rejected' and new.status <> 'rejected' then
      raise exception '반려된 연결은 되살릴 수 없습니다 - 새 연결로 넣으세요 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    if old.status = 'confirmed' and new.status = 'candidate' then
      raise exception '확인된 연결을 후보로 되돌릴 수 없습니다 - 반려로만 거둡니다 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- 새 연결: 양 끝이 실제로 있어야 한다 (CASE-03 - 없는 대상 ID 저장 거부)
  ok := case new.src_kind
    when 'legal_doc' then exists (select 1 from public.legal_docs where id = new.src_id)
    else exists (select 1 from public.articles where id = new.src_id) end;
  if not ok then
    raise exception '없는 대상을 가리키는 연결은 저장할 수 없습니다 (시작 %, 번호 %)', new.src_kind, new.src_id using errcode = 'check_violation';
  end if;
  ok := case new.dst_kind
    when 'legal_doc' then exists (select 1 from public.legal_docs where id = new.dst_id)
    else public.law_provision_exists(new.dst_id, new.dst_article_no, new.dst_branch_no) end;
  if not ok then
    raise exception '없는 대상을 가리키는 연결은 저장할 수 없습니다 (도착 %, 번호 %)', new.dst_kind, new.dst_id using errcode = 'check_violation';
  end if;
  if new.src_kind = new.dst_kind and new.src_id = new.dst_id then
    raise exception '자기 자신을 가리키는 연결은 저장할 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.links_guard() from public, anon, authenticated;
create trigger links_guard before insert or update on public.links
  for each row execute function public.links_guard();

-- 자동 추출 후보 넣기 - 멱등. 같은 연결이 이미 있으면(후보·확인·반려 무엇이든) 새로 만들지 않고 그 번호를 돌려준다(반려된 것을 되살리지 않는다)
create function public.link_add_candidate(
  p_src_kind text, p_src_id bigint, p_dst_kind text, p_dst_id bigint, p_article_no integer, p_branch_no integer,
  p_relation text, p_evidence text, p_actor text
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.links (src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin, status, evidence, created_by)
  values (p_src_kind, p_src_id, p_dst_kind, p_dst_id,
          case when p_dst_kind = 'law_provision' then p_article_no end, case when p_dst_kind = 'law_provision' then coalesce(p_branch_no, 0) end,
          p_relation, 'auto', 'candidate', left(p_evidence, 200), coalesce(nullif(btrim(p_actor), ''), 'system'))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.links
     where src_kind = p_src_kind and src_id = p_src_id and dst_kind = p_dst_kind and dst_id = p_dst_id
       and coalesce(dst_article_no, 0) = coalesce(case when p_dst_kind = 'law_provision' then p_article_no end, 0)
       and coalesce(dst_branch_no, 0) = coalesce(case when p_dst_kind = 'law_provision' then coalesce(p_branch_no, 0) end, 0)
       and relation = p_relation;
  end if;
  return v_id;
end;
$$;

revoke all on function public.link_add_candidate(text, bigint, text, bigint, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.link_add_candidate(text, bigint, text, bigint, integer, integer, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 해석 문서 본문 legal_doc_texts + 공개 보류 legal_doc_holds
-- ─────────────────────────────────────────────────────────────
-- 스냅샷 글자 -> 읽을 글자. 수집기 응답이 JSON이면 글자 값만 줄바꿈으로 잇고, 아니면 그대로 [확인 필요: 실응답 필드 모양]
create function public.legal_doc_payload_text(p_payload text) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  j jsonb;
begin
  if p_payload ~ '^\s*[\{\[]' then
    begin
      j := p_payload::jsonb;
      return coalesce((select string_agg(x, E'\n') from unnest(public.jsonb_strings(j)) as t(x)), '');
    exception when others then
      return p_payload;
    end;
  end if;
  return p_payload;
end;
$$;

-- 실명·주민등록번호 패턴 검출 - 보수적(의심되면 보류)이다. 풀기는 사람이 검수 큐에서.
--  · rrn: 6자리-7자리(뒤 첫 자리 1~8)
--  · real_name: 심판·판례에서 당사자 표시어(원고·피고·청구인 등) 바로 뒤에 성씨 + 한글 1~2자(가리기 표기 ○·O·X·*는 한글 음절이 아니라 걸리지 않고 '모씨'는 제외).
--    '원고 주장'처럼 성씨 글자로 시작하는 일반 낱말도 걸린다 - 새는 것보다 보류가 낫다는 쪽이고, 낱말 예외 목록은 두지 않는다(실명이 예외에 가려질 수 있다). 풀기는 검수 큐에서
create function public.legal_doc_pii_kinds(p_text text, p_doc_type text) returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when p_text ~ '(^|[^0-9])[0-9]{6}[-[:space:]]?[1-8][0-9]{6}([^0-9]|$)' then 'rrn' end,
    case when p_doc_type in ('tribunal', 'case')
          and p_text ~ '(원고|피고|청구인|피청구인|신청인|피신청인|피고인|피해자|상고인|피상고인|항소인|피항소인|채무자|채권자|청구외인)[[:space:]]*[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육맹제모탁국어은편용예봉경사부](?!모씨)[가-힣]{1,2}'
         then 'real_name' end
  ], null)
$$;

revoke all on function public.legal_doc_payload_text(text) from public, anon, authenticated;
revoke all on function public.legal_doc_pii_kinds(text, text) from public, anon, authenticated;
grant execute on function public.legal_doc_payload_text(text) to service_role;
grant execute on function public.legal_doc_pii_kinds(text, text) to service_role;

create table public.legal_doc_texts (
  legal_doc_id bigint primary key references public.legal_docs (id) on delete cascade,
  snapshot_id bigint not null references public.raw_snapshots (id),
  body text not null,
  checked_at timestamptz not null default now(),
  search_text text generated always as (public.search_squash(body)) stored
);

comment on table public.legal_doc_texts is '해석 문서 원문의 읽을 글자와 검색 칸(정규형) - legal_docs의 스냅샷에서 트리거가 뽑는다. 스냅샷 없는 문서는 행이 없다(공개 0). checked_at = 확인일';

create table public.legal_doc_holds (
  id bigint generated always as identity primary key,
  legal_doc_id bigint not null references public.legal_docs (id) on delete cascade,
  snapshot_id bigint not null references public.raw_snapshots (id),
  reason text not null check (reason in ('real_name', 'rrn')),
  detected_at timestamptz not null default now(),
  released_by text check (released_by is null or length(btrim(released_by)) > 0),
  released_at timestamptz,
  release_note text check (release_note is null or length(release_note) <= 500),
  constraint legal_doc_holds_once unique (legal_doc_id, snapshot_id, reason),
  constraint legal_doc_holds_released check ((released_by is null) = (released_at is null) and (released_at is null or length(btrim(coalesce(release_note, ''))) > 0))
);

comment on table public.legal_doc_holds is '실명·주민등록번호 패턴이 검출된 해석 문서의 공개 보류(TX-10 - PRD_최종 §10). 풀지 않은 행이 하나라도 있으면 공개 뷰에서 빠진다. 풀기는 legal_doc_hold_release 함수만';
create index legal_doc_holds_open_idx on public.legal_doc_holds (legal_doc_id) where released_at is null;

create function public.legal_doc_holds_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '공개 보류 기록은 지울 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if (new.legal_doc_id, new.snapshot_id, new.reason, new.detected_at) is distinct from (old.legal_doc_id, old.snapshot_id, old.reason, old.detected_at)
     or (old.released_at is not null and (new.released_at, new.released_by) is distinct from (old.released_at, old.released_by)) then
    raise exception '공개 보류 기록은 풀기 칸만 한 번 채울 수 있습니다 (보류 %)', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.legal_doc_holds_guard() from public, anon, authenticated;
create trigger legal_doc_holds_guard before update or delete on public.legal_doc_holds
  for each row execute function public.legal_doc_holds_guard();

-- 보류 풀기 - 공통 검수 큐의 pii_hold 항목이 승인(approved·published)된 뒤에만. 주민등록번호 패턴이 지금 본문에 남아 있으면 풀 수 없다
create function public.legal_doc_hold_release(p_hold_id bigint, p_actor text, p_note text) returns void
language plpgsql
set search_path = ''
as $$
declare
  h public.legal_doc_holds;
  v_status text;
begin
  select * into h from public.legal_doc_holds where id = p_hold_id;
  if not found then
    raise exception '없는 공개 보류입니다 (%)', p_hold_id using errcode = 'no_data_found';
  end if;
  if h.released_at is not null then
    return;
  end if;
  select status into v_status from public.review_items where kind = 'legal_doc' and source_key = 'pii_hold:' || h.legal_doc_id;
  if v_status is null or v_status not in ('approved', 'published') then
    raise exception '공통 검수에서 승인된 뒤에만 공개 보류를 풀 수 있습니다 (문서 %)', h.legal_doc_id using errcode = 'check_violation';
  end if;
  if h.reason = 'rrn' and exists (
       select 1 from public.legal_doc_texts t where t.legal_doc_id = h.legal_doc_id and public.legal_doc_pii_kinds(t.body, 'ruling') @> array['rrn']) then
    raise exception '본문에 주민등록번호 패턴이 남아 있어 풀 수 없습니다 - 가린 원문으로 바꾼 뒤 다시 하세요 (문서 %)', h.legal_doc_id using errcode = 'check_violation';
  end if;
  update public.legal_doc_holds set released_by = p_actor, released_at = now(), release_note = p_note where id = p_hold_id;
end;
$$;

revoke all on function public.legal_doc_hold_release(bigint, text, text) from public, anon, authenticated;
grant execute on function public.legal_doc_hold_release(bigint, text, text) to service_role;

-- legal_docs의 스냅샷이 정해지거나 바뀌면 읽을 글자를 만들고 PII 검사 - 정의자 권한(스냅샷·검수 큐는 service_role만 읽는 표)
create function public.legal_doc_text_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload text;
  v_body text;
  v_kinds text[];
  v_kind text;
begin
  if new.snapshot_id is null then
    return new;
  end if;
  select payload into v_payload from public.raw_snapshots where id = new.snapshot_id;
  if v_payload is null then
    return new;
  end if;
  v_body := public.legal_doc_payload_text(v_payload);
  if length(btrim(v_body)) = 0 then
    delete from public.legal_doc_texts where legal_doc_id = new.id;
    return new;
  end if;
  insert into public.legal_doc_texts (legal_doc_id, snapshot_id, body) values (new.id, new.snapshot_id, v_body)
  on conflict (legal_doc_id) do update set snapshot_id = excluded.snapshot_id, body = excluded.body, checked_at = now();
  v_kinds := public.legal_doc_pii_kinds(v_body, new.doc_type);
  foreach v_kind in array v_kinds loop
    insert into public.legal_doc_holds (legal_doc_id, snapshot_id, reason) values (new.id, new.snapshot_id, v_kind) on conflict do nothing;
  end loop;
  if cardinality(v_kinds) > 0 then
    insert into public.review_items (kind, source_key, title, snapshot_id, payload, created_by)
    values ('legal_doc', 'pii_hold:' || new.id, '실명·주민등록번호 패턴 검출 - 공개 보류',
            new.snapshot_id, jsonb_build_object('legal_doc_id', new.id, 'doc_no', coalesce(new.doc_no, ''), 'reasons', array_to_string(v_kinds, ',')), 'system:pii_hold')
    on conflict (kind, source_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.legal_doc_text_sync() from public, anon, authenticated;
create trigger legal_doc_text_sync after insert or update of snapshot_id on public.legal_docs
  for each row execute function public.legal_doc_text_sync();

-- 이미 있는 문서(W3 입력분)의 본문·검사를 한 번 채운다 (스냅샷 칸이 있는 행만)
update public.legal_docs set snapshot_id = snapshot_id where snapshot_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS - 새 표 모두 기본 거부, anon·authenticated 0
-- ─────────────────────────────────────────────────────────────
alter table public.quality_samples enable row level security;
alter table public.law_delegations enable row level security;
alter table public.links enable row level security;
alter table public.legal_doc_texts enable row level security;
alter table public.legal_doc_holds enable row level security;
revoke all on table public.quality_samples, public.law_delegations, public.links, public.legal_doc_texts, public.legal_doc_holds from anon, authenticated, service_role;
grant select, insert on table public.quality_samples to service_role;
grant select, insert, update on table public.law_delegations to service_role;
grant select, insert, update on table public.links to service_role;
grant select on table public.legal_doc_texts to service_role;
grant select on table public.legal_doc_holds to service_role;
