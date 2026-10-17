import { memberSearchQuery } from "@/lib/admin/member-rules";
import { listMembers } from "@/lib/server/admin/members";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json } from "@/lib/server/http";

// 회원·편집국 계정 조회 (ADM-02) — 관리자만(member.read). ?q=이메일 일부(2자 이상)로 모든 계정에서 찾는다.
// 계정마다 서비스 역할·연결 인물·관리자 여부·정지 상태. 역할 부여·회수는 POST /api/admin/roles, 정지는 POST members/[id]/suspension.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "member.read", "members:list");
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("q");
  const q = raw === null || raw.trim() === "" ? null : memberSearchQuery(raw);
  if (raw !== null && raw.trim() !== "" && q === null) return errorJson(422, "검색어는 공백·쉼표 없이 2~100자로 적어 주세요");
  return json({ q, members: await listMembers(serviceDb(), q) });
});
