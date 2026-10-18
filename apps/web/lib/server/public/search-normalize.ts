// 검색 정규화 — 순수 규칙 (docs/dev/W2-d_설계.md 2.2·2.3·4장). 의존 없음 — 공개 검색(search-logic.ts)·상황 카드 CMS의 검색 별칭 검사·
// 동의어 사전 편집 화면(브라우저)이 같은 규칙을 쓴다. DB 함수 public.search_squash·search_public과 같은 결과(2.2 견본 표를 DB 시험과 이 시험이 함께 지난다).

/** 한도 (설계 2.3 — DB 함수 상수와 같다) */
export const SEARCH_LIMITS = { queryChars: 100, maxTerms: 8, pageSize: 20, maxPageSize: 50, maxOffset: 1000, maxPerKind: 10 } as const;

/** 남기는 글자 밖 — 숫자·영문 소문자·한글 음절·한글 자모(NFKC가 호환 자모 ㄱ을 첫소리 글자 ᄀ로 바꾼다 — 둘 다)·한자만 남긴다 (DB public.search_squash와 같은 범위) */
const DROP = /[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+/gu;
const ONE_SYLLABLE = /^[가-힣]$/u;

/** 한 칸의 정규형 — NFKC → 소문자 → 남기는 글자만 */
export function squash(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(DROP, "");
}

/** 앞에서 n글자(코드 포인트) — DB left(text, n)과 같다 */
export function leftChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join("");
}

const firstUnique = (xs: readonly string[], max: number) => [...new Set(xs)].slice(0, max);

export interface QueryTerms {
  /** 찾는 낱말 — 한 글자 한글 낱말을 옆 낱말에 붙인 것 */
  terms: string[];
  /** 찾는 낱말로 0건일 때 다시 찾는 낱말(띄어 쓴 그대로) — 찾는 낱말과 같으면 null */
  split: string[] | null;
}

/** 검색어 → 찾는 낱말 (설계 4장 3 — DB search_public과 같은 규칙, 2.2 견본 표) */
export function queryTerms(raw: string | null | undefined): QueryTerms {
  const parts = leftChars(raw ?? "", SEARCH_LIMITS.queryChars)
    .normalize("NFKC")
    .toLowerCase()
    .replace(DROP, " ")
    .split(" ")
    .filter((x) => x !== "");
  const work = [...parts];
  const glued: string[] = [];
  for (let i = 0; i < work.length; i++) {
    const cur = work[i]!;
    if (work.length > 1 && ONE_SYLLABLE.test(cur)) {
      const prev = glued.at(-1);
      // 앞 낱말이 숫자로 끝나면 앞에("2026 년"), 아니면 뒤 낱말이 한글·숫자로 시작하면 뒤에("재 건축"), 아니면 앞 낱말이 한글로 끝날 때 앞에("취득 세")
      if (prev !== undefined && /[0-9]$/u.test(prev)) {
        glued[glued.length - 1] = prev + cur;
        continue;
      }
      if (i + 1 < work.length && /^[가-힣0-9]/u.test(work[i + 1]!)) {
        work[i + 1] = cur + work[i + 1]!;
        continue;
      }
      if (prev !== undefined && /[가-힣]$/u.test(prev)) {
        glued[glued.length - 1] = prev + cur;
        continue;
      }
    }
    glued.push(cur);
  }
  const terms = firstUnique(glued, SEARCH_LIMITS.maxTerms);
  const split = firstUnique(parts, SEARCH_LIMITS.maxTerms);
  const same = split.length === terms.length && split.every((x, i) => x === terms[i]);
  return { terms, split: same ? null : split };
}
