// CAT-05 해결 사례 — 4칸(상황·쟁점·결과·교훈)·결과 근거(사건번호·해석 번호 + 링크)·개인정보 형식(차단)·실명 표현(경고)
// 개인정보 형식 검사는 해결 사례 원고에만 적용한다(일반 기사의 기관 대표 전화 등은 대상 아님).
import { finding, toSaveValidation, type Finding, type SaveValidation } from "../findings";
import { SOLVED_CASE_CONCLUSIONS, type ArticleForPublish, type SolvedCase } from "../model";
import { PII_KIND_LABELS, detectPii, detectRealNames } from "../pii";
import { SOLVED_CASE_CELLS, articleUnits, isBlank, splitSentences, unitLocation, type TextUnit } from "../text";

const LINK = /^https?:\/\/\S+$/;

function privacyFindings(units: readonly TextUnit[]): Finding[] {
  const out: Finding[] = [];
  for (const unit of units) {
    unit.sentences.forEach((sentence, sentenceIndex) => {
      for (const m of detectPii(sentence)) {
        out.push(
          finding("cat05.pii", `개인정보 형식(${PII_KIND_LABELS[m.kind]}) ‘${m.match}’ — 빼거나 가려야 발행됩니다`, unitLocation(unit, sentenceIndex, m.match)),
        );
      }
      for (const name of detectRealNames(sentence)) {
        out.push(finding("cat05.real-name", `실명으로 보이는 표현 ‘${name}’ — 알아볼 수 없게 바꿔 주세요`, unitLocation(unit, sentenceIndex, name)));
      }
    });
  }
  return out;
}

function caseUnits(solvedCase: SolvedCase): TextUnit[] {
  return SOLVED_CASE_CELLS.map(([key]) => ({ field: `solvedCase.${key}`, sentences: splitSentences(solvedCase[key]) }));
}

/** 저장 검사 — 개인정보 형식이 있으면 저장 거부, 실명 표현은 경고. 빈 칸은 작성 중이라 발행 때 막는다 */
export function validateSolvedCaseForSave(solvedCase: SolvedCase): SaveValidation {
  return toSaveValidation(privacyFindings(caseUnits(solvedCase)));
}

export function checkSolvedCase(article: ArticleForPublish): Finding[] {
  if (article.subtype !== "solved_case") return [];
  const out: Finding[] = [];
  const sc = article.solvedCase;
  for (const [key, label] of SOLVED_CASE_CELLS) {
    if (sc === null || isBlank(sc[key])) {
      out.push(finding("cat05.cell-empty", `해결 사례의 ‘${label}’ 칸이 비었습니다`, { field: `solvedCase.${key}` }));
    }
  }
  const evidence = sc?.resultEvidence.filter((e) => !isBlank(e.number) && LINK.test(e.url.trim())) ?? [];
  if (evidence.length === 0) {
    out.push(finding("cat05.result-evidence", "결과 칸의 근거(결정례 사건번호 또는 해석 번호 + 출처 링크)가 1개 이상 있어야 합니다"));
  }
  // 결과 칸의 결론 배지 (PRD-00 8.6 해결 사례 카드 '결과(결론 배지)') — 값 목록 밖이나 빈 값은 배지를 그릴 수 없다
  if (!sc || sc.conclusion === null || !(SOLVED_CASE_CONCLUSIONS as readonly string[]).includes(sc.conclusion)) {
    out.push(finding("cat05.conclusion-missing", "결과의 결론(인용·일부 인용·기각·각하·해석)을 골라 주세요", { field: "solvedCase.conclusion" }));
  }
  out.push(...privacyFindings(articleUnits(article)));
  return out;
}
