import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateManualOrdinance } from "@ltr/workflows/ordinance";
import type { RegisterInput } from "@/lib/ordinances/input";

// 조례 수동 등록 (W11-e e2 - 편집자 경로). 이용 조건 관문과 무관하게 열려 있고, 원문은 원문 DB(laws·law_versions·law_articles)에 한 번만 저장한다.
// 같은 (이름, 지역)의 조례는 같은 laws 행을 쓰고 새 개정판(공포번호·시행일)만 더한다. 요약 숫자 검사는 DB 트리거가 한 번 더 한다.
// 룰셋·계산기 표는 건드리지 않는다.

export type RegisterResult = { ok: true; linkId: number; lawId: number; versionId: number } | { ok: false; status: 409 | 422; errors: string[] };

function fail(status: 409 | 422, ...errors: string[]): RegisterResult {
  return { ok: false, status, errors };
}

export async function registerOrdinance(db: SupabaseClient, input: RegisterInput, actor: string): Promise<RegisterResult> {
  const region = await db.from("regions").select("level").eq("code", input.regionCode).maybeSingle();
  if (region.error) throw new Error(`regions 조회 실패: ${region.error.code ?? ""} ${region.error.message}`.trim());
  if (!region.data) return fail(422, "region_code: 없는 행정구역입니다");
  const level = (region.data as { level: "sido" | "sigungu" }).level;
  const check = validateManualOrdinance({ name: input.name, regionCode: input.regionCode, regionLevel: level, kind: input.kind, sourceUrl: input.sourceUrl, effectiveFrom: input.effectiveFrom, verifiedAt: input.verifiedAt, promulgationNo: input.promulgationNo, bodyText: input.bodyText, summary: input.summary ?? undefined });
  if (!check.ok) return fail(422, ...check.problems.map((p) => (p === "summary_numbers" ? "summary: 요약의 숫자가 원문에 없습니다" : p === "kind_level" ? "kind: 도시정비는 시·도, 감면·세율은 시·군·구 조례입니다" : `${p}: 값을 확인하세요`)));

  // 조례(laws) - 이름 하나에 1행
  let lawId: number;
  const found = await db.from("laws").select("id, tier, region_code").eq("name", input.name).maybeSingle();
  if (found.error) throw new Error(`laws 조회 실패: ${found.error.code ?? ""} ${found.error.message}`.trim());
  if (found.data) {
    const law = found.data as { id: number; tier: string; region_code: string | null };
    if (law.tier !== "ordinance" || law.region_code !== input.regionCode) return fail(409, "name: 같은 이름의 다른 법령이 이미 있습니다");
    lawId = law.id;
  } else {
    const made = await db.from("laws").insert({ name: input.name, tier: "ordinance", scope: "local", watch: false, region_code: input.regionCode }).select("id").single();
    if (made.error) throw new Error(`laws 추가 실패: ${made.error.code ?? ""} ${made.error.message}`.trim());
    lawId = (made.data as { id: number }).id;
  }

  // 원문 스냅샷 -> 개정판 -> 조문 (같은 공포번호·시행일이면 기존 개정판을 쓴다)
  const hash = createHash("sha256").update(input.bodyText, "utf8").digest("hex");
  const snap = await db.from("raw_snapshots").insert({ source: "ordinance_manual", url: input.sourceUrl, content_hash: hash, payload: JSON.stringify({ editor: actor, text: input.bodyText }) }).select("id").single();
  if (snap.error) throw new Error(`raw_snapshots 추가 실패: ${snap.error.code ?? ""} ${snap.error.message}`.trim());
  let versionId: number;
  const ver = await db.from("law_versions").select("id").eq("law_id", lawId).eq("promulgation_no", input.promulgationNo).eq("effective_on", input.effectiveFrom).maybeSingle();
  if (ver.error) throw new Error(`law_versions 조회 실패: ${ver.error.code ?? ""} ${ver.error.message}`.trim());
  if (ver.data) {
    versionId = (ver.data as { id: number }).id;
  } else {
    const madeVer = await db.from("law_versions").insert({ law_id: lawId, promulgation_no: input.promulgationNo, promulgated_on: input.promulgatedOn, effective_on: input.effectiveFrom, body_hash: hash, snapshot_id: (snap.data as { id: number }).id }).select("id").single();
    if (madeVer.error) throw new Error(`law_versions 추가 실패: ${madeVer.error.code ?? ""} ${madeVer.error.message}`.trim());
    versionId = (madeVer.data as { id: number }).id;
    const art = await db.from("law_articles").insert({ version_id: versionId, article_no: input.articleNo, title: input.articleTitle, body: input.bodyText, effective_on: input.effectiveFrom });
    if (art.error) throw new Error(`law_articles 추가 실패: ${art.error.code ?? ""} ${art.error.message}`.trim());
  }

  // 연결 - (지역, 종류, 조례) 하나에 1행. 새 개정판으로 옮기면 DB 트리거가 이전 서명을 비운다
  const row = { region_code: input.regionCode, kind: input.kind, law_id: lawId, version_id: versionId, summary: input.summary, effective_from: input.effectiveFrom, verified_at: input.verifiedAt, source_url: input.sourceUrl, origin: "editor" };
  const existing = await db.from("ordinance_links").select("id").eq("region_code", input.regionCode).eq("kind", input.kind).eq("law_id", lawId).maybeSingle();
  if (existing.error) throw new Error(`ordinance_links 조회 실패: ${existing.error.code ?? ""} ${existing.error.message}`.trim());
  const write = existing.data
    ? await db.from("ordinance_links").update(row).eq("id", (existing.data as { id: number }).id).select("id").single()
    : await db.from("ordinance_links").insert({ ...row, status: "draft", registered_by: actor }).select("id").single();
  if (write.error) {
    if (write.error.code === "23514") return fail(422, write.error.message.includes("number_mismatch") ? "summary: 요약의 숫자가 원문에 없습니다" : write.error.message);
    throw new Error(`ordinance_links 저장 실패: ${write.error.code ?? ""} ${write.error.message}`.trim());
  }
  return { ok: true, linkId: (write.data as { id: number }).id, lawId, versionId };
}
