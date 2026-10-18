import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDate } from "@/lib/analytics/metrics";
import { TRACE_LIMIT } from "@/lib/admin/readiness-view";
import {
  decodeFacts,
  internalMetrics,
  needsCapacityGuidance,
  officialRows,
  reporterRows,
  traceRows,
  type InternalMetrics,
  type OfficialRow,
  type ReporterRow,
  type TraceRow,
} from "@/lib/readiness/production";
import { PLATFORMS, platformState, type Platform, type RequirementRow, type ReviewPeriod } from "@/lib/readiness/requirements";
import { WINDOW_SETTING_KEY, monthWindow, readWindowsSetting, windowsFor, type MonthWindow, type WindowsSetting } from "@/lib/readiness/windows";
import { actorNames, listRequirementRows } from "./requirements";

// 기사 생산·제휴 준비 대시보드(/admin/news-readiness)의 바깥 일 (NAV-13 · NAV-14, docs/dev/W2-c_설계.md 8.5) — 세는 규칙은 lib/readiness/*.ts(순수 함수).
//  · service_role로만 읽는다(규정 버전·원본 표는 anon·authenticated 0). 화면은 편집 책임자·관리자(readiness.read) — 부르기 전에 판정한다
//  · 설정(내부 집계 기간) → 규정 버전(플랫폼마다 오늘 적용되는 확정 버전) → DB 함수 news_production_facts 한 번(가장 이른 기간 시작 ~ 가장 늦은 끝)
//  · 확정 버전이 없는 플랫폼은 '요건 미확정' — 공식 숫자·기준 비교를 만들지 않는다(내부 정의 숫자만)
//  · 화면을 열 때마다 원본 표에서 다시 센다 — 월 마감 행(partner_readiness_monthly)은 NAV-17(W7) 월 마감 배치가 만든다 (설계 9장)

export type PlatformSection =
  | { platform: Platform; state: "none" | "unconfirmed"; reason: string; drafts: number }
  | {
      platform: Platform;
      state: "confirmed";
      version: RequirementRow;
      approvedByName: string;
      reviewPeriod: ReviewPeriod;
      reviewWindow: MonthWindow;
      rows: OfficialRow[];
      capacityGuidance: boolean;
      drafts: number;
    };

export interface ReadinessDashboard {
  today: string;
  computedAt: string;
  windowsSetting: WindowsSetting;
  windowsProblem: string | null;
  windows: MonthWindow[];
  internal: InternalMetrics[];
  platforms: PlatformSection[];
  reporters: ReporterRow[];
  trace: { window: MonthWindow; rows: TraceRow[]; total: number; limit: number; problem: string | null };
}

const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);

export async function loadReadinessDashboard(db: SupabaseClient, query: { window?: string }, now: Date): Promise<ReadinessDashboard> {
  const t = now.getTime();
  const today = kstDate(t);
  const { data: settingRows, error: settingError } = await db.from("settings").select("value").eq("key", WINDOW_SETTING_KEY).limit(1);
  if (settingError) throw fail("기간 설정 읽기", settingError);
  const { setting, problem } = readWindowsSetting(settingRows?.[0]?.value, (settingRows ?? []).length > 0);
  const windows = windowsFor(setting, t);
  const requirements = await listRequirementRows(db);

  const states = PLATFORMS.map((p) => ({ platform: p, state: platformState(requirements, p, today) }));
  const reviewWindows = new Map<Platform, MonthWindow>();
  for (const s of states) if (s.state.kind === "confirmed") reviewWindows.set(s.platform, monthWindow(s.state.reviewPeriod.months, s.state.reviewPeriod.basis, t));
  const all = [...windows, ...reviewWindows.values()];
  const from = Math.min(...all.map((w) => w.start));
  const to = Math.max(...all.map((w) => w.end));
  const { data, error } = await db.rpc("news_production_facts", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  if (error) throw fail("기사 생산 읽기", error);
  const facts = decodeFacts(data);

  const approvers = await actorNames(
    db,
    states.flatMap((s) => (s.state.kind === "confirmed" ? [s.state.row.approved_by] : [])),
  );
  const platforms: PlatformSection[] = states.map(({ platform, state }) => {
    if (state.kind !== "confirmed") return { platform, state: state.kind, reason: state.reason, drafts: state.kind === "unconfirmed" ? state.drafts : 0 };
    const reviewWindow = reviewWindows.get(platform)!;
    const rows = officialRows(state.items, facts, windows, reviewWindow);
    return {
      platform,
      state: "confirmed",
      version: state.row,
      approvedByName: approvers.get(state.row.approved_by ?? "") ?? "",
      reviewPeriod: state.reviewPeriod,
      reviewWindow,
      rows,
      capacityGuidance: needsCapacityGuidance(rows),
      drafts: state.drafts,
    };
  });

  const asked = query.window?.trim();
  const picked = asked ? windows.find((w) => String(w.months) === asked) : undefined;
  const traceWindow = picked ?? windows[0]!;
  const trace = traceRows(facts, traceWindow, TRACE_LIMIT);
  return {
    today,
    computedAt: now.toISOString(),
    windowsSetting: setting,
    windowsProblem: problem,
    windows,
    internal: windows.map((w) => internalMetrics(facts, w)),
    platforms,
    reporters: reporterRows(facts, windows),
    trace: { window: traceWindow, ...trace, limit: TRACE_LIMIT, problem: asked && !picked ? `고를 수 없는 기간(${asked}개월)이라 ${traceWindow.months}개월을 보입니다` : null },
  };
}
