import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRuleset, type Ruleset } from '../src/schema';

/**
 * 실제 프로덕션 룰셋 파일을 그대로 읽어 테스트에 쓴다.
 * 별도의 목(mock) 룰셋을 만들지 않는 이유: 테스트가 실제 룰셋의 값을 검증해야 검수 시트로 쓸 수 있기 때문이다.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = resolve(here, '../../../rules/2026.01.json');

export const RULESET_RAW: unknown = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
export const RULESET: Ruleset = parseRuleset(RULESET_RAW);

/**
 * 2026.07 룰셋 — 경과조치(transitional)·신고분납(filing) 등 신규 데이터를 담는 버전 (SM 룰셋 2026.07, 국세 구역 삭제본).
 */
export const RULES_PATH_2026_07 = resolve(here, '../../../rules/2026.07.json');
export const RULESET_2026_07_RAW: unknown = JSON.parse(
  readFileSync(RULES_PATH_2026_07, 'utf8'),
);
export const RULESET_2026_07: Ruleset = parseRuleset(RULESET_2026_07_RAW);

/**
 * 2026.08 룰셋 — 다주택 중과 경과조치 정비.
 *  · 입법예고 초안(`contract_date_rule`) 제거 — 확정 개정(2026.4.23)이 대체한다.
 *    초안은 "종료일까지 계약하면 유예"였는데, 확정 규정은 계약금·잔금기한(4/6개월)·
 *    보유 2년을 요구한다. 초안대로 판정하면 중과를 부당하게 면제한다.
 *  · `transitional.law` 추가 (2026.07 에는 없어 엔진이 조문을 폴백했다).
 * 세율·공제액 변경은 0건이다.
 */
export const RULES_PATH_2026_08 = resolve(here, '../../../rules/2026.08.json');
export const RULESET_2026_08_RAW: unknown = JSON.parse(
  readFileSync(RULES_PATH_2026_08, 'utf8'),
);
export const RULESET_2026_08: Ruleset = parseRuleset(RULESET_2026_08_RAW);
