import type { TaxLensView } from "@/lib/server/public/article-logic";
import { ACQUISITION_QUESTIONS } from "./acquisition";
import { encodeHash, parseHash } from "./hash";
import { HOLDING_QUESTIONS } from "./holding";
import type { Question } from "./shared";
import { toolLinkFor, type ToolContext } from "./tool-link";

// 기사 -> 도구 지정 (GROW-02) - 편집자가 고른 도구와 미리 채울 값을 검사하고, 독자에게는 공개 게이트를 따른 주소(toolLinkFor)로 바꿔 준다.
// 미리 채울 값은 URL 해시(#)로만 넘어가 서버·이벤트에 남지 않는다. 게이트가 닫힌 도구는 자체 주소가 아니라 허브(/calc)로 보낸다(허브가 SM 카드를 낸다).

export const TARGET_TOOLS = ["acquisition", "holding", "refund"] as const;
export type TargetTool = (typeof TARGET_TOOLS)[number];
export const HUB_HREF = "/calc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function questionsOf(tool: TargetTool): readonly Question<any>[] {
  return tool === "acquisition" ? ACQUISITION_QUESTIONS : tool === "holding" ? HOLDING_QUESTIONS : [];
}

export interface ToolTargetInput {
  articleId: number;
  tool: TargetTool;
  prefill: Record<string, unknown>;
}

/** 편집자 입력(줄마다 `칸=값`)을 검사한다 - 모르는 칸·질문 종류에 안 맞는 값은 오류로 알려 준다(조용히 버리지 않는다). 환급 진단은 미리 채울 값이 없다 */
export function parseToolTarget(input: { articleId: unknown; tool: unknown; prefillText: unknown }): { ok: true; value: ToolTargetInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const articleId = Number(input.articleId);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) errors.push("articleId: 기사 번호를 확인하세요");
  const tool = TARGET_TOOLS.find((t) => t === input.tool);
  if (!tool) errors.push("tool: 취득세·재산세·환급 진단 중 하나");
  const text = typeof input.prefillText === "string" ? input.prefillText : "";
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length > 12) errors.push("prefill: 12줄 이하");
  const pairs = lines.map((l) => l.split("=", 2) as [string, string | undefined]);
  const bad = pairs.filter(([, v]) => v === undefined || v === "").map(([k]) => k);
  if (bad.length) errors.push(`prefill: 값이 없는 줄 (${bad.join(", ")})`);
  if (!tool) return { ok: false, errors };
  const usable = pairs.filter(([, v]) => v !== undefined && v !== "") as [string, string][];
  const parsed = parseHash(`#${new URLSearchParams(usable).toString()}`, questionsOf(tool));
  const rejected = usable.map(([k]) => k).filter((k) => !(k in parsed.values));
  if (rejected.length) errors.push(`prefill: 이 도구의 질문 칸이 아니거나 값이 맞지 않는 줄 (${[...new Set(rejected)].join(", ")})`);
  if (tool === "refund" && usable.length) errors.push("prefill: 환급 진단은 미리 채울 값이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { articleId, tool, prefill: parsed.values } };
}

/** 독자에게 보일 주소 - 자체 계산기가 열려 있으면 미리 채운 값을 해시로 단 자체 주소, 아니면 허브 */
export function targetHref(tool: TargetTool, prefill: Record<string, unknown>, ctx: ToolContext): string {
  const link = toolLinkFor(tool, null, ctx);
  if (link.kind !== "self") return HUB_HREF;
  return `${link.href}${tool === "refund" ? "" : encodeHash(tool, null, prefill, questionsOf(tool))}`;
}

/** 「지방세로 읽기」 상자의 계산기 링크를 지정한 도구 주소로 - 지정이 없으면(허브 주소) 그대로 둔다 */
export function applyToolHref(lens: TaxLensView | null, href: string): TaxLensView | null {
  if (!lens || href === HUB_HREF) return lens;
  return { ...lens, links: lens.links.map((l) => (l.kind === "calculator" ? { ...l, href, external: false } : l)) };
}
