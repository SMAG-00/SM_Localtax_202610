import { validateSolvedCaseForSave, validateTaxLensForSave } from "@ltr/editorial";
import type { ArticleResource } from "@/lib/access";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { EMPTY_CHECKLISTS, parseChecklistsInput } from "@/lib/server/articles/content";
import { parseArticleInput } from "@/lib/server/articles/input";
import { expiredPartnerError } from "@/lib/server/articles/partner-check";
import { planCreate } from "@/lib/server/articles/plan";
import { loadGateSettings, requirePersonForUser } from "@/lib/server/articles/repository";
import type { ArticleRow } from "@/lib/server/articles/rows";
import { afterSave, findingsError, nowIso, saveContext, serviceDb } from "@/lib/server/articles/service";
import { articleSummary, saveFirstRevision } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 기사 초안 작성 (ART-01) — 작성자 = 로그인한 계정의 인물(people). 저장 규칙(CORE-01 박스·CAT-05 개인정보)은 저장 때 막고,
// 쉬운 말·압박 완화(UX-01·UX-03) 검사 결과는 저장을 막지 않고 checks로 돌려준다. 첫 수정 이력(버전 1)과 감사 로그를 남긴다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const parsed = parseArticleInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const input = parsed.value;

  const target = "articles:new";
  const resource: ArticleResource = { kind: "article", authorUserId: viewer.userId, contentType: input.contentType ?? null, published: false };
  const denied = await authorize(viewer, "article.create", target, resource);
  if (denied) return denied;
  if (input.taxLens?.omissionReason) {
    const skipDenied = await authorize(viewer, "article.tax_lens_skip", target);
    if (skipDenied) return skipDenied;
  }

  const checklists = parseChecklistsInput(input.checklists ?? {}, EMPTY_CHECKLISTS);
  if (!checklists.ok) return errorJson(422, "입력값을 확인하세요", { errors: checklists.errors });

  const db = serviceDb();
  const author = await requirePersonForUser(db, viewer.userId);
  const settings = await loadGateSettings(db);
  const now = nowIso();
  const ctx = saveContext(settings.dictionaries, now);
  if (input.taxLens) {
    const v = validateTaxLensForSave({ ...input.taxLens, reviewed: false, reviewedForVersion: null }, ctx);
    if (!v.ok) return findingsError("「지방세로 읽기」 박스가 저장 규칙에 맞지 않습니다 (CORE-01)", v.findings);
  }
  if (input.solvedCase) {
    const v = validateSolvedCaseForSave(input.solvedCase);
    if (!v.ok) return findingsError("해결 사례에 개인정보 형식이 있습니다 (CAT-05)", v.findings);
  }

  const { columns } = planCreate(input, author.id, checklists.value);
  if (typeof columns.partner_id === "number") {
    const expired = await expiredPartnerError(db, columns.partner_id, now);
    if (expired) return expired;
  }
  const { data, error } = await db.from("articles").insert(columns).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "articles 추가");
  const created = data as ArticleRow;
  const revisionId = await saveFirstRevision(db, created, actorOf(viewer));
  const { article, checks } = await afterSave(db, created, settings.dictionaries, false);

  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.create",
    target: targetOf.article(article.id),
    before: null,
    after: { ...articleSummary(article), revisionId, authorId: author.id, taxLens: article.tax_lens },
    reason: "기사 초안 작성",
  });
  return json({ article: articleSummary(article), revisionId, checks }, 201);
});
