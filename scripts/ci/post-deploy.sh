#!/usr/bin/env bash
# 배포 후 점검 (FND-02) — main에 올린 커밋이 운영(Production) 주소에 반영될 때까지 기다린 뒤 상태 확인을 본다.
#   /api/health의 version(배포된 커밋 앞 7자리)이 올린 커밋과 같아지면 → 200이고 env·db가 ok여야 통과
#   운영 배포가 시험 DB를 가리키면 env 실패(503)로 이 작업이 실패하고 GitHub 알림이 간다
# 사용: bash scripts/ci/post-deploy.sh <운영 주소> <커밋 앞 7자리>
set -euo pipefail
url="${1:?운영 주소가 필요합니다}"
want="${2:?커밋 앞 7자리가 필요합니다}"
deadline=$(( $(date +%s) + 900 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  body=$(curl -sS --max-time 15 -w '\n%{http_code}' "$url/api/health" || true)
  code=$(printf '%s' "$body" | tail -n1)
  json=$(printf '%s' "$body" | sed '$d')
  version=$(printf '%s' "$json" | sed -n 's/.*"version":"\([0-9a-f]*\)".*/\1/p')
  if [ "$version" = "$want" ]; then
    if [ "$code" = "200" ] && printf '%s' "$json" | grep -q '"env":"ok"' && printf '%s' "$json" | grep -q '"db":"ok"'; then
      echo "배포 후 점검 통과 — $want 반영, $url/api/health 200 · $json"
      exit 0
    fi
    echo "배포 후 점검 실패 — $want 반영됐지만 상태 확인 $code · $json" >&2
    exit 1
  fi
  echo "아직 이전 배포(${version:-없음}) — 15초 뒤 다시 확인"
  sleep 15
done
echo "배포 후 점검 실패 — 15분 안에 $want 배포가 반영되지 않음" >&2
exit 1
