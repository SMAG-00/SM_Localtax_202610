-- W2-e 4단계 DB — 정책 문서 버전 (docs/dev/W2-e_설계.md 2.1 · 3.4 · 6장, PRD-01A HELP-02 · HELP-05)
-- · policy_versions — 문서마다 버전(1, 2, 3…). 게시하려면 법률 검토·게시 승인 기록 3칸(검토자·검토일·메모)이 모두 있어야 한다(check).
--   게시본(published)은 문서마다 하나뿐(부분 unique), 초안(draft)도 문서마다 하나뿐. 게시된 버전의 본문은 고치지 않고(트리거), 새 버전을 게시하면 이전 게시본은 superseded가 된다.
-- · 함수 policy_publish — 이전 게시본 내림 + 새 버전 게시를 한 번에(한쪽만 되는 일 없음). service_role만 실행.
-- · 공개 뷰 public_policy_versions — 게시본·이전 판의 승인 기록·고친 사람 칸을 뺀 칸만 anon이 읽는다. 기능 키·게시 여부 판정은 서버가 한다.
-- · settings.company_info 공개 읽기 — 바닥글 회사 정보 줄(6.4). 기존 settings_public_read 정책은 건드리지 않고 정책을 하나 더한다.
-- · 씨앗 0행 — 정책 문구는 이 파일 어디에도 없다. 약관·처리방침 등은 PO·법률 검토가 쓰고 승인한 뒤 화면에서 게시한다(설계 12장 #1).

create table public.policy_versions (
  id bigint generated always as identity primary key,
  doc_key text not null check (doc_key in ('about', 'editorial-policy', 'ethics', 'corrections', 'ad-policy', 'privacy', 'terms', 'no-email-collection', 'advertise')),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  body jsonb not null default '[]'::jsonb check (jsonb_typeof(body) = 'array'),
  change_summary text,
  effective_on date,
  published_at timestamptz,
  approved_by text,
  approved_on date,
  approval_note text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_key, version),
  constraint policy_versions_approval_required check (
    status = 'draft'
    or (nullif(btrim(approved_by), '') is not null and approved_on is not null and nullif(btrim(approval_note), '') is not null and published_at is not null)
  ),
  constraint policy_versions_summary_required check (status = 'draft' or version = 1 or nullif(btrim(change_summary), '') is not null)
);

create unique index policy_versions_one_published on public.policy_versions (doc_key) where status = 'published';
create unique index policy_versions_one_draft on public.policy_versions (doc_key) where status = 'draft';

comment on table public.policy_versions is
  '정책 문서 버전 (W2-e 3.4) — 게시는 법률 검토·승인 기록 3칸이 있어야만. 게시본 본문은 고치지 않는다(새 버전). 씨앗 0행';
comment on column public.policy_versions.body is '절 목록 [{heading, blocks:[{type: paragraph|list|callout, text 또는 items[]}]}] — HTML 직접 입력 0';

create function public.policy_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'policy_versions: 게시된 버전은 지울 수 없습니다' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.doc_key <> old.doc_key or new.version <> old.version then
    raise exception 'policy_versions: 문서와 버전 번호는 바꿀 수 없습니다' using errcode = '23514';
  end if;
  if old.status = 'superseded' then
    raise exception 'policy_versions: 이전 판은 고칠 수 없습니다' using errcode = '23514';
  end if;
  if old.status = 'published' then
    if new.status <> 'superseded' then
      raise exception 'policy_versions: 게시본은 새 버전을 게시해야만 내려갑니다' using errcode = '23514';
    end if;
    if new.body is distinct from old.body or new.approved_by is distinct from old.approved_by or new.approval_note is distinct from old.approval_note
       or new.approved_on is distinct from old.approved_on or new.published_at is distinct from old.published_at or new.effective_on is distinct from old.effective_on
       or new.change_summary is distinct from old.change_summary then
      raise exception 'policy_versions: 게시된 버전의 내용은 고칠 수 없습니다 — 새 버전을 만드세요' using errcode = '23514';
    end if;
  elsif new.status = 'superseded' then
    raise exception 'policy_versions: 게시되지 않은 초안은 이전 판이 될 수 없습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.policy_versions_guard() from public, anon, authenticated;
create trigger policy_versions_guard_trg before update or delete on public.policy_versions
  for each row execute function public.policy_versions_guard();
create trigger policy_versions_touch before update on public.policy_versions
  for each row execute function public.touch_updated_at();

alter table public.policy_versions enable row level security;
revoke all on table public.policy_versions from anon, authenticated, service_role;
grant select, insert, update, delete on table public.policy_versions to service_role;

-- 게시 — 이전 게시본을 내리고 초안을 게시한다. 승인 기록이 없으면 check가 거부(23514)해 둘 다 되돌아간다
create function public.policy_publish(
  p_doc_key text, p_version integer, p_approved_by text, p_approved_on date, p_approval_note text,
  p_change_summary text, p_effective_on date, p_updated_by text
) returns bigint
language plpgsql as $$
declare
  v_id bigint;
begin
  select id into v_id from public.policy_versions where doc_key = p_doc_key and version = p_version and status = 'draft';
  if v_id is null then
    raise exception 'policy_publish: 게시할 초안이 없습니다' using errcode = 'P0002';
  end if;
  update public.policy_versions set status = 'superseded', updated_by = p_updated_by where doc_key = p_doc_key and status = 'published';
  update public.policy_versions
     set status = 'published', published_at = now(), approved_by = p_approved_by, approved_on = p_approved_on, approval_note = p_approval_note,
         change_summary = coalesce(p_change_summary, change_summary), effective_on = coalesce(p_effective_on, effective_on), updated_by = p_updated_by
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.policy_publish(text, integer, text, date, text, text, date, text) from public, anon, authenticated;
grant execute on function public.policy_publish(text, integer, text, date, text, text, date, text) to service_role;

create view public.public_policy_versions as
  select doc_key, version, status, body, change_summary, effective_on, published_at
    from public.policy_versions
   where status in ('published', 'superseded');
revoke all on table public.public_policy_versions from public, anon, authenticated;
grant select on table public.public_policy_versions to anon, authenticated, service_role;

create policy settings_public_company_info on public.settings
  for select to anon, authenticated
  using (key = 'company_info');
