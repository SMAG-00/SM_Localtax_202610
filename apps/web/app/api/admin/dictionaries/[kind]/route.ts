import { PHRASE_DICTIONARIES, applyPhraseChange, isPhraseKind, readPhraseDictionary } from "@/lib/admin/dictionary-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { readSetting, writeSetting } from "@/lib/server/admin/backoffice";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 금지 표현(forbidden)·공포 표현(fear) 사전에 표현 하나 더하기·빼기 (UX-01 · UX-03) — 편집 책임자·관리자.
//  · 본문 { op: "add" | "remove", phrase, reason? }
//  · settings 값 { version, phrases }를 발행 판정이 읽는 모양 그대로 고친다 — 배포 없이 다음 점검·저장부터 적용
//  · 버전은 날짜.번호로 오른다. 동시에 고치면 다시 읽어 최대 3번 다시 한다. 감사 로그에 전후 목록
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const kind = (await params).kind;
  if (!isPhraseKind(kind)) return errorJson(404, "그런 사전이 없습니다 — forbidden(금지 표현)·fear(공포 표현)");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const spec = PHRASE_DICTIONARIES[kind];
  const target = targetOf.setting(spec.key);
  const denied = await authorize(viewer, "dictionary.edit", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const unknown = Object.keys(raw).filter((k) => !["op", "phrase", "reason"].includes(k));
  if (unknown.length) return errorJson(422, `모르는 칸입니다: ${unknown.join(", ")}`);
  if (raw.op !== "add" && raw.op !== "remove") return errorJson(422, "op는 add·remove 중 하나여야 합니다");
  if (typeof raw.phrase !== "string") return errorJson(422, "phrase(표현)가 필요합니다");
  const op = raw.op;
  const phrase = raw.phrase;
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : `${spec.label} ${op === "add" ? "더하기" : "빼기"}`;

  const db = serviceDb();
  const today = kstDate(nowIso());
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readSetting(db, spec.key);
    const dict = row ? readPhraseDictionary(row.value) : null;
    if (!row || !dict) throw new HttpError(503, `${spec.label} 사전(settings.${spec.key})을 읽지 못했습니다 — 관리자에게 알려 주세요`);
    const change = applyPhraseChange(dict, op, phrase, today);
    if (!change.ok) return errorJson(change.status, change.message);
    const saved = await writeSetting(db, row, change.value, actorOf(viewer));
    if (!saved) continue; // 다른 사람이 먼저 고쳤다 — 새로 읽어 다시 한다
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: `dictionary.${op}`,
      target,
      before: dict,
      after: change.value,
      reason: `${reason} — ‘${op === "add" ? change.value.phrases.at(-1) : phrase.trim()}’`,
    });
    return json({ kind, ...change.value, updatedAt: saved.updated_at });
  }
  return errorJson(409, "다른 사람이 사전을 동시에 고치고 있습니다 — 새로 불러온 뒤 다시 시도하세요");
});
