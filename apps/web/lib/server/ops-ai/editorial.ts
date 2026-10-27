import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANNELS, draftArticleBox, draftCaseSummary, draftChannelCopy, isKstMonday, isoWeekKey, judgeImpactSentences, parseChannelLimits, proposalLate,
  type Channel, type TagOption, type TokenUsage,
} from "@ltr/workflows/ops";
import { readBriefPolicy, readSetting } from "../brief/policy";
import { readStoredBody } from "../articles/content";
import { siteUrl } from "../env";
import { opsGate, sum, usageOf, type OpsGate } from "./service";

// 편집국 AI 작업 (W12-f - O2 결정례 요지 AIOPS-07 · O3 대중화 AIOPS-08 · O3 채널 원고 AIOPS-10 · O6 정합성 감시 AIOPS-09).
//  · AI는 꺼진 상태(키·모델·예산 없음, ai_ops 꺼짐, 예산 초과)에서 호출 0이고, 감시의 뼈대(영향 기사 찾기·경보·배너 제안)는 그대로 돈다.
//  · AI 결과는 review_items(case_summary · article_ai_box · channel_draft · consistency_alert)와 승인 전 초안 표에만 쓴다. 승인 전 공개 0, 공개 쓰기 0.
//  · AI는 세액을 만들지 않는다 - 이 폴더는 국세 엔진을 불러오지 않는다(NT9).
type Db = SupabaseClient;
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());
const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/** 한 번 실행에서 AI로 처리하는 결정례 수 상한 - 비용을 일정하게 유지하는 운영 제한 */
export const CASE_SUMMARY_PER_RUN = 10;
const BATCH_ACTOR = "job:case-summary-draft";

async function forbiddenWordsOf(db: Db): Promise<string[]> {
  return (await readBriefPolicy(db)).forbiddenWords;
}

async function approvedTags(db: Db): Promise<TagOption[]> {
  const r = await db.from("issue_tags").select("tag_key, label, synonyms, tax_items").eq("status", "approved").limit(500);
  if (r.error) throw fail("issue_tags 조회", r.error);
  return ((r.data ?? []) as { tag_key: string; label: string; synonyms: string[]; tax_items: string[] }[]).map((t) => ({ tagKey: t.tag_key, label: t.label, synonyms: t.synonyms, taxItems: t.tax_items }));
}

// ── O2 결정례 요지 (작업 case-summary-draft) ─────────────────────

interface Candidate { case_id: number; content_hash: string; doc_type: string; tax_kinds: string[]; issuer: string; doc_no: string; decided_on: string; body: string }

/** 매일 + 실시간 조회로 들어온 원문 - 요지가 아직 없는 결정례를 같은 후보 함수로 찾는다(들어온 경로와 무관) */
export async function draftCaseSummaries(db: Db, now: Date, gateIn?: OpsGate): Promise<Record<string, unknown>> {
  const cand = await db.rpc("case_summary_candidates", { p_limit: CASE_SUMMARY_PER_RUN });
  if (cand.error) throw fail("case_summary_candidates", cand.error);
  const rows = (cand.data ?? []) as Candidate[];
  const out: Record<string, unknown> = { checkedAt: now.toISOString(), candidates: rows.length };
  const gate = gateIn ?? (await opsGate(db, now));
  if (!gate.run) return { ...out, ai: { skipped: gate.reason } };
  if (rows.length === 0) return { ...out, ai: { drafted: 0, failed: 0 } };
  const [tags, forbiddenWords] = await Promise.all([approvedTags(db), forbiddenWordsOf(db)]);
  let used = ZERO;
  let drafted = 0;
  let failed = 0;
  let tagsProposed = 0;
  for (const c of rows) {
    const r = await draftCaseSummary(gate.model!, { body: c.body, taxKinds: c.tax_kinds, tags, forbiddenWords });
    used = sum(used, r.usage);
    if (!r.ok) {
      failed += 1;
      continue;
    }
    const d = r.draft;
    // 사건번호·일자·기관은 원문 메타에서 코드가 넣는다 - AI 출력에서 오지 않는다
    const payload = {
      facts: { docNo: c.doc_no, decidedOn: c.decided_on, issuer: c.issuer, docType: c.doc_type },
      lines: d.lines, resultType: d.resultType, popularity: d.popularity, hotCandidate: d.popularity >= 70,
      tagKeys: d.tagKeys, newTagCandidates: d.newTagCandidates, provisionCandidates: d.provisionCandidates, warnings: d.warnings, model: gate.model!.name,
    };
    const add = await db.rpc("case_summary_draft_add", { p_case_id: c.case_id, p_content_hash: c.content_hash, p_lines: d.lines, p_result_type: d.resultType, p_popularity: d.popularity, p_model: gate.model!.name, p_actor: BATCH_ACTOR, p_payload: payload });
    if (add.error) throw fail("case_summary_draft_add", add.error);
    const res = add.data as { ok: boolean; code: string };
    if (!res.ok) {
      failed += 1;
      continue;
    }
    drafted += res.code === "created" ? 1 : 0;
    if (res.code !== "created") continue;
    for (const key of d.tagKeys) {
      const t = await db.rpc("case_issue_tag_ai_propose", { p_case_id: c.case_id, p_tag_key: key, p_actor: BATCH_ACTOR });
      if (t.error) throw fail("case_issue_tag_ai_propose", t.error);
      if ((t.data as { ok: boolean }).ok) tagsProposed += 1;
    }
  }
  return { ...out, ai: { drafted, failed, tagsProposed }, _usage: usageOf(gate, used) };
}

