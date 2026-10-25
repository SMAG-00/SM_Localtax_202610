import { selfCalculatorDocs } from "@/lib/calc/tool-cards";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import "server-only";
import { getAmendmentList } from "@/lib/server/public/amendments";
import { getArticleDetail } from "@/lib/server/public/article";
import { isOpenPath } from "@/lib/server/public/constants";
import { publicDb, rowsOf } from "@/lib/server/public/db";
import { readPublicSettings } from "@/lib/server/public/reads";
import { searchSite } from "@/lib/server/public/search";
import { parseSearchParams, type SearchHit } from "@/lib/server/public/search-logic";
import type { Toolbox, SourceDoc } from "@/lib/assistant/pipeline";

// 읽기 전용 도구 구현 (CHAT-03 · CHAT-11) — 모두 공개 뷰·공개 키(anon)로만 읽는다. 쓰기 0, service role 0.
// 초안·비공개·권리 미확인 콘텐츠는 공개 읽기 정책이 이미 걸러 준다(search_public · 공개 뷰).

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function hitText(h: SearchHit): string {
  const parts = [h.title, h.snippet ?? ""];
  if (h.kind === "tracker") parts.push(`현재 단계 ${h.stage ?? "기록 없음"}${h.stageOn ? ` (${h.stageOn})` : ""}`);
  if (h.kind === "project") parts.push(`현재 단계 ${h.stageLabel ?? "기록 없음"}${h.stageOn ? ` (${h.stageOn})` : ""}`);
  return clip(parts.filter(Boolean).join(" "), 600);
}

/** 본문 블록에서 글자만 모은다 (요약용) */
function collectText(node: unknown, out: string[], budget = { n: 4000 }): void {
  if (budget.n <= 0 || node === null || node === undefined) return;
  if (typeof node === "string") return;
  if (Array.isArray(node)) {
    for (const x of node) collectText(x, out, budget);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "text" && typeof v === "string") {
        out.push(v);
        budget.n -= v.length;
      } else collectText(v, out, budget);
    }
  }
}

export function createToolbox(): Toolbox {
  return {
    async searchSite(query, limit) {
      const result = await searchSite(parseSearchParams({ q: query }), { perKind: Math.max(1, Math.min(limit, 5)) });
      return result.items
        .filter((h) => h.href !== null)
        .slice(0, limit)
        .map((h): SourceDoc => ({ title: h.title, url: h.href as string, text: hitText(h) }));
    },

    async getPage(path) {
      const m = /^\/news\/([^/?#]+)$/u.exec(path);
      if (!m) return null; // 기사 상세만 본문을 읽는다 — 그 밖의 주소는 맥락 없이 답한다 (CHAT-06)
      const detail = await getArticleDetail(decodeURIComponent(m[1]!));
      if (!detail) return null;
      const text: string[] = [detail.summary];
      collectText(detail.blocks, text);
      return { title: detail.title, url: `/news/${detail.slug}`, text: clip(text.join("\n"), 4000) };
    },

    async getStatus(query) {
      const list = await getAmendmentList();
      if (!list) return { docs: [], facts: [], vocabulary: [] };
      const terms = query.split(/\s+/u).filter((t) => t.length >= 2);
      const matched = list.items.filter((i) => terms.some((t) => i.title.includes(t) || i.lawNames.some((l) => l.includes(t)))).slice(0, 5);
      const picked = matched.length > 0 ? matched : list.items.slice(0, 3);
      const withStage = picked.filter((i) => i.state.current !== null);
      return {
        docs: picked.map((i) => ({
          title: i.title,
          url: i.href,
          text: `${i.title} 현재 단계 ${i.state.current ? i.state.label : "기록 없음"}${i.state.currentOn ? ` 확인일 ${i.state.currentOn}` : ""}`,
        })),
        facts: withStage.map((i) => ({ name: i.title, stage: i.state.label })),
        vocabulary: [...new Set(list.items.filter((i) => i.state.current !== null).map((i) => i.state.label))],
      };
    },

    async getOfficialLinks(keys) {
      if (keys.length === 0) return [];
      const rows = await rowsOf<{ key: string; label: string; url: string | null; terms_note: string | null }>(
        publicDb().from("official_links").select("key, label, url, terms_note").in("key", [...keys]).eq("active", true),
        "도우미 바깥 연결",
      );
      // 자체 계산기가 열린 세목은 SM 카드 대신 사이트 안 주소 하나(세목마다 카드 1장, TX-04) - 금액은 도우미가 만들지 않는다
      const tools = await getCalcTools().catch(() => null);
      const self = tools ? selfCalculatorDocs(tools.context) : {};
      const byKey = new Map(rows.filter((r) => r.url).map((r) => [r.key, { title: r.label, url: r.url as string, text: `${r.label}${r.terms_note ? ` — ${r.terms_note}` : ""}` }]));
      return keys.flatMap((k) => {
        const doc = self[k] ?? byKey.get(k);
        return doc ? [doc] : [];
      });
    },

    async openPaths(paths) {
      const { features } = await readPublicSettings();
      return paths.filter((p) => isOpenPath(p, features));
    },
  };
}

/** 전문가 버튼이 열려 있는가 — [SM 전문가 보기]는 expert_finder, [연락 받기]는 W7c가 더하는 키 expert_requests (설계 12장 #6) */
export async function expertAvailability(): Promise<{ find: boolean; request: boolean }> {
  const { features } = await readPublicSettings();
  const f = features as unknown as Record<string, boolean | undefined>;
  return { find: f.expert_finder === true, request: f.expert_requests === true };
}
