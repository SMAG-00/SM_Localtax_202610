#!/usr/bin/env node
// SM 세금 카드 해설 가져오기 도구 (W11-a a7 - 3단계 설계 4.2, RE-01 해설 초안)
// · SM 저장소는 읽기만 하는 곳이다. 이 도구는 SM 저장소를 직접 열지 않고, 사람이 `data-src/sm/`(git 제외)에 복사해 둔 사본만 읽는다.
// · 사본의 카드 객체(code·name·oneLiner·base·rate·due·law·detail·kind)에서 글자 그대로인 값만 뽑는다. 입력에 따라 계산되는 값(함수 호출·조건식)은 가져오지 않고
//   "[확인 필요]" 표시만 남긴다. 양도 단계 카드(getTransferCards)는 통째로 가져오지 않는다 (양도 세율 요약 금지 - 해설 + SM 카드로 연결).
// · 만드는 것은 관리 API(/api/admin/guides op=create)의 가이드 **초안**뿐이다. 서명·공개는 하지 않는다 (SM 값은 AI 작성·미감수 값).
// · SM 내용은 어디에도 커밋하지 않는다 - data-src/는 .gitignore 대상이고, 이 도구는 카드 글자를 화면(표준출력)에 찍지 않는다 (건수만).
// 사용: node scripts/import/sm-tax-cards.mjs [--src data-src/sm/content/tax-cards.ts] [--base-url http://localhost:3001] [--apply]
//   --apply 가 없으면 건수만 보이고 아무것도 보내지 않는다 (dry run). --apply 에는 환경변수 IMPORT_AUTH_HEADER (예: "Bearer <관리자 접근 토큰>") 가 필요하다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// TypeScript 컴파일러(구문 분석용)는 apps/web 의존성에서 찾는다 - 저장소 루트에는 없다
const ts = createRequire(path.join(ROOT, "apps", "web", "package.json"))("typescript");
const PHASE_BY_FUNCTION = { getAcquireCards: "acquire", getHoldCards: "hold", getTransferCards: "transfer" };
const SKIPPED_PHASES = new Set(["transfer"]);
const FIELDS = ["name", "oneLiner", "base", "rate", "due", "law", "detail", "kind"];
const FIELD_LABEL = { oneLiner: "한 줄 설명", base: "과세표준", rate: "세율 요약", due: "납부시기", law: "근거조문", detail: "상세" };
const PHASE_TITLE = { acquire: "취득할 때 세금 카드", hold: "보유할 때 세금 카드" };
export const DYNAMIC_MARK = "[확인 필요: 원본이 입력에 따라 계산하는 값이라 가져오지 않았습니다]";

/** 사본 경로는 저장소의 data-src/ 아래여야 한다 (SM 저장소를 직접 읽지 않는다) */
export function assertUnderDataSrc(src, root = ROOT) {
  const abs = path.resolve(root, src);
  const base = path.join(root, "data-src") + path.sep;
  if (!abs.startsWith(base)) throw new Error(`사본은 data-src/ 아래에 복사해 둔 파일만 읽습니다: ${src}`);
  return abs;
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = literalText(node.left);
    const b = literalText(node.right);
    return a !== null && b !== null ? a + b : null;
  }
  return null;
}

