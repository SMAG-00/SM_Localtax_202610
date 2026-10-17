#!/usr/bin/env bash
# 배포 후 점검 (FND-02) — Vercel Production 배포가 끝나면 상태 확인을 부른다.
# 운영 배포가 시험 DB를 가리키면 /api/health가 env 실패(503)를 돌려주고, 이 작업이 실패해 GitHub 알림이 간다.
# 사용: bash scripts/ci/post-deploy.sh <배포 주소>
set -euo pipefail
url="${1:?배포 주소가 필요합니다}"
for i in $(seq 1 10); do
  body=$(curl -sS --max-time 15 -w '\n%{http_code}' "$url/api/health" || true)
  code=$(printf '%s' "$body" | tail -n1)
  json=$(printf '%s' "$body" | sed '$d')
  if [ "$code" = "200" ]; then
    echo "배포 후 점검 통과 — $url/api/health 200 · $json"
    exit 0
  fi
  if [ "$code" = "503" ]; then
    echo "배포 후 점검 실패 — $url/api/health 503 · $json" >&2
    exit 1
  fi
  echo "응답 $code — 10초 뒤 다시 시도 ($i/10)"
  sleep 10
done
echo "배포 후 점검 실패 — 응답 없음" >&2
exit 1
