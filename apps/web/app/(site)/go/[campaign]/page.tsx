import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { CampaignLanding } from "@/components/site/CampaignLanding";
import { campaignDestinationHref, CALC_TOOLS, type SelfToolHrefs } from "@/lib/campaigns/destination";
import { captureCampaignTags, parseUtmRegistry, type SearchParamsLike } from "@/lib/campaigns/utm";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { publicDb, rowsOf } from "@/lib/server/public/db";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { readPublicSettings } from "@/lib/server/public/reads";
import { readShortcutInputs } from "@/lib/server/public/shortcuts";
import { openDestinations } from "@/lib/server/public/shortcuts-logic";
import { adminClient } from "@/lib/server/supabase";

// 캠페인 랜딩 (/go/[campaign], GROW-03) - 승인되고 기간 안인 캠페인만 200. 초안·철회·없는 키는 404, 기간이 끝나면 도착 화면으로 307(도착이 닫혀 있으면 홈).
// 색인 제외: 이 화면의 noindex 메타 + next.config의 X-Robots-Tag 머리글. robots.txt Disallow에는 넣지 않는다(크롤러가 읽어야 noindex를 본다).
// 캠페인 태그(utm)는 서버가 등록 값으로 바꾼 것만 측정에 쓰고, 도착 버튼 주소에는 싣지 않는다. 입력 칸 0.
export const metadata: Metadata = { title: "안내", robots: { index: false, follow: false, nocache: true } };

const KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;
type Row = { campaign_key: string; title: string | null; body: string | null; primary_target: string; secondary_target: string | null; primary_tool: string | null; state: "live" | "ended" };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaign: string }>; searchParams: Promise<SearchParamsLike> }) {
  await connection();
  const { campaign } = await params;
  const sp = await searchParams;
  if (!KEY.test(campaign)) notFound();
  const data = await readPublic(
    "캠페인 랜딩",
    async () => {
      const [rows, settings] = await Promise.all([
        rowsOf<Row>(publicDb().from("public_campaign_landings").select("campaign_key, title, body, primary_target, secondary_target, primary_tool, state").eq("campaign_key", campaign).limit(1), "캠페인 랜딩"),
        readPublicSettings(),
      ]);
      const inputs = await readShortcutInputs({ ...settings.features, shortcuts: true });
      // 캠페인은 메뉴 바로가기가 아니라 '실제로 열린 도착'만 쓴다 - 닫혀 있으면 기존대로 도착 화면/홈으로 307
      const open = openDestinations(settings.features, inputs);
      // 계산기 도착은 toolLinkFor 하나로 정한다 - 게이트가 닫힌 도구는 허브로 (W10-b 규칙)
      const calc = await getCalcTools();
      const selfTools: SelfToolHrefs = Object.fromEntries(
        CALC_TOOLS.map((t) => {
          const l = calc ? toolLinkFor(t, null, calc.context) : null;
          return [t, l && l.kind === "self" ? l.href : null];
        }),
      );
      const reg = await adminClient()?.from("settings").select("value").eq("key", "campaign_utm_values").maybeSingle();
      return { row: rows[0] ?? null, open, selfTools, registry: parseUtmRegistry(reg?.data?.value) };
    },
    () => UNAVAILABLE,
  );
  if (isUnavailable(data) || !data.row) notFound();
  const { row, open, selfTools, registry } = data;
  const primary = campaignDestinationHref(row.primary_target, row.primary_tool, open, selfTools);
  if (row.state === "ended") redirect(primary ?? "/");
  if (!primary || row.title === null || row.body === null) redirect("/");
  const secondary = row.secondary_target ? campaignDestinationHref(row.secondary_target, null, open) : null;
  const tags = captureCampaignTags(sp, registry);
  return (
    <CampaignLanding
      campaign={row.campaign_key}
      title={row.title}
      body={row.body}
      primary={{ href: primary, target: row.primary_target }}
      secondary={secondary && row.secondary_target ? { href: secondary, target: row.secondary_target } : null}
      source={tags.source}
      medium={tags.medium}
    />
  );
}
