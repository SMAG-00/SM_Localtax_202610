-- 관리자(PO) 전권 (2026-10-17 PO 지시) — 서버의 관리자 경로(service_role)는 감사 로그를 뺀 모든 표를 읽고·추가하고·고치고·지운다.
-- 외부(anon·authenticated)는 그대로 기본 거부다. 감사 로그(ADM-04)의 수정·삭제 여부는 별도로 정한다.
grant select, insert, update, delete on table public.agent_runs to service_role;
