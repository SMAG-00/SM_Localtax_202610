import { Eyebrow } from "@ltr/ui";
import { readPublicSettings } from "@/lib/server/public/reads";
import { getHomeSolvedCases } from "@/lib/server/public/solved-cases";
import { TrackedLink } from "./MeasureShortcut";

// 홈 해결 사례 (W13-h HOME-11) - 상담 사례 HOT 구역 문법의 카드 줄. 기능 키 solved_cases가 꺼져 있거나 승인된 사례가 0건이면 렌더 0.
// 켜짐·동의·승인 판정은 공개 뷰가 한다. 읽기에 실패해도 홈은 그대로 나간다(블록만 빠짐). 카드에 실명·식별 정보 0, 원 Q&A 링크.
export async function SolvedCasesSlot() {
  // 기능 키를 먼저 본다(공개 설정은 요청 안에서 한 번만 읽고 30초 캐시) - 꺼져 있으면 추가 조회 0
  const settings = await readPublicSettings().catch(() => null);
  if (!settings?.features.solved_cases) return null;
  const cards = await getHomeSolvedCases().catch(() => []);
  if (cards.length === 0) return null;
  return (
    <section data-home-section="solved_cases" aria-labelledby="home-solved-cases-title" className="border-t border-navy-100 bg-ivory">
      <div className="mx-auto max-w-5xl px-4 py-20">
        <Eyebrow>SOLVED CASES</Eyebrow>
        <h2 id="home-solved-cases-title" className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">
          해결 사례
        </h2>
        <ul data-part="solved-cases" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id}>
              <article data-part="solved-case-card" data-case-id={c.id} className="h-full rounded-2xl border border-navy-100 bg-white p-6">
                <p className="text-[13px] font-bold text-navy-600">{c.taxType}</p>
                <dl className="mt-3 space-y-2 text-[15px] leading-relaxed text-navy-800">
                  <div>
                    <dt className="font-bold text-navy-900">상황</dt>
                    <dd className="[overflow-wrap:anywhere]">{c.situation}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-navy-900">쟁점</dt>
                    <dd className="[overflow-wrap:anywhere]">{c.issue}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-navy-900">결과</dt>
                    <dd className="[overflow-wrap:anywhere]">{c.result}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-navy-900">교훈</dt>
                    <dd className="[overflow-wrap:anywhere]">{c.lesson}</dd>
                  </div>
                </dl>
                <TrackedLink
                  href={`/qna/${c.questionId}`}
                  name="solved_case_clicked"
                  props={{ placement: "home" }}
                  className="mt-4 inline-flex min-h-11 items-center text-[15px] font-bold text-navy-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                >
                  원 질문·답변 보기
                </TrackedLink>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
