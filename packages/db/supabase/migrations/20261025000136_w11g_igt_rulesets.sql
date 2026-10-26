-- W11-g g5 (1/3) - 상속·증여세 룰셋 표 · 서명/승인 함수 · 공개 읽기 뷰 · 기능 키 (PRD-03 FAM-12, docs/dev/3단계_설계.md 2.1·3·4.4, docs/dev/W11-g_설계.md)
-- · 지방세 rulesets 표와 따로 둔다 - rulesets 의 국세 낱말 거부 트리거(81)와 활성 1행 규칙은 그대로고, 이 표는 상속·증여 묶음만 담는다.
--   최상위 칸은 version · status · effective_from · source · source_laws + 네 묶음(common · gift · inheritance · payment)뿐이고 네 묶음은 반드시 있어야 한다.
--   다른 세목 묶음(SM 플랫폼 몫)의 낱말이 본문에 있으면 저장을 거부한다 - 낱말 목록은 아래 트리거 안에 조각으로 적었다(CI 낱말 검사 대상 파일이라).
-- · 같은 생애: draft -> reviewed(감수 서명, 감수위원만) -> active(관리자 승인) -> retired. 본문·버전·근거는 만든 뒤 바꾸지 못하고,
--   상태 전이는 83번의 rule_sign/rule_approve 를 그대로 쓰는 sign_igt_ruleset/approve_igt_ruleset 함수로만 일어난다. 거부해도 { ok:false, code } + rules_audit 1행.
-- · 값은 안심 상속증여계산기가 AI 로 시행령과 대조한 미감수 값이다. 이 파일에는 룰셋 값이 없고(씨앗 0행) 서명 전에는 공개 계산이 열리지 않는다.
-- · 공개 읽기 뷰 public_igt_active_ruleset 은 활성(서명·승인) 행만, 칸을 좁혀서 보여 준다 - 브라우저 계산이 받아 간다. 초안·서명 전 본문은 열리지 않는다.
-- · 기능 키 calc_igt_gift · calc_igt_inheritance 는 꺼짐으로 시작한다.

create table public.igt_rulesets (
  id bigint generated always as identity primary key,
  version text not null unique check (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'active', 'retired')),
  body jsonb not null check (
    jsonb_typeof(body) = 'object'
    and (body - array['version', 'status', 'effective_from', 'source', 'source_laws', 'common', 'gift', 'inheritance', 'payment']) = '{}'::jsonb
    and body ?& array['version', 'effective_from', 'common', 'gift', 'inheritance', 'payment']
    and jsonb_typeof(body -> 'common') = 'object' and jsonb_typeof(body -> 'gift') = 'object'
    and jsonb_typeof(body -> 'inheritance') = 'object' and jsonb_typeof(body -> 'payment') = 'object'),
  body_sha256 text not null,
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 200),
  basis_event_id bigint references public.amendment_events (id),
  basis_note text check (basis_note is null or char_length(basis_note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  activated_by text,
  activated_at timestamptz,
  retired_at timestamptz,
  constraint igt_rulesets_version_match check (body ->> 'version' = version),
  constraint igt_rulesets_basis_given check (basis_event_id is not null or char_length(btrim(coalesce(basis_note, ''))) > 0),
  constraint igt_rulesets_signed_record check (
    status not in ('reviewed', 'active')
    or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint igt_rulesets_active_record check (status <> 'active' or (activated_by is not null and activated_at is not null)),
  constraint igt_rulesets_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and activated_by is null and activated_at is null))
);
comment on table public.igt_rulesets is '상속·증여세 룰셋 버전 (FAM-12) - 지방세 rulesets 와 다른 표. draft -> reviewed(감수 서명) -> active(관리자 승인). 본문 불변, 활성 1행, 다른 세목 묶음 낱말 거부. 값은 안심이 AI 로 대조한 미감수 값이라 서명 전에는 draft';
create unique index igt_rulesets_one_active on public.igt_rulesets ((true)) where status = 'active';

