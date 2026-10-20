import type { Metadata } from "next";
import { PolicyEditor } from "@/components/admin/PolicyEditor";
import { EmptyNote, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { canEditPolicy, parsePolicyBody, POLICY_SKELETON } from "@/lib/policy/docs";
import { hasEmailShape } from "@/lib/policy/email";
import { publishWarnings } from "@/lib/policy/docs";
import { readSetting } from "@/lib/server/admin/backoffice";
import { listVersions, summarize } from "@/lib/server/admin/policies";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { check } from "@/lib/access";
import { parseFeatures } from "@/lib/server/public/settings";

// 정책 페이지 (/admin/pages, W2-e 6.2) — 문서 9종 목록 · 초안 편집 · 게시 승인. 빈 문서에는 항목 이름 뼈대만 보이고 문장은 채워 두지 않는다.
export const metadata: Metadata = { title: "정책 페이지" };

export default async function PoliciesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "policy.edit");
  const db = serviceDb();
  const [rows, flags, forbidden] = await Promise.all([listVersions(db), readSetting(db, "feature_flags"), readSetting(db, "forbidden_phrases")]);
  const phrases = ((forbidden?.value as { phrases?: unknown } | null)?.phrases as unknown[] | undefined)?.filter((p): p is string => typeof p === "string") ?? [];
  const list = summarize(rows, parseFeatures(flags?.value) as unknown as Record<string, boolean>).filter((d) => canEditPolicy(d.docKey, viewer));
  const canPublish = check(viewer, "policy.publish").allowed;
  return (
    <>
      <PageTitle title="정책 페이지" description="게시본이 없는 문서는 공개되지 않고 링크도 나오지 않습니다. 문장은 법률 검토를 거쳐 사람이 씁니다 — 게시에는 승인 기록이 필요합니다." />
      {list.length === 0 && <EmptyNote>고칠 수 있는 문서가 없습니다.</EmptyNote>}
      <div className="space-y-6">
        {list.map((d) => {
          const draft = rows.find((r) => r.doc_key === d.docKey && r.status === "draft");
          const warnings = draft ? publishWarnings(parsePolicyBody(d.draftText), phrases, hasEmailShape) : [];
          const next = Math.max(0, ...rows.filter((r) => r.doc_key === d.docKey).map((r) => r.version)) + 1;
          return (
            <Panel
              key={d.docKey}
              id={`policy-${d.docKey}`}
              title={d.label}
              description={
                <span className="flex flex-wrap gap-2" data-part="status">
                  <ToneChip tone={d.publishedVersion ? "emerald" : "plain"}>{d.publishedVersion ? `게시 버전 ${d.publishedVersion}` : "게시본 없음"}</ToneChip>
                  <ToneChip tone={d.featureOn ? "emerald" : "plain"}>{`기능 키 ${d.featureKey} ${d.featureOn ? "켜짐" : "꺼짐"}`}</ToneChip>
                  <ToneChip tone={d.publishable ? "emerald" : "amber"}>{d.publishable ? "공개 가능" : "공개 불가"}</ToneChip>
                  {d.hasDraft && <ToneChip tone="navy">초안 있음</ToneChip>}
                  {d.publishedAt && <span>게시일 {d.publishedAt.slice(0, 10)}</span>}
                  {d.effectiveOn && <span>시행일 {d.effectiveOn}</span>}
                </span>
              }
            >
              <PolicyEditor
                docKey={d.docKey}
                initialText={d.draftText}
                initialEffectiveOn={d.draftEffectiveOn ?? ""}
                draftVersion={d.draftVersion}
                nextVersion={next}
                canPublish={canPublish}
                warnings={warnings}
                skeleton={[...(POLICY_SKELETON[d.docKey] ?? [])]}
              />
            </Panel>
          );
        })}
      </div>
    </>
  );
}
