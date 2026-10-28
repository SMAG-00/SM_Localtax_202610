// W2-b 수용 E2E (5단계) — PRD-01A 9장 W2-b 증거 전부를 한 시험 자료·한 서버·한 브라우저로 (docs/dev/W2-b_설계.md 1장 5단계 · 8.5)
// 9장 증거: 홈 섹션 순서 E2E · 홈·상황·기사 화면 규칙 통과 · 사이트 안 이동 새로고침 0 · 숨긴 메뉴·v1.2 경로 링크 0
//  1) 홈 섹션 순서 = PRD_최종 §4.1 — DOM 순서와 화면 위치(360·1280), 내용이 있는 섹션만, 빈 섹션 요소 0 (HOME-01·03·04)
//  2) 화면 규칙 R1~R3 — 홈·허브·상황 페이지·기사 상세, 폭 360·640·1024 (R1은 PRD-00 8.2대로 360×740 첫 화면 — 설계 9장 #38)
//  3) 이어 걷기 — 홈 → 허브 → 하위 분야 → 기사 → 기자 → 칼럼 목록 → 칼럼 → 필자 → 홈 → … → 상황 → 지역 → 기사 → 상황, 그리고 뒤로 끝까지:
//     문서 새로고침 0 · 페이지 표식 유지 · navigation 항목 1 · 뒤로 가기 뒤 스크롤 위치 (FND-09 '사이트 안 링크 10곳')
//  4) 링크 전수 — 홈에서 닿는 사이트 안 페이지 전부(최대 200쪽, 360×740): 응답 200(500 0·깨진 링크 0), 꺼진 기능·아직 없는 화면·v1.2·단계 전 경로 링크 0,
//     사이트 안 링크는 모두 화면 전환(누르면 앱이 받는다 · 새 창 0), 바깥 링크는 전체 이동, 헤더에 정책·지방세봇 메뉴 0, 화면 오류 0 · 설계대로 404·410·빈 하위 분야 noindex
//  5) noindex — 전수 페이지(SITE_INDEXING off)와 /admin (머리글·메타)
//  6) 360px 가로 스크롤 0 — 전수 페이지
//  7) 접근성 95점 이상 — 홈·허브·상황·기사 상세 (Lighthouse, 같은 브라우저)
// 자료는 편집국 API로 만든다 — 기사(작성 → 출처·근거 → 편집 승인 → 세무 감수 → 발행, 정정·삭제), 상황 카드(작성 → 감수 서명 → 공개·허브 자리),
// 홈 배치, 용어. API가 없는 개정 트래커만 DB에 직접 넣는다. 기사 본문에는 실제 원고처럼 사이트 안 링크를 섞는다(열린 화면·꺼진 기능·v1.2 옛 주소).
// 끝나면 만든 행을 모두 지운다 — 시험 전과 표마다 행 수가 같고, 운영 설정 값도 같다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage, toTable } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w2b-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const CRAWL_CAP = 200;
/** 같은 틀로 만드는 지역 화면(전국 적재 뒤 시·도 16·시·군·구 229)은 틀마다 SAME_TEMPLATE_CAP쪽만 연다 — 지역 주소 전수는 e2e/w4-region-routes가 본다 */
const SAME_TEMPLATE_CAP = 5;
function templateKey(key) {
  const u = new URL(key, "http://x");
  if (/^\/local\/[^/]+\/[^/]+$/.test(u.pathname)) return "/local/:sido/:sigungu";
  if (/^\/local\/[^/]+$/.test(u.pathname)) return "/local/:sido";
  if (u.searchParams.has("region")) return `${u.pathname}?region=*`;
  return null;
}
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 360, height: 740 };
const GYEONGGI = "4100000000";
const SEOUL = "1100000000";

// ── 기준 목록 — 문서에서 읽는다 (문서와 다르면 문서가 맞다) ─────────────────

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DESIGN = read("docs", "dev", "W2-b_설계.md");
const PRD_FINAL = read("docs", "PRD", "PRD_최종.md");
const PRD_00 = read("docs", "PRD", "PRD-00_공통기반.md");
const PRD_01A = read("docs", "PRD", "PRD-01A_1단계_기반_편집_유입.md");
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
function lineOf(doc, marker) {
  const line = doc.split("\n").find((l) => l.includes(marker));
  assert.ok(line, `문서에 '${marker}' 줄이 없다`);
  return line;
}

/** 홈 섹션 순서 — 설계 2.3 home_sections, PRD_최종 §4.1 홈 줄과 같아야 한다 */
const HOME_ORDER = ticks(lineOf(DESIGN, "| home_sections ").split("|")[2]);
const PRD_HOME_NAMES = {
  "핵심 메시지": "hero",
  "(2단계) 바로가기 카드 4장": "shortcuts",
  "4대 분야 카드": "fields",
  "이번 주 브리핑": "briefing",
  "최신 자체 취재": "latest_reports",
  "금주 핫뉴스": "weekly_hot",
  "개정 트래커 하이라이트": "amendments",
  "김의효 칼럼": "column",
  "자사 상품 카드 1개": "product",
  "분야별 전문가 소개 카드": "experts",
};
const PRD_HOME = lineOf(PRD_FINAL, "| 홈 |").split("|")[2].split(",").map((s) => s.trim());

