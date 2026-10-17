// 공개 데이터 함수 통합 시험 — 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계, docs/dev/W2-b_설계.md 4·5장).
// 공개·비공개 행을 섞은 시험 세계를 DB에 직접 넣고(커밋 — anon 요청은 다른 연결), 함수 결과에 공개 행만 나오는지 본다.
// 끝나면 이 시험이 만든 행을 모두 지운다 (추가만 되는 표는 트리거를 끈 세션으로). 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const KST_TODAY = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

let db;
let api;
const w = {};
const made = { people: [], articles: [], media: [], tags: [], glossary: [], situations: [], amendments: [], snapshots: [], regions: [], categories: [] };

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    const host = new URL(u).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function insert(table, cols, bucket) {
  const keys = Object.keys(cols);
  const row = await one(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => cols[k]));
  if (bucket) made[bucket].push(row.id ?? row.code);
  return row;
}
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();

  const cat = async (section, slug) => Number((await one("select id from public.categories where section = $1 and slug = $2", [section, slug])).id);
  w.interpretations = await cat("tax", "interpretations");
  w.projects = await cat("realestate", "projects");
  w.emptyCategory = await insert("categories", { section: "finance", slug: `it-empty-${RUN}`, name: `통합 빈 분야 ${RUN}`, visible: true, sort: 999 }, "categories");

  w.reporter = await insert(
    "people",
    {
      slug: `it-reporter-${RUN}`,
      name: "통합 시험 기자",
      roles: ["reporter"],
      visibility: "public",
      beat: "지방세",
      bio_items: JSON.stringify([{ item: "세무사", evidence_id: "EV-1" }, { item: "메일 reporter@example.com", evidence_id: "EV-2" }, { item: "증빙 없는 경력 50년" }]),
    },
    "people",
  );
  w.hiddenPerson = await insert("people", { slug: `it-hidden-${RUN}`, name: "비공개 인물", roles: ["writer"] }, "people");
  w.editor = await insert("people", { slug: `it-editor-${RUN}`, name: "통합 시험 편집자", roles: ["editor"] }, "people");
  w.reviewer = await insert("people", { slug: `it-reviewer-${RUN}`, name: "통합 시험 감수위원", roles: ["reviewer"] }, "people");

  const snap = await insert("raw_snapshots", { source: "itest", url: "https://www.mois.go.kr/it", content_hash: "h", payload: "원문" }, "snapshots");
  w.amendment = await insert("amendments", { slug: `it-amendment-${RUN}`, title: "통합 시험 개정안", status: "public" }, "amendments");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by, recorded_at) values ($1, 'announced', '2026-08-26', 'https://www.mois.go.kr/it', $2, 'user:it', $3)",
    [w.amendment.id, snap.id, daysAgo(30)],
  );

  w.sigungu = await insert("regions", { code: "1199900000", parent_code: "1100000000", level: "sigungu", name: "시험구", slug: `it-gu-${RUN}` }, "regions");

  const art = (label, over) =>
    insert(
      "articles",
      { slug: `it-${label}-${RUN}`, title: `통합 시험 ${label}`, summary: `${label} 요약`, section: "tax", content_type: "explainer", status: "published", author_id: w.reporter.id, ...over },
      "articles",
    );
  w.report = await art("report", {
    content_type: "reported_news",
    reporting_method: "qualitative",
    category_id: w.interpretations,
    region_codes: ["1100000000"],
    amendment_id: w.amendment.id,
    first_published_at: daysAgo(2),
  });
  await insert("editorial_reviews", { article_id: w.report.id, kind: "desk_edit", reviewer_id: w.editor.id, decision: "approve" });
  w.reportPending = await art("report-pending", { content_type: "reported_news", reporting_method: "qualitative", category_id: w.interpretations });
  w.explainer = await art("explainer", { category_id: w.interpretations, first_published_at: daysAgo(3) });
  w.solved = await art("solved", { subtype: "solved_case", category_id: w.interpretations, first_published_at: daysAgo(20) });
  w.draft = await art("draft", { status: "draft", category_id: w.interpretations });
  w.digest = await art("digest", { section: "local", content_type: "digest", digest_id: 1 });

  const photo = (path, confirmed) =>
    insert(
      "media",
      confirmed ? { path, kind: "photo", rights_status: "confirmed", credit: "시험일보", photographer: "홍길동", license: "자체 촬영", checked_at: new Date() } : { path, kind: "photo" },
      "media",
    );
  w.mediaOk = await photo(`it-ok-${RUN}.jpg`, true);
  w.mediaNo = await photo(`it-no-${RUN}.jpg`, false);
  w.lens = await art("lens", {
    section: "realestate",
    category_id: w.projects,
    legal_basis_date: "2026-10-01",
    lead_media_id: w.mediaOk.id,
    body: JSON.stringify({
      blocks: [
        { type: "paragraph", text: "본문 첫 문단" },
        { type: "image", mediaId: String(w.mediaOk.id), alt: "현장 사진", caption: "" },
        { type: "image", mediaId: String(w.mediaNo.id), alt: "권리 미확인 사진", caption: "" },
      ],
      claims: [],
    }),
    tax_lens: JSON.stringify({
      topics: ["취득세"],
      points: ["관리처분인가 뒤 입주권 취득은 취득세 대상입니다."],
      links: [
        { kind: "explainer", label: "해설 읽기", url: `/news/it-explainer-${RUN}` },
        { kind: "calculator", label: "SM 취득세 계산기", url: "https://sm.example.com/calc" },
      ],
      skip_reason: null,
      reviewed: true,
      reviewed_for_version: 1,
    }),
  });

  // 태그 — 보도 기사와 해설이 '취득세' 태그를 함께 쓴다 (비슷한 사례)
  w.tag = await insert("tags", { name: `통합 취득세 ${RUN}`, slug: `it-acq-${RUN}` }, "tags");
  for (const a of [w.report, w.explainer]) await db.query("insert into public.article_tags (article_id, tag_id) values ($1, $2)", [a.id, w.tag.id]);

  // 정정(게재 1 · 게재 전 1)·수정 이력(실질 1 · 오탈자 1)
  await db.query("insert into public.article_corrections (article_id, kind, reason, reader_notice, decided_by, published_at) values ($1, 'follow_up', '후속 취재', '결과를 더했습니다', 'user:it', $2)", [w.report.id, daysAgo(1)]);
  await db.query("insert into public.article_corrections (article_id, kind, reason, decided_by) values ($1, 'rebuttal', '반론 검토 중', 'user:it')", [w.report.id]);
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, 2, '옛 제목', '[]', 'user:it', '3분기 통계 반영', 'substantive')", [w.report.id]);
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, 3, '옛 제목', '[]', 'user:it', '오탈자', 'typo')", [w.report.id]);
  // 기사 발행 뒤 개정 단계가 바뀌었다 → 갱신 배너 (TX-08)
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', $2, 'https://www.moleg.go.kr/it', $3, 'user:it')",
    [w.amendment.id, KST_TODAY, snap.id],
  );

  w.term = await insert("glossary_terms", { term: `통합 과세표준 ${RUN}`, plain: "세금을 매기는 기준 금액", section: ["tax"] }, "glossary");
  const checks = JSON.stringify([{ title: "자동차세 연세액 납부 여부" }, { title: "등록 말소일", when: "판 날" }, { title: "환급 계좌", note: "통장 사본을 준비합니다" }]);
  w.situation = await insert(
    "situations",
    {
      slug: `it-car-sold-${RUN}`,
      section: "tax",
      title: "차를 팔았어요·폐차했어요",
      subtitle: "돌려받을 세금이 있는지 확인합니다",
      pictogram: "car-sold",
      checks,
      reviewer_id: w.reviewer.id,
      reviewed_at: new Date(),
      visible: true,
      hub_slot: 1,
      article_ids: [w.explainer.id, w.draft.id, w.report.id],
      solved_case_ids: [w.solved.id, w.draft.id],
      glossary_ids: [w.term.id],
      tool_links: JSON.stringify([{ feature: "expert_finder" }]),
      region_select: true,
    },
    "situations",
  );
  w.hiddenSituation = await insert("situations", { slug: `it-hidden-${RUN}`, section: "tax", title: "고지서를 받았어요", pictogram: "notice-received", checks, hub_slot: 2 }, "situations");

  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = made.articles;
    await db.query("delete from public.situations where id = any($1::bigint[])", [made.situations]);
    await db.query("delete from public.article_tags where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.tags where id = any($1::bigint[])", [made.tags]);
    await db.query("delete from public.article_corrections where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.editorial_reviews where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.media where id = any($1::bigint[])", [made.media]);
    await db.query("delete from public.amendment_events where amendment_id = any($1::bigint[])", [made.amendments]);
    await db.query("delete from public.amendments where id = any($1::bigint[])", [made.amendments]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
    await db.query("delete from public.glossary_terms where id = any($1::bigint[])", [made.glossary]);
    await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    await db.query("delete from public.regions where code = any($1::text[])", [made.regions]);
    await db.query("delete from public.categories where id = any($1::bigint[])", [made.categories]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

const idsOf = (items) => items.map((i) => Number(i.id));

describe("화면 틀·홈·허브·뉴스 전체 (HOME-01·02·04 · CAT-02)", () => {
  test("헤더 — 상단 4개, 지방세 하위 메뉴에 공개 기사가 있는 '해석' + 뉴스 전체, 기능이 꺼져 유틸·정책 링크 0", async () => {
    const chrome = await api.getSiteChrome();
    expect(chrome.sections.map((s) => s.href)).toEqual(["/tax", "/realestate", "/finance", "/local"]);
    const tax = chrome.sections[0].children.map((c) => c.href);
    expect(tax).toContain("/tax/interpretations");
    expect(tax.at(-1)).toBe("/news?section=tax");
    expect(chrome.utilities).toEqual([]);
    expect(chrome.policyLinks).toEqual([]);
  });

  test("홈 — 히어로·4대 분야 카드가 먼저, 최신 자체 취재는 편집 승인된 보도기사만", async () => {
    const home = await api.getHomeData();
    expect(home.sections.slice(0, 2).map((s) => s.key)).toEqual(["hero", "fields"]);
    expect(home.sections[0].coreMessage).toBe("부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다");
    const latest = home.sections.find((s) => s.key === "latest_reports");
    expect(latest).toBeDefined();
    expect(idsOf(latest.items)).toContain(Number(w.report.id));
    for (const hidden of [w.reportPending, w.explainer, w.draft]) expect(idsOf(latest.items)).not.toContain(Number(hidden.id));
  });

  test("지방세 허브 — 상황 카드는 공개 상황만, 최신 목록에 초안·금주 핫뉴스 0, 관련 용어 칩", async () => {
    const hub = await api.getHubData("tax");
    expect(hub.name).toBe("지방세");
    expect(hub.situations.map((s) => s.slug)).toContain(w.situation.slug);
    expect(hub.situations.map((s) => s.slug)).not.toContain(w.hiddenSituation.slug);
    expect(idsOf(hub.latest)).toEqual(expect.arrayContaining([Number(w.report.id), Number(w.explainer.id)]));
    expect(idsOf(hub.latest)).not.toContain(Number(w.draft.id));
    expect(idsOf(hub.latest)).not.toContain(Number(w.digest.id));
    expect(hub.terms.map((t) => t.id)).toContain(Number(w.term.id));
    expect(hub.tabs.map((t) => t.slug)).toContain("interpretations");
  });

  test("뉴스 전체 — 편집 승인된 reported_news만 (해설·승인 전 보도 0)", async () => {
    const news = await api.getNewsList({ section: "tax" });
    expect(idsOf(news.items)).toContain(Number(w.report.id));
    expect(idsOf(news.items)).not.toContain(Number(w.reportPending.id));
    expect(idsOf(news.items)).not.toContain(Number(w.explainer.id));
    expect(news.tabs).toHaveLength(4);
  });

  test("하위 분야 목록 — 공개 분야는 목록, 없는 분야는 null, 기사 0건이면 noindex", async () => {
    const list = await api.getCategoryList("tax", "interpretations");
    expect(idsOf(list.items)).toEqual(expect.arrayContaining([Number(w.report.id), Number(w.explainer.id), Number(w.solved.id)]));
    expect(list.noindex).toBe(false);
    expect(list.category.needsDisclaimer).toBe(true);
    expect(await api.getCategoryList("tax", `no-such-${RUN}`)).toBeNull();
    const empty = await api.getCategoryList("finance", w.emptyCategory.slug);
    expect(empty).toMatchObject({ total: 0, noindex: true, hubHref: "/finance", items: [] });
    const chrome = await api.getSiteChrome();
    expect(chrome.sections[2].children.map((c) => c.label)).not.toContain(w.emptyCategory.name);
  });
});

describe("기사 상세 (ART-02~06 · CAT-04 · TX-08 · CORE-01)", () => {
  test("보도 기사 — 배지 글자·정정 이력(게재된 것만)·업데이트 표시(실질 수정만)·개정 단계·갱신 배너·면책·기자 약력(증빙·이메일 제외)", async () => {
    const d = await api.getArticleDetail(w.report.slug);
    expect(d.typeLabel).toBe("보도");
    expect(d.corrections.map((c) => c.what)).toEqual(["결과를 더했습니다"]);
    expect(d.updates.map((u) => u.reason)).toEqual(["3분기 통계 반영"]);
    expect(d.amendment.stage).toMatchObject({ current: "pre_notice", label: "입법예고", confirmed: false });
    expect(d.amendment.href).toBeNull();
    expect(d.amendment.banner).toMatchObject({ stageLabel: "입법예고" });
    expect(d.disclaimer).toBe(true);
    expect(d.author).toMatchObject({ name: "통합 시험 기자", href: `/people/${w.reporter.slug}`, bio: ["세무사"] });
    expect(d.title).toBe("통합 시험 report");
    expect(d.regionLabel).toBe("서울특별시");
    expect(d.policyLinks).toEqual([]);
    expect(d.popular).toEqual([]);
  });

  test("다음 행동 띠 — 비슷한 사례(해결 사례 먼저·태그 겹침, 자기 자신·초안 0)와 열린 버튼 2개(연결 상황·같은 분야)", async () => {
    const d = await api.getArticleDetail(w.report.slug);
    const similar = d.similarCases.map((c) => c.id);
    expect(similar[0]).toBe(Number(w.solved.id));
    expect(similar).toContain(Number(w.explainer.id));
    expect(similar).not.toContain(Number(w.report.id));
    expect(similar).not.toContain(Number(w.draft.id));
    expect(d.nextActions.map((a) => [a.key, a.href])).toEqual([
      ["situation", `/situations/${w.situation.slug}`],
      ["same_section", "/tax/interpretations"],
    ]);
  });

  test("「지방세로 읽기」·본문 이미지 — 감수된 박스(열린 링크만), 권리 미확인 이미지 블록은 빠진다", async () => {
    const d = await api.getArticleDetail(w.lens.slug);
    expect(d.taxLens).toMatchObject({ topics: ["취득세"], basisDate: "2026-10-01" });
    expect(d.taxLens.links.map((l) => l.kind)).toEqual(["explainer"]);
    expect(d.blocks.map((b) => b.type)).toEqual(["paragraph", "image"]);
    expect(Number(d.leadImage.id)).toBe(Number(w.mediaOk.id));
    expect(d.media.map((m) => Number(m.id))).toEqual([Number(w.mediaOk.id)]);
  });

  test("초안·금주 핫뉴스·없는 주소는 null (404)", async () => {
    expect(await api.getArticleDetail(w.draft.slug)).toBeNull();
    expect(await api.getArticleDetail(w.digest.slug)).toBeNull();
    expect(await api.getArticleDetail(`no-such-${RUN}`)).toBeNull();
  });
});

describe("상황 페이지·인물 (UX-05 · CAT-03 · ART-04)", () => {
  test("공개 상황 — 먼저 확인할 것 3개, 연결 기사·해결 사례는 공개 것만 지정 순서, 용어 칩, 열리지 않은 기능 버튼 0", async () => {
    const p = await api.getSituationPage(w.situation.slug);
    expect(p.checks.map((c) => c.title)).toEqual(["자동차세 연세액 납부 여부", "등록 말소일", "환급 계좌"]);
    expect(idsOf(p.articles)).toEqual([Number(w.explainer.id), Number(w.report.id)]);
    expect(idsOf(p.solvedCases)).toEqual([Number(w.solved.id)]);
    expect(p.terms.map((t) => t.id)).toEqual([Number(w.term.id)]);
    expect(p.nextActions).toEqual([]);
    expect(p.regionSelect.sido).toHaveLength(17);
    expect(await api.getSituationPage(w.hiddenSituation.slug)).toBeNull();
  });

  test("지역 선택 — 시·군·구 기사가 0건이면 상위 시·도 기사와 그 사실", async () => {
    const p = await api.getSituationPage(w.situation.slug, { region: w.sigungu.code });
    expect(p.regionSelect.selected).toBe(w.sigungu.code);
    expect(p.regionSelect.sigungu.map((r) => r.code)).toContain(w.sigungu.code);
    expect(p.regionArticles.fallbackTo).toMatchObject({ code: "1100000000", name: "서울특별시" });
    expect(idsOf(p.regionArticles.items)).toContain(Number(w.report.id));
  });

  test("인물 — 공개 인물의 공개 칸과 공개 기사만, 비공개 인물은 null", async () => {
    const person = await api.getPersonPage(w.reporter.slug);
    expect(person.bio).toEqual(["세무사"]);
    expect(idsOf(person.articles)).toContain(Number(w.report.id));
    expect(idsOf(person.articles)).not.toContain(Number(w.draft.id));
    expect(JSON.stringify(person)).not.toMatch(/@example\.com/);
    expect(await api.getPersonPage(w.hiddenPerson.slug)).toBeNull();
  });
});
