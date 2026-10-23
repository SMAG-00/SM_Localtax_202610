import { resolveExposure } from "@/lib/server/assistant/service";
import { AssistantWidget } from "./AssistantWidget";

// 우측 하단 AI 도우미 (CHAT-01) — 서버가 보일지 정한다. 꺼짐·미공개(일반 방문자)·설정 오류면 아무것도 그리지 않는다(런처 0, 페이지 정상).
// 공개 화면 틀((site) 레이아웃) 안에만 있어 관리 화면(/admin)에는 없다.
export async function AssistantMount() {
  const { exposure, runtime } = await resolveExposure();
  if (exposure === "off" || !runtime) return null;
  return <AssistantWidget aiNotice={runtime.notice.aiNotice} firstUseNotice={runtime.notice.firstUse} noticeVersion={runtime.notice.version} />;
}
