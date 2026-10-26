import { UiLink } from "@ltr/ui";
import { ArticleItem } from "../ArticleItem";
import { SiteSection } from "../SiteSection";
import { availableTypeIds, getDeterminationBundle, getStageEntries, getTrustArticles } from "@/lib/server/public/tax-guide";
import { getIssueIndex } from "@/lib/server/public/issues";
import { PROJECT_TAX_TYPES, type ProjectTaxKind } from "@/lib/tax-guide/determination-run";

// 세금 칸 부품 (W11-c c2·c5·c6 - TRU-01 · RDV-01·02 · PR-12). 모두 서명·기능 키가 갖춰졌을 때만 그린다 - 버튼도 "준비 중"도 없다.
const LINK = "inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 판정 진입 링크 - 활성 판정표가 있는 종류가 하나라도 있을 때만 */
export async function DeterminationEntry({ href, label, typeIds }: { href: string; label: string; typeIds: readonly string[] }) {
  const kinds = [...new Set(PROJECT_TAX_TYPES.filter((t) => typeIds.includes(t.id)).map((t) => t.kind))];
  const bundle = await getDeterminationBundle(kinds);
  if (availableTypeIds(bundle, typeIds).length === 0) return null;
  return (
    <p data-part="determination-entry" className="mt-4">
      <UiLink href={href} className={LINK}>
        {label}
      </UiLink>
    </p>
  );
}

/** 판정 종류 하나로 정해지는 ?type= (한 판정표를 여러 종류가 나눠 쓰면 비워 두고 화면에서 고르게 한다) */
export function entryTypeFor(kind: ProjectTaxKind): string | null {
  const ts = PROJECT_TAX_TYPES.filter((t) => t.kind === kind);
  return ts.length === 1 ? ts[0]!.id : null;
}

/** 신탁 유형 페이지 세금 칸의 판정 진입 (TRU-01·03) */
export async function TrustJudgmentEntry() {
  return <DeterminationEntry href="/calc/trust-taxpayer" label="신탁 보유세 납세의무자 판정 보기" typeIds={["trust_holding"]} />;
}

/** 개발방법 페이지 단계 타임라인 (RDV-02) - 1단계 표준 단계 사전의 단계 값 그대로, 단계마다 주요 내용과 단계 페이지 링크 */
export async function StageTimeline({ methodSlug, projectTypes }: { methodSlug: string; projectTypes: readonly string[] }) {
  const entries = await getStageEntries(projectTypes);
  if (entries.length === 0) return null;
  return (
    <SiteSection id="dev-method-timeline" tone="ivory" heading={{ eyebrow: "정비 세금", title: "사업 단계별 지방세" }} data={{ "data-part": "stage-timeline" }}>
      <ol className="mt-6 grid gap-3">
        {entries.map((e) => (
          <li key={`${e.projectType}-${e.stage}`} data-stage={e.stage} className="rounded-2xl border border-navy-100 bg-white p-4">
            <UiLink href={`/realestate/development-methods/${methodSlug}/steps/${e.stage}`} className={LINK}>
              {e.position}. {e.stageLabel}
            </UiLink>
            {e.topics.length > 0 && <p className="text-[13px] text-navy-600">{e.topics.join(" · ")}</p>}
          </li>
        ))}
      </ol>
    </SiteSection>
  );
}

/** 관련 쟁점 연결 지도 링크 (LINK-01) - 키 issue_graph가 켜져 있고 그 허브에 공개 지도가 있을 때만 */
export async function IssueMapEntry({ hub }: { hub: "trust" | "redevelopment" | "inheritance_gift" }) {
  const view = await getIssueIndex(hub);
  if (!view || view.items.length === 0) return null;
  return (
    <p data-part="issue-map-entry" className="mt-4">
      <UiLink href={`/realestate/issues?hub=${hub}&from=guide`} className={LINK}>
        관련 쟁점 연결 지도 보기
      </UiLink>
    </p>
  );
}

/** 신탁 유형 페이지 최신 글 목록 (TRU-06) - 글이 없으면 상자를 그리지 않는다 */
export async function TrustArticles() {
  const items = await getTrustArticles();
  if (items.length === 0) return null;
  return (
    <SiteSection id="finance-structure-articles" tone="ivory" heading={{ eyebrow: "신탁 실무", title: "신탁 칼럼·사례 최신 글" }} data={{ "data-part": "trust-articles" }}>
      <ul className="mt-6 grid gap-4">
        {items.map((item) => (
          <li key={item.id}>
            <ArticleItem item={item} />
          </li>
        ))}
      </ul>
    </SiteSection>
  );
}
