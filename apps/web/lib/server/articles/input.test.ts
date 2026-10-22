// 요청 본문 검사 시험 — 기사 입력(input.ts)·본문 블록과 JSON 칸(content.ts)·출처·근거(records-input.ts)
import { describe, expect, test } from "vitest";
import { EMPTY_CHECKLISTS, parseBodyInput, parseChecklistsInput, readChecklists, readStoredBody, withChecklists } from "./content";
import { parseArticleInput } from "./input";
import { parseEvidenceInput, parseSourceInput, parseSourceRevision } from "./records-input";

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("기사 입력", () => {
  test("작성에는 slug·title·section·contentType이 필요하다", () => {
    expect(errorsOf(parseArticleInput({}, "create"))).toEqual([
      "slug: 필요합니다",
      "title: 필요합니다",
      "section: 필요합니다 (tax·realestate·finance·local)",
      "contentType: 필요합니다 (reported_news·explainer·guide·opinion·sponsored·digest)",
    ]);
  });
  test("모르는 칸·값 목록 밖·수정 전용 칸(작성 때)은 거부", () => {
    const errors = errorsOf(parseArticleInput({ slug: "a", title: "t", section: "tax", contentType: "news", roles: ["editor"], updateKind: "typo" }, "create"));
    expect(errors).toEqual(expect.arrayContaining(["roles: 모르는 칸입니다", "updateKind: 모르는 칸입니다", expect.stringMatching(/^contentType: /)]));
  });
  test("slug 공백·'/' 거부, 날짜 형식 검사", () => {
    const errors = errorsOf(parseArticleInput({ slug: "a b", legalBasisDate: "2026-02-30" }, "patch"));
    expect(errors).toEqual(["slug: 공백·'/' 없이 써야 합니다", "legalBasisDate: YYYY-MM-DD 날짜여야 합니다"]);
  });
  test("칼럼 연재 — 이름·회차를 함께 받고, 회차는 1 이상 정수, 한쪽만 보내거나 한쪽만 비우면 거부 (ART-04)", () => {
    expect(parseArticleInput({ seriesTitle: "그때와 지금", seriesEpisode: 3 }, "patch")).toEqual({ ok: true, value: { seriesTitle: "그때와 지금", seriesEpisode: 3 } });
    expect(parseArticleInput({ seriesTitle: null, seriesEpisode: null }, "patch")).toEqual({ ok: true, value: { seriesTitle: null, seriesEpisode: null } });
    expect(parseArticleInput({ seriesTitle: "  ", seriesEpisode: null }, "patch")).toEqual({ ok: true, value: { seriesTitle: null, seriesEpisode: null } });
    expect(errorsOf(parseArticleInput({ seriesTitle: "연재" }, "patch"))).toEqual(["seriesTitle: 연재 이름과 회차는 함께 보냅니다"]);
    expect(errorsOf(parseArticleInput({ seriesTitle: "연재", seriesEpisode: null }, "patch"))).toEqual(["seriesTitle: 연재 이름과 회차는 둘 다 적거나 둘 다 비웁니다"]);
    for (const ep of [0, 1.5, "2", -3]) expect(errorsOf(parseArticleInput({ seriesTitle: "연재", seriesEpisode: ep }, "patch"))).toContain("seriesEpisode: 1 이상의 회차 번호여야 합니다");
    expect(errorsOf(parseArticleInput({ seriesTitle: "가".repeat(101), seriesEpisode: 1 }, "patch"))).toEqual(["seriesTitle: 100자 이하여야 합니다"]);
  });
  test("제목 40자·요약 60자까지 (공백 포함, 앞뒤 공백 뺌 — 휴대폰 첫 화면 R1, W2-b 설계 9장): 40·60자는 되고 41·61자는 거부", () => {
    const title40 = "재산세 감면 신청 기간, 올해부터 한 달 늘리고 창구도 넓힌다 ".padEnd(40, "다").slice(0, 40);
    expect([...title40].length).toBe(40);
    expect(parseArticleInput({ title: title40, summary: "가".repeat(60) }, "patch")).toEqual({ ok: true, value: { title: title40, summary: "가".repeat(60) } });
    expect(parseArticleInput({ title: `  ${title40}  ` }, "patch").ok).toBe(true);
    expect(errorsOf(parseArticleInput({ title: `${title40}다`, summary: "가".repeat(61) }, "patch"))).toEqual([
      "title: 제목은 40자 이하여야 합니다 (지금 41자 — 휴대폰 첫 화면 글자 기준 R1)",
      "summary: 요약은 60자 이하여야 합니다 (지금 61자 — 휴대폰 첫 화면 글자 기준 R1)",
    ]);
    expect(parseArticleInput({ summary: null }, "patch")).toEqual({ ok: true, value: { summary: null } });
  });
  test("수정 입력은 보낸 칸만 담는다", () => {
    const r = parseArticleInput({ title: "새 제목", updateKind: "typo", reason: "오탈자", expectedVersion: 3 }, "patch");
    expect(r).toEqual({ ok: true, value: { title: "새 제목", updateKind: "typo", reason: "오탈자", expectedVersion: 3 } });
  });
});

