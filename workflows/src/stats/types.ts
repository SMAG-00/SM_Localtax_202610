// 지방세 통계 수집 공통 모양 (W12-h h2 - DATA-01). 순수 타입이며 DB·환경변수를 읽지 않는다. 이 모듈에 AI 호출은 없다.
export interface StatsSeriesSpec {
  seriesKey: string;
  title: string;
  taxItem: string | null;
  regionCode: string | null;
  unit: string;
  /** 응답 행에서 시점 값을 읽는 필드 이름 [확인 필요] */
  periodField: string;
  /** 응답 행에서 수치를 읽는 필드 이름 [확인 필요] */
  valueField: string;
  /** 이 시계열에 속하는 행의 조건 (필드 = 값). 없으면 모든 행 */
  match?: { field: string; value: string };
}

export interface StatsSourceSpec {
  sourceKey: string;
  /** 사람이 읽는 출처 이름 (공개 화면의 '출처') [확인 필요] */
  sourceName: string;
  /** 공개 화면에 붙는 출처 주소(인증키 없는 안내 페이지) [확인 필요] */
  sourceUrl: string;
  /** 요청 기본 주소. 이용 조건·실응답 견본 확인 뒤에 채운다 [확인 필요] - 비어 있으면 요청 0 */
  baseUrl: string | null;
  keyName: "DATA_API_KEY";
  keyParam: string;
  params: Record<string, string>;
  listRoot: string;
  series: StatsSeriesSpec[];
}

export type StatsFetch = (url: string) => Promise<{ status: number; text: string }>;

export interface StatsPut {
  sourceKey: string;
  snapshot: { url: string; payload: string; content_hash: string; http_status: number; external_id: string };
  series: {
    series_key: string; title: string; tax_item: string | null; region_code: string | null; unit: string;
    points: { period: string; value: number }[]; source_name: string; source_url: string; base_year: number; checked_at: string;
  };
}

export interface StatsStore {
  /** DB 함수 stats_series_put - 원천이 수집 가능이 아니면 ok=false(code source_not_runnable) */
  put(input: StatsPut): Promise<{ ok: boolean; code?: string; created?: boolean }>;
}

export interface StatsCollectSummary {
  sourceKey: string;
  listed: number;
  seriesBuilt: number;
  created: number;
  known: number;
  rejected: number;
  failed: number;
}
