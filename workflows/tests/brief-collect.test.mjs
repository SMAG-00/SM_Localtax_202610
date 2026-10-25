// W10-e 수집 결과 -> 코너 항목 어댑터 시험 - 외부 호출 0, 값은 모두 지어낸 시험용 (원본 API 응답 견본을 쓰지 않음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectedCorners, dotDate, runBriefChecks, REQUIRED_CORNER_KEYS } from "../src/ops/index.ts";

const base = { since: "2026-10-01", until: "2026-10-08", today: "2026-10-08" };
const law = (o) => ({ serial: "1001", name: "시험용 지방세법", promulgationNo: "9001", promulgatedOn: "2026-10-03", effectiveOn: "2026-10-05", revisionKind: "일부개정", url: "https://example.test/law/1001", reasonText: "시험용 제개정이유", ...o });

test("날짜 표기 - 앞자리 0을 뗀다", () => {
  assert.equal(dotDate("2026-10-01"), "2026.10.1");
  assert.equal(dotDate("2026-12-31"), "2026.12.31");
});

test("법령 - 공포일 또는 시행일이 기간 안인 것만, 시행일이 오늘 이하면 시행 표지, 이후면 시행 전 표지", () => {
  const r = buildCollectedCorners({
    ...base,
    laws: [law({}), law({ serial: "1002", promulgatedOn: "2026-10-07", effectiveOn: "2026-11-01" }), law({ serial: "1003", promulgatedOn: "2026-09-01", effectiveOn: "2026-09-02" }), law({ serial: "1004", promulgatedOn: "2026-09-01", effectiveOn: "2026-10-08" })],
    admrul: [], interpretations: [], decisions: [],
  });
  assert.deepEqual(r.items.laws.map((i) => i.id), ["law-1001", "law-1002", "law-1004"]);
  assert.equal(r.items.laws[0].badge, "live");
  assert.equal(r.items.laws[0].badgeLabel, "시행 2026.10.5");
  assert.equal(r.items.laws[1].badge, "plan");
  assert.equal(r.items.laws[1].badgeLabel, "공포 · 시행 2026.11.1");
  assert.equal(r.items.laws[2].badge, "live"); // 시행일이 기간 끝날과 같으면 포함
  assert.deepEqual(r.items.laws[0].meta, ["제9001호", "공포 2026.10.3", "시행 2026.10.5"]);
  assert.equal(r.counts.lawsChanged, 3);
  assert.ok(r.excerpts["law-1001"].includes("시험용 제개정이유"));
});

test("행정규칙 - 소관부처가 다르거나 기간 밖이면 제외", () => {
  const rows = [
    { serial: "a1", name: "시험용 예규", kind: "예규", issuer: "시험부", issuedOn: "2026-10-02", url: "https://example.test/a1" },
    { serial: "a2", name: "시험용 고시", issuer: "다른부", issuedOn: "2026-10-02", url: "https://example.test/a2" },
    { serial: "a3", name: "시험용 옛 예규", issuer: "시험부", issuedOn: "2026-09-02", url: "https://example.test/a3" },
  ];
  const r = buildCollectedCorners({ ...base, laws: [], admrul: rows, interpretations: [], decisions: [], ministry: "시험부" });
  assert.deepEqual(r.items.admrul.map((i) => i.id), ["adm-a1"]);
  assert.deepEqual(r.items.admrul[0].tags, ["예규"]);
  assert.equal(buildCollectedCorners({ ...base, laws: [], admrul: rows, interpretations: [], decisions: [] }).items.admrul.length, 2);
});

test("해석 - 이력이 있으면 본 번호 제외, 없으면 공개일 기간으로, 제목이 관련 낱말에 걸린 것만", () => {
  const rows = [
    { serial: "e1", title: "시험용 취득세 안건", interpretedOn: "2026-09-20", publishedOn: "2026-10-02" },
    { serial: "e2", title: "시험용 항만 안건", interpretedOn: "2026-09-20", publishedOn: "2026-10-02" },
    { serial: "e3", title: "시험용 재산세 안건", interpretedOn: "2026-09-01", publishedOn: "2026-09-02" },
  ];
  const noHistory = buildCollectedCorners({ ...base, laws: [], admrul: [], interpretations: rows, decisions: [] });
  assert.deepEqual(noHistory.items.interpretations.map((i) => i.id), ["ex-e1"]);
  assert.equal(noHistory.counts.interpretationsNew, 2); // 관련 낱말 거르기 전 새 건수
  const withHistory = buildCollectedCorners({ ...base, laws: [], admrul: [], interpretations: rows, decisions: [], seenInterpretations: new Set(["e1"]) });
  assert.deepEqual(withHistory.items.interpretations.map((i) => i.id), ["ex-e3"]);
  assert.deepEqual(noHistory.items.interpretations[0].meta, ["해석일 2026.9.20", "공개 2026.10.2", "일련번호 e1"]);
});

