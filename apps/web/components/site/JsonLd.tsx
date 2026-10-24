// 구조화 데이터 출력 한 곳 (OPT-02) — 공개 화면의 `<script type="application/ld+json">`은 전부 여기서만 낸다.
// 내용은 @ltr/structured-data 생성기 결과를 toJsonLdScriptContent로 직렬화한 글(손으로 쓴 JSON-LD 0 — 저장소 검사 lib/site/jsonld-source.test.ts).
export function JsonLd({ content, part }: { content: string | null | undefined; part?: string }) {
  if (!content) return null;
  return <script type="application/ld+json" {...(part ? { "data-part": part } : {})} dangerouslySetInnerHTML={{ __html: content }} />;
}
