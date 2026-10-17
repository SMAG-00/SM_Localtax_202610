// 발행 게이트 (OPT-03) — 차단 항목이 남으면 발행 API는 422와 실패 항목 이름을 돌려준다. 경고는 막지 않고 발행 기록에 남긴다.
import type { LintResult, PublishDecision } from "./types";

export function publishDecision(result: Pick<LintResult, "items">): PublishDecision {
  const failed = result.items.filter((i) => i.level === "block").map((i) => i.name);
  const warnings = result.items.filter((i) => i.level === "warn").map((i) => i.id);
  const allowed = failed.length === 0;
  return { allowed, httpStatus: allowed ? 200 : 422, failed, warnings };
}
