-- W12-d d1·d4 - 모드 공개 판정 · 하루 한도 · 피드백 (docs/dev/W12-d_설계.md, 4단계 설계 1장 W12-d · 2.1 번호 168, PRD-04 CHAT-15 · ASK-10 · ASK-11 · COMPLY-01)
--  · 설정 씨앗 2개: ask_mode_notice(모드 고지 승인·문구 자리), ask_mode_targets(4c에서 모드 버튼을 볼 계정 종류). 문구는 모두 빈 칸 - 법률 감수·PO 입력이다
--  · public_ask_mode(): 위젯이 부르는 공개 판정 값 (공개 단계·기능 키·고지 승인·대상 계정 - 값만). 버튼을 보일지는 앱의 순수 함수가 정한다
--  · agent_quota_daily: 하루 한도 사용량. 차감은 agent_quota_consume(보내기를 눌러 요청이 올 때)뿐이며 진입·화면 열기는 부르지 않는다. 한도 값은 ask_limits(코드에 상수 0)
--  · agent_feedback: 👍/👎 + 사유 + 오류 신고. 자유 글 칸 0 (개인정보가 들어갈 길을 막는다)
-- 한도·승인 함수는 service_role만 부른다(서버가 등급을 정한다 - 브라우저가 등급을 속일 수 없다). 피드백 제출과 모드 판정은 anon에 연다.

insert into public.settings (key, value, description, updated_by) values
  ('ask_mode_notice', '{"approved": false, "version": "", "mode_notice": "", "answer_footer": "", "privacy_paragraph": ""}'::jsonb,
    '지방세봇 모드 고지 (COMPLY-01·02) - 문구와 승인은 법률 감수 뒤 PO 입력. approved=false이거나 문구가 비어 있으면 모드 버튼 0', 'migration:20261027000168'),
  ('ask_mode_targets', '{"guest": false, "member": false}'::jsonb,
    '4c 공개 단계에서 지방세봇 모드 버튼을 보일 계정 종류 (비회원·회원). 내부 계정은 4a부터 단계만으로 판정. 기본 모두 꺼짐', 'migration:20261027000168')
on conflict (key) do nothing;

