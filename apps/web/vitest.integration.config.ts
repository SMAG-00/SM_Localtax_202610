import path from "node:path";
import { defineConfig } from "vitest/config";

// 공개 데이터 함수 통합 시험 — 로컬 Supabase(PostgREST·RLS)에 anon 키로 실제로 읽는다 (lib/**/*.itest.mjs).
// 단위 시험(vitest.config.ts)과 따로 돈다: DB가 있는 CI 2단계(scripts/ci/db-e2e.sh)에서만 부른다.
// `server-only` 표식은 Next 서버 밖에서 불러오면 오류를 내므로, 이 시험에서만 패키지의 서버용 빈 모듈로 잇는다.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: { include: ["lib/**/*.itest.mjs"], environment: "node", fileParallelism: false, testTimeout: 30_000, hookTimeout: 120_000 },
});
