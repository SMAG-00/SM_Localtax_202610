-- W13-g g5 — 활동 전문가 집계와 라운지 공개 뷰 (PRD-05 QNA-02 · 04 · 08, docs/dev/W13-g_설계.md 3장)
-- · expert_activity_at(p_at) - SM 소속 전문가(지금 유효한 연결 ∧ 공개 프로필)별 최근 N일(기본 90일, 설정 qna_criteria.window_days) 답변 수·채택 수·채택률·제재 여부.
--   창 시작은 포함(p_at - N일 이상), 끝은 p_at 이하. 채택은 채택 시각(accepted_at) 기준이라 91일 전 채택은 빠진다.
--   분모(답변 수)는 창 안에 쓴 답변 ∪ 창 안에 채택된 답변이라 채택률은 늘 0~1.
--   입력은 라운지 표·연결 표·제재 표뿐이다 - 결제·구독·주문·광고 표를 읽지 않는다 (QNA-08, 스키마 시험이 함수 정의를 검사).
-- · 제재 여부 = 지금 제재 중이거나 창 안에 시작된 제재 이력이 있음.
-- · expert_activity 뷰(내부, service_role) / public_expert_activity(공개 - 라운지 열림 ∧ 제재 없음).
--   순위와 띠 선정(최소 채택 수·최소 채택률·인원)은 서버가 설정 qna_criteria와 결정론 정렬(lib/qna/strip.ts)로 한다.
-- · 공개 뷰 public_qna_questions / public_qna_answers - 배지는 읽는 순간 다시 판정한다 (만료·해제 뒤 배지 0, 별점·후기 0, 작성자 번호 0).

create function public.expert_activity_at(p_at timestamptz default now())
returns table (expert_profile_id bigint, slug text, name text, answered_count integer, accepted_count integer, acceptance_rate numeric, sanctioned boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select make_interval(days => coalesce((select (s.value ->> 'window_days')::integer from public.settings s where s.key = 'qna_criteria'), 90)) as win
  ), links as (
    select v.user_id, v.expert_profile_id, p.slug, p.name
      from public.expert_verifications v
      join public.expert_profiles p on p.id = v.expert_profile_id
     where v.status = 'active' and v.expires_at > p_at
       and p.status = 'published' and p.withdrawn_at is null and p.house_relation in ('employed', 'sm_corporation')
  ), stats as (
    select l.expert_profile_id,
           count(a.id)::integer as answered,
           (count(a.id) filter (where a.accepted_at between p_at - (select win from cfg) and p_at))::integer as accepted
      from links l
      left join public.qna_answers a
        on a.author_id = l.user_id and a.author_kind = 'expert' and a.expert_profile_id = l.expert_profile_id and a.status = 'published'
       and (a.created_at between p_at - (select win from cfg) and p_at
            or a.accepted_at between p_at - (select win from cfg) and p_at)
     group by l.expert_profile_id
  )
  select l.expert_profile_id, l.slug, l.name, st.answered, st.accepted,
         case when st.answered = 0 then 0::numeric else round(st.accepted::numeric / st.answered, 4) end,
         exists (select 1 from public.qna_sanctions z
                  where z.user_id = l.user_id and z.started_at <= p_at
                    and ((z.lifted_at is null or z.lifted_at > p_at) and (z.ends_at is null or z.ends_at > p_at)
                         or z.started_at >= p_at - (select win from cfg)))
    from links l
    join stats st on st.expert_profile_id = l.expert_profile_id
$$;
revoke all on function public.expert_activity_at(timestamptz) from public, anon, authenticated;
grant execute on function public.expert_activity_at(timestamptz) to service_role;

-- 공개 뷰가 부르는 것이므로 함수 호출 없이 식을 직접 둔다(뷰 안의 함수 실행 권한은 부르는 사람 기준이라 anon에게 함수를 열지 않기 위함)
create view public.expert_activity as
  with cfg as (
    select make_interval(days => coalesce((select (s.value ->> 'window_days')::integer from public.settings s where s.key = 'qna_criteria'), 90)) as win
  ), links as (
    select v.user_id, v.expert_profile_id, p.slug, p.name
      from public.expert_verifications v
      join public.expert_profiles p on p.id = v.expert_profile_id
     where v.status = 'active' and v.expires_at > now()
       and p.status = 'published' and p.withdrawn_at is null and p.house_relation in ('employed', 'sm_corporation')
  ), stats as (
    select l.expert_profile_id,
           count(a.id)::integer as answered,
           (count(a.id) filter (where a.accepted_at between now() - (select win from cfg) and now()))::integer as accepted
      from links l
      left join public.qna_answers a
        on a.author_id = l.user_id and a.author_kind = 'expert' and a.expert_profile_id = l.expert_profile_id and a.status = 'published'
       and (a.created_at between now() - (select win from cfg) and now()
            or a.accepted_at between now() - (select win from cfg) and now())
     group by l.expert_profile_id
  )
  select l.expert_profile_id, l.slug, l.name, st.answered as answered_count, st.accepted as accepted_count,
         case when st.answered = 0 then 0::numeric else round(st.accepted::numeric / st.answered, 4) end as acceptance_rate,
         exists (select 1 from public.qna_sanctions z
                  where z.user_id = l.user_id and z.started_at <= now()
                    and ((z.lifted_at is null or z.lifted_at > now()) and (z.ends_at is null or z.ends_at > now())
                         or z.started_at >= now() - (select win from cfg))) as sanctioned
    from links l
    join stats st on st.expert_profile_id = l.expert_profile_id;
