import { ForbiddenView } from "@/components/admin/ForbiddenView";

// 백오피스 403 화면 — 화면 접근 판정(requirePage)이 forbidden()을 부르면 이 화면과 상태 코드 403
export default function Forbidden() {
  return <ForbiddenView />;
}
