import type { ReactNode } from "react";

// 브리핑 호 화면 (W10-e) - SM 호 쪽의 구성을 우리 색 체계로 옮긴 서버 부품. 구조·배치만 옮기고 글·색 값은 쓰지 않는다.
//  단 한 줄 폭(780px) 카드 지면: 제호 패널(차례 포함) -> 보라 "한눈에" -> 코너별 파스텔 패널(코너 묶음마다 색) 안의 흰 항목 카드 -> 계산해 보기 카드.
//  표지(시행·시행 전·해석·취소/경정·기각)는 색만이 아니라 글자도 함께 보인다. 원문 발췌는 비공개 칸이라 여기 없다.
export interface ViewItem {
  id: string;
  text: string;
  sourceUrl?: string;
  badge?: "live" | "plan" | "expc" | "win" | "lose";
  badgeLabel?: string;
  tags?: string[];
  meta?: string[];
}
export interface ViewCorner {
  key: string;
  title: string;
  items: ViewItem[];
  emptyNote?: string;
}

const BADGE_CLASS: Record<NonNullable<ViewItem["badge"]>, string> = {
  live: "border-navy-900 bg-navy-900 text-white",
  plan: "border-dashed border-navy-400 bg-white text-navy-900",
  expc: "border-sky-200 bg-sky-50 text-sky-900",
  win: "border-emerald-200 bg-emerald-50 text-emerald-900",
  lose: "border-rose-200 bg-rose-50 text-rose-800",
};
const BADGE_DEFAULT_LABEL: Record<NonNullable<ViewItem["badge"]>, string> = { live: "시행", plan: "시행 전", expc: "해석", win: "취소·경정", lose: "기각" };

/** 코너 묶음별 패널 색과 표제(kicker) - SM의 하늘(지방세 원문)·민트(사례)·노랑(날짜) 배치를 따른다 */
const SKY = { panel: "border-sky-200 bg-sky-50", kicker: "border-sky-200 text-sky-900", kickerText: "지방세 원문" } as const;
const GROUP: Record<string, { panel: string; kicker: string; kickerText: string }> = {
  laws: SKY,
  amendments: SKY,
  admrul: SKY,
  interpretations: SKY,
  tribunal: SKY,
  summary: { panel: "border-emerald-200 bg-emerald-50", kicker: "border-emerald-200 text-emerald-900", kickerText: "쉬운 요약" },
  dates: { panel: "border-amber-200 bg-amber-50", kicker: "border-amber-200 text-amber-900", kickerText: "일정" },
};
const FALLBACK = { panel: "border-navy-100 bg-navy-50", kicker: "border-navy-100 text-navy-900", kickerText: "브리핑" };

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400";

function Chips({ item }: { item: ViewItem }) {
  if (!item.badge && !item.tags?.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5" data-testid="brief-chips">
      {item.badge && (
        <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[13px] font-bold ${BADGE_CLASS[item.badge]}`}>{item.badgeLabel?.trim() || BADGE_DEFAULT_LABEL[item.badge]}</span>
      )}
      {item.tags?.map((t) => (
        <span key={t} className="inline-flex min-h-6 items-center rounded-full border border-navy-100 bg-navy-50 px-2.5 text-[13px] text-navy-700">
          {t}
        </span>
      ))}
    </p>
  );
}

function ItemCard({ item }: { item: ViewItem }) {
  return (
    <article className="min-w-0 space-y-2 rounded-xl border border-white bg-white p-4 shadow-sm" data-item={item.id}>
      <Chips item={item} />
      <p className="text-[16px] leading-relaxed break-words text-navy-900">{item.text}</p>
      {(item.meta?.length || item.sourceUrl) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-navy-600">
          {item.meta?.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {item.sourceUrl && (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-6 items-center font-bold text-navy-900 underline ${focus}`}>
              원문 보기<span className="sr-only"> (새 창)</span>
            </a>
          )}
        </p>
      )}
    </article>
  );
}

/** 이번 주 한눈에 - 보라 카드, 줄마다 흰 칸 */
function Glance({ corner }: { corner: ViewCorner }) {
  return (
    <section id={corner.key} aria-labelledby={`h-${corner.key}`} data-corner={corner.key} className="scroll-mt-20 rounded-2xl border border-violet-200 border-t-4 border-t-violet-400 bg-violet-50 p-5 shadow-sm">
      <h2 id={`h-${corner.key}`} className="text-[20px] font-black text-violet-900">
        {corner.title}
      </h2>
      {corner.items.length === 0 ? (
        <p className="mt-2 text-[15px] text-navy-700">{corner.emptyNote}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {corner.items.map((it, i) => (
            <li key={it.id} className="rounded-xl border border-violet-200 bg-white px-4 py-3 text-[16px] leading-relaxed text-navy-900">
              <span className="mr-2 font-black text-violet-900">{i + 1}</span>
              {it.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function IssueView({ corners, masthead, children }: { corners: ViewCorner[]; masthead?: ReactNode; children?: ReactNode }) {
  const glance = corners.find((c) => c.key === "editor_notes");
  const rest = corners.filter((c) => c.key !== "editor_notes");
  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-navy-100 bg-navy-50 p-5 sm:p-6">
        {masthead}
        <nav aria-label="이번 호 차례" className="mt-4">
          <ol className="flex flex-wrap gap-2">
            {corners.map((c) => (
              <li key={c.key}>
                <a href={`#${c.key}`} className={`inline-flex min-h-11 items-center rounded-full border border-navy-100 bg-white px-4 text-[14px] font-bold text-navy-900 ${focus}`}>
                  {c.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>
      {glance && <Glance corner={glance} />}
      {rest.map((c) => {
        const g = GROUP[c.key] ?? FALLBACK;
        return (
          <section key={c.key} id={c.key} aria-labelledby={`h-${c.key}`} data-corner={c.key} className={`scroll-mt-20 space-y-3 rounded-2xl border p-5 ${g.panel}`}>
            <header className="grid justify-items-start gap-1.5">
              <span className={`rounded-md border bg-white px-2.5 py-1 text-[12px] font-bold tracking-wide ${g.kicker}`}>{g.kickerText}</span>
              <h2 id={`h-${c.key}`} className="text-[20px] font-black text-navy-900">
                {c.title}
                <span className="ml-2 text-[14px] font-normal text-navy-600">{c.items.length}건</span>
              </h2>
            </header>
            {c.items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-navy-200 bg-white px-4 py-3 text-[15px] text-navy-600">{c.emptyNote}</p>
            ) : (
              <div className="space-y-3">
                {c.items.map((it) => (
                  <ItemCard key={it.id} item={it} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      <aside aria-label="계산해 보기" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5" data-testid="brief-calc-card">
        <h2 className="text-[18px] font-black text-navy-900">계산해 보기</h2>
        <p className="mt-1 text-[15px] text-navy-700">내 상황에 맞는 지방세 계산기로 이동합니다. 이 호에는 금액이나 계산 예시가 없습니다.</p>
        <a href="/calc" className={`mt-3 inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 text-[15px] font-bold text-white ${focus}`}>
          계산기 열기
        </a>
      </aside>
      {children}
    </div>
  );
}
