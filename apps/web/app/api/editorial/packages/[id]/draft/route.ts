import { parseDraftForm } from "@/lib/editorial/article-draft";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { createDraftFromPackage, draftPreview } from "@/lib/server/editorial/article-draft";
import { deskId } from "@/lib/server/editorial/desk";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 결과물 → 기사 초안 (PO 2026-11-18) — 편집위원 데스크를 볼 수 있고(editorial_desk.read) 기사를 쓸 수 있는 사람(article.create — 기자·편집 책임자·관리자)만.
//  GET  확인 창 기본값(제목·요약·분야·하위 분야·유형·주소)·그림·출처·확인 필요·이미 만든 초안
//  POST { title, summary, section, contentType, categorySlug, slug } → 초안 기사(발행 안 함) + 사진 보관함 그림 + 출처 → 201 { article, images, sources, needsCheck, warnings }
export const dynamic = "force-dynamic";
// 그림 몇 장(각 4MB 이하)을 비공개 버킷에서 읽어 사진 보관함에 옮긴다
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

async function gate(request: Request, id: string) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = `editorial_packages:${id}`;
  return (await authorize(viewer, "editorial_desk.read", target)) ?? (await authorize(viewer, "article.create", target)) ?? viewer;
}

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const id = deskId((await params).id);
  const viewer = await gate(request, id);
  if (viewer instanceof Response) return viewer;
  return json({ preview: await draftPreview(serviceDb(), id) });
});

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = deskId((await params).id);
  const viewer = await gate(request, id);
  if (viewer instanceof Response) return viewer;
  const form = parseDraftForm(await readJson(request));
  if (!form.ok) return errorJson(422, "입력값을 확인하세요", { errors: form.errors });
  return json(await createDraftFromPackage(serviceDb(), viewer, id, form.value), 201);
});
