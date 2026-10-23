// 응답 검증기 A1~A6 — 결정론적 검사, 문단 단위 (CHAT-04 · CHAT-05 · CHAT-11 · BR-09, PRD-01C 4.1 검증기). AI를 쓰지 않는다.
//  A1 URL이 이번 대화의 검색 결과·바깥 연결에 있다 → 없으면 URL 제거
//  A2 세액·세금 금액 문장이 없다, 그 밖의 숫자는 인용된 검색 결과에 같은 값이 있을 때만 → 실패 시 재생성 1회 → 근거 목록 응답
//  A3 금지 표현이 없다 → 재생성 1회 → 근거 목록 응답
//  A4 실존 인물 이름과 1인칭 서술이 함께 없다 → 재생성 1회 → 거절 한 줄
//  A5 사이트 정보를 진술하는 문단에 인용 1개 이상, 상태 값은 get_status 결과와 같다 → 재생성 1회 → 근거 목록 응답
//  A6 개인정보 패턴이 다시 나오지 않는다 → 가림
import { maskCore } from "./mask";

export type FailureCode = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

export interface AnswerParagraph {
  text: string;
  /** 이 문단에 붙은 인용의 출처 주소 (모델 인용 블록 → 서버가 모은 것) */
  citedUrls: string[];
}

export interface StatusFact {
  /** 트래커·프로젝트 이름 */
  name: string;
  /** 현재 단계 글자 (get_status 결과) */
  stage: string;
}

export interface VerifyContext {
  /** 이번 대화의 검색 결과·바깥 연결 주소 (A1) */
  allowedUrls: ReadonlySet<string>;
  /** 주소 → 그 결과의 글 (A2 숫자 대조) */
  sourceTextByUrl: ReadonlyMap<string, string>;
  /** 이용자 질문(가린 글) — 질문에 있던 숫자는 되풀이해도 된다 */
  questionText: string;
  /** 금지 표현 사전 (A3) */
  forbiddenPhrases: readonly string[];
  /** 실존 인물 이름 (A4) */
  personNames: readonly string[];
  /** get_status 결과 (A5) */
  statusFacts: readonly StatusFact[];
  /** 단계 이름 전체 어휘 — 다른 단계 이름이 섞이면 실패 (A5) */
  stageVocabulary: readonly string[];
}

export interface Failure {
  code: FailureCode;
  paragraph: number;
  detail: string;
}

export interface VerifyResult {
  /** 고친(URL 제거·가림) 문단 — 통과한 문단만 내보낸다 */
  paragraphs: AnswerParagraph[];
  failures: Failure[];
  /** 재생성 1회로 풀 수 있는 실패가 있는가 (A2·A3·A5) */
  needsRegeneration: boolean;
  /** 재생성해도 실패하면 보낼 형태: evidence_list = 근거 목록('검색 결과만'), refusal = 거절 한 줄 */
  fallback: "evidence_list" | "refusal" | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"'<]+/giu;
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/gu;

/** 주소 비교용 모양 — 조각(#…)과 끝 슬래시를 뗀다 */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/u, "").replace(/\/+$/u, "");
}

