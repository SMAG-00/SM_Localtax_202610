import path from "node:path";
import { defineConfig } from "vitest/config";

// 서버 로직 단위 시험 — 화면 E2E는 저장소 e2e/에서 실제 서버로 한다
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
