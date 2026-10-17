import { PHRASE_DICTIONARIES, PHRASE_KINDS, readPhraseDictionary } from "@/lib/admin/dictionary-rules";
import { listGlossary, readSetting } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";

// 사전 한눈에 (UX-01 · UX-03) — 금지 표현·공포 표현(settings forbidden_phrases·fear_phrases, 발행 판정이 읽는 키 그대로)과
// 쉬운 말 사전(glossary_terms). 편집 책임자·관리자(dictionary.edit).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "dictionary.edit", "dictionaries:list");
  if (denied) return denied;
  const db = serviceDb();
  const [settings, glossary] = await Promise.all([Promise.all(PHRASE_KINDS.map((k) => readSetting(db, PHRASE_DICTIONARIES[k].key))), listGlossary(db)]);
  const phrases = Object.fromEntries(
    PHRASE_KINDS.map((kind, i) => {
      const row = settings[i];
      const dict = row ? readPhraseDictionary(row.value) : null;
      return [kind, dict ? { ...dict, updatedAt: row!.updated_at, updatedBy: row!.updated_by } : null];
    }),
  );
  return json({ ...phrases, glossary });
});
