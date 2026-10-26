import { UiLink } from "@ltr/ui";
import { MeasureView } from "../Measure";
import { getGuideBody, getPlacedGuides } from "@/lib/server/public/tax-guide";
import type { PlacementSurface } from "@/lib/tax-guide/placements";
import { SiteSection } from "../SiteSection";

// 배치된 가이드 상자 (W11-c c2·c3·c5·c6·c9 - TRU-01·02 · RDV-01·03 · DF-08). 원고는 public_guides 한 곳에서만 읽고, 이 상자는 화면 위치만 정한다.
//  · 서명 전·기능 키 꺼짐·배치 없음이면 null (빈 상자·"준비 중" 0).
//  · 국세/지방세 배지·최종 감수일·근거 칩 누락 0. 국세 상자는 해설과 공식 링크만 - 금액 계산 0.

export const SCOPE_LABEL = { local: "지방세", national: "국세", both: "국세·지방세" } as const;
const LINK = "inline-flex min-h-11 items-center font-bold text-navy-900 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

const SURFACE_SECTION = { trust_type: "finance", finance_tax_hub: "finance", dev_method: "realestate", stage: "realestate", situation: "tax" } as const;

export async function PlacedGuides({
  surface,
  targetKey,
  heading,
  tone = "ivory-dark",
  id,
}: {
  surface: PlacementSurface;
  targetKey: string;
  heading: { eyebrow: string; title: string };
  tone?: "ivory" | "ivory-dark";
  id: string;
}) {
  const placed = await getPlacedGuides(surface, targetKey);
  if (placed.length === 0) return null;
  const bodies = (await Promise.all(placed.map((p) => getGuideBody(p)))).filter((b): b is NonNullable<typeof b> => b !== null);
  if (bodies.length === 0) return null;
  return (
    <SiteSection id={id} tone={tone} heading={heading} data={{ "data-part": "tax-guides", "data-guide-surface": surface }}>
      <div className="mt-6 grid gap-6">
        {bodies.map((g) => (
          <article key={g.slug} data-guide-slug={g.slug} data-guide-version={String(g.version)} data-guide-hash={g.bodySha256} className="rounded-2xl border border-navy-100 bg-white p-5">
            <MeasureView name="guide_viewed" section={SURFACE_SECTION[surface]} props={{ hub: g.hub, topic: g.topic, tax_scope: g.taxScope }} />
            <div className="flex flex-wrap items-center gap-3">
              <span data-part="scope-badge" className="rounded-full border border-navy-200 px-3 py-1 text-[13px] font-bold text-navy-700">
                {SCOPE_LABEL[g.taxScope]}
              </span>
              <h3 className="text-[20px] font-black text-navy-900">{g.title}</h3>
            </div>
            {g.lastReviewedOn && (
              <p data-part="reviewed-on" className="mt-2 text-[13px] text-navy-600">
                최종 감수일 {g.lastReviewedOn}
                {g.asOf ? ` · 기준일 ${g.asOf}` : ""}
              </p>
            )}
            {g.taxScope !== "local" && (
              <p data-part="national-note" className="mt-2 text-[13px] text-navy-600">
                국세는 해설과 공식 링크만 안내하며 금액을 계산하지 않습니다.
              </p>
            )}
            {g.sections.map((s) => (
              <section key={s.heading} className="mt-4">
                <h4 className="text-[16px] font-bold text-navy-900">{s.heading}</h4>
                <p className="mt-1 max-w-2xl text-[16px] whitespace-pre-line text-navy-800">{s.body}</p>
              </section>
            ))}
            {g.sources.length > 0 && (
              <ul data-part="source-chips" className="mt-4 flex flex-wrap gap-3" aria-label="근거">
                {g.sources.map((s) => (
                  <li key={s.label} className="rounded-full bg-ivory px-3 py-1 text-[13px] text-navy-800">
                    {s.url ? (
                      <UiLink href={s.url} className={LINK}>
                        {s.label}
                      </UiLink>
                    ) : (
                      s.label
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </SiteSection>
  );
}
