// 캠페인 광고 채널과 도착 제안 (GROW-03, W10-i 설계 8장) - 제안일 뿐 관리자가 고른다. 캠페인 하나에 도착은 하나
export const CAMPAIGN_CHANNELS = ["search", "sns", "display", "email", "other"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export type CampaignTarget = "calc" | "expert_request" | "brief_weekly" | "realestate_weekly";
export const CAMPAIGN_TARGETS: readonly CampaignTarget[] = ["calc", "expert_request", "brief_weekly", "realestate_weekly"];

const SUGGEST: Readonly<Record<CampaignChannel, readonly CampaignTarget[]>> = {
  search: ["calc", "expert_request"],
  sns: ["realestate_weekly", "brief_weekly"],
  display: ["realestate_weekly", "brief_weekly"],
  email: ["brief_weekly", "calc"],
  other: CAMPAIGN_TARGETS,
};

/** 채널에 맞는 도착 후보 - 앞에 있을수록 먼저 권한다. 후보 밖 도착도 관리자가 고를 수 있다(저장 검사는 4개 중 하나뿐) */
export function suggestDestinations(channel: string): readonly CampaignTarget[] {
  return (CAMPAIGN_CHANNELS as readonly string[]).includes(channel) ? SUGGEST[channel as CampaignChannel] : SUGGEST.other;
}
