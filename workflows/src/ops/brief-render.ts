// 브리핑 호 본문 -> 메일 글·웹 데이터 (W10-e - BRIEF-01 · BRIEF-02). 순수 함수.
// 하단(면책·무단수집 거부 안내·광고/제휴 안내 링크)은 settings.brief_publish_policy 칸에서만 오고 이 파일에 문구는 없다.
import type { BriefCorner, BriefDoc } from "./brief-checkers.ts";

export interface MailFooter {
  disclaimer: string;
  noHarvestNotice: string;
  adInfoUrl: string;
}

/** 메일 본문 글 - 코너별 항목, 하단 안내, 수신 거부 링크. 하단 칸이 비어 있으면 빈 줄을 만들지 않고 건너뛴다(그 호는 검사기에서 이미 막힌다) */
export function renderIssueText(input: { title: string; corners: readonly BriefCorner[]; footer: MailFooter; webUrl: string; unsubscribeUrl: string }): string {
  const lines: string[] = [input.title, ""];
  for (const c of input.corners) {
    lines.push(`■ ${c.title}`);
    if (c.items.length === 0) lines.push(c.emptyNote?.trim() ?? "");
    for (const it of c.items) {
      lines.push(`- ${it.text}`);
      if (it.sourceUrl) lines.push(`  ${it.sourceUrl}`);
    }
    lines.push("");
  }
  lines.push(`웹에서 보기: ${input.webUrl}`, "");
  for (const t of [input.footer.disclaimer, input.footer.noHarvestNotice]) if (t.trim() !== "") lines.push(t.trim());
  if (input.footer.adInfoUrl.trim() !== "") lines.push(`광고·제휴 안내: ${input.footer.adInfoUrl.trim()}`);
  lines.push("", `수신 거부: ${input.unsubscribeUrl}`);
  return lines.join("\n");
}

/** 호 번호의 웹 주소 조각 - 발행 시각의 한국 날짜 (YYYY-MM-DD) */
export function issueSlug(publishAt: Date): string {
  return new Date(publishAt.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export const issueDocOf = (doc: Pick<BriefDoc, "title" | "corners">) => ({ title: doc.title, corners: doc.corners });