describe("본문 블록", () => {
  test("블록 종류별 필수 칸과 근거 참조 형식", () => {
    const r = parseBodyInput({
      blocks: [{ type: "paragraph" }, { type: "quote", text: "말", origin: "interview", refId: "123" }, { type: "banner" }],
      claims: [{ id: "c1", text: "주장", kind: "fact", evidenceIds: ["src:1", "x"], blockIndex: 9 }],
    });
    expect(errorsOf(r)).toEqual([
      "body.blocks[0].text: 글자가 필요합니다",
      "body.blocks[1].refId: 근거 참조(src:<번호> 또는 ev:<번호>)여야 합니다",
      "body.blocks[2].type: paragraph·table·image·quote·callout·infographic·video·faq·key_summary·slide 중 하나여야 합니다",
      "body.claims[0].evidenceIds: 근거 참조 형식이 아닙니다 (x)",
      "body.claims[0].blockIndex: 본문 블록 번호여야 합니다",
    ]);
  });
  test("카드뉴스 장(slide) — 제목·글·대체 텍스트만 저장하고, 빈 칸은 저장된다(발행 판정이 막는다)", () => {
    const r = parseBodyInput({ blocks: [{ type: "slide", title: "1. 취득세", text: "60일 안에 신고합니다", alt: "달력 그림", extra: "버린다" }, { type: "slide" }] });
    expect(r).toEqual({
      ok: true,
      value: {
        blocks: [
          { type: "slide", title: "1. 취득세", text: "60일 안에 신고합니다", alt: "달력 그림" },
          { type: "slide", title: "", text: "", alt: "" },
        ],
        claims: [],
      },
    });
    expect(errorsOf(parseBodyInput({ blocks: [{ type: "slide", title: 3, text: "가", alt: "x".repeat(501) }] }))).toEqual([
      "body.blocks[0].title: 글자여야 합니다",
      "body.blocks[0].alt: 500자 이하여야 합니다",
    ]);
  });
  test("이미지 블록의 권리 상태는 저장하지 않는다", () => {
    const r = parseBodyInput({ blocks: [{ type: "image", mediaId: 12, alt: "사진", caption: "", rightsStatus: "confirmed" }] });
    expect(r).toEqual({ ok: true, value: { blocks: [{ type: "image", mediaId: "12", alt: "사진", caption: "" }], claims: [] } });
  });
  test("DB 본문 읽기 — 블록 배열도 받고, 모양이 틀린 블록은 뺀다", () => {
    expect(readStoredBody([{ type: "paragraph", text: "가" }, { type: "paragraph" }])).toEqual({ blocks: [{ type: "paragraph", text: "가" }], claims: [] });
    expect(readStoredBody(null)).toEqual({ blocks: [], claims: [] });
  });
});

