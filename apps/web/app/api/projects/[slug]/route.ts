import { PublicDataError } from "@/lib/server/public";
import { parseProjectApiRequest, projectApiBody } from "@/lib/server/public/project-logic";
import { getProject } from "@/lib/server/public/projects";

// 프로젝트 읽기 API (W4 15단계 — PRD-01B 5.6, docs/dev/W4_설계.md 1장 15단계 · 4장). 프로젝트 화면과 같은 서버 함수·같은 공개 경계(anon 키 — 공개 뷰).
//  200 프로젝트 + 단계 타임라인(공개 기록만 — 고시 번호·고시일·고시 기관·원문 주소·공공누리 유형·확인일·검토 중) + source·verifiedAt·status
//  400 틀린 조건(주소 모양·모르는 쿼리 칸 — 칸마다 사유) · 404 프로젝트 트래커가 닫힘(기능 키 realestate_projects)·공개 전·없는 프로젝트 · 503 공개 데이터를 읽지 못함
//  · 어떤 입력에도 500을 내지 않는다 — 조건은 DB를 부르기 전에 다 거른다(project-logic.ts). 가격·분담금·수익률 칸 0(PR-05)
//  · 캐시하지 않는다(no-store — 비공개로 바뀐 프로젝트가 다음 요청에 바로 빠진다)
export const dynamic = "force-dynamic";

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  // 주소 글자를 읽지 못하면(깨진 % 표기 등) 400 — 어떤 입력에도 500 0
  const slug = await params.then((p) => p.slug).catch(() => null);
  if (slug === null) return reply(400, { error: "조건을 확인하세요", errors: ["slug: 주소 글자를 읽을 수 없습니다"] });
  const parsed = parseProjectApiRequest(slug, new URL(request.url).searchParams);
  if (!parsed.ok) return reply(400, { error: "조건을 확인하세요", errors: parsed.errors });
  try {
    const view = await getProject(parsed.slug);
    if (!view) return reply(404, { error: "프로젝트를 찾을 수 없거나 아직 열리지 않았습니다" });
    return reply(200, projectApiBody(view.card, view.timeline));
  } catch (err) {
    if (err instanceof PublicDataError) {
      console.error("[projects] 프로젝트 API — 공개 데이터를 읽지 못했습니다:", err.context, err.code ?? "");
      return reply(503, { error: "지금은 읽을 수 없습니다 — 잠시 뒤 다시 확인해 주세요" });
    }
    console.error("[projects] 프로젝트 API 처리 중 오류:", err instanceof Error ? err.name : "오류");
    return reply(500, { error: "서버 오류가 났습니다 — 잠시 뒤 다시 확인해 주세요" });
  }
}