// ── 검수 흐름 도우미 ────────────────────────────────────────────

/** 검수 항목을 승인 상태까지 올린다(이미 승인·발행이면 그대로). 체크리스트는 DB가 종류별 필수 키로 검사한다 */
export async function approveReviewItem(db: Db, itemId: number, actor: string, checked: string[]): Promise<void> {
  const it = await db.from("review_items").select("status").eq("id", itemId).limit(1);
  if (it.error) throw fail("review_items 조회", it.error);
  let status = (it.data?.[0] as { status: string } | undefined)?.status;
  if (!status) throw new Error("검수 항목이 없습니다");
  if (status === "approved" || status === "published") return;
  if (status === "drafted") {
    const a = await db.rpc("review_item_transition", { p_id: itemId, p_to: "in_review", p_actor: actor });
    if (a.error) throw fail("review_item_transition", a.error);
    status = "in_review";
  }
  const b = await db.rpc("review_item_transition", { p_id: itemId, p_to: "approved", p_actor: actor, p_checked: checked });
  if (b.error) throw fail("review_item_transition", b.error);
}

/** 승인한 뒤 검수 항목을 처리 완료(published)로 닫는다 */
export async function closeReviewItem(db: Db, itemId: number, actor: string): Promise<void> {
  const r = await db.rpc("review_item_transition", { p_id: itemId, p_to: "published", p_actor: actor });
  if (r.error && !/허용되지 않은 상태 전이/.test(r.error.message)) throw fail("review_item_transition", r.error);
}

// ── O3 대중화 (기사 승인 때) ────────────────────────────────────

interface ArticleRow { id: number; title: string; slug: string; version: number; body: unknown; status: string; editorial_status: string }

/** 기사 본문 블록에서 읽을 글을 뽑는다 - 그림·영상은 건너뛴다 */
export function articleText(body: unknown): string {
  const blocks = readStoredBody(body).blocks as unknown as Record<string, unknown>[];
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph": case "heading": case "quote": parts.push(String(b.text ?? "")); break;
      case "callout": parts.push(`${String(b.title ?? "")} ${String(b.text ?? "")}`); break;
      case "key_summary": parts.push(...((b.lines as string[] | undefined) ?? [])); break;
      case "faq": parts.push(...((b.items as { question: string; answer: string }[] | undefined) ?? []).map((i) => `${i.question} ${i.answer}`)); break;
      case "slide": parts.push(`${String(b.title ?? "")} ${String(b.text ?? "")}`); break;
      case "table": parts.push(...((b.rows as string[][] | undefined) ?? []).map((r) => r.join(" "))); break;
      default: break;
    }
  }
  return parts.map((p) => p.trim()).filter(Boolean).join("\n");
}

async function loadArticle(db: Db, id: number): Promise<ArticleRow | null> {
  const r = await db.from("articles").select("id, title, slug, version, body, status, editorial_status").eq("id", id).limit(1);
  if (r.error) throw fail("articles 조회", r.error);
  return (r.data?.[0] as ArticleRow | undefined) ?? null;
}

