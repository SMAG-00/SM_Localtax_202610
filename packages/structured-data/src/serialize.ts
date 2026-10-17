/**
 * `<script type="application/ld+json">` 안에 넣을 문자열 (OPT-02 — 페이지는 이 결과만 넣는다).
 * - `<` `>` `&`를 < > &으로 바꿔 `</script>`·`<!--`로 태그를 빠져나가지 못하게 한다.
 * - U+2028·U+2029를 \u2028·\u2029로 바꾼다 (일부 JS 파서에서 줄바꿈으로 읽힌다).
 * - 키 순서를 고정한다: @context → @type → @id → 나머지는 키 이름 순서. 같은 내용이면 같은 문자열.
 * - JSON으로 낼 수 없는 값(NaN·Infinity·함수·bigint·Date 같은 특수 객체)은 TypeError — 조용히 바꾸지 않는다.
 */

const FIRST_KEYS = ["@context", "@type", "@id"];

function compareKeys(a: string, b: string): number {
  const ra = FIRST_KEYS.indexOf(a);
  const rb = FIRST_KEYS.indexOf(b);
  if (ra !== -1 || rb !== -1) return (ra === -1 ? FIRST_KEYS.length : ra) - (rb === -1 ? FIRST_KEYS.length : rb);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stringify(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: JSON으로 낼 수 없는 숫자 (${value})`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => (v === undefined ? "null" : stringify(v, `${path}[${i}]`))).join(",")}]`;
      }
      if (!isPlainObject(value)) throw new TypeError(`${path}: 일반 객체가 아니다 (${Object.prototype.toString.call(value)})`);
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort(compareKeys);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(record[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: JSON으로 낼 수 없는 값 (${typeof value})`);
  }
}

const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

export function toJsonLdScriptContent(value: unknown): string {
  return stringify(value, "$").replace(
    UNSAFE_IN_SCRIPT,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
