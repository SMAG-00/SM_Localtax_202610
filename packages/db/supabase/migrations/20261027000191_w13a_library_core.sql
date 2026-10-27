-- W13-a a1 - 지식창고 표: 출판물·판·노드 트리·권호·권호 기사·본문 분리·권리 변경 기록 (docs/dev/W13-a_설계.md 2장, PRD-05 LIB-01·02·06)
-- 이 파일에 출판물 본문·법령·세무 글은 없다 (표 구조·검사뿐). 시험 자료는 시험용 표시 + 지어낸 글로만 넣는다.
-- · 본문(library_bodies)은 anon·authenticated 직접 권한 0 - 공개는 193의 공개 뷰(제목 등 칸 지정)와 서버 절단 함수 library_read뿐 (paid_bodies 방식).
-- · 용도별 권리 4칸(공개·검색 색인·요약·유료 판매)은 기본 unchecked. 확인(confirmed)이 되려면 근거(rights_ref)와 확인일이 있어야 한다. 변경은 트리거가 권리 변경 기록에 남긴다.
-- · 공개(status approved)는 이관 작업(192 digitization_jobs)의 승인으로만 된다 - 승인한 작업 번호(approved_job_id)가 없으면 승인 상태가 될 수 없다.
-- · 필자 표는 people(1단계) - 별도 authors 표는 없다. 칼럼 계약 칸은 194에서 people에 더한다.
-- 기존 표 칸·제약·값은 바꾸지 않는다.