const TAX_NOUN = /(취득세|등록면허세|재산세|종합부동산세|종부세|양도소득세|양도세|상속세|증여세|지방소득세|주민세|자동차세|지방교육세|농어촌특별세|세액|세금)/u;
const MONEY = /[0-9][0-9,.]*\s*(?:원|만\s?원|억\s?원|억|천\s?만\s?원|천만|만)(?![가-힣]*\s*(?:개|명|건|채|세대))/u;
const TAX_PHRASE = /(내야\s?할|납부해야\s?할|납부할\s?세액|예상\s?세액|산출\s?세액|세액은|세금은\s?[0-9]|환급\s?받을)/u;
const NUMBER = /[0-9][0-9,]*(?:\.[0-9]+)?/gu;
const FIRST_PERSON = /(?:^|[\s,.;:"'“‘(])(저는|제가|저의|저도|나는|내가|제\s?견해|제\s?생각|제\s?의견)/u;
const META_START = /^(죄송|사이트에서\s?(?:확인되지|찾지)|알려드릴\s?수\s?없|도와드릴\s?수\s?없|확인되지\s?않|찾지\s?못|답변드리기\s?어렵|해당\s?내용은)/u;

const sentences = (p: string): string[] => p.split(/(?<=[.!?。다요죠])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);

/** A1 — 허용되지 않는 주소를 지운다. 마크다운 링크는 글자만 남긴다 */
function stripUnlistedUrls(text: string, allowed: ReadonlySet<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const ok = (u: string) => allowed.has(normalizeUrl(u));
  let out = text.replace(MD_LINK, (whole, label: string, url: string) => {
    if (!/^(?:https?:\/\/|\/)/iu.test(url) || ok(url)) return whole;
    removed.push(url);
    return label;
  });
  out = out.replace(URL_IN_TEXT, (url) => {
    const bare = url.replace(/[.,;:!?]+$/u, "");
    if (ok(bare)) return url;
    removed.push(bare);
    return "";
  });
  return { text: out.replace(/[ \t]{2,}/gu, " ").trim(), removed };
}

const digitsOnly = (n: string) => n.replace(/,/gu, "");

/** A2 — 이 문단의 숫자 가운데 인용된 글·질문 어디에도 없는 것 */
function unsupportedNumbers(text: string, citedText: string, question: string): string[] {
  const pool = digitsOnly(`${citedText} ${question}`);
  const bad: string[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const n = digitsOnly(m[0]);
    if (n.replace(/\./gu, "").length <= 1) continue; // 한 자리(목록 번호 등)는 검사하지 않는다
    if (!pool.includes(n)) bad.push(m[0]);
  }
  return bad;
}

export function verifyParagraphs(input: readonly AnswerParagraph[], ctx: VerifyContext): VerifyResult {
  const failures: Failure[] = [];
  const out: AnswerParagraph[] = [];
  let refusal = false;
  let regen = false;

  input.forEach((p, i) => {
    let text = p.text.trim();
    if (text === "") return;
    const fail = (code: FailureCode, detail: string) => failures.push({ code, paragraph: i, detail });

    // A1 — 주소 거르기 (인용 목록도 같이)
    const stripped = stripUnlistedUrls(text, ctx.allowedUrls);
    if (stripped.removed.length > 0) fail("A1", `허용 목록 밖 주소 ${stripped.removed.length}개 제거`);
    text = stripped.text;
    const cited = p.citedUrls.filter((u) => ctx.allowedUrls.has(normalizeUrl(u)));
    const mentioned = [...text.matchAll(URL_IN_TEXT), ...text.matchAll(MD_LINK)].length > 0;

    // A6 — 개인정보 모양 다시 가림
    const masked = maskCore(text);
    if (masked.kinds.length > 0) {
      fail("A6", `개인정보 모양 ${masked.kinds.length}개 가림`);
      text = masked.text;
    }

    // A2 — 세액·세금 금액 문장
    const taxSentence = sentences(text).some((s) => (TAX_NOUN.test(s) && MONEY.test(s)) || TAX_PHRASE.test(s));
    if (taxSentence) {
      fail("A2", "세액·세금 금액 문장");
      regen = true;
    } else {
      const citedText = cited.map((u) => ctx.sourceTextByUrl.get(normalizeUrl(u)) ?? ctx.sourceTextByUrl.get(u) ?? "").join(" ");
      const bad = unsupportedNumbers(text, citedText, ctx.questionText);
      if (bad.length > 0) {
        fail("A2", `인용된 글에 없는 숫자 ${bad.slice(0, 3).join(", ")}`);
        regen = true;
      }
    }

    // A3 — 금지 표현
    const hit = ctx.forbiddenPhrases.find((f) => f !== "" && text.includes(f));
    if (hit) {
      fail("A3", `금지 표현 '${hit}'`);
      regen = true;
    }

    // A4 — 실존 인물 이름 + 1인칭
    if (ctx.personNames.some((n) => n !== "" && text.includes(n)) && FIRST_PERSON.test(text)) {
      fail("A4", "실존 인물 이름과 1인칭 서술");
      refusal = true;
    }

    // A5 — 인용 없는 진술, 상태 값 불일치
    const isMeta = META_START.test(text) || Array.from(text).length < 12;
    if (cited.length === 0 && !mentioned && !isMeta) {
      fail("A5", "인용 없는 진술");
      regen = true;
    }
    for (const fact of ctx.statusFacts) {
      if (!text.includes(fact.name)) continue;
      const wrongStage = ctx.stageVocabulary.find((v) => v !== fact.stage && !fact.stage.includes(v) && text.includes(v));
      if (!text.includes(fact.stage) || wrongStage) {
        fail("A5", `상태 값이 조회 결과(${fact.stage})와 다름`);
        regen = true;
      }
    }

    out.push({ text, citedUrls: cited });
  });

  const blocking = failures.some((f) => f.code !== "A1" && f.code !== "A6");
  return {
    paragraphs: blocking ? [] : out,
    failures,
    needsRegeneration: regen && !refusal,
    fallback: refusal ? "refusal" : blocking ? "evidence_list" : null,
  };
}

/** 문단 없음(모델이 글을 안 냄)도 근거 목록으로 */
export const emptyResult = (): VerifyResult => ({ paragraphs: [], failures: [{ code: "A5", paragraph: 0, detail: "빈 응답" }], needsRegeneration: true, fallback: "evidence_list" });