/** 주소 규칙 — `/a/[b]`·`/a/*`·`/a/…`·`/a(/b)`는 /a 아래, 나머지는 그 주소와 그 아래 */
function routeRule(pattern, { self } = {}) {
  const cut = pattern.search(/\/\[|\(|\/\*|\/…/);
  return cut === -1 ? { pattern, base: pattern, self: true } : { pattern, base: pattern.slice(0, cut), self: self ?? false };
}
const matches = (pathname, r) => (r.self && pathname === r.base) || pathname.startsWith(`${r.base}/`);
const hitRules = (pathname, rules) => rules.filter((r) => matches(pathname, r)).map((r) => r.pattern);

/**
 * 꺼진 기능·아직 없는 화면 — 설계 7장 '만들지 않는 경로'(유틸 메뉴·정책 페이지·트래커 상세·지자체 허브·W2-c~e 화면)와 2.3 정책 링크 주소.
 * 시험 동안 feature_flags는 모두 false다 — 이 주소로 가는 사이트 안 링크 0 (HOME-02 · HELP-05 · ART-06)
 */
const CLOSED = [
  ...[...ticks(lineOf(DESIGN, "만들지 않는 경로(다른 작업)")), ...ticks(lineOf(DESIGN, "- 정책 링크 주소:"))].filter((p) => p.startsWith("/")).map((p) => routeRule(p)),
  // 동영상 목록(W2-c 4단계) — 기능 키 video_list가 꺼진 동안 닫힌 화면 (W2-b 설계 2.3 · W2-c 설계 9장)
  routeRule("/news/video"),
];
/** 정책 주소 묶음(/about/*) 안에서 이미 열린 화면 — 측정 거부 안내(W2-c 1단계 /about/measurement). W2-e 4단계부터 바닥글에 항상 있다(W2-e 설계 6.4) */
const OPENED_IN_CLOSED = new Set(["/about/measurement"]);
/** 단계 전 경로·v1.2 경로 — PRD-01A 3장(1단계 라우트 목록에 없는 경로) + PRD-00 8장 'v1.2 경로 대체'의 옛 주소. 옛 주소는 그 자체도 막는다 */
const STAGED_V12 = (() => {
  const l01a = lineOf(PRD_01A, "1단계 라우트 목록에 없습니다");
  const l00 = lineOf(PRD_00, "**v1.2 경로 대체**");
  const old00 = l00
    .slice(l00.indexOf("—") + 1, l00.indexOf("새 플랫폼이"))
    .split(/,\s*/)
    .flatMap((seg) => ticks(seg.split("→")[0]));
  return [...new Set([...ticks(l01a.slice(l01a.indexOf("해당 단계 전의 경로"))), ...old00])].filter((p) => p.startsWith("/")).map((p) => routeRule(p, { self: true }));
})();

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const before0 = {};
let crawl = null;
let cleaned = false;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 1500);
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const slugOf = (label) => `e2e-w2b-${label}-${staff.run}`;

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function expectStatus(promise, status, what) {
  const r = await promise;
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  return r;
}

// ── 편집국 API로 자료 만들기 ─────────────────────────────

async function createArticle(label, user, input) {
  const r = await expectStatus(api("POST", "/articles", user, { slug: slugOf(label), ...input }), 201, `기사 만들기 ${label}`);
  const id = r.body.article.id;
  staff.trackArticle(id);
  fx[label] = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, title: input.title };
  return fx[label];
}
const addSource = async (a, user, s) => (await expectStatus(api("POST", `/articles/${a.id}/sources`, user, s), 201, `출처 ${a.slug}`)).body.source.ref;
const addEvidence = async (a, user, e) => (await expectStatus(api("POST", `/articles/${a.id}/evidence`, user, e), 201, `근거 ${a.slug}`)).body.evidence.ref;
const patchArticle = (a, user, body) => expectStatus(api("PATCH", `/articles/${a.id}`, user, body), 200, `고치기 ${a.slug}`);
// 지역 기사 편집 승인은 근거·관계·광고 독립성 3항목을 함께 남긴다 (REG1-17 — W4 7단계, 지역 기사가 아니면 서버가 보지 않는다)
const REGIONAL_CHECKS = { evidence: true, relation: true, ad_independence: true };
const deskApprove = (a, checklist) => expectStatus(api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: { ...REGIONAL_CHECKS, ...(checklist ?? {}) } }), 201, `편집 승인 ${a.slug}`);
const taxApprove = (a) => expectStatus(api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" }), 201, `세무 감수 ${a.slug}`);
const publish = (a) => expectStatus(api("POST", `/articles/${a.id}/publish`, u.editor), 200, `발행 ${a.slug}`);
/** 「지방세로 읽기」 생략 사유 — 편집 책임자만 (CORE-01) */
const skipTaxLens = (a, reason) => patchArticle(a, u.editor, { taxLens: { topics: [], points: [], links: [], omissionReason: reason } });

// W4 5단계 (REG1-09 · PR-07) — 공식 자료는 공공누리 유형·발표일·기준일·지역 단위·수집일이 있어야 발행된다 (시험용 값)
const OFFICIAL_W4 = { licenseType: "kogl_1", publishedOn: "2026-10-01", referenceDate: "2026-10-01", regionUnit: "전국", collectedAt: "2026-10-10T09:00:00+09:00" };
const LAW_SOURCE = {
  kind: "official_doc",
  title: "지방세법 제20조(신고 및 납부)",
  url: "https://www.law.go.kr/법령/지방세법/제20조",
  sourceName: "법제처 국가법령정보센터",
  lastVerifiedAt: "2026-10-10T09:00:00+09:00",
  licenseStatus: "공공저작물 자유이용",
  ...OFFICIAL_W4,
};
const interview = (role, n) => ({
  evidenceType: "interview",
  location: `편집국 취재 기록함 R-2026-1013-0${n}`,
  rightsStatus: "confirmed",
  verificationStatus: "verified",
  verifiedAt: "2026-10-13T10:00:00+09:00",
  retentionUntil: "2031-10-13",
  interview: { subjectRole: role, contactedAt: "2026-10-13T10:00:00+09:00", recordLocation: `편집국 취재 기록함 R-2026-1013-0${n}`, quoteConsent: "full", anonymity: "named" },
});
const documentEvidence = (location) => ({ evidenceType: "document", location, rightsStatus: "confirmed", verificationStatus: "verified", verifiedAt: "2026-10-14T10:00:00+09:00", retentionUntil: "2031-10-14" });
const slide = (n) => ({ type: "slide", title: `${n}. 취득세 신고`, text: `${n}번째 장 — 잔금일과 등기일 중 빠른 날부터 60일 안에 신고합니다.`, alt: `${n}번째 장 — 달력 위에 신고 날짜를 표시한 그림` });

/** 정량형 보도 — 가상 도시 가온시(경기) 취득세 징수 (실제 통계 아님). 원자료 출처·근거·재현 정보 → 관계자 확인 → 생략 사유 → 편집 승인(인과 단정 없음) → 발행 */
async function seedQuantReport() {
  const a = await createArticle("quant", u.reporter2, {
    title: `가온시 상반기 취득세 징수액 1년 전보다 줄어 ${staff.run}`,
    summary: "가온시의 올해 상반기 취득세 징수액이 1년 전보다 줄었습니다. 편집국이 세목별 징수 실적을 집계했습니다.",
    section: "local",
    categoryId: fx.cat["local/reporting"],
    contentType: "reported_news",
    reportingMethod: "quantitative",
    editorialField: "local_tax",
    regionCodes: [GYEONGGI],
    publicQuestion: "거래 감소가 가온시 취득세 세수에 어떤 영향을 주는가",
    checklists: {
      quantitative: {
        sourceCrossCheck: "징수 실적 파일 구별 합계를 재정공시 화면 값과 2026-10-09에 대조함",
        limitations: "상관관계만 확인 — 감면 확대·신고 시점 요인은 분리하지 않음",
        relatedPartyCheck: "가온시 세정과 관계자 전화 확인(2026-10-08)",
      },
    },
  });
  const src = await addSource(a, u.reporter2, {
    kind: "dataset",
    title: "가온시 지방세 세목별 징수 실적(2026년 6월 말)",
    url: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
    sourceName: "가온시 세정과",
    lastVerifiedAt: "2026-10-07T10:00:00+09:00",
    licenseStatus: "공공누리 제1유형",
    ...OFFICIAL_W4,
    sourceType: "local_tax_revenue",
    referenceDate: "2026-06-30",
    regionUnit: "시·구",
  });
  const ev = await addEvidence(a, u.reporter2, {
    evidenceType: "dataset",
    location: "편집국 자료실/2026/e2e/징수실적_2026H1.xlsx",
    rightsStatus: "confirmed",
    verificationStatus: "verified",
    verifiedAt: "2026-10-09T10:00:00+09:00",
    retentionUntil: "2031-10-09",
    dataset: {
      definition: "취득세 징수액 — 신고·납부가 끝난 취득세(지방교육세 제외)",
      period: "2025년·2026년 각 1월 1일~6월 30일",
      unit: "억 원",
      regionUnit: "시·구",
      denominator: "2025년 같은 기간 징수액(1,574억 원)",
      exclusions: "지방교육세·농어촌특별세, 과오납 환급분",
      transform: "구별 징수액 합산, 증감률 = (2026년 − 2025년) ÷ 2025년",
      reproFileHash: "sha256:3f6c1a9d0b7e45c2a8f1d6e9b4c7a2e5f8d1c4b7a0e3f6c9d2b5a8e1f4c7d0b3",
      provider: "가온시 세정과",
      sourceUrl: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
      collectedAt: "2026-10-07",
      license: "공공누리 제1유형",
    },
  });
  await patchArticle(a, u.reporter2, {
    body: {
      blocks: [
        { type: "key_summary", lines: ["가온시 상반기 취득세 징수액은 1,284억 원으로 1년 전보다 18.4% 줄었습니다.", "같은 기간 아파트 매매 거래는 21.6% 줄었습니다."] },
        { type: "paragraph", text: "편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다. 지난해 같은 기간보다 290억 원 적다." },
        { type: "table", caption: "가온시 구별 취득세 징수액(1~6월)", rows: [["구", "2026년(억 원)"], ["한빛구", "512"], ["누리구", "431"], ["가람구", "341"]], chart: { axis: "구", unit: "억 원", source: "가온시 세목별 징수 실적(편집국 집계)" } },
        { type: "paragraph", text: "이 수치는 거래량과 세수가 함께 줄었다는 사실만 보여 준다. 감면 확대 같은 다른 요인은 따로 떼어 보지 않았다. 지난 지역 소식은 [가온시 소식](/region/gyeonggi/gaon)에서 볼 수 있었다." },
      ],
      claims: [{ id: "claim-1", text: "올해 1~6월 가온시 취득세 징수액은 1,284억 원이다.", kind: "fact", evidenceIds: [ev, src], blockIndex: 1 }],
    },
  });
  await skipTaxLens(a, "징수 실적 보도 — 세금 계산 해설은 별도 해설 기사로");
  await deskApprove(a, { noCausalClaim: true });
  await publish(a);
}

/** 정성형 보도 — 인터뷰 2·문서 근거·인용 기록·필수 기록 4 → 생략 사유(박스 대상 분야) → 편집 승인 → 발행 */
async function seedQualReport(label, { user, section, categoryKey, title, summary, regionCodes = [], editorialField, publicQuestion, paragraphs, quote, needsTaxLens }) {
  const a = await createArticle(label, user, {
    title: `${title} ${staff.run}`,
    summary,
    section,
    categoryId: fx.cat[categoryKey],
    contentType: "reported_news",
    reportingMethod: "qualitative",
    legalBasisDate: "2026-10-01",
    regionCodes,
    // 지역 태그 기사는 편집 분야·공익적 질문 (REG1-17)
    ...(editorialField ? { editorialField } : {}),
    ...(publicQuestion ? { publicQuestion } : {}),
    checklists: {
      qualitative: {
        interviewQuestions: "① 무엇이 어려운지 ② 준비에 걸리는 시간 ③ 기관의 안내 방식",
        fieldRecord: "2026-10-13 현장 방문, 당사자 2명 면담",
        counterPerspective: "기관은 절차가 간단하다고 설명 — 당사자·전문가의 부담 관점을 함께 실음",
        conflictsOfInterest: "취재 대상과 SM 사이 광고·제휴·자문 관계 없음(2026-10-14 확인)",
      },
    },
  });
  await addSource(a, user, { ...LAW_SOURCE, title: "지방세특례제한법 해당 조문", url: "https://www.law.go.kr/법령/지방세특례제한법" });
  const voice = await addEvidence(a, user, interview(quote.role, 1));
  await addEvidence(a, user, interview("세무사", 2));
  await addEvidence(a, user, documentEvidence("편집국 자료실/2026/1014/안내문_원문.pdf"));
  await patchArticle(a, user, {
    body: {
      blocks: [
        { type: "key_summary", lines: [summary] },
        { type: "paragraph", text: paragraphs[0] },
        { type: "quote", text: quote.text, speaker: quote.speaker, origin: "interview", refId: voice },
        { type: "paragraph", text: paragraphs[1] },
      ],
      claims: [],
    },
  });
  if (needsTaxLens) await skipTaxLens(a, "현장 취재 기사 — 세금 계산 해설은 별도 해설 기사로");
  await deskApprove(a);
  await publish(a);
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  Object.assign(before0, await residue());

  // 출발점 — 공개 기사·트래커·상황 0, 기능 공개 목록 모두 꺼짐 (홈 섹션·허브 상한·숨긴 메뉴 판정이 이 자료로만 정해진다)
  assert.equal((await one("select count(*)::int n from public.articles where status = 'published'")).n, 0, "로컬 DB에 공개 기사가 남아 있다");
  assert.equal((await one("select count(*)::int n from public.amendments where status = 'public'")).n, 0, "로컬 DB에 공개 트래커가 남아 있다");
  assert.equal((await one("select count(*)::int n from public.situations")).n, 0, "로컬 DB에 상황 카드가 남아 있다");
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.ok(Object.values(flags).every((v) => v === false), "시험 전 기능 공개 목록이 모두 꺼져 있어야 한다");

  u.editor = await staff.createUser({ label: "w2b-editor", roles: ["editor"], person: { name: "한도윤", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w2b-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  u.reporter2 = await staff.createUser({ label: "w2b-reporter2", roles: ["reporter"], person: { name: "이나래", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w2b-reviewer", roles: ["reviewer"], person: { name: "이감수 세무사", roles: ["reviewer"] } });
  u.writer = await staff.createUser({ label: "w2b-writer", roles: ["reporter"], person: { name: "박필자", roles: ["writer"] } });
  u.admin = await staff.createUser({ label: "w2b-admin", email: ADMIN_EMAIL });
  for (const [k, who] of Object.entries({ reporter: u.reporter, reporter2: u.reporter2, writer: u.writer, reviewer: u.reviewer })) {
    fx[`${k}Slug`] = (await one("select slug from public.people where id = $1", [who.personId])).slug;
  }
  fx.cat = Object.fromEntries((await db.query("select id, section, slug from public.categories")).rows.map((r) => [`${r.section}/${r.slug}`, Number(r.id)]));

  // 개정 트래커 — 공개 개정안 1건(입법예고 — 확정 전). 트래커 단계 기록 API는 01B W3이라 DB에 직접 (첫 화면 요청 전)
  const am = await one("insert into public.amendments (slug, title, status, law_names) values ($1, $2, 'public', $3) returning id", [
    slugOf("amendment"),
    `2026년 지방세제 개편안 (시험 ${staff.run})`,
    ["지방세법", "지방세특례제한법"],
  ]);
  fx.amendmentId = Number(am.id);
  staff.trackRow("amendments", fx.amendmentId);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e/notice', 'h', '입법예고 원문') returning id");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', $2, 'https://www.mois.go.kr/e2e/notice', $3, 'user:e2e')",
    [fx.amendmentId, kstDay(-5), snap.id],
  );

  // 용어 (편집 책임자 — 사전 API)
  for (const [key, term, plain, section] of [
    ["termTax", "과세표준", "세금을 매기는 기준 금액", "tax"],
    ["termRe", "관리처분인가", "재건축·재개발에서 새 집 배분 계획을 구청이 승인하는 것", "realestate"],
  ]) {
    const r = await expectStatus(api("POST", "/glossary", u.editor, { term: `${term} ${staff.run}`, plain, section: [section], visible: true }), 201, `용어 ${term}`);
    fx[key] = Number(r.body.term.id);
    staff.trackRow("glossary_terms", fx[key]);
  }

  // ── 기사 (편집국 API) ──
  // 보도 3 — 정량형(지자체뉴스·경기 태그) · 정성형(부동산·서울 태그) · 정성형(지방세)
  await seedQuantReport();
  await seedQualReport("qual-re", {
    user: u.reporter,
    section: "realestate",
    categoryKey: "realestate/projects",
    regionCodes: [SEOUL],
    editorialField: "realestate",
    publicQuestion: "재건축 조합원은 취득세 안내를 어디서 찾는가",
    needsTaxLens: true,
    title: "재건축 조합원, 취득세 안내 찾기 어렵다",
    summary: "조합원들은 입주권을 산 뒤 취득세 안내를 찾기 어렵다고 말했습니다.",
    paragraphs: [
      "서울의 한 재건축 단지 조합원 두 명을 만나 보니 입주권을 산 뒤 언제 무엇을 신고하는지 안내를 찾기 어려웠다고 했다.",
      "세무사는 관리처분인가 뒤에는 토지분과 건물분을 나눠 확인하라고 조언했다. 지난 기사는 [부동산 자료실](/resources/realestate)에 있었다.",
    ],
    quote: { role: "재건축 조합원", speaker: "재건축 조합원 A씨", text: "언제 신고해야 하는지 알려 주는 곳이 없었습니다." },
  });
  await seedQualReport("qual-tax", {
    user: u.reporter,
    section: "tax",
    categoryKey: "tax/interpretations",
    needsTaxLens: false,
    title: "착한 임대인 재산세 감면, 신청이 적은 이유는",
    summary: "임대인들은 증빙서류를 모으는 부담을 가장 큰 어려움으로 꼽았습니다.",
    paragraphs: [
      "누리구 상가 세 곳을 찾아가 보니 임대인 두 명은 감면 제도를 알고 있었지만 신청하지 않았다. 임대료 입금 내역을 따로 챙겨 두지 않았기 때문이다.",
      "시는 신청 절차가 간단하다고 설명했다. 세무사는 특수관계인인지부터 확인하라고 조언했다.",
    ],
    quote: { role: "상가 임대인", speaker: "누리구 상가 임대인 B씨", text: "증빙을 모으는 데만 일주일이 걸렸습니다." },
  });

  // 세법 해설 — 출처·법률 주장 → 편집 승인 → 세무 감수 → 발행 → 정정 1건 (ART-02 정정 이력). 개정안 연결(트래커 블록 — 트래커 페이지는 꺼짐)
  const explainer = await createArticle("explainer", u.reporter, {
    title: `주택 취득세, 잔금일부터 60일 안에 신고 ${staff.run}`,
    summary: "주택을 사면 취득일부터 60일 안에 취득세를 신고하고 냅니다.",
    section: "tax",
    categoryId: fx.cat["tax/interpretations"],
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    amendmentId: fx.amendmentId,
  });
  const law = await addSource(explainer, u.reporter, LAW_SOURCE);
  fx.explainerBlocks = [
    { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다."] },
    { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서, 예상 세액은 [취득세 계산기](/calc)에서 볼 수 있다." },
    { type: "paragraph", text: "낯선 말은 [용어사전](/glossary)에 풀어 두었다. 이 기사는 [편집 원칙](/about/editorial-policy)에 따라 세무 감수를 거쳤다." },
    { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
    { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }] },
  ];
  await patchArticle(explainer, u.reporter, { body: { blocks: fx.explainerBlocks, claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [law], blockIndex: 1 }] } });
  await deskApprove(explainer);
  await taxApprove(explainer);
  await publish(explainer);
  const fixed = fx.explainerBlocks.map((b, i) => (i === 3 ? { ...b, text: "계약일이 아니라 잔금일과 등기일 중 빠른 날이 취득일입니다." } : b));
  await expectStatus(
    api("POST", `/articles/${explainer.id}/corrections`, u.editor, { kind: "correction", reason: "취득일 설명 보완", readerNotice: "취득일을 '잔금일과 등기일 중 빠른 날'로 바로잡았습니다", changes: { body: { blocks: fixed, claims: [] } } }),
    201,
    "정정",
  );

  // 「지방세로 읽기」 박스 기사 — 부동산 해설(서울 태그), 박스 → 편집 승인 → 세무 감수(서명 기록) → 발행
  const lens = await createArticle("lens", u.reporter, {
    title: `재건축 입주권, 취득세는 언제 내나 ${staff.run}`,
    summary: "관리처분인가 뒤 입주권을 사면 취득세가 어떻게 되는지 정리했습니다.",
    section: "realestate",
    categoryId: fx.cat["realestate/development-methods"],
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    regionCodes: [SEOUL],
    editorialField: "realestate",
    publicQuestion: "입주권을 산 사람은 취득세를 언제 내는가",
    body: { blocks: [{ type: "paragraph", text: "입주권은 토지에 대한 권리로 봅니다. 준공 뒤에는 건물분 취득세를 따로 냅니다." }], claims: [] },
    taxLens: { topics: ["취득세"], points: ["입주권 취득은 토지분 취득세 대상입니다.", "준공 뒤 건물분은 따로 신고합니다."], links: [{ kind: "explainer", label: "취득세 신고 해설", url: explainer.href }], omissionReason: null },
  });
  await deskApprove(lens);
  await taxApprove(lens);
  await publish(lens);

  // 카드뉴스 5장
  const cards = await createArticle("cards", u.reporter, {
    title: `카드뉴스로 보는 취득세 신고 ${staff.run}`,
    summary: "취득세 신고를 다섯 장으로 정리했습니다.",
    section: "tax",
    contentType: "explainer",
    format: "cardnews",
    legalBasisDate: "2026-10-01",
    body: { blocks: [1, 2, 3, 4, 5].map(slide), claims: [] },
  });
  await deskApprove(cards);
  await publish(cards);

  // 해결 사례 — 4칸·결론·결과 근거 → 편집 승인 → 세무 감수 → 발행 (CAT-05)
  const solved = await createArticle("solved", u.reporter, {
    title: `계약일부터 세다 신고가 늦은 사례 ${staff.run}`,
    summary: "신고 기간을 계약일부터 세다 늦어진 사례입니다.",
    section: "tax",
    categoryId: fx.cat["tax/interpretations"],
    contentType: "explainer",
    subtype: "solved_case",
    legalBasisDate: "2026-10-01",
    body: { blocks: [{ type: "paragraph", text: "신고 기간은 잔금일과 등기일 중 빠른 날부터 셉니다." }], claims: [] },
    solvedCase: {
      situation: "한 납세자는 계약일부터 60일을 세어 신고했다.",
      issue: "신고 기간을 계약일부터 세는지가 쟁점이었다.",
      result: "심판기관은 잔금일을 취득일로 보았다.",
      lesson: "신고 기간은 잔금일과 등기일 중 빠른 날부터 셉니다.",
      resultEvidence: [{ kind: "decision", number: "조심2025지0001", url: "https://decisions.example.kr/tt/2025-ji-0001" }],
      conclusion: "rejected",
    },
  });
  await deskApprove(solved);
  await taxApprove(solved);
  await publish(solved);

  // 칼럼 연재 「시험용 지방세 연재」 1·2회 (필자 박필자 — 연재 이름 칸에 경력 연수 표기('50년' 등)는 W3 8단계부터 거부) — 2회 본문은 1회로 잇고, 옛 요금 주소·옛 지방세봇 주소를 품고 있다
  for (const [label, episode, text] of [
    ["col1", 1, "취득세가 지방세가 된 1976년의 이야기로 연재를 시작한다."],
    ["col2", 2, "[지난 회](/news/" + slugOf("col1") + ")에 이어 등록세와 합쳐진 2011년을 돌아본다. 옛 사이트의 [구독 안내](/pricing)와 [지방세봇](/ask)은 이제 없다."],
  ]) {
    const col = await createArticle(label, u.writer, {
      title: `지방세 50년 ${episode}회 ${staff.run}`,
      summary: "지방세 제도가 걸어온 길을 회차마다 돌아봅니다.",
      section: "tax",
      categoryId: fx.cat["tax/columns"],
      contentType: "opinion",
      seriesTitle: "시험용 지방세 연재",
      seriesEpisode: episode,
      legalBasisDate: "2026-10-01",
      body: { blocks: [{ type: "paragraph", text }], claims: [] },
    });
    await deskApprove(col);
    await publish(col);
  }

  // 삭제될 기사(발행 → 삭제 = 410) · 초안(404)
  const gone = await createArticle("gone", u.reporter, { title: `곧 내릴 기사 ${staff.run}`, summary: "삭제 안내 시험", section: "tax", contentType: "explainer", legalBasisDate: "2026-10-01", body: { blocks: [{ type: "paragraph", text: "곧 내릴 기사입니다." }], claims: [] } });
  await deskApprove(gone);
  await publish(gone);
  await expectStatus(api("POST", `/articles/${gone.id}/corrections`, u.editor, { kind: "deletion", reason: "권리 확인 문제로 내림" }), 201, "삭제");
  await createArticle("draft", u.reporter, { title: `아직 초안 ${staff.run}`, section: "tax", contentType: "explainer" });

  // ── 상황 카드 (작성 → 세무 감수 서명 → 공개·허브 자리) ──
  async function situation(label, input, hubSlot) {
    const r = await expectStatus(api("POST", "/situations", u.reporter, { slug: slugOf(label), ...input }), 201, `상황 ${label}`);
    const id = r.body.situation.id;
    staff.trackRow("situations", id);
    const row = await one("select updated_at from public.situations where id = $1", [id]);
    await expectStatus(api("POST", `/situations/${id}/review`, u.reviewer, { updatedAt: row.updated_at.toISOString() }), 200, `감수 서명 ${label}`);
    await expectStatus(api("PATCH", `/situations/${id}`, u.editor, { visible: true, hubSlot }), 200, `공개 ${label}`);
    fx[label] = { id, slug: slugOf(label), href: `/situations/${slugOf(label)}` };
  }
  await situation(
    "sit-car",
    {
      section: "tax",
      title: "차를 팔았어요·폐차했어요",
      subtitle: "돌려받을 자동차세가 있는지 확인합니다",
      pictogram: "car-sold",
      checks: [{ title: "자동차세를 1년치 미리 냈는지", note: "납부 내역을 찾아 둡니다" }, { title: "등록 말소일" }, { title: "환급 받을 계좌" }],
      mistakes: ["판 날이 아니라 등록 말소일 기준으로 계산합니다"],
      articleIds: [fx.explainer.id, fx["qual-tax"].id],
      solvedCaseIds: [fx.solved.id],
      glossaryIds: [fx.termTax],
      toolLinks: ["sm_calculator"],
    },
    1,
  );
  await situation(
    "sit-home",
    {
      section: "realestate",
      title: "집을 샀어요",
      subtitle: "취득세 신고와 감면을 먼저 확인합니다",
      pictogram: "home-bought",
      checks: [{ title: "잔금일과 등기일" }, { title: "생애 첫 주택인지" }, { title: "60일 안에 신고하는지" }],
      checklist: { items: ["매매계약서", "잔금 영수증", "등기권리증"], notice: "일반적인 준비물입니다. 개별 사정은 전문가와 확인하세요." },
      articleIds: [fx.lens.id, fx["qual-re"].id],
      glossaryIds: [fx.termRe],
      regionSelect: true,
    },
    1,
  );

  // ── 홈 배치 (편집 책임자) — 트래커 1 · 해설 스토리 3 ──
  for (const [kind, targetId, sort] of [
    ["tracker", fx.amendmentId, 10],
    ["story", fx.explainer.id, 10],
    ["story", fx.lens.id, 20],
    ["story", fx.cards.id, 30],
  ]) {
    const r = await expectStatus(api("POST", "/home-curations", u.editor, { kind, targetId, startsOn: kstDay(0), sort }), 201, `홈 배치 ${kind} ${targetId}`);
    staff.trackRow("home_curations", r.body.curation.id);
  }

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    if (!cleaned) await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

/** 시험이 행을 남기지 않았는지 보는 표 — 행 수와 운영 설정 값 */
async function residue(client = db) {
  const tables = [
    "articles",
    "article_revisions",
    "article_sources",
    "article_evidence",
    "article_datasets",
    "article_interviews",
    "article_corrections",
    "article_tombstones",
    "editorial_reviews",
    "seo_checks",
    "raw_snapshots",
    "inquiries",
    "situations",
    "home_curations",
    "amendments",
    "amendment_events",
    "glossary_terms",
    "people",
    "staff_roles",
    "audit_logs",
    "media",
    "partners",
    "categories",
  ];
  const out = {};
  for (const t of tables) out[t] = (await client.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  out["auth.users"] = (await client.query("select count(*)::int n from auth.users")).rows[0].n;
  out.settings = JSON.stringify((await client.query("select key, value from public.settings order by key")).rows);
  return out;
}

async function open(p, viewport = DESKTOP) {
  const page = await browser.newPage({ viewport });
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, status: res.status() };
}
const sectionLayout = (page) =>
  page.$$eval("[data-home-section]", (els) => els.map((e) => ({ key: e.getAttribute("data-home-section"), top: e.getBoundingClientRect().top + window.scrollY, links: e.querySelectorAll("a[href]").length, text: e.textContent.trim().length })));

// ── 1) 홈 섹션 순서 ─────────────────────────────────────

test("1) 홈 섹션 순서 = PRD_최종 §4.1 — DOM 순서·화면 위치(360·1280), 내용이 있는 섹션만(히어로·4대 분야·최신 자체 취재·개정 트래커), 빈 섹션 요소 0", async () => {
  assert.deepEqual(PRD_HOME.map((n) => PRD_HOME_NAMES[n]), HOME_ORDER, "설계 2.3 home_sections = PRD_최종 §4.1 홈 줄");
  for (const viewport of [MOBILE, DESKTOP]) {
    const { page, status } = await open("/", viewport);
    assert.equal(status, 200);
    const layout = await sectionLayout(page);
    const keys = layout.map((s) => s.key);
    // 금주 핫뉴스(01B W6)·김의효 칼럼·자사 상품·전문가(01C)는 데이터가 없다 — 섹션 요소째 0
    assert.deepEqual(keys, ["hero", "fields", "latest_reports", "amendments"], `${viewport.width}px`);
    assert.deepEqual(keys, HOME_ORDER.filter((k) => keys.includes(k)), "DOM 순서 = PRD 순서");
    for (let i = 1; i < layout.length; i++) assert.ok(layout[i].top > layout[i - 1].top, `${viewport.width}px: ${layout[i].key}가 ${layout[i - 1].key}보다 아래`);
    for (const s of layout) assert.ok(s.text > 0 && (s.key === "hero" || s.links > 0), `${s.key}: 빈 섹션 0 (글자 ${s.text} · 링크 ${s.links})`);
    assert.equal(await page.getByText("준비 중").count(), 0, "'준비 중' 0");
    // 섹션 제목 = PRD 화면 이름
    assert.equal((await page.locator('[data-home-section="latest_reports"] h2').textContent()).trim(), "최신 자체 취재");
    assert.equal((await page.locator('[data-home-section="amendments"] h2').textContent()).trim(), "개정 트래커 하이라이트");
    // 섹션 내용 — 편집 승인된 보도 3건 최신 순(해설·칼럼·카드뉴스 0) · 지정 트래커 1(확정 아님 1) · 지정 스토리 3(배치 순)
    const reports = await page.$$eval('[data-part="latest-reports"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id"))));
    assert.deepEqual(reports, [fx["qual-tax"].id, fx["qual-re"].id, fx.quant.id]);
    assert.deepEqual([...new Set(await page.$$eval('[data-part="latest-reports"] [data-ui="article-type-badge"]', (els) => els.map((e) => e.textContent)))], ["보도"]);
    const trackers = await page.$$eval('[data-part="tracker-card"]', (cs) => cs.map((c) => [Number(c.getAttribute("data-tracker-id")), c.getAttribute("data-stage"), c.querySelectorAll('[data-ui="unconfirmed-chip"]').length]));
    assert.deepEqual(trackers, [[fx.amendmentId, "pre_notice", 1]]);
    assert.deepEqual(await page.$$eval('[data-part="stories"] [data-story-id]', (els) => els.map((e) => Number(e.getAttribute("data-story-id")))), [fx.explainer.id, fx.lens.id, fx.cards.id]);
    assert.equal(await page.locator('[data-ui="situation-card"]').count(), 0, "홈 HTML에 상황 카드 섹션 0 (UX-05)");
    await page.close();
  }
});

// ── 2) 화면 규칙 R1~R3 ──────────────────────────────────

test("2) 화면 규칙 R1·R2·R3 — 홈·허브(/tax)·상황 페이지·기사 상세, 폭 360·640·1024 (R1은 360×740 첫 화면)", async () => {
  const screens = [
    ["홈", "/"],
    ["허브", "/tax"],
    ["상황", fx["sit-car"].href],
    ["기사 상세", fx.explainer.href],
  ];
  const results = [];
  for (const [name, p] of screens) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      r.url = `${name} ${p.replace(staff.run, "…")}`;
      // R1은 360×740 첫 화면 규칙이다 — 640·1024의 글자 수는 기록만 한다 (run-screen-rules와 같다)
      if (width !== 360) r.r1 = { ...r.r1, pass: true };
      results.push(r);
      assert.ok(r.r1.pass, `${name} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${name} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${name} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
  const out = path.join(ROOT, "e2e", "reports");
  fs.mkdirSync(out, { recursive: true });
  // 640·1024의 R1 칸은 '기록' — 판정하지 않은 값을 '통과'로 적지 않는다
  const table = toTable(results)
    .split("\n")
    .map((line) => (/\| (640|1024)x740 \|/.test(line) ? line.replace(/\| (\d+)자 통과 \|/, "| $1자 기록 |") : line))
    .join("\n");
  fs.writeFileSync(path.join(out, "w2b-acceptance-screen-rules.md"), `# W2-b 수용 — 화면 규칙 (PRD-00 8.2)\n\n측정 시각 ${new Date().toISOString()} · R1은 360×740만 판정(640·1024 글자 수는 기록)\n\n${table}\n`);
});

// ── 3) 이어 걷기 — 문서 새로고침 0 ───────────────────────

test("3) 이어 걷기 — 사이트 안 링크 15곳을 차례로 누르고 뒤로 끝까지: 문서 새로고침 0·페이지 표식 유지·navigation 1, 뒤로 가기 뒤 스크롤 위치 (FND-09)", async () => {
  const { page } = await open("/", DESKTOP);
  await page.evaluate(() => (window.__e2eMarker = "kept"));
  const documents = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
  });
  const visited = [{ path: "/", ready: '[data-home-section="fields"]' }];
  const here = () => {
    const u0 = new URL(page.url());
    return u0.pathname + u0.search;
  };
  /** 링크 하나를 누르고 다음 화면을 기다린다 — 주소·화면 표식이 그 화면이어야 한다 */
  async function go(selector, expectPath, ready, before) {
    const link = page.locator(selector).first();
    await link.waitFor({ state: "attached" });
    if (before) await before(link);
    await link.click();
    await page.waitForURL((url) => url.pathname + url.search === expectPath);
    await page.locator(ready).first().waitFor();
    visited.push({ path: expectPath, ready });
  }
  const hub = (k) => `[data-ui="hub"][data-hub="${k}"]`;
  await go('nav[aria-label="분야 메뉴"] a[href="/tax"]', "/tax", hub("tax"));
  await go('[data-ui="tab-nav"] a[href="/tax/interpretations"]', "/tax/interpretations", '[data-ui="category-list"]');
  await go(`[data-part="category-articles"] a[href="${fx.explainer.href}"]`, fx.explainer.href, '[data-ui="article-page"]');
  await go('[data-article-part="head"] [data-part="byline"] a', `/people/${fx.reporterSlug}`, '[data-ui="person-page"]');
  // 헤더 하위 메뉴 → 칼럼 목록 (분야 데이터에서 만든 하위 메뉴, HOME-02)
  await page.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" }).click();
  await go('[data-menu-section="tax"] [data-part="sub-link"][href="/tax/columns"]', "/tax/columns", '[data-ui="column-list"]');
  await go(`[data-ui="column-list"] a[href="${fx.col1.href}"]`, fx.col1.href, '[data-part="series"]');
  await go('[data-ui="reporter-block"] a[href^="/people/"]', `/people/${fx.writerSlug}`, '[data-ui="person-page"]');
  await go('header a[href="/"]', "/", '[data-home-section="fields"]');
  // 홈 아래쪽 카드 — 누르기 전 스크롤 위치를 기억해 뒤로 가기에서 비교한다
  let homeScroll = 0;
  await go(`[data-part="latest-reports"] a[href="${fx.quant.href}"]`, fx.quant.href, '[data-ui="article-page"]', async (link) => {
    await link.scrollIntoViewIfNeeded();
    homeScroll = await page.evaluate(() => window.scrollY);
  });
  assert.ok(homeScroll > 0, "홈 아래쪽 카드라 스크롤된 상태에서 누른다");
  await page.goBack();
  await page.waitForURL(`${base}/`);
  await page.locator('[data-home-section="latest_reports"]').waitFor();
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, homeScroll, { timeout: 5000 }).catch(() => {});
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - homeScroll) <= 2, `뒤로 가기 뒤 홈 스크롤 위치 ${homeScroll}px로 돌아온다 (FND-09)`);
  visited.pop();
  await go('[data-ui="field-cards"] a[href="/realestate"]', "/realestate", hub("realestate"));
  await go(`[data-part="hub-situations"] a[href="${fx["sit-home"].href}"]`, fx["sit-home"].href, '[data-ui="situation-page"]');
  await go(`[data-situation-part="region"] [data-region-code="${SEOUL}"]`, `${fx["sit-home"].href}?region=${SEOUL}`, '[data-part="region-article-list"]');
  await go(`[data-part="region-article-list"] a[href="${fx.lens.href}"]`, fx.lens.href, '[data-ui="tax-lens-box"]');
  await go(`[data-ui="tax-lens-box"] a[href="${fx.explainer.href}"]`, fx.explainer.href, '[data-ui="article-page"]');
  await go('[data-ui="next-action-band"] [data-next-action="situation"] a', fx["sit-car"].href, '[data-ui="situation-page"]');
  const clicks = visited.length - 1;
  assert.ok(clicks >= 10, `사이트 안 링크 ${clicks}곳 (FND-09 — 10곳 이상)`);
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept", "앞으로 — 페이지 표식 유지");

  // 뒤로 끝까지 — 걸어온 화면을 거꾸로, 같은 문서
  for (let i = visited.length - 2; i >= 0; i--) {
    await page.goBack();
    await page.waitForURL((url) => url.pathname + url.search === visited[i].path);
    await page.locator(visited[i].ready).first().waitFor();
    assert.equal(here(), visited[i].path);
  }
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept", "뒤로 — 페이지 표식 유지");
  assert.deepEqual(documents, [], "문서 요청 0 — 모든 이동이 화면 전환");
  assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation").length), 1);
  await page.close();
});

// ── 4) 링크 전수 ────────────────────────────────────────

/** 페이지 안 — 링크마다 실제로 눌러(합성 클릭) 앱이 받는지(기본 동작 취소 = 화면 전환) 본다. 기본 동작은 창 단계에서 막아 페이지를 떠나지 않는다 */
function inspectPage() {
  const vw = document.documentElement.clientWidth;
  const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content") ?? "");
  const header = document.querySelector("header");
  let prevented = null;
  // 앱이 시작한 화면 전환의 RSC 요청(주소에 _rsc)은 보내지 않고 끝나지 않게 둔다 — 지금 페이지를 계속 재고, 서버에 반쯤 받다 끊는 요청을 만들지 않는다.
  // 되돌리지 않는다(화면 전환은 클릭 뒤에 이어서 요청한다) — 이 페이지는 재고 나서 닫는다
  const realFetch = window.fetch;
  window.fetch = (input, init) => (String(input instanceof Request ? input.url : input).includes("_rsc=") ? new Promise(() => {}) : realFetch(input, init));
  const onClick = (e) => {
    prevented = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener("click", onClick);
  const links = [];
  try {
    for (const a of document.querySelectorAll("a[href]")) {
      const raw = a.getAttribute("href");
      prevented = null;
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, view: window }));
      const url = new URL(a.href, location.href);
      links.push({
        raw,
        origin: url.origin,
        path: url.pathname,
        search: url.search,
        inPage: raw.startsWith("#"),
        target: a.getAttribute("target"),
        download: a.hasAttribute("download"),
        client: prevented === true,
        inHeader: header ? header.contains(a) : false,
        text: (a.textContent ?? "").trim().slice(0, 40),
      });
    }
  } finally {
    window.removeEventListener("click", onClick);
  }
  return {
    overflow: document.documentElement.scrollWidth - vw,
    robots,
    h1: document.querySelectorAll("h1").length,
    headerText: header?.textContent ?? "",
    sectionLinks: [...document.querySelectorAll('nav[aria-label="분야 메뉴"] [data-part="section-link"]')].map((x) => x.getAttribute("href")),
    links,
  };
}

