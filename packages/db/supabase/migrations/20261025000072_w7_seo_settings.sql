-- W7 1~3단계 — 최적화 설정 씨앗 (PRD-01A OPT-01·03·08·10, docs/dev/W7_설계.md 2장)
-- · seo_lint_params — 점검 기준값 덮어쓰기(비어 있으면 규칙 파일 값)
-- · crawler_policy — robots.txt 원본. AI 학습 크롤러 정책은 PO 결정 전(decided=false)이라 비어 있다 — 이 값으로는 색인을 켤 수 없다(PRD_최종 §13 #3)
-- · news_sitemap_hours — 뉴스 사이트맵 기간(48시간) [확인 필요: 검색 엔진 권장 기간]
-- · indexnow — 전송 꺼짐 (§13 #18 실사 전)
-- 값 검사는 설정 API(apps/web/lib/admin/settings-rules.ts)가 한다. 이 키들은 공개 읽기 목록에 없다(anon 0) — 서버가 service_role로 읽는다.
-- 크롤러 이름·합격선 같은 값은 넣지 않는다.
insert into public.settings (key, value, description, updated_by) values
  ('seo_lint_params', '{}'::jsonb,
   '최적화 점검 기준값 덮어쓰기 (OPT-03·10) — { "<규칙 ID>": { "<기준 이름>": 값 } }. 비어 있으면 규칙 파일 값', 'migration:20261025000072'),
  ('crawler_policy', '{"search": [], "ai_training": {"decided": false, "agents": []}}'::jsonb,
   '크롤러 정책 (OPT-08) — robots.txt 원본. ai_training.decided=false이면 색인을 켤 수 없고 robots.txt는 전체 차단', 'migration:20261025000072'),
  ('news_sitemap_hours', '48'::jsonb,
   '뉴스 사이트맵 기간(시간, OPT-01) — 이 시간 안에 발행된 기사만. 1~168 정수', 'migration:20261025000072'),
  ('indexnow', '{"enabled": false}'::jsonb,
   'IndexNow 전송 (OPT-01) — 지원 범위 실사 전이라 꺼짐', 'migration:20261025000072')
on conflict (key) do nothing;
