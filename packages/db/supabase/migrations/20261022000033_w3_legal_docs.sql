-- W3 5단계 — 해석 원문 legal_docs · 기사 연결 article_legal_docs · 해석 해설 지정 interpretation_articles · 검수 큐 legal_doc_review_queue
-- (PRD-01B TX-09, docs/dev/W3_설계.md 3장)
-- · 원문(예규·통칙·유권해석·심판·판례)은 편집국이 직접 입력한다 — 이 파일에 원문·해설 본문은 없다. 스냅샷은 raw_snapshots(W2-a)를 가리킨다.
-- · 공개 읽기는 '필수 칸이 모두 있고 권리 확인(confirmed)된' 행만. 심판·판례는 비실명 확인(anonymity_check=confirmed)도 필요하다.
-- · 해석 해설로 지정된 기사(interpretation_articles)는 발행(published·scheduled) 때 (1) 공개 가능한 원문 subject 연결 1건 이상 (2) 세무 감수 승인(tax_review_status=approved)이 있어야 한다.
-- · 원문 해시(content_hash)가 바뀌면 연결된 해설마다 검수 큐 1건(같은 해시로는 한 번만). 기존 표·제약·값은 바꾸지 않는다.

create table public.legal_docs (
  id bigint generated always as identity primary key,
  doc_type text not null check (doc_type in ('ruling', 'circular', 'interpretation', 'tribunal', 'case')),
  issuer text,
  doc_no text,
  decided_on date,
  tax_kinds text[] not null default '{}',
  provisions text[] not null default '{}',
  source_url text check (source_url is null or source_url ~* '^https?://[^[:space:]]+$'),
  snapshot_id bigint references public.raw_snapshots (id),
  rights_status text not null default 'unchecked' check (rights_status in ('unchecked', 'confirmed', 'restricted')),
  anonymity_check text not null default 'unchecked' check (anonymity_check in ('unchecked', 'confirmed')),
  content_hash text,
  hash_changed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.legal_docs is '해석·판례 원문 메타 (TX-09) — 필수 칸이 비거나 권리 미확인이면 공개 제외. 심판·판례는 비실명 확인 필요. 원문 글자는 raw_snapshots';

-- 공개 가능 판정 한 곳 (공개 읽기 정책 · 발행 검사가 같이 쓴다)
create function public.legal_doc_public(d public.legal_docs) returns boolean
language sql
immutable
as $$
  select d.rights_status = 'confirmed'
     and coalesce(btrim(d.issuer), '') <> ''
     and coalesce(btrim(d.doc_no), '') <> ''
     and d.decided_on is not null
     and d.source_url is not null
     and d.snapshot_id is not null
     and coalesce(btrim(d.content_hash), '') <> ''
     and cardinality(d.tax_kinds) > 0
     and (d.doc_type in ('ruling', 'circular', 'interpretation') or d.anonymity_check = 'confirmed');
$$;

create table public.article_legal_docs (
  article_id bigint not null references public.articles (id) on delete cascade,
  legal_doc_id bigint not null references public.legal_docs (id),
  role text not null check (role in ('subject', 'related')),
  primary key (article_id, legal_doc_id)
);

create index article_legal_docs_doc_idx on public.article_legal_docs (legal_doc_id);

create table public.interpretation_articles (
  article_id bigint primary key references public.articles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.interpretation_articles is '해석 해설로 지정된 기사 — 발행 때 원문 연결·세무 감수를 요구한다';

create table public.legal_doc_review_queue (
  id bigint generated always as identity primary key,
  legal_doc_id bigint not null references public.legal_docs (id) on delete cascade,
  article_id bigint not null references public.articles (id) on delete cascade,
  content_hash text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (legal_doc_id, article_id, content_hash)
);

comment on table public.legal_doc_review_queue is '원문 해시가 바뀐 뒤 다시 검수할 해설 — 같은 변경으로는 기사당 1건';

-- 원문 해시가 바뀌면 시각을 찍고, 연결된 해설마다 검수 큐에 올린다
create function public.legal_docs_hash_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content_hash is distinct from old.content_hash then
    new.hash_changed_at := now();
    if new.content_hash is not null then
      insert into public.legal_doc_review_queue (legal_doc_id, article_id, content_hash)
      select new.id, l.article_id, new.content_hash
        from public.article_legal_docs l
        join public.interpretation_articles i on i.article_id = l.article_id
       where l.legal_doc_id = new.id
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.legal_docs_hash_guard() from public, anon, authenticated;

create trigger legal_docs_hash_guard
  before update on public.legal_docs
  for each row execute function public.legal_docs_hash_guard();

-- 해석 해설 발행 검사 — 공개 가능한 원문(subject) 1건 이상 + 세무 감수 승인
create function public.interpretation_publish_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('published', 'scheduled')
     and exists (select 1 from public.interpretation_articles i where i.article_id = new.id) then
    if not exists (
      select 1 from public.article_legal_docs l join public.legal_docs d on d.id = l.legal_doc_id
       where l.article_id = new.id and l.role = 'subject' and public.legal_doc_public(d)
    ) then
      raise exception '해석 해설은 공개 가능한 원문(해설 대상)을 1건 이상 연결해야 발행할 수 있습니다 (기사 %)', new.id
        using errcode = 'check_violation';
    end if;
    if new.tax_review_status <> 'approved' then
      raise exception '해석 해설은 세무 감수 승인 뒤에만 발행할 수 있습니다 (기사 %)', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.interpretation_publish_guard() from public, anon, authenticated;

create trigger articles_interpretation_guard
  before insert or update on public.articles
  for each row execute function public.interpretation_publish_guard();

-- 발행된 해설의 마지막 원문 연결을 끊거나 바꾸지 못하게
create function public.article_legal_docs_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.interpretation_articles i join public.articles a on a.id = i.article_id
              where i.article_id = old.article_id and a.status in ('published', 'scheduled'))
     and old.role = 'subject'
     and not exists (select 1 from public.article_legal_docs l join public.legal_docs d on d.id = l.legal_doc_id
                      where l.article_id = old.article_id and l.role = 'subject' and l.legal_doc_id <> old.legal_doc_id and public.legal_doc_public(d))
     and (tg_op = 'DELETE' or new.role is distinct from 'subject' or new.legal_doc_id is distinct from old.legal_doc_id) then
    raise exception '발행된 해석 해설의 마지막 원문 연결은 끊을 수 없습니다 (기사 %)', old.article_id
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.article_legal_docs_guard() from public, anon, authenticated;

create trigger article_legal_docs_guard
  before update or delete on public.article_legal_docs
  for each row execute function public.article_legal_docs_guard();

-- 권한·RLS
alter table public.legal_docs enable row level security;
alter table public.article_legal_docs enable row level security;
alter table public.interpretation_articles enable row level security;
alter table public.legal_doc_review_queue enable row level security;
revoke all on table public.legal_docs, public.article_legal_docs, public.interpretation_articles, public.legal_doc_review_queue from anon, authenticated, service_role;
grant select, insert, update, delete on table public.legal_docs, public.article_legal_docs, public.interpretation_articles, public.legal_doc_review_queue to service_role;
grant select (id, doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url, content_hash, hash_changed_at) on table public.legal_docs to anon, authenticated;
grant select on table public.article_legal_docs to anon, authenticated;
grant select (article_id) on table public.interpretation_articles to anon, authenticated;

create policy legal_docs_public_read on public.legal_docs
  for select to anon, authenticated
  using (
    rights_status = 'confirmed'
    and coalesce(btrim(issuer), '') <> '' and coalesce(btrim(doc_no), '') <> ''
    and decided_on is not null and source_url is not null and snapshot_id is not null
    and coalesce(btrim(content_hash), '') <> '' and cardinality(tax_kinds) > 0
    and (doc_type in ('ruling', 'circular', 'interpretation') or anonymity_check = 'confirmed')
  );
-- 위 조건은 legal_doc_public 함수와 같다. 함수는 anon이 실행하지 못하게 막아 두므로(허용 목록 시험) 정책에는 식을 직접 쓴다
revoke all on function public.legal_doc_public(public.legal_docs) from public, anon, authenticated;

create policy article_legal_docs_public_read on public.article_legal_docs
  for select to anon, authenticated
  using (exists (select 1 from public.legal_docs d where d.id = article_legal_docs.legal_doc_id));

create policy interpretation_articles_public_read on public.interpretation_articles
  for select to anon, authenticated
  using (exists (select 1 from public.public_articles p where p.id = interpretation_articles.article_id));

-- 기능 키 interpretations — 꺼진 채로
update public.settings
   set value = value || jsonb_build_object('interpretations', false),
       updated_by = 'migration:20261022000033'
 where key = 'feature_flags'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'interpretations');