test("4) 링크 전수 — 홈에서 닿는 사이트 안 페이지 전부를 360×740으로 연다 (최대 200쪽)", async () => {
  const context = await browser.newContext({ viewport: MOBILE });
  const pages = new Map();
  const queue = ["/"];
  const referrer = new Map([["/", "(시작)"]]);
  const errors = [];
  const perTemplate = new Map();
  let skippedSameTemplate = 0;
  try {
    while (queue.length && pages.size < CRAWL_CAP) {
      const url = queue.shift();
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push({ url, error: e.message }));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push({ url, error: m.text() });
      });
      const res = await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
      const info = await page.evaluate(inspectPage);
      pages.set(url, { status: res.status(), from: referrer.get(url), ...info });
      for (const l of info.links) {
        if (l.origin !== new URL(base).origin || l.inPage) continue;
        const key = l.path + l.search;
        if (!referrer.has(key)) {
          referrer.set(key, url);
          const t = templateKey(key);
          const n = t ? (perTemplate.get(t) ?? 0) : 0;
          if (t && n >= SAME_TEMPLATE_CAP) {
            skippedSameTemplate += 1;
            continue;
          }
          if (t) perTemplate.set(t, n + 1);
          queue.push(key);
        }
      }
      await page.close();
    }
  } finally {
    await context.close();
  }
  const all = [...pages.values()].flatMap((p) => p.links);
  const internal = all.filter((l) => l.origin === new URL(base).origin && !l.inPage);
  crawl = {
    pages,
    errors,
    truncated: queue.length > 0,
    stats: {
      pages: pages.size,
      skippedSameTemplate,
      links: all.length,
      internalLinks: internal.length,
      uniqueInternal: new Set(internal.map((l) => l.path + l.search)).size,
      external: all.filter((l) => /^https?:\/\//i.test(l.raw)).length,
    },
  };
  console.log(`링크 전수 — 페이지 ${crawl.stats.pages}쪽(같은 틀 지역 화면 ${crawl.stats.skippedSameTemplate}쪽 건너뜀) · 링크 ${crawl.stats.links}개(사이트 안 ${crawl.stats.internalLinks} · 서로 다른 사이트 안 주소 ${crawl.stats.uniqueInternal} · 바깥 ${crawl.stats.external})`);
  assert.equal(crawl.truncated, false, `${CRAWL_CAP}쪽 안에 다 돌았다`);
  // 시험 자료가 닿는 곳 — 네 허브·뉴스 전체·하위 분야·칼럼·기사·인물·상황·지역 선택
  for (const p of ["/", "/tax", "/realestate", "/finance", "/local", "/news", "/tax/interpretations", "/tax/columns", fx.explainer.href, fx.lens.href, fx.cards.href, fx.solved.href, fx.col2.href, fx.quant.href, `/people/${fx.reporterSlug}`, `/people/${fx.writerSlug}`, fx["sit-car"].href, fx["sit-home"].href, `${fx["sit-home"].href}?region=${SEOUL}`]) {
    assert.ok(pages.has(p), `홈에서 닿는다: ${p}`);
  }
  assert.ok(!pages.has(fx.gone.href) && !pages.has(fx.draft.href), "삭제된 기사·초안으로 가는 링크 0");
});