describe("확인 목록 (check_log.checklists)", () => {
  test("보낸 칸만 덮어쓰고, 관점 기록은 ev: 참조만", () => {
    const base = { ...EMPTY_CHECKLISTS, isTaxIssue: true };
    const r = parseChecklistsInput({ quantitative: { relatedPartyCheck: "전화 확인" }, perspectives: { experts: { status: "interviewed", evidenceId: "ev:4", contactedAt: "2026-10-08" } } }, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isTaxIssue).toBe(true);
    expect(r.value.quantitative).toEqual({ sourceCrossCheck: null, limitations: null, relatedPartyCheck: "전화 확인" });
    expect(r.value.perspectives.experts).toEqual({ status: "interviewed", evidenceId: "ev:4", contactedAt: "2026-10-08" });
    expect(errorsOf(parseChecklistsInput({ perspectives: { local_gov: { status: "interviewed", evidenceId: "src:4" } } }, base))).toEqual([
      "checklists.perspectives.local_gov.evidenceId: 근거 참조(ev:<번호>)여야 합니다",
    ]);
  });
  test("check_log의 다른 칸(발행 기록)은 그대로 두고 확인 목록만 바꾼다", () => {
    const log = withChecklists({ publish: { at: "x" } }, { ...EMPTY_CHECKLISTS, isLocalPolicyIssue: true });
    expect(log.publish).toEqual({ at: "x" });
    expect(readChecklists(log).isLocalPolicyIssue).toBe(true);
    expect(readChecklists(null)).toEqual(EMPTY_CHECKLISTS);
  });
});