revoke all on table public.expert_activity from public, anon, authenticated;
grant select on table public.expert_activity to service_role;

-- 공개 띠 후보 - 라운지가 열려 있고 제재 없는 전문가만. 프로필 주소는 W7c 공개 뷰가 열려 있을 때만 채운다
create view public.public_expert_activity as
select a.expert_profile_id, a.name, a.answered_count, a.accepted_count, a.acceptance_rate,
       (select pp.slug from public.public_expert_profiles pp where pp.id = a.expert_profile_id) as profile_slug
  from public.expert_activity a
 where not a.sanctioned and (exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
        and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb));
revoke all on table public.public_expert_activity from public, anon, authenticated;
grant select on table public.public_expert_activity to anon, authenticated, service_role;

-- 공개 질문 - 작성자 번호 없음
create view public.public_qna_questions as
select q.id, q.tax_type, q.title, q.body, q.created_at,
       (q.accepted_answer_id is not null) as resolved,
       (select count(*)::integer from public.qna_answers a where a.question_id = q.id and a.status = 'published') as answer_count
  from public.qna_questions q
 where q.status = 'open' and (exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
        and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb));
revoke all on table public.public_qna_questions from public, anon, authenticated;
grant select on table public.public_qna_questions to anon, authenticated, service_role;

-- 공개 답변 - display_kind는 읽는 순간 판정: expert(유효한 SM 전문가 연결) | gov(인증 공무원) | member
create view public.public_qna_answers as
select x.id, x.question_id, x.body, x.created_at, (x.accepted_at is not null) as accepted, x.display_kind,
       case when x.display_kind = 'expert' then p.name end as expert_name,
       case when x.display_kind = 'expert' then x.expert_profile_id end as expert_profile_id,
       case when x.display_kind = 'expert' then (select pp.slug from public.public_expert_profiles pp where pp.id = p.id) end as profile_slug
  from (
    select a.*,
           case
             -- 뷰 안의 함수 실행 권한은 읽는 사람(anon) 기준이라 expert_badge_valid·qna_gov_verified를 부르지 않고 같은 판정을 직접 둔다
             -- (expert: 지금 유효한 SM 전문가 연결 ∧ 공개 프로필 / gov: 확인된 메일 ∧ 허용 도메인에 정확히 일치하거나 그 하위 도메인)
             when a.author_kind = 'expert' and a.expert_profile_id is not null and exists (
                    select 1 from public.expert_verifications v
                      join public.expert_profiles ep on ep.id = v.expert_profile_id
                     where v.user_id = a.author_id and v.expert_profile_id = a.expert_profile_id and v.status = 'active' and v.expires_at > now()
                       and ep.status = 'published' and ep.withdrawn_at is null and ep.house_relation in ('employed', 'sm_corporation')) then 'expert'
             when a.author_kind = 'gov' and exists (
                    select 1 from auth.users u, public.settings gs, jsonb_array_elements_text(case when jsonb_typeof(gs.value -> 'domains') = 'array' then gs.value -> 'domains' else '[]'::jsonb end) as d(domain)
                     where u.id = a.author_id and u.email_confirmed_at is not null and gs.key = 'qna_gov_domains'
                       and lower(u.email) ~ ('@([a-z0-9-]+\.)*' || replace(lower(d.domain), '.', '\.') || '$')) then 'gov'
             else 'member'
           end as display_kind
      from public.qna_answers a
      join public.public_qna_questions q on q.id = a.question_id
     where a.status = 'published'
  ) x
  left join public.expert_profiles p on p.id = x.expert_profile_id and x.display_kind = 'expert';
revoke all on table public.public_qna_answers from public, anon, authenticated;
grant select on table public.public_qna_answers to anon, authenticated, service_role;
