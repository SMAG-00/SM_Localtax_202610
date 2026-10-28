import { isoToKstDate } from "@/lib/admin/form-utils";
import { normalizeUrl, suggestSources, type SourceCandidate, type SourceCheck } from "@/lib/admin/source-suggest";
import { targetOf } from "@/lib/server/audit";
import { readStoredBody } from "@/lib/server/articles/content";
import { articleResource, loadArticle, loadOfficialSourceTypes } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId } from "@/lib/server/http";
import { fetchCheck } from "@/lib/server/sources/fetch-check";

// 출처 자동 채우기 후보 (F5) — 저장된 본문의 [글](URL) 링크와 '출처:' 줄에서 후보를 뽑고, 공식 문서 후보는 원문 페이지를 서버가 받아
// 열림(확인일)·공공누리 유형·이용 조건 글자를 읽는다. 저장하지 않는다 — 추가는 화면이 기존 POST …/sources로 한다(DB 제약·감사 로그 그대로).
// 권한은 출처 추가와 같다(article.edit). 감사 로그는 남기지 않는다(읽기만 하고 기록을 바꾸지 않음).
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const OFFICIAL = new Set(["official_doc", "dataset"]);
const CONCURRENCY = 4;

export interface SuggestedItem {
  candidate: SourceCandidate;
  /** 원문 페이지 확인 결과 — 확인하지 않은 후보(공식 자료가 아님)는 null */
  check: SourceCheck | null;
}

/** 순서를 지키며 N개씩 동시에 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const article = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.edit", targetOf.article(id), await articleResource(db, article));
  if (denied) return denied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사입니다");

  const { data, error } = await db.from("article_sources").select("source_url").eq("article_id", id);
  if (error) throw dbError(error, "article_sources 읽기");
  const existingUrls = ((data ?? []) as { source_url: string | null }[]).flatMap((r) => (r.source_url ? [r.source_url] : []));
  const today = isoToKstDate(new Date().toISOString());
  const body = readStoredBody(article.body);
  const all = suggestSources(body.blocks, { today, coversBillStatus: article.covers_bill_status === true, allowedSourceTypes: await loadOfficialSourceTypes(db), existingUrls: [] });
  const known = new Set(existingUrls.map(normalizeUrl));
  const candidates = all.filter((c) => !known.has(normalizeUrl(c.url)));

  const items: SuggestedItem[] = await mapLimit(candidates, CONCURRENCY, async (candidate) => ({
    candidate,
    check: OFFICIAL.has(candidate.kind) ? await fetchCheck(candidate.url) : null,
  }));
  return json({ items, alreadyRegistered: all.length - candidates.length, today });
});
