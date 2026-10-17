import { SETTING_SPECS, isEditableSetting } from "@/lib/admin/settings-rules";
import { listSettings } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";

// 운영 설정 목록 (PRD-01A 6.1 settings) — 관리자만(settings.edit). 편집 책임자의 시도는 403 + 감사 로그.
// 행마다 화면에서 고칠 수 있는지(검사 규칙이 있는 키만)와 고치는 법을 함께 준다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "settings.edit", "settings:list");
  if (denied) return denied;
  const rows = await listSettings(serviceDb());
  return json({
    settings: rows.map((r) => ({
      key: r.key,
      value: r.value,
      description: r.description,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
      editable: isEditableSetting(r.key),
      label: SETTING_SPECS[r.key]?.label ?? null,
      guide: SETTING_SPECS[r.key]?.guide ?? null,
    })),
  });
});