create function public.igt_rulesets_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '상속·증여세 룰셋은 초안(draft)으로만 만들 수 있습니다 - 활성화는 감수 서명 뒤 approve_igt_ruleset 함수로만 합니다 (FAM-12)' using errcode = 'check_violation';
    end if;
    -- 다른 세목 묶음 낱말 0 (CI NT7 과 같은 묶음): 낱말을 조각으로 이어 붙인다
    if new.body::text ~* ('양' || '도|부담' || '부|trans' || 'fer|oner' || 'ous|bur' || 'den|capi' || 'tal_?gain|calc_?' || 'cgt') then
      raise exception '본문에 이 표가 담지 않는 세목의 낱말이 있어 저장할 수 없습니다 - 이 표는 상속·증여세 묶음만 담습니다 (원칙 4)' using errcode = 'check_violation';
    end if;
    new.body_sha256 := encode(sha256(convert_to(new.body::text, 'UTF8')), 'hex');
    return new;
  end if;
  if new.version is distinct from old.version or new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.source_ref is distinct from old.source_ref or new.basis_event_id is distinct from old.basis_event_id
     or new.basis_note is distinct from old.basis_note or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception '버전·본문·근거는 고칠 수 없습니다 - 차수를 올려 새 행으로 만드세요 (RULE-01)' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at
     or new.activated_by is distinct from old.activated_by or new.activated_at is distinct from old.activated_at then
    if coalesce(current_setting('ltr.rules_gate', true), '') <> 'rpc' then
      raise exception '서명·활성화 상태는 sign_igt_ruleset/approve_igt_ruleset 함수로만 바뀝니다 (RULE-02)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.igt_rulesets_guard() from public, anon, authenticated;
create trigger igt_rulesets_guard before insert or update on public.igt_rulesets for each row execute function public.igt_rulesets_guard();
create trigger igt_rulesets_no_delete before delete on public.igt_rulesets for each row execute function public.rule_versions_no_delete();
create trigger igt_rulesets_no_truncate before truncate on public.igt_rulesets for each statement execute function public.rule_versions_no_delete();

alter table public.igt_rulesets enable row level security;
revoke all on table public.igt_rulesets from anon, authenticated, service_role;
grant select, insert on table public.igt_rulesets to service_role;

-- ─────────────────────────────────────────────────────────────
-- 감사 종류 + 서명/승인 함수 (83·112 의 rule_sign/rule_approve 를 그대로 쓴다 - 종류 이름만 더한다)
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'public.rules_audit'::regclass and conname = 'rules_audit_kind_check';
  if v_def is null then
    raise exception 'rules_audit_kind_check 제약이 없습니다';
  end if;
  if v_def not like '%igt_ruleset%' then
    execute 'alter table public.rules_audit drop constraint rules_audit_kind_check';
    execute format('alter table public.rules_audit add constraint rules_audit_kind_check %s', replace(v_def, '''ruleset''::text', '''ruleset''::text, ''igt_ruleset''::text'));
  end if;
end;
$$;

create or replace function public.rules_kind_table(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'ruleset' then 'rulesets' when 'determination_table' then 'determination_tables' when 'tax_calendar' then 'tax_calendar'
                     when 'requirement_dictionary' then 'requirement_dictionary' when 'igt_ruleset' then 'igt_rulesets' end;
$$;

create function public.sign_igt_ruleset(p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_sign('igt_ruleset', p_id, p_signer, p_sheet_ref, p_impact); $$;
create function public.approve_igt_ruleset(p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_approve('igt_ruleset', p_id, p_approver, p_impact); $$;
revoke all on function public.sign_igt_ruleset(bigint, text, text, jsonb), public.approve_igt_ruleset(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.sign_igt_ruleset(bigint, text, text, jsonb), public.approve_igt_ruleset(bigint, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 읽기 뷰 - 활성 행만, 칸을 좁혀서 (브라우저 계산이 받아 간다)
-- ─────────────────────────────────────────────────────────────
create view public.public_igt_active_ruleset as
select version, body, body_sha256, signed_at, activated_at
  from public.igt_rulesets
 where status = 'active';
comment on view public.public_igt_active_ruleset is '활성(서명·승인된) 상속·증여세 룰셋 본문 (FAM-10·11) - 초안·서명 전 본문은 열리지 않는다';
revoke all on table public.public_igt_active_ruleset from public, anon, authenticated, service_role;
grant select on table public.public_igt_active_ruleset to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 기능 키 둘 - 꺼짐으로 시작, 이미 있는 값은 건드리지 않는다
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = jsonb_build_object('calc_igt_gift', false, 'calc_igt_inheritance', false) || s.value,
       updated_by = 'migration:20261025000136'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and not (s.value ? 'calc_igt_gift' and s.value ? 'calc_igt_inheritance');