/** 편집 승인된 기사의 요약 상자 초안 - AI가 꺼져 있으면 호출 0. 이미 같은 버전의 초안이 있으면 아무것도 하지 않는다 */
export async function draftArticleAiBox(db: Db, articleId: number, now: Date): Promise<Record<string, unknown>> {
  const a = await loadArticle(db, articleId);
  if (!a) return { skipped: "not_found" };
  if (a.editorial_status !== "approved") return { skipped: "not_approved" };
  const gate = await opsGate(db, now);
  if (!gate.run) return { skipped: gate.reason };
  const text = articleText(a.body);
  if (text.trim() === "") return { skipped: "no_text" };
  const r = await draftArticleBox(gate.model!, { title: a.title, articleText: text, forbiddenWords: await forbiddenWordsOf(db) });
  const _usage = usageOf(gate, r.usage);
  if (!r.ok) return { failed: r.reason, _usage };
  const d = r.draft;
  const payload = { title: a.title, threeLines: d.threeLines, meaning: d.meaning, cardnews: d.cardnews, seoTitle: d.seoTitle, seoDescription: d.seoDescription, warnings: d.warnings, model: gate.model!.name };
  const add = await db.rpc("article_ai_box_add", { p_article_id: a.id, p_article_version: a.version, p_lines: d.threeLines, p_meaning: d.meaning, p_model: gate.model!.name, p_actor: "job:article-ai-box", p_payload: payload });
  if (add.error) throw fail("article_ai_box_add", add.error);
  return { created: (add.data as { code: string }).code === "created", _usage };
}

// ── O3 채널별 원고 (편집자가 [채널 원고 만들기]) ────────────────────

export function utmUrl(base: string, slug: string, channel: Channel): string {
  return `${base}/news/${encodeURIComponent(slug)}?utm_source=${channel}&utm_medium=owned&utm_campaign=${encodeURIComponent(slug)}`;
}

export async function draftChannelCopies(db: Db, articleId: number, channels: readonly Channel[], now: Date): Promise<Record<string, unknown>> {
  const a = await loadArticle(db, articleId);
  if (!a) return { skipped: "not_found" };
  if (a.editorial_status !== "approved") return { skipped: "not_approved" };
  const limits = parseChannelLimits(await readSetting(db, "channel_copy_limits"));
  const base = siteUrl();
  if (!base) return { skipped: "no_site_url" };
  const wanted = channels.filter((c) => (CHANNELS as readonly string[]).includes(c));
  const usable = wanted.filter((c) => limits[c] !== undefined);
  if (usable.length === 0) return { skipped: "no_limits" };
  const gate = await opsGate(db, now);
  if (!gate.run) return { skipped: gate.reason };
  const text = articleText(a.body);
  if (text.trim() === "") return { skipped: "no_text" };
  const forbiddenWords = await forbiddenWordsOf(db);
  let used = ZERO;
  const done: string[] = [];
  const failed: { channel: string; reason: string }[] = [];
  for (const channel of usable) {
    const limit = limits[channel]!;
    const url = utmUrl(base, a.slug, channel);
    const r = await draftChannelCopy(gate.model!, { channel, title: a.title, articleText: text, articleUrl: url, limit, forbiddenWords });
    used = sum(used, r.usage);
    if (!r.ok) {
      failed.push({ channel, reason: r.reason });
      continue;
    }
    const ins = await db.from("review_items").insert({
      kind: "channel_draft", source_key: `channel:${a.id}:${a.version}:${channel}`, title: `채널 원고 초안 (${channel}, 기사 ${a.id})`,
      payload: { articleId: a.id, articleVersion: a.version, channel, text: r.text, length: r.text.length, limit, articleUrl: url, warnings: r.warnings, aiNotice: true, model: gate.model!.name },
      created_by: "job:channel-draft",
    });
    if (ins.error && ins.error.code !== "23505") throw fail("review_items 저장", ins.error);
    done.push(channel);
  }
  return { drafted: done, failed, _usage: usageOf(gate, used) };
}

/** 기사 승인 직후 호출 - 응답을 늦추지 않도록 응답 뒤에 돌리고, 실패해도 승인에는 영향이 없다 */
export async function scheduleAiBox(db: Db, articleId: number): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        await draftArticleAiBox(db, articleId, new Date());
      } catch (e) {
        console.error("요약 상자 초안 실패", e instanceof Error ? e.message : e);
      }
    });
  } catch {
    // 요청 밖에서 불렸으면 건너뛴다 - 초안은 관리 화면의 [상자 초안 만들기]로도 만들 수 있다
  }
}

