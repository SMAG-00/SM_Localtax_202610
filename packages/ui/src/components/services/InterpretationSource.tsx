import { Chip } from "../base";
import { DateText, MONO, SiteLink } from "./parts";
import { isBlank, isHttpUrl } from "./format";

export type LegalDocType = "예규" | "통칙" | "유권해석" | "심판" | "판례";

export type InterpretationSourceProps = {
  docType: LegalDocType;
  /** 발행기관 */
  issuer: string;
  /** 문서·사건 번호 */
  docNumber: string;
  /** 결정·회신일 */
  decidedAt: string;
  /** 요지 */
  summary: string;
  /** 원문 주소 (http·https) */
  sourceUrl: string;
  /** 권리 확인 기록 */
  rightsConfirmed: boolean;
  /** 비실명 확인 — 판례·심판은 필수 (TX-09) */
  anonymized?: boolean;
};

const NEEDS_ANONYMIZING: readonly LegalDocType[] = ["심판", "판례"];

/** 해석 원문 블록 — 원문과 해설을 나누는 블록 (TX-09). 해설 블록과 한 카드에 섞지 않는다(자식 칸 없음) */
export function InterpretationSource(props: InterpretationSourceProps) {
  const { docType, issuer, docNumber, decidedAt, summary, sourceUrl, rightsConfirmed, anonymized = false } = props;
  const needsAnon = NEEDS_ANONYMIZING.includes(docType);
  // 원문 필수 칸이 비었거나 권리·비실명 확인이 없으면 공개하지 않는다
  if ([issuer, docNumber, decidedAt, summary].some(isBlank) || !isHttpUrl(sourceUrl) || !rightsConfirmed || (needsAnon && !anonymized)) return null;

  return (
    <section data-ui="interpretation-source" aria-label={`${docType} 원문`} className="rounded-2xl border border-navy-100 bg-white p-6">
      <p className="text-[13px] font-bold text-navy-600">원문</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip>{docType}</Chip>
        <span className="text-[15px] font-bold text-navy-900">{issuer}</span>
      </div>
      <p className={`mt-2 ${MONO}`}>
        문서 번호 {docNumber}
        <span aria-hidden="true"> · </span>결정일 <DateText value={decidedAt} />
      </p>
      <h3 className="mt-4 text-[15px] font-bold text-navy-600">요지</h3>
      <p className="mt-1 text-[17px] text-navy-900">{summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <SiteLink href={sourceUrl}>원문 보기</SiteLink>
        <p className="text-[13px] font-bold text-navy-600">
          권리 확인
          {needsAnon && (
            <>
              <span aria-hidden="true"> · </span>비실명 확인
            </>
          )}
        </p>
      </div>
    </section>
  );
}