/** 소스 글에서 카드(code 속성이 글자인 객체)를 모은다. 반환: [{ phase, code, fields: {이름: 글자|null}, dynamic: [이름] }] */
export function extractCards(sourceText) {
  const sf = ts.createSourceFile("tax-cards.ts", sourceText, ts.ScriptTarget.ES2022, true);
  const cards = [];
  const visit = (node, phase) => {
    if (ts.isFunctionDeclaration(node) && node.name && PHASE_BY_FUNCTION[node.name.text]) phase = PHASE_BY_FUNCTION[node.name.text];
    if (phase && ts.isObjectLiteralExpression(node)) {
      const props = new Map();
      for (const p of node.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
      const code = props.has("code") ? literalText(props.get("code")) : null;
      if (code !== null && props.has("name")) {
        const fields = {};
        const dynamic = [];
        for (const f of FIELDS) {
          if (!props.has(f)) continue;
          const text = literalText(props.get(f));
          fields[f] = text;
          if (text === null) dynamic.push(f);
        }
        cards.push({ phase, code, fields, dynamic });
      }
    }
    ts.forEachChild(node, (c) => visit(c, phase));
  };
  visit(sf, null);
  return cards;
}

const cardSection = (card) => {
  const lines = [];
  for (const f of ["oneLiner", "base", "rate", "due", "law", "detail"]) {
    if (!(f in card.fields)) continue;
    lines.push(`${FIELD_LABEL[f]}: ${card.fields[f] === null ? DYNAMIC_MARK : card.fields[f]}`);
  }
  return { heading: (card.fields.name ?? card.code).slice(0, 200), body: (lines.join("\n") || DYNAMIC_MARK).slice(0, 20_000) };
};

/** 카드 목록 -> 가이드 초안 요청 본문. 양도 단계는 제외하고 건수만 돌려준다 */
export function buildDrafts(cards, origin) {
  const skipped = cards.filter((c) => SKIPPED_PHASES.has(c.phase)).length;
  const drafts = [];
  for (const phase of ["acquire", "hold"]) {
    const list = cards.filter((c) => c.phase === phase);
    if (list.length === 0) continue;
    const kinds = new Set(list.map((c) => c.fields.kind).filter((k) => typeof k === "string"));
    const tax_scope = kinds.has("national") && kinds.has("local") ? "both" : kinds.has("national") ? "national" : "local";
    drafts.push({
      op: "create",
      hub: "realestate_tax",
      topic: `sm_cards_${phase}`,
      slug: `sm-cards-${phase}`,
      title: `${PHASE_TITLE[phase]} (SM 해설 가져옴 - 미감수)`,
      tax_scope,
      sections: list.map(cardSection),
      import_origin: origin,
      dynamicCount: list.reduce((n, c) => n + c.dynamic.length, 0),
    });
  }
  return { drafts, skipped };
}

export const originOf = (sourceText) => `sm:content/tax-cards.ts sha256:${crypto.createHash("sha256").update(sourceText).digest("hex").slice(0, 16)}`;

async function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const apply = argv.includes("--apply");
  const src = assertUnderDataSrc(arg("--src", "data-src/sm/content/tax-cards.ts"));
  if (!fs.existsSync(src)) throw new Error(`사본이 없습니다: ${path.relative(ROOT, src)} (SM 저장소에서 읽기 전용으로 복사해 두세요)`);
  const text = fs.readFileSync(src, "utf8");
  const cards = extractCards(text);
  const { drafts, skipped } = buildDrafts(cards, originOf(text));
  console.log(`카드 ${cards.length}건 읽음 - 양도 단계 ${skipped}건 제외, 초안 ${drafts.length}개(절 ${drafts.reduce((n, d) => n + d.sections.length, 0)}개), 계산 값이라 표시만 남긴 칸 ${drafts.reduce((n, d) => n + d.dynamicCount, 0)}개`);
  if (!apply) return console.log("dry run - 보낸 것이 없습니다. 보내려면 --apply (환경변수 IMPORT_AUTH_HEADER 필요)");
  const auth = process.env.IMPORT_AUTH_HEADER;
  if (!auth) throw new Error("IMPORT_AUTH_HEADER 환경변수가 필요합니다 (예: Bearer <관리자 접근 토큰>)");
  const base = arg("--base-url", "http://localhost:3001").replace(/\/$/, "");
  for (const { dynamicCount: _unused, ...body } of drafts) {
    const res = await fetch(`${base}/api/admin/guides`, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify(body) });
    console.log(`${body.topic}: HTTP ${res.status}${res.ok ? " (초안 생성)" : ""}`);
    if (!res.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