// ── O6 정합성 감시 (작업 consistency-watch) ────────────────────────

interface ScanRow { law_event_id: number; law_id: number; law_name: string; version_id: number; effective_on: string; detected_at: string; article_id: number; article_title: string; article_no: number; branch_no: number; change: string }

async function holidaysOf(db: Db): Promise<string[]> {
  const v = await readSetting(db, "business_holidays");
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
}

/** 바뀐 조문의 새 개정판 글과 바로 앞 개정판 글 - 수집기가 옮긴 DB 값 */
async function provisionTexts(db: Db, lawId: number, versionId: number, articleNo: number, branchNo: number): Promise<{ oldText: string; newText: string }> {
  const vs = await db.from("law_versions").select("id").eq("law_id", lawId).order("effective_on", { ascending: false }).order("id", { ascending: false }).limit(20);
  if (vs.error) throw fail("law_versions 조회", vs.error);
  const ids = ((vs.data ?? []) as { id: number }[]).map((v) => v.id);
  const prev = ids[ids.indexOf(versionId) + 1];
  const read = async (vid: number | undefined) => {
    if (vid === undefined) return "";
    const r = await db.from("law_articles").select("body").eq("version_id", vid).eq("article_no", articleNo).eq("branch_no", branchNo).limit(1);
    return (r.data?.[0] as { body: string } | undefined)?.body ?? "";
  };
  return { oldText: await read(prev), newText: await read(versionId) };
}

/** 개정 이벤트(최근 14일) -> 인용 기사 찾기 -> 경보 1건 + 배너 제안(AI 없이도) + (켜져 있으면) 문장 단위 영향 참고. 월요일엔 깨진 연결 점검 */
export async function watchConsistency(db: Db, now: Date): Promise<Record<string, unknown>> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const scan = await db.rpc("consistency_scan", { p_since: since });
  if (scan.error) throw fail("consistency_scan", scan.error);
  const rows = (scan.data ?? []) as ScanRow[];
  const events = [...new Set(rows.map((r) => r.law_event_id))];
  const holidays = await holidaysOf(db);
  const gate = await opsGate(db, now);
  let used = ZERO;
  let proposed = 0;
  let bannersCreated = 0;
  let late = 0;
  let aiNotes = 0;
  for (const eventId of events) {
    const have = await db.from("review_items").select("id").eq("kind", "consistency_alert").eq("source_key", `consistency:event:${eventId}`).limit(1);
    if (have.error) throw fail("review_items 조회", have.error);
    if (have.data?.length) continue;
    const mine = rows.filter((r) => r.law_event_id === eventId);
    const notes: Record<string, string> = {};
    if (gate.run) {
      for (const articleId of [...new Set(mine.map((r) => r.article_id))]) {
        const art = await loadArticle(db, articleId);
        if (!art) continue;
        const first = mine.find((r) => r.article_id === articleId)!;
        const pair = await provisionTexts(db, first.law_id, first.version_id, first.article_no, first.branch_no);
        const j = await judgeImpactSentences(gate.model!, { articleText: articleText(art.body), oldText: pair.oldText, newText: pair.newText });
        used = sum(used, j.usage);
        if (j.ok && j.sentences.length > 0) {
          notes[String(articleId)] = j.sentences.join(" / ").slice(0, 300);
          aiNotes += 1;
        }
      }
    }
    const p = await db.rpc("consistency_propose", { p_law_event_id: eventId, p_actor: "job:consistency-watch", p_notes: notes });
    if (p.error) throw fail("consistency_propose", p.error);
    const res = p.data as { banners?: number };
    bannersCreated += Number(res.banners ?? 0);
    proposed += 1;
    if (Number(res.banners ?? 0) > 0 && proposalLate(new Date(mine[0]!.detected_at), now, holidays)) late += 1;
  }
  const out: Record<string, unknown> = { checkedAt: now.toISOString(), events: events.length, proposed, bannersCreated, late, ai: gate.run ? { notes: aiNotes } : { skipped: gate.reason } };
  if (isKstMonday(now)) {
    const l = await db.rpc("consistency_links_alert", { p_week: isoWeekKey(now), p_actor: "job:consistency-watch" });
    if (l.error) throw fail("consistency_links_alert", l.error);
    out.brokenLinks = (l.data as { broken?: number }).broken ?? 0;
  }
  return gate.run ? { ...out, _usage: usageOf(gate, used) } : out;
}

