// proxy.ts가 화면 렌더에 넘기는 요청 머리글 이름 — 로그인이 끝났을 때 돌아올 주소(next)를 만드는 데만 쓴다 (값은 safeNextPath로 다시 거른다)
export const ADMIN_PATH_HEADER = "x-ltr-admin-path";
