-- W5 1단계 — 개발금융 기반 (PRD-01B DF-01 · DF-02 · DF-04 · DF-05, docs/dev/W5_설계.md 1장 1단계 · 2장 · 12장)
-- 이 파일에 실제 금융·법률·세무 내용(구조 설명·통계 값·규제 단계·투자 관련 문구)은 없다. 표 틀·검사·공개 뷰만 정한다. 씨앗 행 0.
-- · 기능 키 finance(꺼진 채) — 켜기는 설정 finance_legal_review(검토자·일자·결론 approved)가 있을 때만 (DF-05). 이 키 뒤에 W5 공개 뷰가 열린다.
-- · 설정 finance_legal_review({}) · finance_blocked_domains([]) · finance_rebuttal_wait_days(7) — 저장 검사 포함. 공개 읽기 정책에는 넣지 않는다.
-- · 금지 표현 사전 새 판 — 가입 권유·수익률 순위 계열 낱말을 없을 때만 뒤에 더한다.
-- · finance_structures(초안) + finance_structure_versions(승인본, 추가만) — 세무 감수위원 서명 + 법률 확인이 모두 있어야 승인본이 생긴다.
--     내용을 고치면 법률 확인을 지우고 공개는 마지막 승인본을 유지한다(재감수 필요).
-- · finance_indicators · finance_regulations — 추가만 시계열. 원자료(제공기관·원문 주소·원본 스냅샷)·기준일이 없으면 저장 거부.
-- · 공개 뷰 public_finance_structures · public_finance_indicators · public_finance_regulations — 키 finance가 켜졌을 때만 행이 보인다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 기능 키 · 설정 씨앗
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = s.value || jsonb_build_object('finance', false),
       updated_by = 'migration:20261024000060'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and not (s.value ? 'finance');

insert into public.settings (key, value, description, updated_by) values
  ('finance_legal_review',
   '{}'::jsonb,
   '개발금융 법률 검토 기록 (DF-05 · PRD_최종 §13 #21) — { "reviewer": 검토자 이름, "reviewed_on": YYYY-MM-DD, "conclusion": "approved" 또는 "rejected" }. 비어 있거나 approved가 아니면 기능 키 finance를 켤 수 없다',
   'migration:20261024000060'),
  ('finance_blocked_domains',
   '[]'::jsonb,
   '금융상품 판매·가입 페이지 차단 도메인 목록 (DF-05) — 예: "example.test". 이 도메인(하위 도메인 포함)을 가리키는 개발금융 원문 주소는 저장 거부',
   'migration:20261024000060'),
  ('finance_rebuttal_wait_days',
   '7'::jsonb,
   '금융 사례 반론 무응답 인정 기간(일) (DF-03) — 요청일부터 이 기간이 지나야 답변 상태 ''무응답''을 고를 수 있다. 1~365. 초기값은 편집국 초안이며 법률 검토로 정한다',
   'migration:20261024000060')
on conflict (key) do nothing;

-- 금지 표현 사전 새 판 — 가입 권유·수익률 순위 계열 (이미 있는 낱말은 그대로)
update public.settings s
   set value = (s.value - 'version' - 'phrases')
            || jsonb_build_object(
                 'version', '2026-10-24.1',
                 'phrases', (s.value -> 'phrases') || coalesce((
                    select jsonb_agg(x.p order by x.n)
                      from unnest(array['지금 가입', '가입하세요', '매수하세요', '투자하세요', '수익률 순위', '수익률 1위', '고수익 보장']) with ordinality as x(p, n)
                     where not ((s.value -> 'phrases') ? x.p)), '[]'::jsonb)),
       updated_by = 'migration:20261024000060'
 where s.key = 'forbidden_phrases' and jsonb_typeof(s.value -> 'phrases') = 'array';

