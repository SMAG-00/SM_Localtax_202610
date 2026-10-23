// PR-13 법안 상태를 다룬 기사 (01B W4 20단계 뒷부분 — docs/dev/W4_설계.md 1장 20단계 · 11.20 · 12장 #169)
// DB 트리거(마이그레이션 20261023000054 bill_status_publish_problem)와 같은 규칙을 발행 서비스 쪽에서 한 번 더 본다.
//  · 기사가 '법안 상태를 다룸'(coversBillStatus)이면 공식 자료 출처(official_doc·dataset) 중 출처 주소와 확인일이 모두 있는 것이 1건 이상이어야 발행된다
//  · 표시가 꺼진 기사는 이 검사가 아무것도 하지 않는다
import { finding, type Finding } from "../findings";
import { OFFICIAL_SOURCE_KINDS, type ArticleForPublish } from "../model";
import { isBlank } from "../text";

/** 법안 상태 기사의 빠진 것 — 문제 없으면 null (DB bill_status_publish_problem과 같은 규칙) */
export function billStatusProblem(article: ArticleForPublish): { missing: string[] } | null {
  if (article.coversBillStatus !== true) return null;
  const official = article.sources.filter((s) => (OFFICIAL_SOURCE_KINDS as readonly string[]).includes(s.kind));
  if (official.some((s) => !isBlank(s.url) && !isBlank(s.accessedAt))) return null;
  if (official.length === 0) return { missing: ["공식 자료 출처"] };
  return {
    missing: [official.some((s) => isBlank(s.url)) ? "출처 주소" : "", official.some((s) => isBlank(s.accessedAt)) ? "확인일" : ""].filter((x) => x !== ""),
  };
}

export function checkBillStatus(article: ArticleForPublish): Finding[] {
  const problem = billStatusProblem(article);
  if (!problem) return [];
  return [
    finding(
      "pr13.bill-status-source",
      `법안 상태를 다룬 기사는 출처 주소와 확인일이 있는 공식 자료 출처가 1건 이상 있어야 발행됩니다 — 빠진 것: ${problem.missing.join("·")} (PR-13 · REG1-13)`,
      { field: "coversBillStatus" },
    ),
  ];
}
