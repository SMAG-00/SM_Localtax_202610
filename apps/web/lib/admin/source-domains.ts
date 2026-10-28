// 도메인 → 발표기관·매체 이름 표 (F5 출처 자동 채우기) — 이 표가 유일한 정본입니다.
//  · 표에 없는 도메인은 이름을 비웁니다(지어내지 않음). 정부 도메인(.go.kr)은 표에 없어도 '공식 문서'로 분류하되 기관 이름은 비웁니다.
//  · 언론사는 출처 종류에 '언론 보도'가 따로 없어 '기타'(other)로 둡니다(SOURCE_KIND_LABELS 확인).
//  · 순수 함수 (시험: source-suggest.test.ts)

export interface DomainEntry {
  /** 이 도메인 또는 그 하위 도메인(www. 등)에 맞음 */
  domain: string;
  name: string;
  /** gov = 정부·공공기관, press = 언론사 */
  type: "gov" | "press";
}

export const DOMAIN_TABLE: readonly DomainEntry[] = [
  { domain: "mois.go.kr", name: "행정안전부", type: "gov" },
  { domain: "law.go.kr", name: "법제처 국가법령정보센터", type: "gov" },
  { domain: "molit.go.kr", name: "국토교통부", type: "gov" },
  // [확인 필요] moef.go.kr 기관 명칭 — 기획재정부 / 재정경제부(개편 뒤 현 명칭)를 운영 시점에 확인합니다. 지금은 기획재정부로 둡니다.
  { domain: "moef.go.kr", name: "기획재정부", type: "gov" },
  { domain: "assembly.go.kr", name: "국회", type: "gov" },
  { domain: "nts.go.kr", name: "국세청", type: "gov" },
  { domain: "yna.co.kr", name: "연합뉴스", type: "press" },
  { domain: "mk.co.kr", name: "매일경제", type: "press" },
  { domain: "newspim.com", name: "뉴스핌", type: "press" },
  { domain: "news1.kr", name: "뉴스1", type: "press" },
  { domain: "biz.chosun.com", name: "조선비즈", type: "press" },
];

export interface DomainInfo {
  /** 출처 종류 — official_doc(정부·공공기관) 또는 other(언론·모르는 도메인) */
  kind: "official_doc" | "other";
  /** 모르면 "" */
  publisher: string;
  /** 표에서 찾았는가 */
  known: boolean;
  host: string;
}

/** 주소의 호스트 (소문자, 끝 점 제거). 읽을 수 없으면 "" */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function domainInfo(url: string): DomainInfo {
  const host = hostOf(url);
  const hit = DOMAIN_TABLE.filter((e) => host === e.domain || host.endsWith(`.${e.domain}`)).sort((a, b) => b.domain.length - a.domain.length)[0];
  if (hit) return { kind: hit.type === "gov" ? "official_doc" : "other", publisher: hit.name, known: true, host };
  const gov = host.endsWith(".go.kr");
  return { kind: gov ? "official_doc" : "other", publisher: "", known: false, host };
}
