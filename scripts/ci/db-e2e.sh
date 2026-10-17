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
step "개발 서버 3001 고정 E2E";              node e2e/dev-port.mjs
step "웹 E2E (standalone 빌드)";            node --test --test-concurrency=1 e2e/api-health-jobs.test.mjs
step "편집국 API E2E (역할별 403·감사 로그·발행 판정)"; node --test --test-concurrency=1 e2e/admin-api.test.mjs
step "운영 API E2E (분야·사전·설정·제휴사·회원 정지 — 403·422·감사 로그)"; node --test --test-concurrency=1 e2e/admin-settings-api.test.mjs
step "브라우저 설치 (Playwright Chromium)";  pnpm exec playwright install --with-deps chromium
step "편집국 화면 E2E (정량형·정성형 기획→공개·정정·역할별 메뉴·403)"; node --test --test-concurrency=1 e2e/admin-ui.test.mjs
step "운영 화면 E2E (겸직 금지 화면 차단·사전→점검 패널·분야 순서·360px)"; node --test --test-concurrency=1 e2e/admin-settings-ui.test.mjs
step "견본 페이지 브라우저 E2E (70종·가로 스크롤 0)"; node --test --test-concurrency=1 e2e/design-page.test.mjs
step "화면 규칙 측정 시험 (R1~R3 경계 견본)"; node --test --test-concurrency=1 e2e/screen-rules.test.mjs
step "화면 규칙 측정 (주요 화면 × 뷰포트 표)"; node e2e/run-screen-rules.mjs
step "접근성 점수 (Lighthouse, 95점 이상)"; node --test --test-concurrency=1 e2e/a11y.test.mjs
step "Docker 이미지 E2E";                   node e2e/run-docker.mjs
step "사내 서버 구성 E2E (web·scheduler·proxy)"; node --test --test-concurrency=1 e2e/compose.test.mjs
