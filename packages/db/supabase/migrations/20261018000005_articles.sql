-- W2-a 1단계 DB — 기사 articles · 수정 이력 article_revisions · 기사 태그 article_tags (PRD-01A 6.1, ART-01·05·10, CAT-01·04·05)
-- 발행 판정(packages/editorial)이 막는 규칙(근거·승인·감수 필수 등)과 별개로, 직접 SQL로도 깨지지 않아야 하는 저장 규칙만 DB에 둔다:
-- · section·content_type 필수(이관 기사만 content_type을 비울 수 있다), 값 목록 밖 거부
-- · reporting_method는 reported_news만 · 표기(label)가 있으면 sponsored, sponsored는 표기 필수 · 공동 기획은 제휴사 필수
-- · digest는 주간 회차(digest_id) 필수, digest → reported_news 변경 거부 (LG-04)
-- · slug 예약 이름(video·photo·popular) 거부 (ART-01) · 최초 발행일(first_published_at) 변경 거부 (OPT-10)
-- · 하위 분야는 기사의 분야 안의 것만 · 대표 이미지 권리(lead_media_cleared)는 트리거가 계산한다 (공개 읽기 조건)
-- 편집 승인·세무 감수 상태(editorial_status·tax_review_status)의 규칙은 승인 기록 표와 함께 20261018000007에서 건다.

create table public.articles (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[^[:space:]/]+$' and lower(slug) <> all (array['video', 'photo', 'popular'])),
  title text not null check (length(btrim(title)) > 0),
  summary text,
  body jsonb not null default '[]'::jsonb,                 -- 블록 편집 (문단·표·이미지·인용·콜아웃·FAQ·핵심 요약 상자, 핵심 주장 표시와 근거 ID)
  format text not null default 'general' check (format in ('general', 'cardnews', 'infographic', 'video', 'photo')),
  section text not null check (section in ('tax', 'realestate', 'finance', 'local')),
  content_type text check (content_type in ('reported_news', 'explainer', 'guide', 'opinion', 'sponsored', 'digest')),
  reporting_method text check (reporting_method in ('quantitative', 'qualitative', 'mixed')),
  origin text not null default 'new' check (origin in ('new', 'legacy')),
  category_id bigint,
  subtype text not null default 'general' check (subtype in ('general', 'solved_case')),
  solved_case jsonb,                                       -- 해결 사례 4칸 (상황·쟁점·결과·교훈, CAT-05)
  label text not null default 'none' check (label in ('none', 'co_planned', 'ad')),
  partner_id bigint references public.partners (id),
  author_id bigint references public.people (id),
  story_assignment_id bigint references public.story_assignments (id),
  lead_media_id bigint references public.media (id),
  lead_media_cleared boolean not null default true,        -- 대표 이미지가 없거나 권리 확인됨 — 트리거가 계산 (직접 못 바꾼다)
  editorial_status text not null default 'pending' check (editorial_status in ('pending', 'approved', 'rejected', 'held')),
  tax_review_status text not null default 'not_required' check (tax_review_status in ('not_required', 'pending', 'approved', 'rejected', 'held')),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'held', 'deleted')),
  version integer not null default 1 check (version >= 1),
  publish_at timestamptz,
  first_published_at timestamptz,                          -- 불변 (OPT-10)
  substantive_updated_at timestamptz,                      -- = dateModified (실질 수정·정정 때만 바뀐다, OPT-07)
  updated_reason text,
  update_kind text check (update_kind in ('substantive', 'typo', 'correction')),
  legal_basis_date date,                                   -- 법령 기준일
  tax_lens jsonb,                                          -- 「지방세로 읽기」 (01B CORE-01)
  digest_id bigint,                                        -- 01B weekly_digests (표는 01B 단계에서 만든다 — 그때 외래 키를 더한다)
  region_codes text[] not null default '{}',
  editorial_field text check (editorial_field in ('local_tax', 'realestate', 'local_finance', 'urban_policy')),
  public_question text,
  amendment_id bigint references public.amendments (id),   -- 개정 브리핑의 트래커 (CAT-04 — 단계는 트래커에서 읽고 기사에 저장하지 않는다)
  legacy_url text,
  legacy_source text,
  nav_candidate boolean not null default false,
  hot_pin_until timestamptz,
  is_paid boolean not null default false,                  -- 2단계 BIZ-04 (1단계 false)
  check_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_category_section foreign key (category_id, section) references public.categories (id, section),
  constraint articles_content_type_required check (content_type is not null or origin = 'legacy'),
  constraint articles_reporting_method_reported_only check (reporting_method is null or content_type = 'reported_news'),
  constraint articles_label_sponsored check ((label <> 'none') = (content_type is not distinct from 'sponsored')),
  constraint articles_co_planned_partner check (label <> 'co_planned' or partner_id is not null),
  constraint articles_digest_link check ((content_type is not distinct from 'digest') = (digest_id is not null)),
  constraint articles_scheduled_publish_at check (status <> 'scheduled' or publish_at is not null),
  constraint articles_update_reason check (update_kind is null or length(btrim(coalesce(updated_reason, ''))) > 0),
  constraint articles_solved_case_subtype check (solved_case is null or subtype = 'solved_case')
);

