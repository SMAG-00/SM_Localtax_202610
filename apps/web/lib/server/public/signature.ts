import "server-only";
import type { SeriesKey } from "@/lib/brand/claim";
import { consentScopes } from "./brand";
import type { ArticleListItem } from "./cards";
import { publicDb, rowsOf } from "./db";
import { num } from "./rows";
import { readArticleList, readPublicSettings } from "./reads";
import { applySignature, framesFrom, homeColumnItems, thenNowViews, type EpisodeRef, type SeriesRow, type SignatureFrame, type SignatureHomeItem, type ThenNowView } from "./signature-logic";

// 시그니처 연재 공개 읽기 (W3 8단계 — BR-04, docs/dev/W3_설계.md 2.4·2.6) — 공개 뷰만(anon).
//  · public_signature_series: 연재 제목(경력 연수 표기가 있는데 승인·brand_copy·근거 약력 줄 중 하나라도 없으면 null)·근거 링크 재료·발행 주기·공개 회차 수
//  · public_signature_episodes: 공개 기사의 회차 번호 / public_then_now_items: 출처·기준연도가 있는 비교 항목만
//  · 연재 틀(제목·회차·홈 영역)은 기능 키 tax_columns가 켜졌을 때만. 「그때와 지금」 비교 항목은 칼럼 내용이라 키와 상관없이 낸다

const SERIES_COLUMNS = "series_key, ord, title, claim_shown, basis_person_slug, basis_evidence_id, cadence, episodes";
const HOME_CANDIDATES = 5;

export async function readSignatureFrames(): Promise<Map<SeriesKey, SignatureFrame>> {
  const rows = await rowsOf<SeriesRow>(publicDb().from("public_signature_series").select(SERIES_COLUMNS), "시그니처 연재 틀");
  return framesFrom(rows);
}

async function readEpisodes(articleIds: readonly number[]): Promise<Map<number, EpisodeRef>> {
  if (articleIds.length === 0) return new Map();
  const rows = await rowsOf<{ article_id: number; series_key: SeriesKey; episode: number }>(
    publicDb().from("public_signature_episodes").select("article_id, series_key, episode").in("article_id", [...articleIds]),
    "시그니처 연재 회차",
  );
  return new Map(rows.map((r) => [num(r.article_id), { seriesKey: r.series_key, episode: num(r.episode) }]));
}

/** 목록 카드에 연재 틀 입히기 — 기능 키가 꺼져 있으면 그대로(회차 글은 기사 연재 칸이 비어 있어 칼럼으로만 보인다) */
export async function withSignature(items: readonly ArticleListItem[]): Promise<ArticleListItem[]> {
  const opinion = items.filter((a) => a.contentType === "opinion").map((a) => a.id);
  if (opinion.length === 0) return [...items];
  const settings = await readPublicSettings();
  if (!settings.features.tax_columns) return [...items];
  const [episodes, frames] = await Promise.all([readEpisodes(opinion), readSignatureFrames()]);
  return applySignature(items, episodes, frames);
}

/** 홈 김의효 칼럼 영역 (BR-04 · PRD_최종 §4.1) — 기능 키 tax_columns + 공개 회차 1편 이상일 때만, 아니면 빈 목록(영역째 숨김) */
export async function getSignatureHome(): Promise<SignatureHomeItem[]> {
  const settings = await readPublicSettings();
  if (!settings.features.tax_columns) return [];
  const frames = await readSignatureFrames();
  const open = [...frames.values()].filter((f) => f.episodes > 0).map((f) => f.key);
  if (open.length === 0) return [];
  const db = publicDb();
  const lists = await Promise.all(
    open.map((key) =>
      rowsOf<{ article_id: number; episode: number }>(
        db.from("public_signature_episodes").select("article_id, episode").eq("series_key", key).order("episode", { ascending: false }).limit(HOME_CANDIDATES),
        "홈 시그니처 회차",
      ).then((rows) => rows.map((r) => ({ seriesKey: key, articleId: num(r.article_id), episode: num(r.episode) }))),
    ),
  );
  const flat = lists.flat();
  const { items } = await readArticleList(db, { ids: flat.map((c) => c.articleId), limit: flat.length || 1 });
  const byId = new Map(items.map((a) => [a.id, a]));
  const authorIds = await authorsOf(flat.map((c) => c.articleId));
  const scopes = await consentScopes([...new Set(authorIds.values())]);
  return homeColumnItems(
    frames,
    flat.map((c) => ({ seriesKey: c.seriesKey, episode: c.episode, article: byId.get(c.articleId) })),
    (a) => {
      const author = authorIds.get(a.id);
      return author !== undefined && (scopes.get(author) ?? []).includes("home");
    },
  );
}

/** 회차 기사의 필자 번호 — 홈에 이름을 내려면 필자 동의서 범위에 home이 있어야 한다 (BR-07) */
async function authorsOf(articleIds: readonly number[]): Promise<Map<number, number>> {
  if (articleIds.length === 0) return new Map();
  const rows = await rowsOf<{ id: number; author_id: number | null }>(publicDb().from("public_articles").select("id, author_id").in("id", [...articleIds]), "회차 필자");
  return new Map(rows.flatMap((r) => (r.author_id === null ? [] : [[num(r.id), num(r.author_id)] as [number, number]])));
}

export interface ArticleSignature {
  /** 연재 줄 — 틀이 열려 있을 때만 (기사 연재 이름 칸 대신) */
  series: { title: string; episode: number; basisHref: string | null } | null;
  thenNow: ThenNowView[];
}

/** 기사 상세의 시그니처 연재 줄 + 「그때와 지금」 비교 항목. 회차가 아니면 null */
export async function getArticleSignature(articleId: number): Promise<ArticleSignature | null> {
  const episodes = await readEpisodes([articleId]);
  const ep = episodes.get(articleId);
  if (!ep) return null;
  const [settings, frames, items] = await Promise.all([
    readPublicSettings(),
    readSignatureFrames(),
    ep.seriesKey === "then_now"
      ? rowsOf<{ position: number; label: string | null; then_text: string; now_text: string; source: string | null; source_url: string | null; base_year: number | null }>(
          publicDb().from("public_then_now_items").select("position, label, then_text, now_text, source, source_url, base_year").eq("article_id", articleId).order("position"),
          "그때와 지금 항목",
        )
      : Promise.resolve([]),
  ]);
  const frame = settings.features.tax_columns ? frames.get(ep.seriesKey) : undefined;
  return { series: frame ? { title: frame.title, episode: ep.episode, basisHref: frame.basisHref } : null, thenNow: thenNowViews(items) };
}
