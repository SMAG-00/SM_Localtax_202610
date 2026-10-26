-- W11-b b6 - 총비용 시뮬레이터 정책 공개 뷰 (docs/dev/W11-b_설계.md 3장)
-- · settings 표는 anon이 읽지 못한다(키 목록 허용 방식). 총비용 화면은 보유 연수 상한 등 정책 값을 브라우저에서 입력 검사에 써야 하므로, 이 한 키만 칸을 지정한 뷰로 연다.
-- · 값은 PO 입력 한도 숫자뿐이다(입력값·개인 정보 칸 없음). 빈 객체({} = 씨앗)는 0행으로 내보내 기능이 닫힌 상태와 같게 한다.
-- · 새 DB 함수 없음 - verify-rls 함수 허용 목록 변경 없음.

create view public.public_total_cost_policy as
  select value as policy
    from public.settings
   where key = 'total_cost_policy'
     and value <> '{}'::jsonb;
revoke all on table public.public_total_cost_policy from public, anon, authenticated;
grant select on table public.public_total_cost_policy to anon, authenticated, service_role;

comment on view public.public_total_cost_policy is 'W11-b: settings.total_cost_policy가 비어 있지 않을 때만 1행 (RE-05 정책 - 보유 연수 상한·금리 입력 상한·부대비용 항목 수·비교 연수)';
