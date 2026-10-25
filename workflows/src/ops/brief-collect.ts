// 수집 결과 -> 브리핑 코너 항목 어댑터 (W10-e SM 이식). 순수 함수 - 입출력·네트워크·AI 없음.
// 입력은 "이미 내려받아 정리한 행"입니다(수집기가 만들고, 원천 이용 조건이 허용되기 전에는 요청이 0이라 행도 없음).
// 출력 항목은 검사기 8종을 그대로 통과하도록 만듭니다 - 출처 줄(meta)의 번호·일자는 원문 발췌(excerpts)나 항목의 원문 값에서만 나옵니다.
import type { BriefItem } from "./brief-checkers.ts";
import { MAX_DECISION_BODIES, MAX_INTERPRETATION_BODIES, decisionBadge, isNewInRange, pickRelevant, prioritizeDecisions } from "./sm-brief.ts";

export interface LawRowIn {
  serial: string;
  name: string;
  promulgationNo: string;
  /** YYYY-MM-DD */
  promulgatedOn: string;
  effectiveOn: string;
  revisionKind?: string;
  url: string;
  /** 제개정이유 글 - 비공개 발췌 칸으로만 간다 */
  reasonText?: string;
}
export interface AdmrulRowIn {
  serial: string;
  name: string;
  kind?: string;
  issuer: string;
  issuedOn: string;
  effectiveOn?: string;
  url: string;
}
export interface InterpretationRowIn {
  serial: string;
  title: string;
  interpretedOn: string;
  publishedOn: string;
  url?: string;
  /** 질의요지·회답 글 - 비공개 발췌 칸으로만 간다 */
  replyText?: string;
}
export interface DecisionRowIn {
  serial: string;
  title: string;
  claimNo: string;
  decidedOn: string;
  /** 주문 글 */
  order: string;
  url?: string;
  summaryText?: string;
}

export interface CollectInput {
  since: string;
  until: string;
  today: string;
  laws: readonly LawRowIn[];
  admrul: readonly AdmrulRowIn[];
  interpretations: readonly InterpretationRowIn[];
  decisions: readonly DecisionRowIn[];
  /** 행정규칙을 이 소관부처 것만 (COLLECT_TARGETS의 ministry) */
  ministry?: string;
  /** 이미 본 일련번호 - 비어 있으면 기간으로 판정 */
  seenInterpretations?: ReadonlySet<string>;
  seenDecisions?: ReadonlySet<string>;
}

export interface CollectedCorners {
  items: { laws: BriefItem[]; admrul: BriefItem[]; interpretations: BriefItem[]; tribunal: BriefItem[] };
  excerpts: Record<string, string>;
  counts: { lawsChanged: number; admrulNew: number; interpretationsNew: number; decisionsNew: number };
}

