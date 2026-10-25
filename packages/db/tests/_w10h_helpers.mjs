// W10-h DB 시험 공통 도우미 - 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 원천·후보는 모두 시험용 견본이다.
import crypto from "node:crypto";
import { open, helpers } from "./_w10c_helpers.mjs";

export const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "terms_allowed"];
export const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export async function setup() {
  const client = await open();
  const h = helpers(client);

  /** 거래 안에서 원천을 수집 가능으로 바꾼다 (이용 조건 허용 + 견본 계약 확인) */
  const allowSource = (key) =>
    client.query(
      "update public.data_sources set terms_status = 'allowed', terms_checked_by = 'user:w10h', terms_checked_at = now(), contract_verified_by = 'user:w10h', contract_verified_at = now() where key = $1",
      [key],
    );

  /** 기능 키 값을 거래 안에서만 바꾼다 (설정 검사 트리거를 건너뜀) */
  const setFlags = async (flags) => {
    await client.query("set local session_replication_role = replica");
    await client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(flags)]);
    await client.query("set local session_replication_role = origin");
  };

  const regionCode = async () =>
    (await h.one("select code from public.regions where (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date) order by code limit 1")).code;

  /** 후보(검수 항목 field_data) 하나 - payload 는 W10-h 고정 모양 */
  const candidate = async ({ source = "applyhome_supply", target, fields, kogl = "kogl_1", itemId, hash, payloadOver = {}, snapshotId, noSnapshot = false }) => {
    const sid = noSnapshot ? null : (snapshotId ?? (await h.snapshot()));
    const payload = { target, source_item_id: itemId ?? h.uniq("item"), value_hash: hash ?? sha(h.uniq("v")), kogl_type: kogl, changed_fields: [], fields, ...payloadOver };
    const row = await h.one(
      "insert into public.review_items (kind, source_key, title, data_source_key, snapshot_id, payload, created_by) values ('field_data', $1, '시험용 후보', $2, $3, $4::jsonb, 'user:w10h') returning *",
      [h.uniq("field"), source, sid, JSON.stringify(payload)],
    );
    return row;
  };

  const go = (id, to, over = {}) => {
    const a = { actor: "user:w10h", reason: null, checked: null, parts: null, ...over };
    return h.attempt("select * from public.review_item_transition($1, $2, $3, $4, $5, $6)", [id, to, a.actor, a.reason, a.checked, a.parts]);
  };
  /** drafted -> in_review -> approved 시도. 승인 결과를 돌려준다 */
  const approve = async (id) => {
    const a = await go(id, "in_review");
    if (!a.ok) return a;
    return go(id, "approved", { checked: ALL_CHECKS });
  };
  const publish = (id) => h.attempt("select public.field_publish($1, 'user:w10h') as r", [id]);
  const status = async (id) => (await h.one("select status from public.review_items where id = $1", [id])).status;

  const supplyFields = async (over = {}) => ({
    name: "시험용 분양", region_code: await regionCode(), supply_scale: "100세대", apply_start: "2026-11-01", apply_end: "2026-11-03",
    notice_date: "2026-10-20", notice_issuer: "시험용 기관", official_notice_url: "https://example.test/notice/1", ...over,
  });
  const indicatorFields = (over = {}) => ({
    indicator_key: "fixture_idx", label: "시험용 지표", definition: "시험용 정의 문장입니다.", value: 1.5, unit: "%", as_of: "2026-09-30",
    released_on: "2026-10-01", provider: "시험용 기관", source_url: "https://example.test/f/1", ...over,
  });

  return { client, h, allowSource, setFlags, regionCode, candidate, go, approve, publish, status, supplyFields, indicatorFields };
}
