// W10-d DB 시험 공통 도우미 - 모든 시험은 거래 안에서 돌고 되돌린다(남는 행 0). 법령·문서는 모두 시험용 표시와 지어낸 글이다.
import { open as openBase, helpers as baseHelpers } from "./_w10c_helpers.mjs";

export const open = openBase;

export function helpers(client) {
  const base = baseHelpers(client);
  const { uniq, one, attempt } = base;

  async function flags(on = {}) {
    const keys = ["law_viewer", "law_three", "case_db"];
    const patch = Object.fromEntries(keys.map((k) => [k, on[k] === true]));
    await client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
  }

  /** 시험용 법령 하나(법률/시행령/시행규칙 중). 이름 규칙: 법 이름 + ' 시행령' / ' 시행규칙' */
  async function law(name, tier = "statute") {
    return (await one("insert into public.laws (name, tier) values ($1, $2) returning id", [name, tier])).id;
  }
  async function version(lawId, over = {}) {
    const row = { law_id: lawId, promulgation_no: uniq("시험용"), promulgated_on: "2025-10-01", effective_on: "2026-01-01", body_hash: uniq("bh"), snapshot_id: await base.snapshot(), ...over };
    const keys = Object.keys(row);
    return (await one(`insert into public.law_versions (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]))).id;
  }
  async function article(versionId, no, branch = 0, body = "① 시험용 조문 글") {
    return (await one("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, $2, $3, $4) returning id", [versionId, no, branch, body])).id;
  }

  /** 공개 가능한 시험용 해석 문서 - 필수 칸·권리 확인·비실명 확인·스냅샷이 모두 있다. over로 덮어쓴다 */
  async function doc(over = {}, payload = "시험용 원문 글") {
    const snapshot_id = over.snapshot_id === undefined ? await base.snapshot({ payload }) : over.snapshot_id;
    const row = {
      doc_type: "interpretation", issuer: "시험용 기관", doc_no: uniq("시험용-번호"), decided_on: "2026-03-01", tax_kinds: ["취득세"], source_url: "https://example.test/시험용/doc",
      rights_status: "confirmed", anonymity_check: "confirmed", content_hash: uniq("ch"), ...over, snapshot_id,
    };
    const keys = Object.keys(row);
    return (await one(`insert into public.legal_docs (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]))).id;
  }

  async function sample(kind, size, matched) {
    return attempt("insert into public.quality_samples (kind, sample_size, matched, sampled_by) values ($1, $2, $3, 'w10d-test') returning passed", [kind, size, matched]);
  }
  async function link(over) {
    const row = { src_kind: "legal_doc", src_id: null, dst_kind: "law_provision", dst_id: null, dst_article_no: null, dst_branch_no: null, relation: "cites", origin: "editor", ...over };
    const keys = Object.keys(row);
    return attempt(`insert into public.links (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
  }
  const confirm = (id) => client.query("update public.links set status = 'confirmed', confirmed_by = 'w10d-test', confirmed_at = now() where id = $1", [id]);
  const anon = (sql, params = []) => attempt(sql, params, "anon");

  return { ...base, flags, law, version, article, doc, sample, link, confirm, anon };
}