create table public.publications (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  kind text not null check (kind in ('magazine', 'book')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.publications is '출판물 서명 (LIB-01·02) - magazine = 월간 권호형(magazine_issues), book = 판차형 단행본(editions → pub_nodes). 직접 읽기 0';
create trigger publications_touch before update on public.publications for each row execute function public.touch_updated_at();

create table public.editions (
  id bigint generated always as identity primary key,
  publication_id bigint not null references public.publications (id),
  edition_label text not null check (char_length(btrim(edition_label)) between 1 and 40),
  as_of date not null,
  created_at timestamptz not null default now(),
  unique (publication_id, edition_label),
  unique (publication_id, as_of)
);
comment on table public.editions is '단행본 판차 (LIB-02) - 판마다 기준일 고정. 최신판 = 같은 서명에서 기준일이 가장 늦은 판, 이전 판은 연혁';
create function public.editions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.publications p where p.id = new.publication_id and p.kind = 'book') then
    raise exception '판차는 단행본(book) 출판물에만 둘 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.editions_guard() from public, anon, authenticated;
create trigger editions_guard before insert or update on public.editions for each row execute function public.editions_guard();

-- ── 노드 트리 ─────────────────────────────────────────────────
create table public.pub_nodes (
  id bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id),
  parent_id bigint references public.pub_nodes (id),
  depth int not null check (depth between 1 and 3),                 -- 1 장 · 2 절 · 3 항목
  ordinal int not null check (ordinal >= 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  access_tier text not null default 'premium' check (access_tier in ('public', 'premium')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  approved_job_id bigint,                                            -- 192에서 digitization_jobs 외래 키를 건다
  cross_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(cross_refs) = 'array' and jsonb_array_length(cross_refs) <= 200),
  rights_public text not null default 'unchecked' check (rights_public in ('unchecked', 'confirmed', 'restricted')),
  rights_index text not null default 'unchecked' check (rights_index in ('unchecked', 'confirmed', 'restricted')),
  rights_summary text not null default 'unchecked' check (rights_summary in ('unchecked', 'confirmed', 'restricted')),
  rights_sale text not null default 'unchecked' check (rights_sale in ('unchecked', 'confirmed', 'restricted')),
  rights_ref text check (rights_ref is null or char_length(btrim(rights_ref)) between 1 and 200),
  rights_confirmed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pub_nodes_rights_record check (
    not (rights_public = 'confirmed' or rights_index = 'confirmed' or rights_summary = 'confirmed' or rights_sale = 'confirmed')
    or (rights_ref is not null and rights_confirmed_on is not null)),
  constraint pub_nodes_approved_by_job check (status <> 'approved' or approved_job_id is not null),
  constraint pub_nodes_parent_depth check ((parent_id is null) = (depth = 1))
);
comment on table public.pub_nodes is '출판물 노드 (LIB-02·06) - 장·절·항목 트리. 용도별 권리 4칸, 접근 등급, 승인 상태. 본문은 library_bodies. 직접 읽기 0';
create unique index pub_nodes_order_once on public.pub_nodes (edition_id, coalesce(parent_id, 0), ordinal);
create index pub_nodes_parent_idx on public.pub_nodes (parent_id) where parent_id is not null;
create index pub_nodes_public_idx on public.pub_nodes (edition_id, status, rights_public);

create function public.pub_nodes_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare p record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception '승인되었거나 철회된 노드는 지울 수 없습니다 (철회는 status)' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if new.parent_id is not null then
    select * into p from public.pub_nodes where id = new.parent_id;
    if not found or p.edition_id <> new.edition_id or new.depth <> p.depth + 1 then
      raise exception '상위 노드는 같은 판의 한 단계 위여야 합니다' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.edition_id <> old.edition_id or new.parent_id is distinct from old.parent_id or new.depth <> old.depth then
      raise exception '노드의 판·상위·깊이는 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.status = 'withdrawn' and new.status <> 'withdrawn' then
      raise exception '철회된 노드는 되살릴 수 없습니다 (새 노드로 이관)' using errcode = 'check_violation';
    end if;
    if old.status = 'approved' and new.status = 'draft' then
      raise exception '승인된 노드를 초안으로 되돌릴 수 없습니다' using errcode = 'check_violation';
    end if;
  elsif new.status <> 'draft' then
    raise exception '새 노드는 초안(draft)으로만 만듭니다 - 승인은 이관 작업 승인으로만' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.pub_nodes_guard() from public, anon, authenticated;
create trigger pub_nodes_guard before insert or update or delete on public.pub_nodes for each row execute function public.pub_nodes_guard();

-- ── 월간지 권호 · 권호 기사 ───────────────────────────────────
create table public.magazine_issues (
  id bigint generated always as identity primary key,
  publication_id bigint not null references public.publications (id),
  issue_no text not null check (char_length(btrim(issue_no)) between 1 and 40),
  issued_on date not null,
  as_of date not null,
  title text check (title is null or char_length(btrim(title)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  approved_job_id bigint,
  rights_public text not null default 'unchecked' check (rights_public in ('unchecked', 'confirmed', 'restricted')),
  rights_index text not null default 'unchecked' check (rights_index in ('unchecked', 'confirmed', 'restricted')),
  rights_summary text not null default 'unchecked' check (rights_summary in ('unchecked', 'confirmed', 'restricted')),
  rights_sale text not null default 'unchecked' check (rights_sale in ('unchecked', 'confirmed', 'restricted')),
  rights_pdf text not null default 'unchecked' check (rights_pdf in ('unchecked', 'confirmed', 'restricted')),
  rights_ref text check (rights_ref is null or char_length(btrim(rights_ref)) between 1 and 200),
  rights_confirmed_on date,
  pdf_path text check (pdf_path is null or char_length(btrim(pdf_path)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, issue_no),
  constraint magazine_issues_rights_record check (
    not (rights_public = 'confirmed' or rights_index = 'confirmed' or rights_summary = 'confirmed' or rights_sale = 'confirmed' or rights_pdf = 'confirmed')
    or (rights_ref is not null and rights_confirmed_on is not null)),
  constraint magazine_issues_approved_by_job check (status <> 'approved' or approved_job_id is not null)
);
comment on table public.magazine_issues is '월간지 권호 (LIB-01) - 발행일·기준일·권리 상태. 원본 PDF는 rights_pdf 확인일 때만 열린다. 직접 읽기 0';
create index magazine_issues_listing_idx on public.magazine_issues (publication_id, issued_on desc);

create table public.magazine_articles (
  id bigint generated always as identity primary key,
  issue_id bigint not null references public.magazine_issues (id),
  ordinal int not null check (ordinal >= 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  author_person_id bigint references public.people (id),
  access_tier text not null default 'premium' check (access_tier in ('public', 'premium')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  approved_job_id bigint,
  rights_public text not null default 'unchecked' check (rights_public in ('unchecked', 'confirmed', 'restricted')),
  rights_index text not null default 'unchecked' check (rights_index in ('unchecked', 'confirmed', 'restricted')),
  rights_summary text not null default 'unchecked' check (rights_summary in ('unchecked', 'confirmed', 'restricted')),
  rights_sale text not null default 'unchecked' check (rights_sale in ('unchecked', 'confirmed', 'restricted')),
  rights_ref text check (rights_ref is null or char_length(btrim(rights_ref)) between 1 and 200),
  rights_confirmed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, ordinal),
  constraint magazine_articles_rights_record check (
    not (rights_public = 'confirmed' or rights_index = 'confirmed' or rights_summary = 'confirmed' or rights_sale = 'confirmed')
    or (rights_ref is not null and rights_confirmed_on is not null)),
  constraint magazine_articles_approved_by_job check (status <> 'approved' or approved_job_id is not null)
);
comment on table public.magazine_articles is '권호 기사 (LIB-01·03) - 필자(people)·권리·접근 등급. 본문은 library_bodies. 직접 읽기 0';
create index magazine_articles_author_idx on public.magazine_articles (author_person_id) where author_person_id is not null;

-- 권호·권호 기사 공용 가드: 새 행은 초안만, 철회 되살리기·승인 되돌리기 거부, 삭제는 초안만, 월간(magazine) 출판물만
create function public.magazine_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception '승인되었거나 철회된 권호·기사는 지울 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_table_name = 'magazine_issues' then
    -- 조건을 한 줄로 묶지 않는다 - magazine_articles 행에는 publication_id 칸이 없어 한 식에 두면 오류가 난다
    if not exists (select 1 from public.publications p where p.id = new.publication_id and p.kind = 'magazine') then
      raise exception '권호는 월간(magazine) 출판물에만 둘 수 있습니다' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'withdrawn' and new.status <> 'withdrawn' then
      raise exception '철회된 권호·기사는 되살릴 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.status = 'approved' and new.status = 'draft' then
      raise exception '승인된 권호·기사를 초안으로 되돌릴 수 없습니다' using errcode = 'check_violation';
    end if;
  elsif new.status <> 'draft' then
    raise exception '새 권호·기사는 초안(draft)으로만 만듭니다 - 승인은 이관 작업 승인으로만' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.magazine_guard() from public, anon, authenticated;
create trigger magazine_issues_guard before insert or update or delete on public.magazine_issues for each row execute function public.magazine_guard();
create trigger magazine_articles_guard before insert or update or delete on public.magazine_articles for each row execute function public.magazine_guard();

-- ── 본문 (직접 권한 0) ────────────────────────────────────────
create table public.library_bodies (
  kind text not null check (kind in ('node', 'issue_article')),
  ref_id bigint not null,
  body text not null check (char_length(btrim(body)) between 1 and 500000),
  body_hash text generated always as (md5(body)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, ref_id)
);
comment on table public.library_bodies is '지식창고 본문 (LIB-04) - anon·authenticated 권한 0. 서버 함수 library_read(193)만 미리보기로 잘라 내보낸다. 승인 뒤에는 고칠 수 없다(새 판으로)';
create function public.library_bodies_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare v_status text; v_kind text := coalesce(new.kind, old.kind); v_id bigint := coalesce(new.ref_id, old.ref_id);
begin
  if v_kind = 'node' then
    select n.status into v_status from public.pub_nodes n where n.id = v_id;
  else
    select a.status into v_status from public.magazine_articles a where a.id = v_id;
  end if;
  if v_status is null then
    raise exception '본문이 가리키는 노드·기사가 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'draft' then
    raise exception '승인되었거나 철회된 항목의 본문은 고칠 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.library_bodies_guard() from public, anon, authenticated;
create trigger library_bodies_guard before insert or update or delete on public.library_bodies for each row execute function public.library_bodies_guard();

-- ── 권리 변경 기록 (LIB-06 - 추가만) ──────────────────────────
create table public.library_rights_log (
  id bigint generated always as identity primary key,
  item_kind text not null check (item_kind in ('node', 'issue', 'issue_article', 'column')),
  item_id bigint not null,
  field text not null check (field in ('rights_public', 'rights_index', 'rights_summary', 'rights_sale', 'rights_pdf', 'status')),
  old_value text,
  new_value text not null,
  actor text not null check (char_length(btrim(actor)) > 0),
  at timestamptz not null default now()
);
comment on table public.library_rights_log is '권리·공개 상태 변경 감사 (LIB-06) - 추가만. 트리거가 자동으로 남긴다(행위자는 세션 값 ltr.actor, 없으면 unknown)';
create index library_rights_log_item_idx on public.library_rights_log (item_kind, item_id, at desc);
create function public.library_log_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '권리 변경 기록은 고치거나 지울 수 없습니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.library_log_immutable() from public, anon, authenticated;
create trigger library_rights_log_no_update_delete before update or delete on public.library_rights_log for each row execute function public.library_log_immutable();
create trigger library_rights_log_no_truncate before truncate on public.library_rights_log for each statement execute function public.library_log_immutable();

create function public.library_rights_trace() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f text;
  v_kind text := tg_argv[0];
  v_actor text := coalesce(nullif(btrim(current_setting('ltr.actor', true)), ''), 'unknown');
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := to_jsonb(new);
begin
  foreach f in array array['rights_public', 'rights_index', 'rights_summary', 'rights_sale', 'rights_pdf', 'status'] loop
    if n ? f and (o ->> f) is distinct from (n ->> f) and not (tg_op = 'INSERT' and (n ->> f) in ('unchecked', 'draft')) then
      insert into public.library_rights_log (item_kind, item_id, field, old_value, new_value, actor)
      values (v_kind, (n ->> 'id')::bigint, f, o ->> f, n ->> f, v_actor);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.library_rights_trace() from public, anon, authenticated;
create trigger pub_nodes_rights_trace after insert or update on public.pub_nodes for each row execute function public.library_rights_trace('node');
create trigger magazine_issues_rights_trace after insert or update on public.magazine_issues for each row execute function public.library_rights_trace('issue');
create trigger magazine_articles_rights_trace after insert or update on public.magazine_articles for each row execute function public.library_rights_trace('issue_article');

-- ── 권한: 모두 서비스 역할만 (공개는 193의 뷰·함수) ───────────
alter table public.publications enable row level security;
alter table public.editions enable row level security;
alter table public.pub_nodes enable row level security;
alter table public.magazine_issues enable row level security;
alter table public.magazine_articles enable row level security;
alter table public.library_bodies enable row level security;
alter table public.library_rights_log enable row level security;
revoke all on table public.publications, public.editions, public.pub_nodes, public.magazine_issues, public.magazine_articles, public.library_bodies, public.library_rights_log from public, anon, authenticated, service_role;
grant select, insert, update on table public.publications, public.editions, public.pub_nodes, public.magazine_issues, public.magazine_articles, public.library_bodies to service_role;
grant delete on table public.publications, public.editions, public.pub_nodes, public.magazine_issues, public.magazine_articles, public.library_bodies to service_role;
grant select on table public.library_rights_log to service_role;
