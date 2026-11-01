-- 홈 핵심 메시지 문구 교체 + 강조 낱말 맞춤 (PO 결정 2026-11-01 — HOME-01 · CORE-02)
-- · home_core_message — 71번 씨앗 값 그대로일 때만 새 문구로 바꾼다. PO가 관리자 화면에서 이미 고쳐 둔 값은 건드리지 않는다
--     새 문구: 취득·보유·양도·상속·증여 등 모든 순간 — 월간 지방세연구 무료상담 이용하세요.
-- · home_core_highlights — 새 문구일 때만 ["월간 지방세연구", "무료상담"]으로 맞춘다 (옛 낱말 '부동산 세금'·'재테크'는 새 문구에 없다)
--     메시지를 먼저 바꾸고 낱말을 맞춘다 — 트리거 core_highlights_guard(71)가 지금 메시지 안 낱말만 받는다
-- · 표·칸·트리거·정책은 바꾸지 않는다 (settings 값 두 줄 갱신만)

update public.settings
   set value = to_jsonb('취득·보유·양도·상속·증여 등 모든 순간 — 월간 지방세연구 무료상담 이용하세요.'::text),
       updated_by = 'migration:20261101000236'
 where key = 'home_core_message'
   and value = to_jsonb('취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다'::text);

update public.settings
   set value = '["월간 지방세연구", "무료상담"]'::jsonb,
       updated_by = 'migration:20261101000236'
 where key = 'home_core_highlights'
   and exists (
     select 1 from public.settings s
      where s.key = 'home_core_message'
        and s.value = to_jsonb('취득·보유·양도·상속·증여 등 모든 순간 — 월간 지방세연구 무료상담 이용하세요.'::text)
   );
