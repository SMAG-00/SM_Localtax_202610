#!/usr/bin/env bash
# CI 2단계 — 로컬 Supabase(Docker)를 띄워 DB 시험 · RLS 검증 · 웹 E2E · Docker 이미지 E2E (FND-03·04·07·10)
set -euo pipefail
cd "$(dirname "$0")/../.."

step() { printf '\n== %s\n' "$1"; }

step "의존성 설치 (lockfile 고정)"
pnpm install --frozen-lockfile

step "로컬 Supabase 시작 (마이그레이션 적용)"
(cd packages/db && supabase start -x vector,logflare,edge-runtime,imgproxy,realtime,studio)

step "DB 시험 (감사 로그·관리자 권한·RLS)"; pnpm --filter @ltr/db test
step "RLS 검증 (anon·authenticated 접근 0)"; node packages/db/scripts/verify-rls.mjs
step "공개 데이터 함수 통합 시험 (anon 키·RLS — 공개 행만)"; pnpm --filter @ltr/web test:integration
step "개발 서버 3001 고정 E2E";              node e2e/dev-port.mjs
step "웹 E2E (standalone 빌드)";            node --test --test-concurrency=1 e2e/api-health-jobs.test.mjs
step "편집국 API E2E (역할별 403·감사 로그·발행 판정)"; node --test --test-concurrency=1 e2e/admin-api.test.mjs
step "운영 API E2E (분야·사전·설정·제휴사·회원 정지 — 403·422·감사 로그)"; node --test --test-concurrency=1 e2e/admin-settings-api.test.mjs
step "홈 배치 API E2E (편집 책임자 201·편집국 외 403·7장째 409·끝난 카드 공개 0)"; node --test --test-concurrency=1 e2e/admin-home-api.test.mjs
step "브라우저 설치 (Playwright Chromium)";  pnpm exec playwright install --with-deps chromium
step "측정 기반 E2E (W2-c — 수집 API 202·UA·IP 저장 0·세션 29/31분·봇 표시·측정 거부·GPC 204와 전송 0·4xx 저장 0·429·편집국 표시·칸 검사)"; node --test --test-concurrency=1 e2e/analytics-api.test.mjs
step "1시간 집계·많이 본 기사·상담 사례 HOT E2E (W2-c — 봇 100+사람 3 < 사람 5·30분 안 반복 1회·168/169시간 경계·편집국 제외·비공개 바로 제외·멱등·카드 3+HOT 5·고정 2건·가중치 변경 → 다음 집계·누름 이벤트·보존 기한 정리)"; node --test --test-concurrency=1 e2e/analytics-popular.test.mjs
step "측정 지표 대시보드 E2E (W2-c — 숫자 = 넣은 자료 손 계산: 유효 방문 29초 0·30초 1·재방문 30일째 포함·31일째 제외·측정 거부 분모 0·봇·편집국 0·깔때기 / 전환일 → 시험 기간·운영 / 새 브라우저 시나리오 깔때기 세 칸 +1 / 수집 전 / 관리자만·403 / 360px)"; node --test --test-concurrency=1 e2e/admin-metrics.test.mjs
step "기사 생산·제휴 준비 대시보드 E2E (W2-c 5단계 — 확정 버전 없으면 요건 미확정·공식 숫자 0 / 시작일 하루 전 제외·시작일 포함 / 확정 조건 422·담당자 확인 / 확정 뒤 공식·내부 정의 따로·심사 기간 비교·인력 보강 안내 / 확정 버전 고치기 409·새 버전·앞 버전 남음 / 기자·광고 담당 403 / '인정'·'예상 점수'·'예측'·'판정' 0 / 360px)"; node --test --test-concurrency=1 e2e/admin-news-partner.test.mjs
step "편집국 화면 E2E (정량형·정성형 기획→공개·정정·역할별 메뉴·403)"; node --test --test-concurrency=1 e2e/admin-ui.test.mjs
step "운영 화면 E2E (겸직 금지 화면 차단·사전→점검 패널·분야 순서·360px)"; node --test --test-concurrency=1 e2e/admin-settings-ui.test.mjs
step "공개 홈·공통 틀 E2E (섹션 순서·첫 화면 R1·R2·화면 전환·숨긴 메뉴 링크 0·1분 안 반영)"; node --test --test-concurrency=1 e2e/site-home.test.mjs
step "허브·하위 분야·뉴스 전체·상황 페이지 E2E (네 허브 같은 골격·빈 하위 분야 noindex·취재 기사만·먼저 확인할 것 3·화면 전환·R1~R3)"; node --test --test-concurrency=1 e2e/site-hubs.test.mjs
step "상황 카드 백오피스 E2E (2·4개 거부·감수 서명은 감수위원만·허브 5번째 409·저장 즉시 공개 반영)"; node --test --test-concurrency=1 e2e/admin-situations.test.mjs
step "통합 검색 화면·API E2E (W2-d 2단계 — 기능 키 꺼지면 404·링크 0 / 띄어쓰기 변형 같은 결과·차 팔았→상황·개편안→트래커 / JS 꺼도 탭·거르개·쪽 / reported_news만 → 다른 유형 0 / 결과 없음 추천 3·상황 카드·도우미 0 / 비공개 0 / search_submitted 검색어 원문 0 / API 400·500 0·429 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-search.test.mjs
step "검색 어휘 백오피스 E2E (W2-d 2단계 — 상황 카드 검색 별칭 21개·51자 422·공개 중 고쳐도 감수 그대로·저장 즉시 검색 / 동의어 사전 편집 책임자만·409·끄면 바로 빠짐·감사 로그 / 화면 칸 오류·360px)"; node --test --test-concurrency=1 e2e/admin-search-vocab.test.mjs
step "용어사전·본문 용어 풀이 E2E (W2-d 3단계 — 기능 키 꺼지면 /glossary 404·용어사전 링크 0 / 가나다 색인에서 공개 용어 모두·숨긴 용어 0·분야 거르개·용어 쪽 / 본문 풀이 용어마다 한 번·제목·링크 안 0·긴 용어 먼저·키보드 포커스로 열림·Esc 닫힘·누르기 / 검색 결과·용어 칩 링크 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-glossary.test.mjs
step "검색어 집계 E2E (W2-d 4단계 — 전화·이메일·주민등록번호·9자리 이상 숫자 가림·닮은꼴(날짜·60일·제111조) 그대로·원문 조각 DB·화면·기록·이벤트 0 / 같은 정규형 하루 한 행·30분 안 다시 찾기 1 / 봇·편집국·측정 거부·GPC·2쪽·미리 받기·같은 검색 안 이동 0 / 실제 브라우저 탭 바꾸기 0 / /admin/query-terms 편집 책임자·관리자만·403·최소 횟수 아래 수만·동의어 더하기·360px / 보존 기한 정리)"; node --test --test-concurrency=1 e2e/search-terms.test.mjs
step "기사 상세·카드뉴스·칼럼·인물 E2E (배지 글자·박스 자리·정정 블록 0/1·JSON-LD 불일치 0·삭제 410·카드뉴스 5~7장·자기 자신 0·버튼 2개 이하)"; node --test --test-concurrency=1 e2e/site-article.test.mjs
step "형식·제휴 콘텐츠 E2E (W2-c 4단계 — 인포그래픽 대체 텍스트·표 없으면 저장 422·표 접힘·키보드 펼침 / 동영상 nocookie만 저장·재생 전 유튜브 요청 0·video_played 1건·요약·자막·16:9 없으면 발행 422 / 포토 출처·이용 조건·대체 텍스트 없으면 발행 422·원본 비율 / 동영상·포토 목록 / 제휴사 프로필·같은 배지·partner_content_viewed 1건·비공개 404 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-media.test.mjs
step "공개 화면 — DB를 읽지 못할 때 (목록 200 + 안내 · 상세 503 · 500 0)"; node --test --test-concurrency=1 e2e/site-degraded.test.mjs
step "W2-b 수용 E2E (홈 섹션 순서 · 홈·허브·상황·기사 R1~R3 · 이어 걷기 새로고침 0 · 링크 전수: 숨긴 메뉴·v1.2 경로 0·깨진 링크 0·noindex·360px · 접근성 95)"; node --test --test-concurrency=1 e2e/w2b-acceptance.test.mjs
step "W2-c 수용 E2E (FND-06 칸 검사·events 0·health 503 / 인포그래픽·동영상·포토 저장·발행 조건·재생 전 유튜브 요청 0 / 제휴사 비공개 뒤 배지 그대로 / 수집 API 봇 100+사람 3 < 사람 5·반복 1회·168/169시간 경계·비공개 제외 / HOT 고정·가중치 → 다음 집계 / 실제 브라우저 29초 0·30초 1·깔때기·측정 거부·GPC·편집자·봇 0·재방문 30/31일 / 요건 미확정·규정 확정·확정 버전 그대로·기준 상수 0 / 권한 표·360px·접근성 95)"; node --test --test-concurrency=1 e2e/w2c-acceptance.test.mjs
step "견본 페이지 브라우저 E2E (70종·가로 스크롤 0)"; node --test --test-concurrency=1 e2e/design-page.test.mjs
step "화면 규칙 측정 시험 (R1~R3 경계 견본)"; node --test --test-concurrency=1 e2e/screen-rules.test.mjs
step "화면 규칙 측정 (주요 화면 × 뷰포트 표)"; node e2e/run-screen-rules.mjs
step "접근성 점수 (Lighthouse, 95점 이상)"; node --test --test-concurrency=1 e2e/a11y.test.mjs
step "Docker 이미지 E2E";                   node e2e/run-docker.mjs
step "사내 서버 구성 E2E (web·scheduler·proxy)"; node --test --test-concurrency=1 e2e/compose.test.mjs
