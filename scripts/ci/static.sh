#!/usr/bin/env bash
# CI 1단계 — 정적 검사 (FND-03). 로컬에서 돌려도 CI와 같은 판정이 나온다.
# 타입·린트 · 환경변수 규칙(ENV-02·03·05) · 의존성(FND-08·01) · 커밋 작성자(FND-01) · SM 식별자(FND-05) · 마이그레이션 RLS(FND-04) · 검사 스크립트 단위 시험
set -euo pipefail
cd "$(dirname "$0")/../.."

step() { printf '\n== %s\n' "$1"; }

step "의존성 설치 (lockfile 고정)"
pnpm install --frozen-lockfile

step "타입 검사";            pnpm -r --if-present typecheck
step "린트";                pnpm -r --if-present lint
step "환경변수 규칙";         node scripts/check-env.mjs
step "의존성 규칙";          node scripts/check-deps.mjs
step "버전 고정";            node scripts/check-pins.mjs
step "커밋 작성자";          node scripts/check-commit-authors.mjs
step "SM 플랫폼 식별자";      node scripts/check-forbidden-ids.mjs
step "마이그레이션 RLS";      node packages/db/scripts/lint-migrations.mjs packages/db/supabase/migrations
step "디자인 린트";           node scripts/check-design.mjs
step "디자인 토큰·명칭 시험";   pnpm --filter @ltr/ui test
step "점검·유사도·구조화 데이터 견본 시험 (W1-b)"; pnpm --filter @ltr/seo-lint --filter @ltr/similarity --filter @ltr/structured-data --filter @ltr/editorial test
step "빌드 산출물 비밀값 검사 (가짜 비밀값으로 빌드)"; node scripts/scan-bundle-secrets.mjs --build
step "검사 스크립트 단위 시험"; node --test "scripts/__tests__/*.test.mjs"
