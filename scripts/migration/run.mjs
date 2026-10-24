// dry-run 본체 — 중간 형식 문서 → 검증 → 변환 → 주소 매핑 → 보고서 (순수 함수, 입출력은 cli.mjs)
//  같은 입력이면 출력이 글자 하나까지 같다(시각·난수 없음) — 리허설 2회 비교(MIG-03)의 전제
import { createHash } from "node:crypto";
import { SECTIONS } from "./format.mjs";
import { toArticle } from "./transform.mjs";
import { buildUrlMap, checkUrlMap, renderRedirectsSql } from "./urlmap.mjs";
import { validateDocument } from "./validate.mjs";

export const SAMPLE_SIZE = 200;
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** 표본 200건 — 번호를 해시해 고른다(입력이 같으면 표본도 같다) */
export function pickSample(items, size = SAMPLE_SIZE) {
  return [...items].sort((a, b) => (sha(a.sidecar.legacy_id) < sha(b.sidecar.legacy_id) ? -1 : 1)).slice(0, size).map((i) => ({ legacy_id: i.sidecar.legacy_id, slug: i.article.slug, content_hash: i.content_hash }));
}

export function runDryRun(doc, { status = "draft", now, sourceLabel } = {}) {
  const v = validateDocument(doc, { now });
  const base = { ok: false, errors: v.errors, warnings: v.warnings };
  if (v.errors.length) {
    return { ...base, report: buildReport({ v, items: [], urlMap: [], urlProblems: [], status }), items: [], urlMap: [], redirectsSql: "" };
  }
  const items = v.records.map((entry) => toArticle(entry, { status, sourceLabel })).sort((a, b) => Number(a.sidecar.legacy_id) - Number(b.sidecar.legacy_id));
  const urlMap = buildUrlMap({
    migrated: items.map((i) => ({ legacy_url: i.article.legacy_url, slug: i.article.slug })),
    excluded: v.excluded.map((e) => ({ legacy_url: e.legacy_url, status: e.status, reason: e.reason })),
  });
  const urlProblems = checkUrlMap(urlMap);
  return {
    ok: true,
    errors: [],
    warnings: v.warnings,
    items,
    excluded: v.excluded,
    urlMap,
    urlProblems,
    redirectsSql: renderRedirectsSql(urlMap),
    report: buildReport({ v, items, urlMap, urlProblems, status }),
  };
}

function buildReport({ v, items, urlMap, urlProblems, status }) {
  const sourceCount = v.header.count;
  const bySection = Object.fromEntries(SECTIONS.map((s) => [s, items.filter((i) => i.article.section === s).length]));
  const imageUrls = [...new Set(items.flatMap((i) => i.sidecar.images.map((im) => im.url)))].sort();
  const authors = [...new Set(items.map((i) => i.sidecar.author_name).filter(Boolean))].sort();
  const blockers = urlProblems.filter((p) => p.problem === "새 주소 미결정");
  return {
    result: v.errors.length ? "FAIL" : "PASS",
    target_status: status,
    source: v.header.source,
    counts: {
      source: sourceCount,
      migrated: items.length,
      excluded: v.excluded.length,
      // 이관 수 + 제외 수 = 원본 수 (검증 오류가 있으면 일부 항목이 어느 쪽에도 들지 못해 맞지 않는다)
      reconciled: items.length + v.excluded.length === sourceCount,
      errors: v.errors.length,
      warnings: v.warnings.length,
      by_section: bySection,
      reclassify_queue: items.filter((i) => i.sidecar.needs_reclassify).length,
      region_review_queue: items.filter((i) => i.sidecar.region_review).length,
      distinct_images: imageUrls.length,
      distinct_authors: authors.length,
      url_map_rows: urlMap.length,
      url_map_by_status: urlMap.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
    },
    errors: v.errors,
    warnings: v.warnings,
    excluded: v.excluded,
    url_problems: urlProblems.filter((p) => p.problem !== "새 주소 미결정"),
    cutover_blockers: blockers.map((b) => b.old_path),
    authors,
    image_urls: imageUrls,
    sample: pickSample(items),
  };
}

export function renderReportMarkdown(r) {
  const c = r.counts;
  const lines = [
    `# 기존 기사 이관 dry-run 보고서 — ${r.result}`,
    "",
    `- 대상 상태: ${r.target_status} · 원본 ${c.source}건 = 이관 ${c.migrated} + 제외 ${c.excluded} (대조 ${c.reconciled ? "일치" : "불일치"})`,
    `- 오류 ${c.errors} · 경고 ${c.warnings}`,
    `- 분야별: ${Object.entries(c.by_section).map(([k, n]) => `${k} ${n}`).join(" · ")}`,
    `- 편집국 재분류 큐 ${c.reclassify_queue} · 지역 태그 검토 큐 ${c.region_review_queue}`,
    `- 이미지 주소 ${c.distinct_images}개(전부 권리 미확인) · 필자 ${c.distinct_authors}명`,
    `- 주소 매핑 ${c.url_map_rows}행 (${Object.entries(c.url_map_by_status).map(([k, n]) => `${k}: ${n}`).join(" · ")}) · 매핑 문제 ${r.url_problems.length} · 전환 전 미결정 ${r.cutover_blockers.length}`,
    "",
  ];
  if (r.errors.length) lines.push("## 오류", "", ...r.errors.map((e) => `- [${e.id ?? "-"}] ${e.field}: ${e.message}`), "");
  if (r.warnings.length) lines.push("## 경고", "", ...r.warnings.slice(0, 200).map((e) => `- [${e.id ?? "-"}] ${e.field}: ${e.message}`), "");
  if (r.url_problems.length) lines.push("## 주소 매핑 문제", "", ...r.url_problems.map((p) => `- ${p.old_path}: ${p.problem}`), "");
  if (r.cutover_blockers.length) lines.push("## 전환 전에 정해야 할 주소", "", ...r.cutover_blockers.map((p) => `- ${p}`), "");
  if (r.excluded.length) lines.push("## 제외한 기사", "", ...r.excluded.map((e) => `- ${e.legacy_id} (${e.status}): ${e.reason}`), "");
  return `${lines.join("\n")}\n`;
}
