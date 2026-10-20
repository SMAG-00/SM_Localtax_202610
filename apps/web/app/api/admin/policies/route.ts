import { authorize, requireViewer } from "@/lib/server/dal";
import { summarize, listVersions } from "@/lib/server/admin/policies";
import { readSetting } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { handle, json } from "@/lib/server/http";
import { parseFeatures } from "@/lib/server/public/settings";

// 정책 문서 목록 (문서 9종 · 게시 버전 · 초안 · 기능 키 상태) — 정책 편집 권한이 있는 사람
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "policy.edit", "policies");
  if (denied) return denied;
  const db = serviceDb();
  const [rows, flags] = await Promise.all([listVersions(db), readSetting(db, "feature_flags")]);
  return json({ policies: summarize(rows, parseFeatures(flags?.value)) });
});