-- 설정 저장 검사
create function public.finance_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
begin
  if new.key = 'finance_legal_review' then
    if jsonb_typeof(new.value) is distinct from 'object' then
      raise exception '개발금융 법률 검토 기록(finance_legal_review)은 { reviewer, reviewed_on, conclusion } 객체(또는 빈 객체)입니다' using errcode = 'check_violation';
    end if;
    if new.value <> '{}'::jsonb then
      if (select array_agg(k order by k) from jsonb_object_keys(new.value) k) is distinct from array['conclusion', 'reviewed_on', 'reviewer'] then
        raise exception '개발금융 법률 검토 기록은 reviewer·reviewed_on·conclusion 세 칸입니다' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(new.value -> 'reviewer') is distinct from 'string' or char_length(btrim(new.value ->> 'reviewer')) not between 1 and 60 then
        raise exception '법률 검토자 이름(reviewer)은 1~60자 글자입니다' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(new.value -> 'reviewed_on') is distinct from 'string' or (new.value ->> 'reviewed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception '법률 검토일(reviewed_on)은 YYYY-MM-DD입니다' using errcode = 'check_violation';
      end if;
      begin
        perform (new.value ->> 'reviewed_on')::date;
      exception when others then
        raise exception '법률 검토일(reviewed_on)이 날짜가 아닙니다' using errcode = 'check_violation';
      end;
      if (new.value ->> 'conclusion') is null or (new.value ->> 'conclusion') not in ('approved', 'rejected') then
        raise exception '법률 검토 결론(conclusion)은 approved 또는 rejected입니다' using errcode = 'check_violation';
      end if;
    end if;
  elsif new.key = 'finance_blocked_domains' then
    if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value) > 100 then
      raise exception '금융상품 차단 도메인(finance_blocked_domains)은 100개까지의 목록입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) x loop
      if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then
        raise exception '차단 도메인은 소문자 도메인 이름입니다 (지금 %)', v_item using errcode = 'check_violation';
      end if;
      if (v_item #>> '{}') = any (v_seen) then
        raise exception '같은 차단 도메인이 두 번 있습니다 (%)', v_item using errcode = 'check_violation';
      end if;
      v_seen := v_seen || (v_item #>> '{}');
    end loop;
  elsif new.key = 'finance_rebuttal_wait_days' then
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,3}$' or (new.value #>> '{}')::int not between 1 and 365 then
      raise exception '반론 무응답 인정 기간(finance_rebuttal_wait_days)은 1~365 사이 정수(일)입니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finance_settings_guard() from public, anon, authenticated;
create trigger settings_finance_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('finance_legal_review', 'finance_blocked_domains', 'finance_rebuttal_wait_days'))
  execute function public.finance_settings_guard();

-- 기능 키 켜기 검사 — 법률 검토 기록(approved) 없이는 켜지 못한다. 끄기·이미 켜진 값은 검사하지 않는다
create function public.finance_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'finance') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'finance') is distinct from 'true'::jsonb) then
    select s.value into v_review from public.settings s where s.key = 'finance_legal_review';
    if jsonb_typeof(v_review) is distinct from 'object'
       or (v_review ->> 'conclusion') is distinct from 'approved'
       or coalesce(btrim(v_review ->> 'reviewer'), '') = ''
       or (v_review ->> 'reviewed_on') is null then
      raise exception '개발금융(finance)은 법률 검토 기록(검토자·일자·결론 approved)이 있어야 켭니다 (DF-05 · PRD_최종 §13 #21)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finance_flag_guard() from public, anon, authenticated;
create trigger settings_finance_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.finance_flag_guard();

