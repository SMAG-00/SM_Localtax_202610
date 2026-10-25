// 분야 데이터 원천 등록표 (W10-h h1) — 실제 주소·필드 이름은 이용 조건 실사와 실응답 견본 확인 뒤에 채운다 [확인 필요].
// 지금은 모든 칸이 비어 있어 `no_endpoint` 로 요청 0이다. 관광(TourAPI) 계열 원천은 두지 않는다 (LG-15, PRD-X).
import type { FieldSourceSpec } from "./types.ts";

const empty = (sourceKey: string, target: FieldSourceSpec["target"], keyName: FieldSourceSpec["keyName"] = "DATA_API_KEY"): FieldSourceSpec => ({
  sourceKey, target, baseUrl: null, keyName, keyParam: "", params: {}, listRoot: "", idField: "", fieldMap: {},
});

export const FIELD_SPECS: Record<string, FieldSourceSpec> = {
  applyhome_supply: empty("applyhome_supply", "supply_notice"),
  buildinghub_permit: empty("buildinghub_permit", "project_stage"),
  seoul_cleanup: empty("seoul_cleanup", "project_stage"),
  festival_data: empty("festival_data", "local_event"),
  fin_authority_release: empty("fin_authority_release", "finance_regulation"),
  dart_disclosure: empty("dart_disclosure", "finance_indicator", "DATA_API_DART_KEY"),
  pf_integrated_info: empty("pf_integrated_info", "finance_case_entry"),
};
