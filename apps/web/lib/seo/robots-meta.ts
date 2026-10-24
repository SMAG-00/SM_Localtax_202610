// 공개 화면(site) 틀의 기본 robots 메타 (SEO-04) — SITE_INDEXING=off이면 전부 noindex, on이면 색인 허용.
// 화면마다 따로 정한 noindex(빈 지역·삭제·검색 결과·로그인 계정 등)는 각 화면의 metadata가 그대로 덮어쓴다. 공개 틀 밖(로그인·계정·관리)은 루트의 noindex가 그대로다.
export function defaultRobots(indexing: boolean): { index: boolean; follow: boolean } {
  return indexing ? { index: true, follow: true } : { index: false, follow: false };
}