describe("출처·근거 입력", () => {
  test("출처 — 종류 필수, camelCase → DB 칸, 스냅샷 글", () => {
    const r = parseSourceInput({ kind: "press_release", url: "https://x.example/p", sourceName: "가온시", licenseType: "kogl_1", snapshot: { text: "보도자료 원문" } });
    expect(r).toEqual({
      ok: true,
      value: { columns: { kind: "press_release", source_url: "https://x.example/p", source_name: "가온시", license_type: "kogl_1" }, snapshot: { text: "보도자료 원문", url: null, source: null } },
    });
    expect(errorsOf(parseSourceInput({ kind: "blog" }))).toEqual(["source.kind: official_doc·dataset·press_release·interview·field·photo·other 중 하나여야 합니다"]);
  });
  test("출처 — 공공누리 유형: 공식 자료·보도자료·사진은 필수, 6값만, 인터뷰는 없어도 된다 (PR-07)", () => {
    for (const kind of ["official_doc", "dataset", "press_release", "photo"]) {
      expect(errorsOf(parseSourceInput({ kind, title: "자료" }))).toContain(
        "source.licenseType: 공식 자료·보도자료·사진은 공공누리 유형이 필요합니다 — 자체 자료는 '해당 없음'(not_applicable) (PR-07)",
      );
    }
    expect(errorsOf(parseSourceInput({ kind: "press_release", licenseType: "kogl_5" }))).toEqual([
      "source.licenseType: kogl_1·kogl_2·kogl_3·kogl_4·unmarked·not_applicable 중 하나여야 합니다",
      "source.licenseType: 공식 자료·보도자료·사진은 공공누리 유형이 필요합니다 — 자체 자료는 '해당 없음'(not_applicable) (PR-07)",
    ]);
    expect(errorsOf(parseSourceInput({ kind: "interview", title: "관계자 통화" }))).toEqual([]);
  });
  test("출처 — 자료 종류: 허용 목록 값만·차단 4종 거부·공식 자료 행에만, 빈 글자는 없음으로 (REG1-07)", () => {
    const official = { kind: "official_doc", title: "시험용 고시", licenseType: "kogl_1" };
    expect(errorsOf(parseSourceInput({ ...official, sourceType: "notice" }))).toEqual([]);
    expect(errorsOf(parseSourceInput({ ...official, sourceType: "tourism" }))).toEqual([
      "source.sourceType: 자료 종류 tourism는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)",
    ]);
    expect(errorsOf(parseSourceInput({ ...official, sourceType: "festival_guide" }))).toEqual(["source.sourceType: 자료 종류 festival_guide는 허용 목록(official_source_types)에 없습니다 (REG1-07)"]);
    // 차단 4종은 설정 목록에 있어도 거부 (코드 고정)
    expect(errorsOf(parseSourceInput({ ...official, sourceType: "restaurant" }, ["restaurant"]))).toHaveLength(1);
    expect(errorsOf(parseSourceInput({ kind: "press_release", licenseType: "kogl_1", sourceType: "notice" }))).toEqual([
      "source.sourceType: 자료 종류는 공식 자료(official_doc·dataset) 출처에만 씁니다 (REG1-07)",
    ]);
    const blank = parseSourceInput({ ...official, sourceType: "  ", regionUnit: " " });
    expect(blank.ok && blank.value.columns).toMatchObject({ source_type: null, region_unit: null });
  });
  test("원자료 새 버전 — 사유 필수·500자·바뀐 칸 1개 이상, 종류·대체·스냅샷은 바꿀 수 없고 그대로 잇는다 (REG1-09)", () => {
    const current = {
      id: 41,
      kind: "dataset",
      title: "시험용 가상구 세수 결산",
      source_url: "https://gasang.example/open/1",
      source_name: "시험용 가상구청",
      provider: null,
      last_verified_at: "2026-10-20T01:00:00+00:00",
      license_status: "공공누리 제1유형",
      license_type: "kogl_1",
      source_type: "local_tax_revenue",
      published_on: "2026-10-01",
      reference_date: "2026-06-30",
      region_code: null,
      region_unit: "시·군·구",
      collected_at: "2026-10-19T01:00:00+00:00",
      snapshot_id: 9,
    };
    const ok = parseSourceRevision({ revisionReason: " 발표기관 정정 ", title: "시험용 가상구 세수 결산(정정)" }, current);
    expect(ok).toEqual({
      ok: true,
      value: {
        changed: ["title"],
        row: { ...Object.fromEntries(Object.entries(current).filter(([k]) => k !== "id")), title: "시험용 가상구 세수 결산(정정)", supersedes_id: 41, revision_reason: "발표기관 정정" },
      },
    });
    expect(errorsOf(parseSourceRevision({ title: "새 제목" }, current))).toEqual(["source.revisionReason: 수정 사유가 필요합니다 — 원자료를 고치면 새 버전과 사유가 남습니다 (REG1-09)"]);
    expect(errorsOf(parseSourceRevision({ revisionReason: "   ", title: "새 제목" }, current))).toHaveLength(1);
    expect(errorsOf(parseSourceRevision({ revisionReason: "가".repeat(501), title: "새 제목" }, current))).toEqual(["source.revisionReason: 500자 이하로 적습니다"]);
    expect(errorsOf(parseSourceRevision({ revisionReason: "사유", title: current.title }, current))).toEqual(["source: 바뀐 칸이 없습니다 — 고칠 칸을 적으세요"]);
    expect(errorsOf(parseSourceRevision({ revisionReason: "사유", kind: "press_release" }, current))).toContain("source.kind: 모르는 칸입니다");
    expect(errorsOf(parseSourceRevision({ revisionReason: "사유", supersedesId: 1 }, current))).toContain("source.supersedesId: 모르는 칸입니다");
    expect(errorsOf(parseSourceRevision({ revisionReason: "사유", sourceType: "living_guide" }, current))).toEqual([
      "source.sourceType: 자료 종류 living_guide는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)",
    ]);
    expect(errorsOf(parseSourceRevision({ revisionReason: "사유", licenseType: null }, current))).toEqual([
      "source.licenseType: 공식 자료·보도자료·사진은 공공누리 유형이 필요합니다 — 자체 자료는 '해당 없음'(not_applicable) (PR-07)",
    ]);
  });
  test("근거 — 유형 6종, 인터뷰 기록은 interview 유형에만, 연락처 칸은 없다", () => {
    expect(errorsOf(parseEvidenceInput({ evidenceType: "rumor", location: "x" }, "create"))).toEqual([
      "evidence.evidenceType: dataset·document·interview·field·photo·calculation 중 하나여야 합니다",
    ]);
    expect(errorsOf(parseEvidenceInput({ evidenceType: "dataset", location: "x", interview: { subjectRole: "관계자" } }, "create"))).toEqual([
      "evidence.interview: 근거 유형이 interview일 때만 씁니다",
    ]);
    expect(errorsOf(parseEvidenceInput({ evidenceType: "interview", location: "x", interview: { subjectRole: "관계자", quoteConsent: "full", anonymity: "named", phone: "010" } }, "create"))).toEqual([
      "evidence.interview.phone: 모르는 칸입니다",
    ]);
  });
});
