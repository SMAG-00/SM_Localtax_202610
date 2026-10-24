import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md 불변 원칙 1의 회귀 방지 테스트.
 *
 * "세액 계산은 packages/tax-engine의 순수 함수만 수행한다. LLM은 금액을 절대 산출하지 않는다."
 *
 * DoD의 `grep -r "anthropic\|fetch(" packages/tax-engine/src` 를 테스트로 고정한다.
 * 누군가 엔진에 네트워크 호출이나 LLM SDK를 넣으면 이 테스트가 실패한다.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bfetch\s*\(/, why: '네트워크 호출 (fetch)' },
  { pattern: /\banthropic\b/i, why: 'LLM SDK (Anthropic)' },
  { pattern: /\bopenai\b/i, why: 'LLM SDK (OpenAI)' },
  { pattern: /@ai-sdk|\bai-sdk\b/i, why: 'LLM SDK (AI SDK)' },
  { pattern: /\baxios\b/i, why: 'HTTP 클라이언트 (axios)' },
  { pattern: /XMLHttpRequest/, why: '네트워크 호출 (XHR)' },
  { pattern: /from\s+['"]node:fs['"]|require\(['"]fs['"]\)/, why: '파일 I/O (fs)' },
  { pattern: /from\s+['"]node:https?['"]/, why: '네트워크 호출 (node:http)' },
  {
    pattern: /process\.env/,
    why: '환경변수 접근 (엔진은 입력만으로 결정론적이어야 한다)',
  },
  { pattern: /\beval\s*\(/, why: '동적 코드 실행 (eval)' },
  { pattern: /new\s+Function\s*\(/, why: '동적 코드 실행 (new Function)' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('엔진 순수성 (CLAUDE.md 불변 원칙 1)', () => {
  const files = sourceFiles(SRC);

  it('src/ 에 소스 파일이 실제로 존재한다 (검사가 헛돌지 않는지 확인)', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f] as const))(
    'src/%s 에 네트워크·LLM·I/O·동적실행 호출이 없다',
    (_name, path) => {
      const code = readFileSync(path, 'utf8');
      const violations = FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
        ({ why }) => why,
      );
      expect(violations, `금지된 호출 발견: ${violations.join(', ')}`).toEqual([]);
    },
  );

  it('엔진은 세율 상수를 하드코딩하지 않는다 — 세율은 룰셋에서만 온다', () => {
    // 예외: formulas.ts의 §11①8 산식 상수(2, 3억), money/brackets의 반올림 상수는 세율이 아니다.
    const rateLike = /=\s*0\.0\d+\s*;/; // 0.04, 0.028 같은 세율 리터럴 대입
    for (const path of files) {
      const name = path.slice(SRC.length + 1);
      const code = readFileSync(path, 'utf8');
      expect(rateLike.test(code), `${name} 에 세율로 보이는 상수가 있다`).toBe(false);
    }
  });
});
