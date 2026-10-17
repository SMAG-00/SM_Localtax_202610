import Link from "next/link";
import type { Metadata } from "next";
import { SettingEditor } from "@/components/admin/SettingEditor";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { SETTING_SPECS, isEditableSetting } from "@/lib/admin/settings-rules";
import { listSettings } from "@/lib/server/admin/backoffice";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 운영 설정 (/admin/settings) — 관리자만(settings.edit). settings 행마다 설명·지금 값·JSON 편집. 검사 규칙이 있는 키만 고친다.
// 저장하면 감사 로그에 전후 값이 남고, 발행 판정은 배포 없이 다음 점검부터 새 값을 읽는다.
export const metadata: Metadata = { title: "설정" };

export default async function SettingsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "settings.edit");
  const rows = await listSettings(serviceDb());

  return (
    <>
      <PageTitle title="운영 설정" description="발행 점검이 읽는 기준값과 사전입니다. 값은 JSON으로 고치고, 규칙에 맞지 않으면 저장되지 않습니다." />
      {rows.length === 0 && <EmptyNote>설정이 없습니다.</EmptyNote>}
      <div className="space-y-6">
        {rows.map((row) => {
          const spec = SETTING_SPECS[row.key];
          const editable = isEditableSetting(row.key);
          return (
            <Panel
              key={row.key}
              id={`setting-${row.key.replace(/[^a-z0-9]/g, "-")}`}
              title={spec?.label ?? row.key}
              description={
                <>
                  <span className={`${MONO} [overflow-wrap:anywhere]`}>{row.key}</span>
                  {row.description && <span className="mt-1 block [overflow-wrap:anywhere]">{row.description}</span>}
                  <span className="mt-1 block text-[14px]">
                    마지막 수정 {isoToKstDateTime(row.updated_at)} · <span className="[overflow-wrap:anywhere]">{row.updated_by ?? "기록 없음"}</span>
                  </span>
                </>
              }
            >
              {spec?.dictionaryTab && (
                <p className="text-[15px] text-navy-700">
                  표현을 하나씩 더하고 빼려면{" "}
                  <Link href={`/admin/dictionaries?tab=${spec.dictionaryTab}`} className={TEXT_LINK}>
                    사전 화면
                  </Link>
                  을 쓰세요.
                </p>
              )}
              {editable ? (
                <SettingEditor settingKey={row.key} value={row.value} updatedAt={row.updated_at} guide={spec!.guide} />
              ) : (
                <div className="space-y-2">
                  <ToneChip tone="plain">화면에서 고칠 수 없음</ToneChip>
                  <p className="text-[15px] text-navy-700">이 설정은 검사 규칙이 아직 없어 화면에서 고치지 않습니다.</p>
                  <pre className="overflow-x-auto rounded-xl border border-navy-100 bg-ivory p-4 font-mono text-[13px] text-navy-800">{JSON.stringify(row.value, null, 2)}</pre>
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
