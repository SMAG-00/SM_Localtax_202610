import "server-only";

// 지방세봇 검색 색인 환경변수 읽기 (서버 전용). 이름을 하나씩 읽어 check-env가 읽는 곳을 찾게 한다.
// EMBEDDING_PROVIDER가 비어 있으면 벡터 검색은 꺼져 있고 전문 검색만 쓴다 (PO 결정 #5 - 공급자 선정 전).
export function embeddingEnv(): { provider?: string; model?: string; apiKey?: string; dims?: number } {
  return {
    provider: process.env.EMBEDDING_PROVIDER || undefined,
    model: process.env.EMBEDDING_MODEL || undefined,
    apiKey: process.env.EMBEDDING_API_KEY || undefined,
    // 차원은 DB 칸(chunk_embeddings vector(1024))과 같아야 한다 - 공급자 결정 뒤 155에서 바꾸면 여기도 같이 바꾼다
    dims: 1024,
  };
}
