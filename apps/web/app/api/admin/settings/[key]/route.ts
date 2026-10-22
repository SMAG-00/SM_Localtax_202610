import { isEditableSetting, parseJsonText, sameJson, validateSettingValue } from "@/lib/admin/settings-rules";
import { featureEnableErrors } from "@/lib/policy/feature-open";
import { brandRecords } from "@/lib/server/admin/brand-records";
import { publishedDocKeys } from "@/lib/server/auth-guard";
import { mailEnv } from "@/lib/server/env";
import { mailConfigured } from "@/lib/server/mail/config";
import { parseFeatures } from "@/lib/server/public/settings";
import { pilotRegionsRegionErrors } from "@/lib/server/public/region-index-logic";
import { projectSettingsCrossErrors } from "@/lib/admin/project-rules";
import { isoToKstDate } from "@/lib/admin/form-utils";
import type { RegionRouteRow } from "@/lib/site/region-route";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { readSetting, writeSetting } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 운영 설정 한 줄 고치기 — 관리자만(settings.edit, 거부는 403 + 감사 로그).
//  · 본문 { valueJson: "JSON 글" } 또는 { value: JSON 값 }, 둘 중 하나. updatedAt(읽은 시각)을 주면 그 뒤에 다른 사람이 고쳤을 때 409
//  · 아는 키만 고친다 — 키마다 모양 검사(lib/admin/settings-rules.ts), 틀리면 422 { errors: ["칸: 문장"] }
//  · 감사 로그에 전후 값. 발행 판정은 배포 없이 다음 점검부터 새 값을 읽는다
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const key = (await params).key;
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.setting(/^[a-z][a-z0-9_.]*$/.test(key) ? key : "invalid");
  const denied = await authorize(viewer, "settings.edit", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const unknown = Object.keys(raw).filter((k) => !["value", "valueJson", "updatedAt", "reason"].includes(k));
  if (unknown.length) return errorJson(422, `모르는 칸입니다: ${unknown.join(", ")}`);
  if ((raw.value === undefined) === (raw.valueJson === undefined)) return errorJson(422, "value 또는 valueJson 중 하나만 보내세요");
  let value: unknown = raw.value;
  if (raw.valueJson !== undefined) {
    if (typeof raw.valueJson !== "string") return errorJson(422, "valueJson은 JSON 글이어야 합니다");
    const p = parseJsonText(raw.valueJson);
    if (!p.ok) return errorJson(422, p.error, { errors: [p.error] });
    value = p.value;
  }

  const db = serviceDb();
  const current = await readSetting(db, key);
  if (!current) return errorJson(404, "그런 설정이 없습니다");
  if (!isEditableSetting(key)) return errorJson(409, "이 설정은 검사 규칙이 아직 없어 화면에서 고칠 수 없습니다");
  if (raw.updatedAt !== undefined && (typeof raw.updatedAt !== "string" || Date.parse(raw.updatedAt) !== Date.parse(current.updated_at))) {
    return errorJson(409, "다른 사람이 먼저 고쳤습니다 — 새로 불러온 뒤 다시 저장하세요", { updatedAt: current.updated_at });
  }
  const checked = validateSettingValue(key, value, current.value);
  if (!checked.ok) return errorJson(422, "설정 값이 규칙에 맞지 않습니다", { errors: checked.errors });
  if (sameJson(value, current.value)) return json({ setting: current, unchanged: true });
  // 시범 지역: 새로 넣는 코드는 오늘 유효한 행정구역 (W4 11단계 — DB 트리거 …46과 같은 규칙, 422로 칸마다 사유)
  if (key === "pilot_regions") {
    const { data, error } = await db.from("regions").select("code, parent_code, level, name, slug, valid_from, valid_to").in("code", value as string[]);
    if (error) throw dbError(error, "regions 읽기");
    const regionErrors = pilotRegionsRegionErrors(value as string[], current.value, (data ?? []) as RegionRouteRow[], isoToKstDate(new Date().toISOString()));
    if (regionErrors.length) return errorJson(422, "설정 값이 규칙에 맞지 않습니다", { errors: regionErrors });
  }
  // 프로젝트 사업 유형·단계 목록: 단계 목록의 유형은 project_types에 있어야 한다 (W4 12단계 — DB 트리거 …47과 같은 규칙, 422로 칸마다 사유).
  //   프로젝트가 쓰는 유형·단계 기록이 쓰는 단계를 빼는 저장은 DB 트리거가 거부한다(409 + 사유 문장)
  if (key === "project_types" || key === "project_stage_lists") {
    const other = await readSetting(db, key === "project_types" ? "project_stage_lists" : "project_types");
    const crossErrors = projectSettingsCrossErrors(key, value, other?.value);
    if (crossErrors.length) return errorJson(422, "설정 값이 규칙에 맞지 않습니다", { errors: crossErrors });
  }
  // 기능 키를 새로 켜는 경우: 게시본·메일 설정 의존을 채우지 못하면 거부하고 사유를 보인다 (W2-e 설계 2.3 · 6.3)
  if (key === "feature_flags") {
    const depErrors = featureEnableErrors(parseFeatures(current.value), parseFeatures(value), await publishedDocKeys(db), mailConfigured(mailEnv()), await brandRecords(db));
    if (depErrors.length) return errorJson(422, "기능을 켤 수 없습니다 — 먼저 필요한 것을 갖추세요", { errors: depErrors });
  }

  const saved = await writeSetting(db, current, value, actorOf(viewer));
  if (!saved) return errorJson(409, "다른 사람이 먼저 고쳤습니다 — 새로 불러온 뒤 다시 저장하세요");
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : `설정 고치기 — ${key}`;
  await writeAudit(db, { actor: actorOf(viewer), action: "settings.update", target, before: { value: current.value }, after: { value: saved.value }, reason });
  return json({ setting: saved });
}, { revalidatesPublic: true });