/** 2026-10-01 -> 2026.10.1 (앞자리 0 없이, SM 출처 줄 표기) */
export function dotDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}.${Number(m)}.${Number(d)}`;
}

const lines = (...parts: (string | undefined)[]) => parts.filter((p): p is string => !!p && p.trim() !== "").join("\n");

export function buildCollectedCorners(input: CollectInput): CollectedCorners {
  const excerpts: Record<string, string> = {};

  // 법령 개정 - 공포일 또는 시행일이 기간 안
  const lawsChanged = input.laws.filter((r) => isNewInRange(r.promulgatedOn, input.since, input.until) || isNewInRange(r.effectiveOn, input.since, input.until));
  const laws: BriefItem[] = lawsChanged.map((r) => {
    const id = `law-${r.serial}`;
    const live = r.effectiveOn <= input.today;
    excerpts[id] = lines(r.reasonText, r.promulgatedOn, r.effectiveOn);
    return {
      id, origin: "system", reviewed: false,
      text: [r.name, r.revisionKind].filter(Boolean).join(" "),
      sourceUrl: r.url, sourceNo: `제${r.promulgationNo}호`, sourceDate: r.promulgatedOn,
      badge: live ? "live" : "plan",
      badgeLabel: live ? `시행 ${dotDate(r.effectiveOn)}` : `공포 · 시행 ${dotDate(r.effectiveOn)}`,
      meta: [`제${r.promulgationNo}호`, `공포 ${dotDate(r.promulgatedOn)}`, `시행 ${dotDate(r.effectiveOn)}`],
    };
  });

  // 행정규칙 - 발령일이 기간 안(소관부처가 정해져 있으면 그 부처 것만)
  const admrulNew = input.admrul.filter((r) => (input.ministry === undefined || r.issuer === input.ministry) && isNewInRange(r.issuedOn, input.since, input.until));
  const admrul: BriefItem[] = admrulNew.map((r) => {
    const id = `adm-${r.serial}`;
    excerpts[id] = lines(r.issuedOn, r.effectiveOn);
    return {
      id, origin: "system", reviewed: false, text: r.name, sourceUrl: r.url, sourceDate: r.issuedOn,
      ...(r.kind ? { tags: [r.kind] } : {}),
      meta: [`발령 ${dotDate(r.issuedOn)}`, ...(r.effectiveOn ? [`시행 ${dotDate(r.effectiveOn)}`] : [])],
    };
  });

  // 유권해석 - 본 적 없는 일련번호(이력이 비면 공개일이 기간 안), 제목이 관련 낱말에 걸린 것만 최대 건수
  const seenI = input.seenInterpretations ?? new Set<string>();
  const newI = seenI.size > 0 ? input.interpretations.filter((r) => !seenI.has(r.serial)) : input.interpretations.filter((r) => isNewInRange(r.publishedOn, input.since, input.until));
  const interpretations: BriefItem[] = pickRelevant(newI, (r) => r.title, MAX_INTERPRETATION_BODIES).map((r) => {
    const id = `ex-${r.serial}`;
    excerpts[id] = lines(r.replyText, r.interpretedOn, r.publishedOn);
    return {
      id, origin: "system", reviewed: false, text: r.title, ...(r.url ? { sourceUrl: r.url } : {}), sourceDate: r.interpretedOn,
      badge: "expc", badgeLabel: "해석",
      meta: [`해석일 ${dotDate(r.interpretedOn)}`, `공개 ${dotDate(r.publishedOn)}`, `일련번호 ${r.serial}`],
    };
  });

  // 결정례 - 본 적 없고 의결일이 기간 안, 일반 독자 관련 사건 우선. 결론 표지는 주문으로 정한다(주문이 불분명하면 표지 없음 - 검수자가 정함)
  const seenD = input.seenDecisions ?? new Set<string>();
  const newD = input.decisions.filter((r) => !seenD.has(r.serial) && isNewInRange(r.decidedOn, input.since, input.until));
  const tribunal: BriefItem[] = prioritizeDecisions(newD, (r) => r.title, MAX_DECISION_BODIES).map((r) => {
    const id = `dc-${r.serial}`;
    const badge = decisionBadge(r.order);
    excerpts[id] = lines(r.summaryText, r.decidedOn, r.claimNo);
    excerpts[`${id}#order`] = r.order;
    return {
      id, origin: "system", reviewed: false, text: r.title, ...(r.url ? { sourceUrl: r.url } : {}), sourceDate: r.decidedOn,
      ...(badge ? { badge, badgeLabel: badge === "lose" ? "기각" : "취소·경정" } : {}),
      meta: [`청구번호 ${r.claimNo}`, `의결 ${dotDate(r.decidedOn)}`, `일련번호 ${r.serial}`],
    };
  });

  return {
    items: { laws, admrul, interpretations, tribunal },
    excerpts,
    counts: { lawsChanged: laws.length, admrulNew: admrul.length, interpretationsNew: newI.length, decisionsNew: newD.length },
  };
}
