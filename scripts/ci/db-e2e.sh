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
step "편집국 화면 E2E (정량형·정성형 기획→공개·정정·역할별 메뉴·403)"; node --test --test-concurrency=1 e2e/admin-ui.test.mjs
step "운영 화면 E2E (겸직 금지 화면 차단·사전→점검 패널·분야 순서·360px)"; node --test --test-concurrency=1 e2e/admin-settings-ui.test.mjs
step "공개 홈·공통 틀 E2E (섹션 순서·첫 화면 R1·R2·화면 전환·숨긴 메뉴 링크 0·1분 안 반영)"; node --test --test-concurrency=1 e2e/site-home.test.mjs
step "허브·하위 분야·뉴스 전체·상황 페이지 E2E (네 허브 같은 골격·빈 하위 분야 noindex·취재 기사만·먼저 확인할 것 3·화면 전환·R1~R3)"; node --test --test-concurrency=1 e2e/site-hubs.test.mjs
step "상황 카드 백오피스 E2E (2·4개 거부·감수 서명은 감수위원만·허브 5번째 409·저장 즉시 공개 반영)"; node --test --test-concurrency=1 e2e/admin-situations.test.mjs
step "기사 상세·카드뉴스·칼럼·인물 E2E (배지 글자·박스 자리·정정 블록 0/1·JSON-LD 불일치 0·삭제 410·카드뉴스 5~7장·자기 자신 0·버튼 2개 이하)"; node --test --test-concurrency=1 e2e/site-article.test.mjs
step "공개 화면 — DB를 읽지 못할 때 (목록 200 + 안내 · 상세 503 · 500 0)"; node --test --test-concurrency=1 e2e/site-degraded.test.mjs
step "W2-b 수용 E2E (홈 섹션 순서 · 홈·허브·상황·기사 R1~R3 · 이어 걷기 새로고침 0 · 링크 전수: 숨긴 메뉴·v1.2 경로 0·깨진 링크 0·noindex·360px · 접근성 95)"; node --test --test-concurrency=1 e2e/w2b-acceptance.test.mjs
step "견본 페이지 브라우저 E2E (70종·가로 스크롤 0)"; node --test --test-concurrency=1 e2e/design-page.test.mjs
step "화면 규칙 측정 시험 (R1~R3 경계 견본)"; node --test --test-concurrency=1 e2e/screen-rules.test.mjs
step "화면 규칙 측정 (주요 화면 × 뷰포트 표)"; node e2e/run-screen-rules.mjs
step "접근성 점수 (Lighthouse, 95점 이상)"; node --test --test-concurrency=1 e2e/a11y.test.mjs
step "Docker 이미지 E2E";                   node e2e/run-docker.mjs
step "사내 서버 구성 E2E (web·scheduler·proxy)"; node --test --test-concurrency=1 e2e/compose.test.mjs