test("4a) 전수 페이지 응답 200 — 500 0 · 깨진 사이트 안 링크(404·410) 0 · 화면 오류 0", () => {
  assert.ok(crawl, "4) 전수가 먼저 돈다");
  const bad = [...crawl.pages].filter(([, p]) => p.status !== 200).map(([url, p]) => `${url} → ${p.status} (링크가 있던 곳 ${p.from})`);
  assert.deepEqual(bad, [], "깨진 사이트 안 링크");
  assert.deepEqual(crawl.errors, [], "화면 오류(pageerror·console.error)");
  for (const [url, p] of crawl.pages) assert.equal(p.h1, 1, `${url}: 제목(h1) 1개`);
});

test("4b) 꺼진 기능·아직 없는 화면·v1.2·단계 전 경로로 가는 링크 0 — 헤더에 정책·지방세봇·지역·축제·AI 도우미 메뉴 0, 상단 메뉴 4", () => {
  assert.ok(crawl, "4) 전수가 먼저 돈다");
  // 기준 목록이 PRD를 담았는지 — 비어 있으면 검사가 빈 검사가 된다
  for (const p of ["/calc", "/experts", "/store", "/edu", "/search", "/about", "/about/editorial-policy", "/help/report", "/glossary", "/news/video"]) assert.ok(hitRules(p, CLOSED).length, `꺼진 기능 목록에 ${p}`);
  // 많이 본 기사(/news/popular — W2-c 2단계)·포토 목록(/news/photo — W2-c 4단계)은 열린 화면이다 — 꺼진 목록에 없다
  assert.equal(hitRules("/news/popular", CLOSED).length, 0);
  assert.equal(hitRules("/news/photo", CLOSED).length, 0);
  for (const p of ["/region", "/resources", "/authors/1", "/news/cards/x", "/law", "/cases", "/workspace", "/qna", "/library", "/academy", "/pricing", "/ask", "/realestate/trust", "/no-email-collection"]) assert.ok(hitRules(p, STAGED_V12).length, `v1.2·단계 전 목록에 ${p}`);
  const closed = [];
  const old = [];
  for (const [url, p] of crawl.pages) {
    for (const l of p.links) {
      if (l.origin !== new URL(base).origin || l.inPage) continue;
      const c = OPENED_IN_CLOSED.has(l.path) ? [] : hitRules(l.path, CLOSED);
      const o = hitRules(l.path, STAGED_V12);
      if (c.length) closed.push(`${url} → ${l.raw} (${c.join(", ")}) '${l.text}'`);
      if (o.length) old.push(`${url} → ${l.raw} (${o.join(", ")}) '${l.text}'`);
    }
    assert.deepEqual(p.sectionLinks, ["/tax", "/realestate", "/finance", "/local"], `${url}: 상단 메뉴 4 (HOME-02)`);
    for (const word of ["지방세봇", "지역·축제", "AI 도우미"]) assert.ok(!p.headerText.includes(word), `${url}: 헤더에 '${word}' 0`);
    assert.deepEqual(p.links.filter((l) => l.inHeader && /^\/(about|help)(\/|$)/.test(l.path)).map((l) => l.raw), [], `${url}: 헤더에 정책 링크 0 (HELP-05)`);
  }
  assert.deepEqual(closed, [], "꺼진 기능·아직 없는 화면으로 가는 링크");
  assert.deepEqual(old, [], "v1.2·단계 전 경로로 가는 링크");
  // 기사 본문에 편집자가 쓴 링크 — 열린 화면은 링크, 꺼진 기능·아직 없는 화면은 글자만, v1.2 옛 주소는 표기 그대로(편집자가 고친다)
  const exp = crawl.pages.get(fx.explainer.href);
  assert.ok(exp.links.some((l) => l.path === "/tax" && l.text === "지방세 허브"), "열린 화면 링크는 그대로");
});