create function public.public_ask_mode() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'taxbot', coalesce((select s.value ->> 'taxbot' = 'true' from public.settings s where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'), false),
    'stage', coalesce((select s.value ->> 'stage' from public.settings s where s.key = 'ask_rollout'), 'none'),
    'notice_approved', coalesce((select s.value ->> 'approved' = 'true' and btrim(coalesce(s.value ->> 'version', '')) <> '' and btrim(coalesce(s.value ->> 'mode_notice', '')) <> ''
                                   from public.settings s where s.key = 'ask_mode_notice' and jsonb_typeof(s.value) = 'object'), false),
    'notice_version', coalesce((select s.value ->> 'version' from public.settings s where s.key = 'ask_mode_notice'), ''),
    'mode_notice', coalesce((select s.value ->> 'mode_notice' from public.settings s where s.key = 'ask_mode_notice'), ''),
    'answer_footer', coalesce((select s.value ->> 'answer_footer' from public.settings s where s.key = 'ask_mode_notice'), ''),
    'targets', jsonb_build_object(
      'guest', coalesce((select s.value ->> 'guest' = 'true' from public.settings s where s.key = 'ask_mode_targets'), false),
      'member', coalesce((select s.value ->> 'member' = 'true' from public.settings s where s.key = 'ask_mode_targets'), false)));
$$;
revoke all on function public.public_ask_mode() from public, anon, authenticated;
grant execute on function public.public_ask_mode() to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 하루 한도 (ASK-10)
-- ─────────────────────────────────────────────────────────────
create table public.agent_quota_daily (
  day date not null,
  subject text not null check (char_length(subject) between 8 and 80),
  tier text not null check (tier in ('guest', 'member', 'premium')),
  used integer not null default 0 check (used >= 0),
  primary key (day, subject)
);
comment on table public.agent_quota_daily is '지방세봇 하루 한도 사용량 - subject는 서버가 만든 가린 값(비회원 IP 해시·회원 ID). 직접 읽기·쓰기 0';
alter table public.agent_quota_daily enable row level security;
revoke all on table public.agent_quota_daily from anon, authenticated, service_role;

create function public.agent_quota_limit(p_tier text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when jsonb_typeof(s.value -> (p_tier || '_daily')) = 'number' and (s.value ->> (p_tier || '_daily'))::numeric >= 1
              then (s.value ->> (p_tier || '_daily'))::numeric::integer end
    from public.settings s where s.key = 'ask_limits' and p_tier in ('guest', 'member', 'premium');
$$;
revoke all on function public.agent_quota_limit(text) from public, anon, authenticated;
grant execute on function public.agent_quota_limit(text) to service_role;

-- 읽기 (차감 없음) - 화면의 '오늘 남은 질문 수'
create function public.agent_quota_peek(p_subject text, p_tier text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := public.agent_quota_limit(p_tier);
  v_used integer;
begin
  select q.used into v_used from public.agent_quota_daily q where q.day = (now() at time zone 'Asia/Seoul')::date and q.subject = p_subject;
  return jsonb_build_object('used', coalesce(v_used, 0), 'limit', v_limit, 'remaining', case when v_limit is null then null else greatest(v_limit - coalesce(v_used, 0), 0) end);
end;
$$;
revoke all on function public.agent_quota_peek(text, text) from public, anon, authenticated;
grant execute on function public.agent_quota_peek(text, text) to service_role;

-- 차감 - 한도 미만일 때만 1 올린다 (같은 시각 두 요청이 겹쳐도 한도를 넘지 않는다). 한도 값이 설정에 없으면 닫힘(limit_missing)
create function public.agent_quota_consume(p_subject text, p_tier text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := public.agent_quota_limit(p_tier);
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_used integer;
begin
  if p_subject is null or char_length(p_subject) not between 8 and 80 or p_tier not in ('guest', 'member', 'premium') then
    raise exception using errcode = '22023', message = '한도 대상·등급이 올바르지 않습니다';
  end if;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'code', 'limit_missing', 'used', 0, 'limit', null);
  end if;
  insert into public.agent_quota_daily (day, subject, tier) values (v_day, p_subject, p_tier) on conflict (day, subject) do nothing;
  update public.agent_quota_daily q set used = q.used + 1 where q.day = v_day and q.subject = p_subject and q.used < v_limit returning q.used into v_used;
  if v_used is null then
    select q.used into v_used from public.agent_quota_daily q where q.day = v_day and q.subject = p_subject;
    return jsonb_build_object('allowed', false, 'code', 'limit', 'used', coalesce(v_used, 0), 'limit', v_limit);
  end if;
  return jsonb_build_object('allowed', true, 'code', 'ok', 'used', v_used, 'limit', v_limit);
end;
$$;
revoke all on function public.agent_quota_consume(text, text) from public, anon, authenticated;
grant execute on function public.agent_quota_consume(text, text) to service_role;

-- 반환 - 서버 장애로 답을 못 낸 요청은 차감을 되돌린다 (0 아래로 내려가지 않음)
create function public.agent_quota_refund(p_subject text) returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.agent_quota_daily q set used = greatest(q.used - 1, 0)
     where q.day = (now() at time zone 'Asia/Seoul')::date and q.subject = p_subject returning q.used)
  select coalesce((select used from u), 0);
$$;
revoke all on function public.agent_quota_refund(text) from public, anon, authenticated;
grant execute on function public.agent_quota_refund(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 피드백·오류 신고 (ASK-11)
-- ─────────────────────────────────────────────────────────────
create table public.agent_feedback (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.agent_sessions (id) on delete cascade,
  turn integer not null check (turn >= 1),
  kind text not null check (kind in ('helpful', 'not_helpful', 'error_report')),
  reason text check (reason is null or reason in ('wrong', 'weak_evidence', 'hard_to_understand', 'other')),
  status text not null default 'received' check (status in ('received', 'in_progress', 'resolved')),
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint agent_feedback_reason_kind check (kind <> 'helpful' or reason is null),
  unique (session_id, turn, kind)
);
comment on table public.agent_feedback is '지방세봇 피드백·오류 신고 (ASK-11) - 자유 글 칸 0. 처리 상태는 품질 콘솔(W12-e)이 service_role 함수로 바꾼다';
create index agent_feedback_status_idx on public.agent_feedback (status, created_at);
alter table public.agent_feedback enable row level security;
revoke all on table public.agent_feedback from anon, authenticated, service_role;
grant select on table public.agent_feedback to service_role;

create function public.agent_feedback_submit(p_session uuid, p_turn integer, p_kind text, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_found boolean;
  v_turns integer;
begin
  if p_kind not in ('helpful', 'not_helpful', 'error_report') or (p_reason is not null and p_reason not in ('wrong', 'weak_evidence', 'hard_to_understand', 'other'))
     or (p_kind = 'helpful' and p_reason is not null) or p_turn is null or p_turn < 1 then
    raise exception using errcode = '22023', message = '피드백 값이 올바르지 않습니다';
  end if;
  select true, s.user_id, s.turn_count into v_found, v_owner, v_turns from public.agent_sessions s where s.id = p_session;
  if not coalesce(v_found, false) or p_turn > v_turns or (v_owner is not null and v_owner is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role') then
    return false;
  end if;
  insert into public.agent_feedback (session_id, turn, kind, reason) values (p_session, p_turn, p_kind, p_reason)
    on conflict (session_id, turn, kind) do update set reason = excluded.reason;
  return true;
end;
$$;
revoke all on function public.agent_feedback_submit(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.agent_feedback_submit(uuid, integer, text, text) to anon, authenticated, service_role;

create function public.agent_feedback_set_status(p_id bigint, p_status text) returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (update public.agent_feedback f set status = p_status, status_at = now() where f.id = p_id and p_status in ('received', 'in_progress', 'resolved') returning 1)
  select exists (select 1 from u);
$$;
revoke all on function public.agent_feedback_set_status(bigint, text) from public, anon, authenticated;
grant execute on function public.agent_feedback_set_status(bigint, text) to service_role;
