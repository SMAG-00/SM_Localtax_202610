-- W2-e 5단계 DB — 문의함 칸 더하기(연락처·접수 번호·접수 메일 상태…) · 고객센터 설정 씨앗 help · 비공개 첨부 저장소 (docs/dev/W2-e_설계.md 3.5 · 2.2 · 7장)
-- · inquiries의 기존 칸·제약·값은 바꾸지 않는다. 새 제약은 NOT VALID — 새 행과 고친 행만 검사한다(이미 있는 행은 건드리지 않는다)
-- · contact_email은 평문이 허용된 칸 둘 중 하나(다른 하나는 brief 사전 알림 신청). 본문 body는 이메일·전화·주민등록번호 모양이 있으면 거부한다(W2-d query_terms와 같은 모양)
-- · 첨부는 비공개 버킷 inquiry-attachments — 공개 주소 0, anon·authenticated 정책 0(service_role만). 직원은 5분짜리 서명 주소로만 내려받는다

-- 접수 번호 — 혼동 글자(0 O 1 I)를 뺀 영숫자 8글자. 중복이면 unique가 막고 서버가 다시 시도한다
create function public.inquiry_new_ref() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_out text := '';
  i int;
begin
  for i in 1..8 loop
    v_out := v_out || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.inquiry_new_ref() from public, anon, authenticated;
grant execute on function public.inquiry_new_ref() to service_role;

alter table public.inquiries
  add column ref_code text not null default public.inquiry_new_ref(),
  add column title text,
  add column contact_name text,
  add column organization text,
  add column contact_email text,
  add column request_type text,
  add column submitted_by uuid references auth.users (id) on delete set null,
  add column privacy_version_id bigint references public.policy_versions (id) on delete set null,
  add column mail_status text not null default 'none',
  add column contact_cleared_at timestamptz,
  add column attachments_cleared_at timestamptz;

create unique index inquiries_ref_code_key on public.inquiries (ref_code);
create index inquiries_assignee_idx on public.inquiries (assignee) where assignee is not null;

alter table public.inquiries
  add constraint inquiries_ref_code_shape check (ref_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  add constraint inquiries_title_chars check (title is null or char_length(btrim(title)) between 1 and 100),
  add constraint inquiries_contact_name_chars check (contact_name is null or char_length(btrim(contact_name)) between 1 and 100),
  add constraint inquiries_organization_chars check (organization is null or char_length(btrim(organization)) between 1 and 100),
  add constraint inquiries_contact_email_shape check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')),
  add constraint inquiries_request_type_values check (request_type is null or request_type in ('correction', 'rebuttal')),
  add constraint inquiries_mail_status_values check (mail_status in ('none', 'queued', 'sent', 'failed', 'skipped')),
  -- request_type은 정정·반론에서만 허용한다. 필수는 공개 폼(정정·반론 폼)이 검사한다 — 편집국이 문의함에 직접 넣는 정정 요청(W2-a)은 구분이 없어도 된다
  add constraint inquiries_request_type_kind check (request_type is null or kind = 'correction') not valid,
  -- 구독·광고·독자 투고는 연락 이메일 필수(접수 확인 메일). 기사 제보는 선택. 정정·반론은 공개 폼이 필수로 검사하고 DB는 비워 둔다(편집국이 직접 넣는 정정 요청에는 연락처가 없다)
  add constraint inquiries_contact_email_required check (kind not in ('subscription', 'advertising', 'reader_submission') or contact_email is not null) not valid,
  -- 연락처를 받은 행은 동의한 처리방침 버전이 있어야 한다
  add constraint inquiries_privacy_version_required check (contact_email is null or privacy_version_id is not null or contact_cleared_at is not null) not valid,
  -- 본문에는 이메일·전화·주민등록번호 모양이 없다 — 가림은 서버가 저장 전에, 이 제약이 한 번 더 막는다
  add constraint inquiries_body_no_digit_run check (normalize(body, NFKC) !~ '[0-9]([^0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]*[0-9]){8}') not valid,
  add constraint inquiries_body_no_email check (normalize(body, NFKC) !~ '[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿_.%+-][[:space:]]*@[[:space:]]*[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]') not valid;

comment on column public.inquiries.ref_code is '접수 번호 — 사용자에게 보이는 번호(순번 id는 노출하지 않는다)';
comment on column public.inquiries.contact_email is '평문이 허용된 칸 둘 중 하나 — 열람은 [연락처 보기]를 눌러야 하고 누를 때마다 감사 로그 inquiry.contact_view';

-- 고객센터 설정 씨앗 (설계 2.2 help) — 이미 있으면 건드리지 않는다
insert into public.settings (key, value, description, updated_by) values
  ('help',
   '{"version":"2026-10-20.1","attachments":{"max_files":3,"max_total_bytes":4000000,"allowed_extensions":["pdf","jpg","jpeg","png","docx","xlsx","hwp","hwpx"]},"body_chars":{"min":10,"max":5000},"min_fill_seconds":3,"fill_token_hours":2}'::jsonb,
   '고객센터 폼 (HELP-01) — attachments 첨부 개수·합계 바이트·허용 확장자 · body_chars 내용 글자 수 · min_fill_seconds 최소 작성 시간 · fill_token_hours 폼 열림 토큰 유효 시간 [결정 안건: 초기값 — 합계 4,000,000은 Vercel 요청 본문 한도에 맞춤]',
   'migration:20261020000028')
on conflict (key) do nothing;

-- 첨부 비공개 저장소 — 저장소 기능이 있는 환경에서만 (정책 0 = anon·authenticated 접근 0, service_role만)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('inquiry-attachments', 'inquiry-attachments', false)
    on conflict (id) do update set public = false;
  end if;
end;
$$;
