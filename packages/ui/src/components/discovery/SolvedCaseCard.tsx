import { Chip, cx } from "../base";

/** 결론 배지 — 결정례 카드와 같은 의미 색 (인용 emerald / 기각 rose / 각하 navy, PRD-00 8.6). 색에 더해 글자로 뜻을 전한다 (8.9) */
const CONCLUSION = {
  accepted: { label: "인용", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  partial: { label: "일부 인용", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  rejected: { label: "기각", className: "border-rose-200 bg-rose-50 text-rose-800" },
  dismissed: { label: "각하", className: "border-navy-100 bg-navy-50 text-navy-700" },
} as const;

export type SolvedCaseConclusion = keyof typeof CONCLUSION;

/** 결과의 근거 — 결정례 사건번호·해석 번호·조문 (CAT-05: 1개 이상 필수) */
export type SolvedCaseBasis = { label: string; href?: string; external?: boolean };

export type SolvedCaseCardProps = {
  /** 사례 제목 (목록) — 실명 없이 */
  title?: string;
  /** 해결 사례 상세 `/news/[slug]` */
  href?: string;
  situation: string;
  issue: string;
  result: { conclusion: SolvedCaseConclusion; text: string; basis: SolvedCaseBasis[] };
  lesson: string;
};

/** 개인 식별 정보 형식 — 주민등록번호 · 휴대전화/지역 전화번호 · 이메일 (CAT-05 저장 검사와 같은 형식) */
const IDENTIFYING = [/\d{6}-?[1-8]\d{6}/, /\b0\d{1,2}-\d{3,4}-\d{4}\b/, /\b01[016789]\d{7,8}\b/, /[\w.+-]+@[\w-]+\.[\w.-]+/];

function isFilled(text: string | undefined): boolean {
  return typeof text === "string" && text.trim() !== "";
}

/** 칸 이름 — 밝은 바탕 위 작은 주황 글자는 hermes-800 (8.3) */
const STEP_LABEL = "text-[13px] font-bold tracking-wide text-hermes-800";

/**
 * 해결 사례 카드 — 4칸 흐름 상황 → 쟁점 → 결과(결론 배지 · 근거 칩) → 교훈 + 재구성 고지 (PRD-00 8.6, CAT-05)
 * 실명·연락처 칸이 없다. 4칸 중 하나라도 비었거나 근거가 0개이거나 식별 정보 형식이 들어 있으면 렌더하지 않는다
 */
export function SolvedCaseCard({ title, href, situation, issue, result, lesson }: SolvedCaseCardProps) {
  const texts = [title ?? "", situation, issue, result.text, lesson, ...result.basis.map((b) => b.label)];
  if (![situation, issue, result.text, lesson].every(isFilled) || result.basis.length === 0) return null;
  if (texts.some((t) => IDENTIFYING.some((re) => re.test(t)))) return null;

  const conclusion = CONCLUSION[result.conclusion];
  const steps = [
    { label: "상황", body: <p>{situation}</p> },
    { label: "쟁점", body: <p>{issue}</p> },
    {
      label: "결과",
      body: (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span data-conclusion={result.conclusion} className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-bold", conclusion.className)}>
              {conclusion.label}
            </span>
            <span>{result.text}</span>
          </p>
          <ul className="mt-2 flex flex-wrap items-center gap-2" aria-label="근거">
            {result.basis.map((b, i) => (
              <li key={i}>
                {b.href ? (
                  <a
                    href={b.href}
                    className="relative z-10 inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                    {...(b.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    <Chip className="font-mono underline-offset-4 hover:underline">{b.label}</Chip>
                    {b.external && <span className="sr-only"> (새 창)</span>}
                  </a>
                ) : (
                  <Chip className="font-mono">{b.label}</Chip>
                )}
              </li>
            ))}
          </ul>
        </>
      ),
    },
    { label: "교훈", body: <p>{lesson}</p> },
  ];

  return (
    <article data-ui="solved-case-card" className="relative rounded-2xl border border-navy-100 bg-white p-6">
      {title && (
        <h3 className="text-[19px] leading-snug font-black text-navy-900">
          {href ? (
            <a href={href} className="hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
      )}
      <ol aria-label="사례 흐름" className={cx("space-y-4", title && "mt-4")}>
        {steps.map((step) => (
          <li key={step.label} className="border-l-2 border-navy-100 pl-4 text-[16px] leading-relaxed text-navy-800 last:border-hermes-500">
            <p data-step-label className={STEP_LABEL}>
              {step.label}
            </p>
            <div className="mt-1">{step.body}</div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[14px] text-navy-600">개인을 알아볼 수 없도록 내용을 바꿔 다시 구성한 사례입니다.</p>
    </article>
  );
}
