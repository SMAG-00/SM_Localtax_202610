-- W13-b b6 - 내보내기 이력 (docs/dev/W13-b_설계.md, PRD-05 WS-05)
-- · 개수만 남긴다 - 내용·검색어·메모 글은 저장하지 않는다. 추가만 (고치기·지우기 거부, 계정 탈퇴 연쇄 삭제만 예외).
-- · 읽기는 본인 행만 (RLS), 쓰기는 서버(service_role)만.

create table public.workspace_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  format text not null check (format in ('docx', 'csv')),
  target text not null check (target in ('notes', 'scraps', 'saved_searches', 'copilot_result')),
  item_count integer not null check (item_count between 0 and 100000),
  citation_count integer not null check (citation_count between 0 and 100000),
  excerpt_chars integer not null check (excerpt_chars between 0 and 100000000),
  created_at timestamptz not null default now()
);
comment on table public.workspace_exports is '내보내기 이력 (WS-05) - 형식·대상 종류·개수·발췌 글자 수만. 내용 칸 없음, 추가만';
create index workspace_exports_user_idx on public.workspace_exports (user_id, created_at desc);

create function public.workspace_exports_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 계정 탈퇴(auth.users 삭제)의 연쇄 삭제는 트리거 안(깊이 2)에서 오므로 허용한다. 직접 삭제·수정·비우기는 거부
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '내보내기 이력은 고치거나 지울 수 없습니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.workspace_exports_immutable() from public, anon, authenticated;
create trigger workspace_exports_no_change before update or delete on public.workspace_exports for each row execute function public.workspace_exports_immutable();
create trigger workspace_exports_no_truncate before truncate on public.workspace_exports for each statement execute function public.workspace_exports_immutable();

alter table public.workspace_exports enable row level security;
revoke all on table public.workspace_exports from public, anon, authenticated, service_role;
grant select on table public.workspace_exports to authenticated;
grant select, insert on table public.workspace_exports to service_role;
create policy workspace_exports_own_read on public.workspace_exports for select to authenticated using (user_id = (select auth.uid()));
