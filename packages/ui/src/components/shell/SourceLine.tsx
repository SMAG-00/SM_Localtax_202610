/** 빈 값·공백은 추정하지 않고 "확인 필요"로 쓴다 (PRD-00 8.8) */
function orCheck(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? v : "확인 필요";
}

export type SourceLineProps = {
  /** 출처 — 발표기관·데이터 이름 */
  source: string;
  /** 자료의 기준일 (YYYY-MM-DD) */
  baseDate?: string | null;
  /** 편집국이 원문을 마지막으로 확인한 날 (YYYY-MM-DD) */
  checkedAt?: string | null;
  /**
   * 공식 자료 없이 편집국 기사만 쓴 화면 — 기준일·정보 확인일 대신 "최신 발행일 ○○" (W4 설계 2.8 '자료 0이면 출처 편집국 + 최신 발행일').
   * 값을 주면(null 포함) 이 모양이다. null = 기사도 없음 → "출처 ○○"만
   */
  latestPublished?: string | null;
};

/**
 * 데이터 출처 줄 — 공공데이터·공식 자료 화면 하단의 고정폭 한 줄 "출처 ○○ · 기준일 ○○ · 정보 확인일 ○○" (PRD-00 8.6).
 * 항목마다 줄바꿈하지 않는 묶음이라 좁은 화면에서는 가운뎃점 자리에서만 줄이 바뀐다 (가로 스크롤 없음).
 */
export function SourceLine({ source, baseDate, checkedAt, latestPublished }: SourceLineProps) {
  const parts =
    latestPublished !== undefined
      ? [`출처 ${orCheck(source)}`, ...(latestPublished?.trim() ? [`최신 발행일 ${latestPublished.trim()}`] : [])]
      : [`출처 ${orCheck(source)}`, `기준일 ${orCheck(baseDate)}`, `정보 확인일 ${orCheck(checkedAt)}`];
  return (
    <p data-ui="source-line" className="font-mono text-[13px] tracking-wide text-navy-600">
      {parts.map((part, i) => (
        <span key={part}>
          {i > 0 && " · "}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </p>
  );
}