comment on table public.articles is '기사 (ART-01). 게재 상태·편집 승인·세무 감수·표기를 분리한다. 공개는 status=published이고 대표 이미지 권리 확인(또는 없음)인 행의 공개 칸만';
comment on column public.articles.lead_media_cleared is '대표 이미지가 없거나 rights_status=confirmed — articles·media 트리거가 계산한다';

create index articles_status_idx on public.articles (status, first_published_at desc);
create index articles_section_idx on public.articles (section, content_type);
create index articles_author_idx on public.articles (author_id);
create index articles_lead_media_idx on public.articles (lead_media_id);

create function public.articles_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 대표 이미지 권리 — 넣은 값과 상관없이 media에서 다시 계산한다
  if new.lead_media_id is null then
    new.lead_media_cleared := true;
  else
    select coalesce(m.rights_status = 'confirmed', false) into new.lead_media_cleared
      from public.media m where m.id = new.lead_media_id;
    new.lead_media_cleared := coalesce(new.lead_media_cleared, false);
  end if;

  if tg_op = 'UPDATE' then
    -- 최초 발행일은 한 번 정해지면 바꾸거나 지울 수 없다 (OPT-10)
    if old.first_published_at is not null and new.first_published_at is distinct from old.first_published_at then
      raise exception '최초 발행일(first_published_at)은 바꿀 수 없습니다 (OPT-10)'
        using errcode = 'check_violation';
    end if;
    -- 금주 핫뉴스를 보도 기사로 바꾸지 않는다 — 새 기획으로만 (LG-04)
    if old.content_type = 'digest' and new.content_type = 'reported_news' then
      raise exception 'digest(금주 핫뉴스)를 reported_news로 바꿀 수 없습니다 (LG-04)'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 처음 발행할 때 최초 발행일을 찍는다 (이관 기사는 원래 발행일을 넣어 온다)
  if new.status = 'published' and new.first_published_at is null then
    new.first_published_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.articles_guard() from public, anon, authenticated;

create trigger articles_guard
  before insert or update on public.articles
  for each row execute function public.articles_guard();

create trigger articles_touch before update on public.articles
  for each row execute function public.touch_updated_at();

-- 이미지 권리가 바뀌면 그 이미지를 대표 이미지로 쓰는 기사의 공개 가능 표시를 다시 계산한다
create function public.media_rights_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.articles a
     set lead_media_cleared = (new.rights_status = 'confirmed')
   where a.lead_media_id = new.id
     and a.lead_media_cleared is distinct from (new.rights_status = 'confirmed');
  return null;
end;
$$;

revoke all on function public.media_rights_sync() from public, anon, authenticated;

create trigger media_rights_sync
  after update of rights_status on public.media
  for each row execute function public.media_rights_sync();

alter table public.articles enable row level security;
revoke all on table public.articles from anon, authenticated, service_role;
grant select, insert, update, delete on table public.articles to service_role;

-- ─────────────────────────────────────────────────────────────
-- article_revisions — 수정 이력 (ART-05 · NAV-06). 덮어쓰지 않는다 — 추가만
-- ─────────────────────────────────────────────────────────────
create table public.article_revisions (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id),
  version integer not null check (version >= 1),
  title text not null,
  body jsonb not null,
  edited_by text not null check (length(btrim(edited_by)) > 0),   -- user:<uuid> · admin:<이메일> (audit_logs와 같은 형식)
  edited_at timestamptz not null default now(),
  reason text,
  update_kind text check (update_kind in ('substantive', 'typo', 'correction')),
  unique (article_id, version),
  unique (id, article_id),                                         -- 정정 이력이 (버전, 기사) 짝으로 참조한다
  constraint article_revisions_reason check (update_kind is null or length(btrim(coalesce(reason, ''))) > 0)
);

comment on table public.article_revisions is '기사 수정 이력 (ART-05) — 추가만. 정정·제목 변경의 전후 버전';

create trigger article_revisions_no_update_delete
  before update or delete on public.article_revisions
  for each row execute function public.append_only_guard();

create trigger article_revisions_no_truncate
  before truncate on public.article_revisions
  for each statement execute function public.append_only_guard();

alter table public.article_revisions enable row level security;
revoke all on table public.article_revisions from anon, authenticated, service_role;
grant select, insert on table public.article_revisions to service_role;

-- ─────────────────────────────────────────────────────────────
-- article_tags — 기사 ↔ 태그
-- ─────────────────────────────────────────────────────────────
create table public.article_tags (
  article_id bigint not null references public.articles (id) on delete cascade,
  tag_id bigint not null references public.tags (id) on delete cascade,
  primary key (article_id, tag_id)
);

alter table public.article_tags enable row level security;
revoke all on table public.article_tags from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_tags to service_role;