test("결정례 - 주문으로 결론 표지를 정하고 주문 원문을 비공개 칸에 둔다, 불분명하면 표지 없음", () => {
  const rows = [
    { serial: "d1", title: "시험용 일반 사건", claimNo: "시험2026-001", decidedOn: "2026-10-02", order: "심판청구를 기각한다" },
    { serial: "d2", title: "시험용 경매 사건", claimNo: "시험2026-002", decidedOn: "2026-10-03", order: "처분청이 한 처분을 취소한다" },
    { serial: "d3", title: "시험용 각하 사건", claimNo: "시험2026-003", decidedOn: "2026-10-04", order: "심판청구를 각하한다" },
    { serial: "d4", title: "시험용 본 사건", claimNo: "시험2026-004", decidedOn: "2026-10-04", order: "심판청구를 기각한다" },
  ];
  const r = buildCollectedCorners({ ...base, laws: [], admrul: [], interpretations: [], decisions: rows, seenDecisions: new Set(["d4"]) });
  assert.deepEqual(r.items.tribunal.map((i) => i.id), ["dc-d2", "dc-d1", "dc-d3"]); // 경매(우선 낱말)가 앞
  assert.deepEqual(r.items.tribunal.map((i) => i.badge), ["win", "lose", undefined]);
  assert.equal(r.excerpts["dc-d1#order"], "심판청구를 기각한다");
  assert.equal(r.counts.decisionsNew, 3);
});

test("어댑터 출력은 검사기 8종의 차단 0 - 번호·일자·표지가 원문과 맞는다", () => {
  const r = buildCollectedCorners({
    ...base,
    laws: [law({})],
    admrul: [{ serial: "a1", name: "시험용 예규", issuer: "시험부", issuedOn: "2026-10-02", url: "https://example.test/a1" }],
    interpretations: [{ serial: "e1", title: "시험용 취득세 안건", interpretedOn: "2026-09-20", publishedOn: "2026-10-02", url: "https://example.test/e1" }],
    decisions: [{ serial: "d1", title: "시험용 경매 사건", claimNo: "시험2026-001", decidedOn: "2026-10-02", order: "심판청구를 기각한다", url: "https://example.test/d1" }],
  });
  const corners = [
    { key: "laws", title: "지방세 법령 개정", items: r.items.laws, emptyNote: "없음" },
    { key: "admrul", title: "행정규칙", items: r.items.admrul, emptyNote: "없음" },
    { key: "interpretations", title: "유권해석", items: r.items.interpretations, emptyNote: "없음" },
    { key: "tribunal", title: "결정례", items: r.items.tribunal, emptyNote: "없음" },
    { key: "dates", title: "알아둘 날짜", items: [], emptyNote: "없음" },
  ];
  const urls = ["https://example.test/law/1001", "https://example.test/a1", "https://example.test/e1", "https://example.test/d1"];
  const doc = {
    title: "시험용 호", subject: "시험용 호", hasAd: false, corners, excerpts: r.excerpts,
    linkStatus: Object.fromEntries(urls.map((u) => [u, "ok"])), forbiddenWords: [], reviewLabelAllowed: false,
    footer: { disclaimer: "시험용 면책", noHarvestNotice: "시험용 거부 안내", adInfoUrl: "/ads" }, requiredCorners: REQUIRED_CORNER_KEYS,
  };
  const report = runBriefChecks(doc);
  assert.deepEqual(report.findings.filter((f) => f.level === "block"), []);
  // 주문을 지우면 결론 표지 대조가 막는다
  const broken = runBriefChecks({ ...doc, excerpts: { ...r.excerpts, "dc-d1#order": "" } });
  assert.ok(broken.findings.some((f) => f.check === "stage_label" && f.level === "block"));
  // 출처 줄 일자가 어긋나면 막는다
  const wrongMeta = structuredClone(corners);
  wrongMeta[0].items[0].meta = ["공포 2026.10.4"];
  assert.ok(runBriefChecks({ ...doc, corners: wrongMeta }).findings.some((f) => f.check === "source_match"));
});
