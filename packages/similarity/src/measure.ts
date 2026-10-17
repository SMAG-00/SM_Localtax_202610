/**
 * 문장 유사도 — 정규화한 글자열의 글자 2-gram 중복집합 Dice 계수.
 *   Dice = 2 × |A ∩ B| / (|A| + |B|)   (A·B는 2-gram 중복집합, ∩는 양쪽 개수의 최솟값 합)
 * 0~1, 대칭, 결정론. 띄어쓰기·문장부호 차이는 0으로 본다.
 */

/** NFKC(전각 → 반각, 자모 합치기) → 소문자 → 글자(\p{L})·숫자(\p{N})만 남김 */
export function normalizeForComparison(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export interface TextProfile {
  normalized: string;
  grams: Map<string, number>;
  /** 2-gram 개수 (중복 포함) = 글자 수 − 1 */
  size: number;
}

export function buildProfile(text: string): TextProfile {
  const normalized = normalizeForComparison(text);
  const chars = Array.from(normalized);
  const grams = new Map<string, number>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const gram = chars[i]! + chars[i + 1]!;
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return { normalized, grams, size: Math.max(chars.length - 1, 0) };
}

export function profileSimilarity(a: TextProfile, b: TextProfile): number {
  if (a.size === 0 || b.size === 0) {
    // 한 글자 이하 문장 — 2-gram이 없으므로 정규화 글자가 같을 때만 1
    return a.normalized.length > 0 && a.normalized === b.normalized ? 1 : 0;
  }
  const [small, large] = a.grams.size <= b.grams.size ? [a, b] : [b, a];
  let shared = 0;
  for (const [gram, count] of small.grams) {
    const other = large.grams.get(gram);
    if (other !== undefined) shared += Math.min(count, other);
  }
  return (2 * shared) / (a.size + b.size);
}

export function sentenceSimilarity(a: string, b: string): number {
  return profileSimilarity(buildProfile(a), buildProfile(b));
}
