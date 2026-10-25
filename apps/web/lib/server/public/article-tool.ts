import "server-only";
import { HUB_HREF, targetHref, TARGET_TOOLS, type TargetTool } from "@/lib/calc/tool-target";
import { getCalcTools } from "./calc-tools";
import { publicDb, rowsOf } from "./db";

// 기사 -> 도구 주소 (GROW-02) - 편집자가 지정한 도구가 있고 공개 게이트가 열려 있으면 미리 채운 값이 해시로 달린 자체 주소, 아니면 허브(/calc).
// 읽지 못해도 기사 화면은 그대로 - 허브 주소로 대신한다. 입력값·결과값은 어디에도 없다(편집자가 고른 예시 값만).
export async function resolveArticleTool(articleId: number): Promise<string> {
  try {
    const rows = await rowsOf<{ tool: string; prefill: Record<string, unknown> }>(
      publicDb().from("public_article_tool_targets").select("tool, prefill").eq("article_id", articleId).limit(1),
      "기사 도구 지정",
    );
    const row = rows[0];
    const tool = TARGET_TOOLS.find((t): t is TargetTool => t === row?.tool);
    if (!row || !tool) return HUB_HREF;
    const tools = await getCalcTools();
    return tools ? targetHref(tool, row.prefill ?? {}, tools.context) : HUB_HREF;
  } catch {
    return HUB_HREF;
  }
}
