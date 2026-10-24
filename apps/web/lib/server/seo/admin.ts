import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lastClosedMonth } from "@/lib/readiness/monthly";
import { citationTally, tallyByEngine, type CitationTally } from "@/lib/seo/ai-citation";
import { parseCrawlerPolicy } from "@/lib/seo/settings";
import { siteIndexing } from "../env";
import { indexingGate } from "./load";

// /admin/seo 화면·API가 읽는 것 (W7 · OPT-01·07·08·09) — service_role로만, 부르기 전에 seo.read를 판정한다.
const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);
const JOBS = ["search-console-daily", "indexnow-submit", "readiness-monthly"] as const;

export interface FreshnessItem {
  id: number;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  note: string | null;
  article: { id: number; slug: string; title: string } | null;
  eventStage: string | null;
  occurredOn: string | null;
  amendmentTitle: string | null;
}

export interface SeoOverview {
  now: string;
  gate: { open: boolean; problems: string[]; siteIndexing: boolean; site: string | null; searchCrawlers: number; aiDecided: boolean; indexnow: boolean };
  freshness: { open: FreshnessItem[]; recent: FreshnessItem[] };
  ai: {
    sets: { version: number; questions: number; activatedAt: string | null }[];
    activeVersion: number | null;
    questions: { no: number; text: string }[];
    month: string;
    samples: { id: number; questionNo: number; engine: string; cited: string; citedUrl: string | null; expectedPage: string | null; note: string | null }[];
    tally: CitationTally;
    byEngine: { engine: string; tally: CitationTally }[];
  };
  runs: { job: string; status: string; startedAt: string; finishedAt: string | null; detail: unknown; error: string | null }[];
}

type RawFreshness = {
  id: number;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  note: string | null;
  article: { id: number; slug: string; title: string } | null;
  event: { stage: string; occurred_on: string | null; amendment: { title: string } | null } | null;
};

const toItem = (r: RawFreshness): FreshnessItem => ({
  id: Number(r.id),
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  resolution: r.resolution,
  note: r.note,
  article: r.article ? { id: Number(r.article.id), slug: r.article.slug, title: r.article.title } : null,
  eventStage: r.event?.stage ?? null,
  occurredOn: r.event?.occurred_on ?? null,
  amendmentTitle: r.event?.amendment?.title ?? null,
});

export async function loadSeoOverview(db: SupabaseClient, now: Date, query: { month?: string }): Promise<SeoOverview> {
  const gate = await indexingGate();
  const policy = parseCrawlerPolicy(gate.settings?.crawlerPolicy);
  const SELECT = "id, created_at, resolved_at, resolution, note, article:articles(id, slug, title), event:amendment_events(stage, occurred_on, amendment:amendments(title))";
  const [openRes, recentRes, setsRes, runsRes] = await Promise.all([
    db.from("freshness_review_queue").select(SELECT).is("resolved_at", null).order("created_at").limit(200),
    db.from("freshness_review_queue").select(SELECT).not("resolved_at", "is", null).order("resolved_at", { ascending: false }).limit(20),
    db.from("ai_question_sets").select("version, activated_at").order("version", { ascending: false }).limit(20),
    db.from("agent_runs").select("job, status, started_at, finished_at, detail, error").in("job", [...JOBS]).order("started_at", { ascending: false }).limit(30),
  ]);
  for (const [what, r] of [["신선도 큐", openRes], ["처리한 신선도 항목", recentRes], ["질문 목록", setsRes], ["실행 기록", runsRes]] as const) if (r.error) throw fail(`${what} 읽기`, r.error);
  const sets = (setsRes.data ?? []) as { version: number; activated_at: string | null }[];
  const counts = new Map<number, number>();
  if (sets.length > 0) {
    const { data, error } = await db.from("ai_core_questions").select("version").in("version", sets.map((s) => s.version));
    if (error) throw fail("질문 수 읽기", error);
    for (const q of (data ?? []) as { version: number }[]) counts.set(q.version, (counts.get(q.version) ?? 0) + 1);
  }
  const active = sets.find((s) => s.activated_at !== null)?.version ?? null;
  const month = query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : lastClosedMonth(now.getTime());
  let questions: { no: number; text: string }[] = [];
  let samples: SeoOverview["ai"]["samples"] = [];
  if (active !== null) {
    const [qRes, sRes] = await Promise.all([
      db.from("ai_core_questions").select("question_no, text").eq("version", active).order("question_no"),
      db.from("ai_citation_samples").select("id, question_no, engine, cited, cited_url, expected_page, note").eq("month", `${month}-01`).eq("question_set_version", active).order("question_no").order("engine"),
    ]);
    if (qRes.error) throw fail("질문 읽기", qRes.error);
    if (sRes.error) throw fail("표본 읽기", sRes.error);
    questions = ((qRes.data ?? []) as { question_no: number; text: string }[]).map((q) => ({ no: q.question_no, text: q.text }));
    samples = ((sRes.data ?? []) as { id: number; question_no: number; engine: string; cited: string; cited_url: string | null; expected_page: string | null; note: string | null }[]).map((s) => ({
      id: Number(s.id),
      questionNo: s.question_no,
      engine: s.engine,
      cited: s.cited,
      citedUrl: s.cited_url,
      expectedPage: s.expected_page,
      note: s.note,
    }));
  }
  return {
    now: now.toISOString(),
    gate: {
      open: gate.open,
      problems: gate.problems,
      siteIndexing: siteIndexing(),
      site: gate.site ?? null,
      searchCrawlers: policy?.search.length ?? 0,
      aiDecided: policy?.ai_training.decided === true,
      indexnow: gate.settings?.indexnow === true,
    },
    freshness: { open: ((openRes.data ?? []) as unknown as RawFreshness[]).map(toItem), recent: ((recentRes.data ?? []) as unknown as RawFreshness[]).map(toItem) },
    ai: {
      sets: sets.map((s) => ({ version: s.version, questions: counts.get(s.version) ?? 0, activatedAt: s.activated_at })),
      activeVersion: active,
      questions,
      month,
      samples,
      tally: citationTally(samples),
      byEngine: tallyByEngine(samples),
    },
    runs: ((runsRes.data ?? []) as { job: string; status: string; started_at: string; finished_at: string | null; detail: unknown; error: string | null }[]).map((r) => ({
      job: r.job,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      detail: r.detail,
      error: r.error,
    })),
  };
}
