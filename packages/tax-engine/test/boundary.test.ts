import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/index';
import { RULESET, RULESET_2026_07, RULESET_2026_08 } from './ruleset';

// 이 파일은 이 저장소에서 새로 쓴 시험이다 (SM 복사본 아님) - 패키지 경계(CALC-10·TX-04)와 복사 기록(SOURCE.json)을 고정한다.
const here = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(here, '..');
// 국세 낱말 검사(check-national-tax)가 이 파일도 보므로 한국어 세목 이름은 조각으로 붙인다
const NATIONAL_WORDS = new RegExp(['transfer|compare|inherit|gift(?!ed)|capital|oligopoly|양도', '상속' + '세', '증여' + '세'].join('|'), 'i');

describe('공개 진입점 경계 (CALC-10 - 서버·지방세봇도 이 목록으로만 계산한다)', () => {
  it('국세 계산·시나리오 비교·과점주주 계산 함수를 내보내지 않는다 (룰셋 칸 검사용 OligopolySchema만 예외)', () => {
    const names = Object.keys(engine);
    expect(names.filter((n) => NATIONAL_WORDS.test(n) && n !== 'OligopolySchema')).toEqual([]);
  });

  it('계산 함수는 지방세 2개뿐이다 - 취득과 보유', () => {
    const calcs = Object.keys(engine).filter((n) => /^calc[A-Z]/.test(n));
    expect(calcs.sort()).toEqual(['calcAcquisition', 'calcHolding']);
  });

  it('소스 폴더에 국세 계산·비교 파일이 없다', () => {
    const files = readdirSync(resolve(PKG, 'src'));
    expect(files.filter((f) => /transfer|compare/i.test(f))).toEqual([]);
  });

  it('룰셋 스키마에 국세 구역이 없다 - 파싱된 룰셋의 최상위 칸', () => {
    for (const r of [RULESET, RULESET_2026_07, RULESET_2026_08]) {
      expect(Object.keys(r).sort()).toEqual(['acquisition', 'effective_from', 'holding', 'oligopoly', 'source_laws', 'status', 'version']);
    }
  });
});

describe('복사 기록 SOURCE.json', () => {
  const source = JSON.parse(readFileSync(resolve(PKG, 'SOURCE.json'), 'utf8')) as {
    source: { commit: string };
    files: { copy: string; copySha256: string; sourceSha256: string; status: string }[];
  };
  const root = resolve(PKG, '../..');

  it('원본 커밋은 40자리 16진 해시다', () => {
    expect(source.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('파일마다 복사본의 SHA-256이 기록과 같다 - 몰래 고치면 실패한다', () => {
    expect(source.files.length).toBeGreaterThanOrEqual(20);
    for (const f of source.files) {
      const sha = createHash('sha256').update(readFileSync(resolve(root, f.copy))).digest('hex');
      expect(sha, f.copy).toBe(f.copySha256);
      expect(f.sourceSha256, f.copy).toMatch(/^[0-9a-f]{64}$/);
      expect(['verbatim', 'modified', 'pruned']).toContain(f.status);
    }
  });

  it('줄바꿈은 LF뿐이다', () => {
    for (const f of source.files) expect(readFileSync(resolve(root, f.copy), 'utf8').includes('\r'), f.copy).toBe(false);
  });
});
