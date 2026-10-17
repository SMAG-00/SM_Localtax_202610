import { Chip, LinkCard } from "../base";
import { DateText, MONO } from "./parts";
import { isBlank, nonBlank } from "./format";

/** 전문가 분류 5종 (EXPL-01, 4.2 분류표) */
export type ExpertCategory = "tax-accountant" | "cpa" | "lawyer" | "judicial-scrivener" | "real-estate";
/** 자격·등록 검증 상태 (EXPL-03) — verified만 공개 */
export type ExpertVerification = "verified" | "pending" | "expired" | "revoked";

/**
 * 전문가 카드 값. 별점·후기·순위·상담 건수 칸은 두지 않는다 (EXPL-02 · EXPL-04).
 */
export type ExpertCardProps = {
  name: string;
  /** 인물 페이지 `/people/[slug]` */
  slug: string;
  category: ExpertCategory;
  /** 전문 분야 */
  fields: readonly string[];
  /** 소속 (사무소·법인) */
  affiliation: string;
  /** 지역 (시·도) */
  region?: string;
  registrationNo?: string;
  /** 자격 확인일 */
  checkedAt: string;
  /** 자사 관계 (예: 월간지방세연구 필진, SM(선명) 소속) */
  relations?: readonly string[];
  /** 이해관계 한 줄 */
  interest?: string;
  verification: ExpertVerification;
};

const CATEGORY_LABEL: Record<ExpertCategory, string> = {
  "tax-accountant": "세무사",
  cpa: "공인회계사",
  lawyer: "변호사",
  "judicial-scrivener": "법무사",
  "real-estate": "부동산 전문가",
};

/** 전문가 카드 — 링크 카드 문법, 카드 전체가 인물 페이지로 가는 링크 하나 (EXPL-01~08 · EXPL-12) */
export function ExpertCard(props: ExpertCardProps) {
  const { name, slug, category, affiliation, region, registrationNo, checkedAt, interest, verification } = props;
  const fields = nonBlank(props.fields);
  const relations = nonBlank(props.relations ?? []);
  // 검증 전·만료·취소, 필수 항목(이름·자격·소속·분야·확인일) 빈 값 → 공개 렌더 0
  if (verification !== "verified" || [name, slug, affiliation, checkedAt].some(isBlank) || fields.length === 0) return null;

  return (
    <div data-ui="expert-card">
      <LinkCard href={`/people/${encodeURIComponent(slug)}`}>
        <span data-part="name" className="block text-[19px] font-black text-navy-900">
          {name}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <Chip>{CATEGORY_LABEL[category]}</Chip>
          {fields.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </span>
        <span className="mt-2 block text-[15px] text-navy-600">
          {affiliation}
          {!isBlank(region) && <> · {region}</>}
        </span>
        <span className={`mt-1 block ${MONO}`}>
          {!isBlank(registrationNo) && <>등록번호 {registrationNo} · </>}
          확인일 <DateText value={checkedAt} />
        </span>
        {relations.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {relations.map((r) => (
              <Chip key={r}>{r}</Chip>
            ))}
          </span>
        )}
        {!isBlank(interest) && <span className="mt-2 block text-[15px] text-navy-800">이해관계: {interest}</span>}
      </LinkCard>
    </div>
  );
}
