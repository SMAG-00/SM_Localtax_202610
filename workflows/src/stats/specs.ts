// 통계 원천 등록표 (W12-h h2) - 실제 주소·필드 이름은 이용 조건 실사와 실응답 견본 확인 뒤에 채운다 [확인 필요]. 지금은 모든 칸이 비어 있어 `no_endpoint`로 요청 0이다.
import type { StatsSourceSpec } from "./types.ts";

export const STATS_SPECS: Record<string, StatsSourceSpec> = {
  mois_local_tax_stats: {
    sourceKey: "mois_local_tax_stats", sourceName: "", sourceUrl: "", baseUrl: null, keyName: "DATA_API_KEY", keyParam: "", params: {}, listRoot: "", series: [],
  },
};
