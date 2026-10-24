import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 테스트는 test/ 에만 둔다. src/ 는 순수 함수만 남겨 purity 검사(fetch/LLM 호출 없음)를 유지한다.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