-- ─────────────────────────────────────────────────────────────
-- 검사 도우미 — 원문 주소(차단 도메인 · 추적 쿼리) · 글 검사(금지 표현 · 자리 채움 · 세액)
-- ─────────────────────────────────────────────────────────────
-- 문제 문장(없으면 null). 차단 도메인(하위 도메인 포함)과 제휴·추천 추적 쿼리를 거부한다 (DF-05)
create function public.finance_url_problem(p_url text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_domain text;
begin
  if p_url is null or p_url !~* '^https?://[^[:space:]]+$' or char_length(p_url) > 500 then
    return '원문 주소는 http(s)로 시작하는 500자 이하 주소입니다';
  end if;
  v_host := lower(substring(p_url from '^[hH][tT][tT][pP][sS]?://([^/:?#]+)'));
  for v_domain in
    select lower(d) from jsonb_array_elements_text(coalesce((select s.value from public.settings s where s.key = 'finance_blocked_domains' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)) d
  loop
    if v_host = v_domain or v_host like '%.' || v_domain then
      return format('금융상품 판매·가입 페이지로 막아 둔 도메인(%s)입니다 — 저장하지 않습니다 (DF-05)', v_domain);
    end if;
  end loop;
  if lower(p_url) ~ '[?&](utm_[a-z]+|ref|referrer|aff|affiliate|partner|promo|coupon|campaign|fbclid|gclid)=' then
    return '제휴·추천 추적 쿼리가 든 주소는 저장하지 않습니다 (DF-05)';
  end if;
  return null;
end;
$$;
revoke all on function public.finance_url_problem(text) from public, anon, authenticated;
grant execute on function public.finance_url_problem(text) to service_role;

-- 글 칸 검사 — 금지 표현(사전) · 자리 채움 글 · 세액 표현. 문제 문장 또는 null
create function public.finance_text_problem(p_texts text[]) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hit text;
  v_text text;
begin
  v_hit := public.dev_method_forbidden_hit(p_texts);
  if v_hit is not null then
    return format('금지 표현 ''%s'' — 투자 권유·추천·수익 암시 표현은 쓰지 않습니다 (DF-05)', v_hit);
  end if;
  foreach v_text in array coalesce(p_texts, '{}') loop
    if v_text is not null and public.dev_method_placeholder(v_text) then
      return '''확인 중''·''준비 중'' 같은 자리 채움 글은 저장하지 않습니다 — 모르는 칸은 비워 둡니다';
    end if;
    if v_text is not null and public.lens_text_has_tax_amount(normalize(v_text, NFC)) then
      return '세액을 쓰지 않습니다 — 숫자 + 원 표현을 빼 주세요 (CORE-01)';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.finance_text_problem(text[]) from public, anon, authenticated;
grant execute on function public.finance_text_problem(text[]) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 구조 해설 초안 (DF-01 · DF-02)
-- ─────────────────────────────────────────────────────────────
create table public.finance_structures (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  structure_type text not null check (structure_type in ('trust', 'completion_guarantee', 'pf_stage', 'reit')),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  summary text check (summary is null or char_length(btrim(summary)) between 1 and 300),
  diagram jsonb,
  notes jsonb not null default '[]'::jsonb,
  lens jsonb,
  lens_omit_reason text check (lens_omit_reason is null or char_length(btrim(lens_omit_reason)) between 1 and 120),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  updated_at timestamptz not null default now(),
  legal_checked_by text check (legal_checked_by is null or char_length(btrim(legal_checked_by)) between 1 and 60),
  legal_checked_at date,
  created_at timestamptz not null default now(),
  constraint finance_structures_legal_pair check ((legal_checked_by is null) = (legal_checked_at is null))
);

comment on table public.finance_structures is '개발금융 구조 해설 초안 (DF-01) — 구조도는 노드·관계 데이터(그림 파일 아님), 표는 관계 목록에서 만든다. 공개는 승인본(finance_structure_versions)만';
comment on column public.finance_structures.diagram is '{ alt: 대체 텍스트, nodes: [{ key, label }] 2~12개, edges: [{ from, to, label }] 1~20개 } — 관계 1개 이상이 있어야 같은 내용의 표가 생긴다';
comment on column public.finance_structures.notes is '구조 설명 문단 목록 (0~10개, 문단마다 1~400자)';
comment on column public.finance_structures.lens is '「지방세로 읽기」 박스 — 개발방법 박스와 같은 모양(dev_method_lens_problem). 없으면 lens_omit_reason(생략 사유)이 있어야 승인';
comment on column public.finance_structures.legal_checked_by is '법률 확인자 이름 (DF-02) — 저장된 내용에만, 내용을 고치면 지워진다';

create function public.finance_structure_problem(s public.finance_structures) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_texts text[] := array[s.title, s.summary, s.lens_omit_reason];
  v_item jsonb;
  v_keys text[] := '{}';
  v_problem text;
begin
  if s.diagram is not null then
    if jsonb_typeof(s.diagram) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(s.diagram) k) is distinct from array['alt', 'edges', 'nodes'] then
      return '구조도는 { alt, nodes, edges } 세 칸입니다';
    end if;
    if jsonb_typeof(s.diagram -> 'alt') is distinct from 'string' or char_length(btrim(s.diagram ->> 'alt')) not between 1 and 200 then
      return '구조도 대체 텍스트(alt)는 1~200자입니다 (PRD-00 8.9)';
    end if;
    v_texts := v_texts || (s.diagram ->> 'alt');
    if jsonb_typeof(s.diagram -> 'nodes') is distinct from 'array' or jsonb_array_length(s.diagram -> 'nodes') not between 2 and 12 then
      return '구조도 노드는 2~12개 목록입니다';
    end if;
    for v_item in select x.value from jsonb_array_elements(s.diagram -> 'nodes') x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_item) k) is distinct from array['key', 'label']
         or jsonb_typeof(v_item -> 'key') is distinct from 'string' or (v_item ->> 'key') !~ '^[a-z][a-z0-9_]{0,19}$'
         or jsonb_typeof(v_item -> 'label') is distinct from 'string' or char_length(btrim(v_item ->> 'label')) not between 1 and 30 then
        return '구조도 노드는 { key: 영문 소문자·숫자·밑줄 20자 이하, label: 1~30자 } 입니다';
      end if;
      if (v_item ->> 'key') = any (v_keys) then
        return '구조도 노드 key가 두 번 있습니다';
      end if;
      v_keys := v_keys || (v_item ->> 'key');
      v_texts := v_texts || (v_item ->> 'label');
    end loop;
    if jsonb_typeof(s.diagram -> 'edges') is distinct from 'array' or jsonb_array_length(s.diagram -> 'edges') not between 1 and 20 then
      return '구조도 관계(edges)는 1~20개 목록입니다 — 관계가 없으면 같은 내용의 표를 만들 수 없습니다 (DF-01)';
    end if;
    for v_item in select x.value from jsonb_array_elements(s.diagram -> 'edges') x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_item) k) is distinct from array['from', 'label', 'to']
         or jsonb_typeof(v_item -> 'from') is distinct from 'string' or not ((v_item ->> 'from') = any (v_keys))
         or jsonb_typeof(v_item -> 'to') is distinct from 'string' or not ((v_item ->> 'to') = any (v_keys))
         or (v_item ->> 'from') = (v_item ->> 'to')
         or jsonb_typeof(v_item -> 'label') is distinct from 'string' or char_length(v_item ->> 'label') > 30 then
        return '구조도 관계는 { from, to: 노드 key(서로 다름), label: 30자 이하 } 입니다';
      end if;
      v_texts := v_texts || (v_item ->> 'label');
    end loop;
  end if;
  if jsonb_typeof(s.notes) is distinct from 'array' or jsonb_array_length(s.notes) > 10 then
    return '구조 설명 문단은 10개까지의 목록입니다';
  end if;
  for v_item in select x.value from jsonb_array_elements(s.notes) x loop
    if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 400 then
      return '구조 설명 문단은 1~400자 글자입니다 (빈 문단 0)';
    end if;
    v_texts := v_texts || (v_item #>> '{}');
  end loop;
  if s.lens is not null then
    v_problem := public.dev_method_lens_problem(s.lens);
    if v_problem is not null then
      return v_problem;
    end if;
    v_texts := v_texts || public.dev_method_lens_texts(s.lens);
  end if;
  if s.lens is not null and s.lens_omit_reason is not null then
    return '「지방세로 읽기」 박스와 생략 사유는 둘 중 하나만 적습니다';
  end if;
  return public.finance_text_problem(array_remove(v_texts, null));
end;
$$;
revoke all on function public.finance_structure_problem(public.finance_structures) from public, anon, authenticated;
grant execute on function public.finance_structure_problem(public.finance_structures) to service_role;

-- 초안 저장 검사 — 내용 모양 · 법률 확인은 저장된 내용에만, 내용을 고치면 지움
create function public.finance_structures_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
  v_content_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception '구조 해설 초안은 지우지 않습니다 — 승인본이 있으면 추가만 남깁니다 (DF-02)' using errcode = 'check_violation';
  end if;
  v_problem := public.finance_structure_problem(new);
  if v_problem is not null then
    raise exception '구조 해설(%) — %', new.slug, v_problem using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.legal_checked_by is not null then
      raise exception '구조 해설(%) — 법률 확인은 저장된 내용에만 합니다 (새 초안에는 없음)', new.slug using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.slug is distinct from old.slug then
    raise exception '구조 해설의 주소 이름(slug)은 바꿀 수 없습니다 (%)', old.slug using errcode = 'check_violation';
  end if;
  v_content_changed := new.structure_type is distinct from old.structure_type or new.title is distinct from old.title
    or new.summary is distinct from old.summary or new.diagram is distinct from old.diagram or new.notes is distinct from old.notes
    or new.lens is distinct from old.lens or new.lens_omit_reason is distinct from old.lens_omit_reason;
  if v_content_changed then
    if new.legal_checked_by is distinct from old.legal_checked_by or new.legal_checked_at is distinct from old.legal_checked_at then
      raise exception '구조 해설(%) — 법률 확인은 저장된 내용에만 합니다. 내용을 고치는 쓰기에 법률 확인을 넣지 않습니다', new.slug using errcode = 'check_violation';
    end if;
    new.legal_checked_by := null;
    new.legal_checked_at := null;
  elsif new.legal_checked_by is distinct from old.legal_checked_by or new.legal_checked_at is distinct from old.legal_checked_at then
    if new.legal_checked_by is not null then
      if new.summary is null or new.diagram is null then
        raise exception '구조 해설(%) — 한 줄 설명과 구조도를 저장한 뒤에 법률 확인을 합니다', new.slug using errcode = 'check_violation';
      end if;
      if new.legal_checked_at > (now() at time zone 'Asia/Seoul')::date then
        raise exception '구조 해설(%) — 법률 확인일이 오늘보다 뒤입니다', new.slug using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finance_structures_guard() from public, anon, authenticated;
create trigger finance_structures_guard
  before insert or update or delete on public.finance_structures
  for each row execute function public.finance_structures_guard();
create trigger finance_structures_no_truncate
  before truncate on public.finance_structures
  for each statement execute function public.append_only_guard();

create function public.finance_structure_snapshot(s public.finance_structures) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('structure_type', s.structure_type, 'title', s.title, 'summary', s.summary, 'diagram', s.diagram,
                            'notes', s.notes, 'lens', s.lens, 'lens_omit_reason', s.lens_omit_reason);
$$;
revoke all on function public.finance_structure_snapshot(public.finance_structures) from public, anon, authenticated;
grant execute on function public.finance_structure_snapshot(public.finance_structures) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 승인본 — 추가만. 세무 감수위원 서명 + 법률 확인이 있고 현재 초안 그대로일 때만 생긴다 (DF-02)
-- ─────────────────────────────────────────────────────────────
create table public.finance_structure_versions (
  id bigint generated always as identity primary key,
  structure_id bigint not null references public.finance_structures (id),
  version integer not null check (version >= 1),
  content jsonb not null,
  tax_signed_by text not null check (length(btrim(tax_signed_by)) > 0),
  tax_signed_at timestamptz not null default now(),
  legal_checked_by text not null check (char_length(btrim(legal_checked_by)) between 1 and 60),
  legal_checked_at date not null,
  unique (structure_id, version)
);

comment on table public.finance_structure_versions is '개발금융 구조 해설 승인본 (DF-02) — 추가만. 공개는 구조 해설마다 가장 큰 version. 서명자 계정은 공개 뷰에 없다';

create function public.finance_structure_versions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.finance_structures;
begin
  select * into s from public.finance_structures where id = new.structure_id for update;
  if s.id is null then
    raise exception '그런 구조 해설이 없습니다' using errcode = 'check_violation';
  end if;
  if not public.dev_method_is_reviewer(new.tax_signed_by) then
    raise exception '구조 해설(%)의 세무 감수 서명은 세무 감수위원(reviewer)만 합니다 (DF-02)', s.slug using errcode = 'check_violation';
  end if;
  if s.summary is null or s.diagram is null then
    raise exception '구조 해설(%) — 한 줄 설명과 구조도를 저장한 뒤에 서명합니다', s.slug using errcode = 'check_violation';
  end if;
  if s.legal_checked_by is null then
    raise exception '구조 해설(%) — 법률 확인 기록이 없습니다. 세무 서명과 법률 확인이 둘 다 있어야 공개됩니다 (DF-02)', s.slug using errcode = 'check_violation';
  end if;
  if s.lens is null and s.lens_omit_reason is null then
    raise exception '구조 해설(%) — 「지방세로 읽기」 박스 또는 생략 사유가 있어야 합니다 (DF-02)', s.slug using errcode = 'check_violation';
  end if;
  new.version := coalesce((select max(v.version) from public.finance_structure_versions v where v.structure_id = new.structure_id), 0) + 1;
  new.content := public.finance_structure_snapshot(s);
  new.legal_checked_by := s.legal_checked_by;
  new.legal_checked_at := s.legal_checked_at;
  new.tax_signed_at := now();
  return new;
end;
$$;
revoke all on function public.finance_structure_versions_guard() from public, anon, authenticated;
create trigger finance_structure_versions_guard
  before insert on public.finance_structure_versions
  for each row execute function public.finance_structure_versions_guard();
create trigger finance_structure_versions_no_change
  before update or delete on public.finance_structure_versions
  for each row execute function public.append_only_guard();
create trigger finance_structure_versions_no_truncate
  before truncate on public.finance_structure_versions
  for each statement execute function public.append_only_guard();

-- 관리 보드용 상태 (service_role만) — draft(승인본 없음) · approved(초안 = 마지막 승인본) · rereview_needed(승인 뒤 고침)
create view public.finance_structure_board as
select s.id, s.slug, s.structure_type, s.title, s.summary, s.diagram, s.notes, s.lens, s.lens_omit_reason, s.drafted_by, s.updated_at,
       s.legal_checked_by, s.legal_checked_at,
       v.version as approved_version, v.tax_signed_at as approved_at,
       case when v.id is null then 'draft'
            when v.content = public.finance_structure_snapshot(s) then 'approved'
            else 'rereview_needed' end as review_status
  from public.finance_structures s
  left join lateral (select x.* from public.finance_structure_versions x where x.structure_id = s.id order by x.version desc limit 1) v on true;

-- ─────────────────────────────────────────────────────────────
-- 통계 지표 (DF-04) — 추가만 시계열
-- ─────────────────────────────────────────────────────────────
create table public.finance_indicators (
  id bigint generated always as identity primary key,
  indicator_key text not null check (indicator_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  definition text not null check (char_length(btrim(definition)) between 1 and 200),
  value numeric not null,
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  as_of date not null,
  collected_on date not null,
  provider text not null check (char_length(btrim(provider)) between 1 and 60),
  source_url text not null,
  snapshot_id bigint not null references public.raw_snapshots (id),
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now()
);

comment on table public.finance_indicators is '개발금융 통계 지표 (DF-04) — 추가만 시계열. 같은 지표의 새 값은 새 행(덮어쓰기·지우기 0). 제공기관·원문 주소·원본 스냅샷·기준일·수집일이 모두 있어야 저장';
create index finance_indicators_key_idx on public.finance_indicators (indicator_key, as_of desc, id desc);

create function public.finance_indicators_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  v_problem := public.finance_url_problem(new.source_url);
  if v_problem is null then
    v_problem := public.finance_text_problem(array[new.label, new.definition, new.provider]);
  end if;
  if v_problem is not null then
    raise exception '통계 지표(%) — %', new.indicator_key, v_problem using errcode = 'check_violation';
  end if;
  if new.as_of > (now() at time zone 'Asia/Seoul')::date or new.collected_on > (now() at time zone 'Asia/Seoul')::date then
    raise exception '통계 지표(%) — 기준일·수집일이 오늘보다 뒤입니다', new.indicator_key using errcode = 'check_violation';
  end if;
  new.recorded_at := now();
  return new;
end;
$$;
revoke all on function public.finance_indicators_guard() from public, anon, authenticated;
create trigger finance_indicators_guard
  before insert on public.finance_indicators
  for each row execute function public.finance_indicators_guard();
create trigger finance_indicators_no_change
  before update or delete on public.finance_indicators
  for each row execute function public.append_only_guard();
create trigger finance_indicators_no_truncate
  before truncate on public.finance_indicators
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 규제 항목 (DF-04) — 추가만. 같은 항목의 새 단계는 새 행
-- ─────────────────────────────────────────────────────────────
create table public.finance_regulations (
  id bigint generated always as identity primary key,
  reg_key text not null check (reg_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  stage text not null check (char_length(btrim(stage)) between 1 and 40),
  effective_on date not null,
  provider text not null check (char_length(btrim(provider)) between 1 and 60),
  source_url text not null,
  snapshot_id bigint not null references public.raw_snapshots (id),
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now()
);

comment on table public.finance_regulations is '개발금융 규제 항목 (DF-04) — 추가만. 단계·시행 예정일·원문(제공기관·주소·원본 스냅샷)이 모두 있어야 저장. 시행 여부는 공개 뷰가 한국 시간 날짜로 계산한다';
create index finance_regulations_key_idx on public.finance_regulations (reg_key, id desc);

create function public.finance_regulations_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  v_problem := public.finance_url_problem(new.source_url);
  if v_problem is null then
    v_problem := public.finance_text_problem(array[new.title, new.stage, new.provider]);
  end if;
  if v_problem is not null then
    raise exception '규제 항목(%) — %', new.reg_key, v_problem using errcode = 'check_violation';
  end if;
  new.recorded_at := now();
  return new;
end;
$$;
revoke all on function public.finance_regulations_guard() from public, anon, authenticated;
create trigger finance_regulations_guard
  before insert on public.finance_regulations
  for each row execute function public.finance_regulations_guard();
create trigger finance_regulations_no_change
  before update or delete on public.finance_regulations
  for each row execute function public.append_only_guard();
create trigger finance_regulations_no_truncate
  before truncate on public.finance_regulations
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한 · RLS — 표는 service_role만(추가만 표는 읽기·추가만), 공개 읽기는 뷰만
-- ─────────────────────────────────────────────────────────────
alter table public.finance_structures enable row level security;
alter table public.finance_structure_versions enable row level security;
alter table public.finance_indicators enable row level security;
alter table public.finance_regulations enable row level security;
revoke all on table public.finance_structures, public.finance_structure_versions, public.finance_indicators, public.finance_regulations from anon, authenticated, service_role;
grant select, insert, update, delete on table public.finance_structures to service_role;
grant select, insert on table public.finance_structure_versions to service_role;
grant select, insert on table public.finance_indicators to service_role;
grant select, insert on table public.finance_regulations to service_role;
revoke all on table public.finance_structure_board from public, anon, authenticated, service_role;
grant select on table public.finance_structure_board to service_role;

-- 공개 뷰 — 기능 키 finance가 켜졌을 때만. 서명자 계정·메모·스냅샷 번호 칸 0
create view public.public_finance_structures as
select s.slug,
       v.content ->> 'structure_type' as structure_type,
       v.content ->> 'title' as title,
       v.content ->> 'summary' as summary,
       v.content -> 'diagram' as diagram,
       v.content -> 'notes' as notes,
       v.content -> 'lens' as lens,
       v.content ->> 'lens_omit_reason' as lens_omit_reason,
       v.version,
       v.tax_signed_at,
       v.legal_checked_at
  from public.finance_structures s
  join lateral (select x.* from public.finance_structure_versions x where x.structure_id = s.id order by x.version desc limit 1) v on true
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'finance') = 'true'::jsonb);

create view public.public_finance_indicators as
select i.id, i.indicator_key, i.label, i.definition, i.value, i.unit, i.as_of, i.collected_on, i.provider, i.source_url,
       (i.id = max(i.id) over (partition by i.indicator_key)) as is_latest
  from public.finance_indicators i
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'finance') = 'true'::jsonb);

create view public.public_finance_regulations as
select r.id, r.reg_key, r.title, r.stage, r.effective_on, r.provider, r.source_url,
       (r.id = max(r.id) over (partition by r.reg_key)) as is_latest,
       (r.effective_on <= (now() at time zone 'Asia/Seoul')::date) as in_force
  from public.finance_regulations r
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'finance') = 'true'::jsonb);

revoke all on table public.public_finance_structures, public.public_finance_indicators, public.public_finance_regulations from public, anon, authenticated, service_role;
grant select on table public.public_finance_structures, public.public_finance_indicators, public.public_finance_regulations to anon, authenticated, service_role;
