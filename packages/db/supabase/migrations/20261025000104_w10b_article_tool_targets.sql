-- W10-b 보충 — 기사별 도구 지정 article_tool_targets (PRD-02 GROW-02, docs/dev/W10-b_설계.md 3장)
-- 편집자가 기사마다 이어 줄 계산기(취득세·재산세·환급 진단)와 미리 채울 값을 고른다. 번호 104는 2단계 설계 2.2의 W10-b 범위(84~85)가 모두 쓰여 새로 잡은 것이다 - 충돌하면 리드가 번호만 바꾼다.
-- · 미리 채울 값은 "질문 칸 이름 -> 값" 평평한 객체뿐이다(앱이 질문 정의로 한 번 더 검사). 개인정보·사용자 입력은 담지 않는다 - 편집자가 고른 예시 값이다.
-- · 공개 읽기는 발행된 기사의 행만 칸을 좁힌 뷰로 연다. 계산기 기능 키·공개 게이트는 앱의 toolLinkFor가 따로 닫는다.

create table public.article_tool_targets (
  article_id bigint primary key references public.articles (id) on delete cascade,
  tool text not null check (tool in ('acquisition', 'holding', 'refund')),
  prefill jsonb not null default '{}'::jsonb check (jsonb_typeof(prefill) = 'object' and pg_column_size(prefill) <= 2048),
  updated_by text not null check (length(btrim(updated_by)) > 0),
  updated_at timestamptz not null default now(),
  constraint article_tool_targets_refund_no_prefill check (tool <> 'refund' or prefill = '{}'::jsonb)
);

comment on table public.article_tool_targets is '기사 -> 도구 지정 (GROW-02) - 대상 도구와 미리 채울 값. 값은 URL 해시로만 넘어가고 서버·이벤트에 남지 않는다';

alter table public.article_tool_targets enable row level security;
revoke all on table public.article_tool_targets from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_tool_targets to service_role;

create view public.public_article_tool_targets as
select t.article_id, t.tool, t.prefill
  from public.article_tool_targets t
  join public.articles a on a.id = t.article_id
 where a.status = 'published';
comment on view public.public_article_tool_targets is '발행된 기사의 도구 지정 - 기사 번호·도구·미리 채울 값뿐';
revoke all on table public.public_article_tool_targets from public, anon, authenticated, service_role;
grant select on table public.public_article_tool_targets to anon, authenticated, service_role;
