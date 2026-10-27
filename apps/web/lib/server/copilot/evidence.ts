import type { EvidenceDoc } from "@/lib/agent/evidence";
import type { AgentToolbox } from "@/lib/agent/tools";
import type { CopilotRequest } from "./logic";

// 코파일럿 근거 수집 (W13-e) - 4단계 읽기 전용 도구 상자(agent_search)를 불러 문서를 미리 모으고, 모델에게는 그 목록만 보여 준다.
// 라운지 글·메모는 색인 허용 목록에 없어 여기까지 오지 않고, 아래 종류 목록에도 없다 (원칙 10 · RES-05).

const DECISION_TYPES: readonly string[] = ["case_decision", "interpretation"];
const MEMO_TYPES: readonly string[] = ["law_article", "case_decision", "interpretation"];
/** 연혁 기준일 표본 상한 (시작·끝 + 해마다 1월 1일) */
const HISTORY_SAMPLE_MAX = 32;

export interface CollectDeps {
  tools: AgentToolbox;
  /** 오늘(한국 시간) - 조문 조회 기본 기준일 */
  today: string;
  /** 프리미엄 근거를 받아도 되는 계정인가 (copilot 권한 또는 4a·4b 내부 계정). 아니면 프리미엄 문서는 버린다 */
  premiumOk: boolean;
  /** 요약 권리 확인 출처만 돌려주는 함수 (DB 211) */
  summaryAllowed(ids: string[]): Promise<string[]>;
}

export type CollectResult = { ok: true; docs: EvidenceDoc[] } | { ok: false; status: 422; code: string };

/** 조문 경로 "법령명 > 제N조"와 사용자가 쓴 "법령명 제N조"를 맞추기 위해 공백과 > 를 지운다 */
const norm = (s: string) => s.normalize("NFKC").replace(/[\s>]+/gu, "");
const fail = (code: string): CollectResult => ({ ok: false, status: 422, code });

function samples(from: string, to: string): string[] {
  const out = [from];
  for (let y = Number(from.slice(0, 4)) + 1; y <= Number(to.slice(0, 4)); y++) {
    const d = `${y}-01-01`;
    if (d > from && d < to) out.push(d);
  }
  if (to !== from) out.push(to);
  return out.slice(0, HISTORY_SAMPLE_MAX);
}

function dedupe(docs: readonly EvidenceDoc[]): EvidenceDoc[] {
  const seen = new Set<string>();
  const out: EvidenceDoc[] = [];
  for (const d of docs) {
    const k = d.chunkId !== null ? `c${d.chunkId}` : `${d.sourceId}|${d.path}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}

export async function collectEvidence(req: CopilotRequest, deps: CollectDeps): Promise<CollectResult> {
  const keep = (d: EvidenceDoc | null | undefined, types: readonly string[]): d is EvidenceDoc => !!d && types.includes(d.sourceType) && (d.accessTier !== "premium" || deps.premiumOk);
  try {
    switch (req.kind) {
      case "comparison":
      case "issue_memo": {
        const types = req.kind === "comparison" ? DECISION_TYPES : MEMO_TYPES;
        const found = await Promise.all(req.ids.map((id) => deps.tools.getSource({ sourceId: id, asOf: deps.today })));
        const docs = found.filter((d): d is EvidenceDoc => keep(d, types));
        // 고른 건 중 하나라도 못 읽으면(없음·종류 아님·권한 없음) 일부만 비교하지 않고 멈춘다
        if (docs.length !== req.ids.length) return fail("source_not_found");
        return { ok: true, docs: dedupe(docs) };
      }
      case "history": {
        const lists = await Promise.all(samples(req.from, req.to).map((asOf) => deps.tools.search({ query: req.ref, asOf, limit: 10, docType: "law_article" })));
        const want = norm(req.ref);
        const docs = dedupe(lists.flat().filter((d) => keep(d, ["law_article"]) && norm(d.path).includes(want)));
        if (docs.length === 0) return fail("no_evidence");
        return { ok: true, docs: docs.sort((a, b) => a.validFrom.localeCompare(b.validFrom)) };
      }
      case "publications": {
        const found = (await deps.tools.search({ query: req.ref, asOf: deps.today, limit: 40, docType: "publication" })).filter((d) => keep(d, ["publication"]));
        const allowed = new Set(await deps.summaryAllowed([...new Set(found.map((d) => d.sourceId))]));
        const pubs = dedupe(found.filter((d) => allowed.has(d.sourceId)));
        // 요약 권리가 확인된 출판물이 없으면 요약하지 않는다 (RES-03 · LIB-06)
        if (pubs.length === 0) return fail("no_summarizable_publication");
        const law = await deps.tools.getLawArticle({ ref: req.ref, asOf: deps.today }).catch(() => null);
        return { ok: true, docs: law && keep(law, ["law_article"]) ? [law, ...pubs] : pubs };
      }
    }
  } catch {
    return fail("search_down");
  }
}

/** 모델에게 보이는 도구 상자 - 미리 모은 문서 목록 안에서만 돌려준다. 목록 밖 검색·실시간 조회로 새 문서가 들어올 길이 없다 */
export function restrictedToolbox(docs: readonly EvidenceDoc[]): AgentToolbox {
  // 사용자가 직접 고른(또는 권리·권한으로 걸러 모은) 문서이므로 근거 강도 판정에서 점수 때문에 탈락하지 않게 1 이상으로 둔다
  const pool = docs.map((d) => ({ ...d, score: Math.max(d.score, 1) }));
  return {
    async search() {
      return pool;
    },
    async getLawArticle(a) {
      return pool.find((d) => d.sourceType === "law_article" && norm(d.path).includes(norm(a.ref))) ?? null;
    },
    async getSource(a) {
      return pool.find((d) => d.sourceId === a.sourceId) ?? null;
    },
    async lookupGlossary() {
      return [];
    },
    async suggestActions() {
      return [];
    },
  };
}