test("4b′) 기사 본문의 손으로 쓴 링크 — 열린 화면은 링크, 꺼진 기능·아직 없는 화면은 글자만, v1.2 옛 주소는 링크 0 (표기는 남아 편집자가 고친다)", async () => {
  const body = async (href) => {
    const { page } = await open(href);
    const r = await page.$eval('[data-part="blocks"]', (el) => ({ text: el.textContent, hrefs: [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")) }));
    await page.close();
    return r;
  };
  const exp = await body(fx.explainer.href);
  assert.deepEqual(exp.hrefs, ["/tax"]);
  for (const words of ["예상 세액은 취득세 계산기에서", "낯선 말은 용어사전에", "이 기사는 편집 원칙에 따라"]) assert.ok(exp.text.includes(words), `글자로 남는다: ${words}`);
  const col = await body(fx.col2.href);
  assert.deepEqual(col.hrefs, [fx.col1.href], "지난 회 링크만");
  assert.ok(col.text.includes("[구독 안내](/pricing)") && col.text.includes("[지방세봇](/ask)"), "v1.2 옛 주소는 표기 그대로");
});

test("4c) 사이트 안 링크는 모두 화면 전환 — 누르면 앱이 받는다(문서 이동 0), 새 창·내려받기 0 / 바깥 링크는 전체 이동", async () => {
  assert.ok(crawl, "4) 전수가 먼저 돈다");
  // 역검사 — 앱 링크가 아닌 보통의 a 요소(삭제 안내 410 쪽은 화면 틀 없는 HTML)는 같은 판정에서 '앱이 받지 않음'으로 나온다
  const control = await browser.newPage({ viewport: MOBILE });
  const res = await control.goto(`${base}${fx.gone.href}`, { waitUntil: "load" });
  assert.equal(res.status(), 410);
  const plain = (await control.evaluate(inspectPage)).links.filter((l) => l.origin === new URL(base).origin && !l.inPage);
  await control.close();
  assert.ok(plain.length >= 1 && plain.every((l) => !l.client), `보통의 a 요소는 문서 이동으로 판정: ${JSON.stringify(plain.map((l) => [l.raw, l.client]))}`);
  const notClient = [];
  const newWindow = [];
  const externalIntercepted = [];
  let internal = 0;
  let external = 0;
  for (const [url, p] of crawl.pages) {
    for (const l of p.links) {
      if (l.inPage) continue;
      if (l.origin === new URL(base).origin) {
        internal++;
        if (!l.client) notClient.push(`${url} → ${l.raw} '${l.text}'`);
        if ((l.target && l.target !== "_self") || l.download) newWindow.push(`${url} → ${l.raw} target=${l.target}`);
      } else if (/^https?:/.test(l.raw)) {
        external++;
        if (l.client) externalIntercepted.push(`${url} → ${l.raw}`);
      }
    }
  }
  assert.ok(internal > 100 && external > 0, `사이트 안 ${internal} · 바깥 ${external}`);
  assert.deepEqual(notClient, [], "누르면 문서를 새로 여는 사이트 안 링크");
  assert.deepEqual(newWindow, [], "새 창·내려받기 사이트 안 링크");
  assert.deepEqual(externalIntercepted, [], "바깥 링크는 앱이 가로채지 않는다 (FND-09 — 전체 이동)");
});

test("4d) 설계대로의 응답 — 삭제된 기사 410 · 초안·없는 기사·인물·상황·하위 분야·지자체 하위 경로·지역 칼럼 404 · 빈 하위 분야 200 + noindex + 상위 허브 안내 · 500 0", async () => {
  const expect = [
    [fx.gone.href, 410],
    [fx.draft.href, 404],
    ["/news/no-such-article", 404],
    ["/people/no-such-person", 404],
    ["/situations/no-such-situation", 404],
    ["/tax/no-such-category", 404],
    ["/local/reporting", 404],
    ["/local/columns", 404], // 지역 분야에는 칼럼 하위 분야가 없다 (부동산 칼럼은 W4 21단계가 열었다 — 빈 칼럼 목록 200)
    ["/realestate/columns", 200],
    ["/finance/indicators", 200],
  ];
  for (const [p, status] of expect) {
    const res = await fetch(`${base}${p}`);
    const html = await res.text();
    assert.equal(res.status, status, p);
    assert.match(html, /<meta name="robots" content="[^"]*noindex/, `${p}: noindex`);
    if (status === 410) assert.match(html, /삭제된 기사입니다/);
    if (status === 404) assert.match(html, /찾는 화면이 없습니다/, `${p}: 공개 틀 안의 404 안내`);
  }
  const { page } = await open("/finance/indicators");
  assert.equal(await page.locator('[data-part="empty-guide"] a').getAttribute("href"), "/finance", "빈 하위 분야 — 상위 허브 안내 (CAT-02)");
  await page.close();
});

// ── 5·6) noindex · 360px ────────────────────────────────

test("5) noindex — 전수 공개 페이지마다 robots 메타 1개(noindex, SITE_INDEXING off), /admin은 머리글·메타 모두 noindex", async () => {
  assert.ok(crawl, "4) 전수가 먼저 돈다");
  for (const [url, p] of crawl.pages) {
    assert.equal(p.robots.length, 1, `${url}: robots 메타 ${p.robots.length}개`);
    assert.match(p.robots[0], /noindex/, `${url}: ${p.robots[0]}`);
  }
  const redirect = await fetch(`${base}/admin`, { redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(redirect.status), `/admin → 로그인 (${redirect.status})`);
  assert.match(redirect.headers.get("x-robots-tag") ?? "", /noindex/, "/admin 응답 머리글");
  assert.match(redirect.headers.get("location") ?? "", /\/admin\/login/);
  const login = await fetch(`${base}/admin/login`);
  assert.equal(login.status, 200);
  assert.match(login.headers.get("x-robots-tag") ?? "", /noindex/, "/admin/login 머리글");
  assert.match(await login.text(), /<meta name="robots" content="[^"]*noindex/, "/admin/login 메타");
});

test("6) 360px — 전수 페이지 가로 스크롤 0", () => {
  assert.ok(crawl, "4) 전수가 먼저 돈다");
  const wide = [...crawl.pages].filter(([, p]) => p.overflow > 0).map(([url, p]) => `${url} +${p.overflow}px`);
  assert.deepEqual(wide, []);
});

// ── 7) 접근성 ───────────────────────────────────────────

test("7) 접근성 95점 이상 — 홈·허브(/tax)·상황 페이지·기사 상세 (시험 자료가 찬 모습)", async () => {
  for (const p of ["/", "/tax", fx["sit-car"].href, fx.explainer.href]) {
    const r = await accessibility(`${base}${p}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${p}: ${r.score} — 실패 항목 ${r.failing.join(", ")}`);
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|⨯/);
});

test("정리 — 만든 계정·기사·상황·배치·용어·트래커·감사 로그를 지우면 표마다 시험 전 행 수, 운영 설정 값 그대로", async () => {
  await staff.cleanup();
  cleaned = true;
  const client = new pg.Client({ connectionString: sb.dbUrl });
  await client.connect();
  try {
    assert.deepEqual(await residue(client), before0);
  } finally {
    await client.end();
  }
});
