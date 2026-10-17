import { defineConfig } from "vitest/config";

// 컴포넌트 시험 — jsdom에서 실제로 렌더하고 사용자 동작(클릭·키보드)으로 확인한다
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
