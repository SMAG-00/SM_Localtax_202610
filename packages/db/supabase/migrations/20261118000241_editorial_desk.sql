-- 편집위원 데스크 (PO 2026-11-18) — 헤더 '편집위원' 메뉴: 기사 제작 요청(프로젝트 지침 통합본 v4) + 결과물 열람
-- · 역할 editorial_board(편집위원) 더하기 — 편집국 밖의 별도 역할. 기사 작성·승인·발행 권한은 없고 제작 요청·결과물 열람만 한다(관리자도 함).
--   겸직 금지 트리거(staff_roles_separation)는 그대로 — editor·ops 조합만 막고 편집위원은 어느 역할과도 함께 줄 수 있다.
-- · editorial_requests: 요청 대기열. 웹이 queued로 넣고, 작업기(지금은 PO PC, 서버 이전 뒤 서버)가 가져가 running → done/failed로 바꾼다.
-- · editorial_packages: 결과물 묶음(New_Article 날짜 폴더 하나 = 한 묶음). 웹 요청분(web)과 코워크로 만든 지난 결과물(cowork)을 함께 담는다.
-- · editorial_worker_status: 작업기 마지막 확인 시각 — 화면이 "작업기 꺼짐(요청은 대기)"을 알린다.
-- · 저장소 버킷 editorial-desk(비공개) — 첨부 원본(requests/…)과 결과물(packages/…). 읽기는 서버가 만든 5분 서명 주소로만.
-- 세 표 모두 RLS를 켜고 정책을 만들지 않는다 — service_role(서버·작업기)만 읽고 쓴다 (staff_roles와 같은 방식).

alter table public.staff_roles drop constraint staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check
  check (role in ('reporter', 'editor', 'reviewer', 'ad_ops', 'store_ops', 'brand_ops', 'expert_ops', 'editorial_board'));

create table public.editorial_packages (
  id uuid primary key default gen_random_uuid(),
  folder text not null unique check (folder ~ '^\d{4}_\d{2}_\d{2}(_\d+)?$'),      -- New_Article 아래 날짜 폴더 이름
  work_date date not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  source text not null check (source in ('web', 'cowork')),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),  -- [{path, size, mime, kind}] — path는 날짜 폴더 기준 상대 경로
  report text,                                                                     -- 작업기 완료 보고(지침 18장)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.editorial_packages is '편집위원 데스크 결과물 묶음 (New_Article 날짜 폴더 하나). service_role만 쓴다';

create table public.editorial_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users (id) on delete set null,
  requester_label text not null check (length(btrim(requester_label)) > 0),        -- 요청 당시 이메일 (계정이 지워져도 누가 요청했는지 남긴다)
  status text not null default 'draft' check (status in ('draft', 'queued', 'running', 'done', 'failed', 'canceled')),
  input jsonb not null check (jsonb_typeof(input) = 'object'),                     -- 접수 인터뷰 답(lib/editorial/request-input.ts가 검사한 값)
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'), -- [{name, path, size, mime}]
  package_id uuid references public.editorial_packages (id) on delete set null,
  progress text,                                                                   -- 작업기가 남기는 진행 한 줄
  error text,
  worker text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);

comment on table public.editorial_requests is '편집위원 데스크 기사 제작 요청 대기열. 웹이 넣고 작업기가 처리한다. service_role만 쓴다';

create index editorial_requests_queue on public.editorial_requests (status, queued_at);
create index editorial_requests_created on public.editorial_requests (created_at desc);
create index editorial_packages_date on public.editorial_packages (work_date desc, folder desc);

create table public.editorial_worker_status (
  worker text primary key check (length(btrim(worker)) between 1 and 100),
  seen_at timestamptz not null default now(),
  version text
);

comment on table public.editorial_worker_status is '편집위원 데스크 작업기 마지막 확인 시각. service_role만 쓴다';

alter table public.editorial_packages enable row level security;
alter table public.editorial_requests enable row level security;
alter table public.editorial_worker_status enable row level security;

-- 저장소 기능이 있는 환경에서만 (선례: 20261027000233_f1_media_storage.sql). 한 파일 50MB — 영상(mp4·vrew)은 작업기가 올리지 않는다
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('editorial-desk', 'editorial-desk', false, 52428800)
    on conflict (id) do update set public = false, file_size_limit = 52428800;
  end if;
end;
$$;
