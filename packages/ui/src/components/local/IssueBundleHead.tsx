import type { ReactNode } from "react";
import { Chip, Eyebrow } from "../base";
import { filled } from "./dates";

/** 4대 분야 */
export type IssueField = "지방세·부동산세금" | "부동산재테크" | "부동산금융" | "지자체뉴스";
const FIELD_ORDER: readonly IssueField[] = ["지방세·부동산세금", "부동산재테크", "부동산금융", "지자체뉴스"];

export type IssueArticle = {
  id: string;
  field: IssueField;
  /** 기사 카드 (분야 칩·기사 유형 배지가 있는 카드를 바깥에서 넣는다) */
  card: ReactNode;
  /** 편집자 승인 기록 — 승인자·시각·관계 이유가 모두 있어야 공개된다 */
  approval?: { by: string; at: string; reason: string };
};

export type IssueBundleHeadProps = {
  title: string;
  summary: string;
  articles: IssueArticle[];
  /** 「지방세로 읽기」 박스 1개 */
  taxLens: ReactNode;
};

const MIN_FIELDS = 2;

function approved(a: IssueArticle): boolean {
  return !!a.approval && filled(a.approval.by) && filled(a.approval.at) && filled(a.approval.reason);
}

/**
 * 이슈 묶음 머리 — 아이브로 ISSUE + 편집자 제목·요약 + 분야별 기사 카드 목록 + 「지방세로 읽기」 박스 1개.
 * 편집자가 승인한 관계만 오르고, 승인된 기사가 서로 다른 분야 2개 미만이면 그리지 않는다 (CORE-04)
 */
export function IssueBundleHead({ title, summary, articles, taxLens }: IssueBundleHeadProps) {
  const shown = articles.filter(approved);
  const groups = FIELD_ORDER.map((field) => ({ field, items: shown.filter((a) => a.field === field) })).filter((g) => g.items.length > 0);
  if (groups.length < MIN_FIELDS) return null;

  return (
    <div data-ui="issue-bundle-head">
      <header>
        <Eyebrow>ISSUE</Eyebrow>
        <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">{title}</h1>
        <p className="mt-3 text-[17px] text-navy-600">{summary}</p>
      </header>
      <div className="mt-10 space-y-10">
        {groups.map((g) => (
          <section key={g.field} data-issue-field={g.field} aria-label={`${g.field} 기사`}>
            <h2>
              <Chip>{g.field}</Chip>
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((a) => (
                <li key={a.id}>{a.card}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-10">{taxLens}</div>
    </div>
  );
}
