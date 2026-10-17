/** JSON-LD 값과 노드 타입, 빈 값 정리 */

export const SCHEMA_CONTEXT = "https://schema.org";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
export type JsonObject = { [key: string]: JsonValue | undefined };

/** JSON-LD 노드 — 최상위 노드는 @context를 가진다 */
export interface JsonLdNode extends JsonObject {
  "@context"?: string;
  "@type": string;
}

type Input = JsonValue | undefined;

/**
 * 빈 값(undefined · 빈 글자 · 빈 배열)을 지운 사본을 만든다. 입력은 바꾸지 않는다.
 * 화면에 없는 값은 JSON-LD에도 없게 — 빈 칸을 속성으로 내지 않는다.
 */
export function compact<T extends { [key: string]: Input }>(obj: T): T {
  const out: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = compactValue(value);
    if (v !== undefined) out[key] = v;
  }
  return out as T;
}

function compactValue(value: Input): JsonValue | undefined {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((v): v is JsonValue => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value !== null && typeof value === "object") return compact(value);
  return value;
}
