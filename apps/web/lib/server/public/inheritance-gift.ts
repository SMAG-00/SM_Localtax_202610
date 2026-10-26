import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { OFFICIAL_LINK_COLUMNS, toLinkCard, type OfficialLinkCard } from "./calc";
import type { ArticleListItem } from "./cards";
import { publicDb, rowsOf } from "./db";
import {
  IG_TITLE,
  fam08Card,
  lensNeedsNationalCard,
  parseNotice,
  parseSituationSlugs,
  selfCalculatorHref,
  smAcquisitionCard,
  type IgPath,
  type LinkPair,
} from "./inheritance-gift-logic";
import { getOwnCardState } from "@/lib/igt/tools";
import type { OwnState } from "@/lib/igt/gate";
import { readArticleList, readPublicSettings } from "./reads";
import { SITUATION_COLUMNS, type SituationRow } from "./rows";
import { toSituationCard, type SituationCard } from "./situation-logic";

// 상속·증여 안내 읽기 (W4 23단계 — FAM-01·02·08). 기능 키 inheritance_gift가 꺼지면 null → 하위 분야 목록(본 경로) 또는 404(하위 경로).
// 공개 뷰·공개 설정·공개 상황(RLS visible)만 anon 키로 읽는다. 계산·입력은 없고, 외부 계산기 주소는 official_links 저장 주소 그대로다.

export interface IntroArticle {
  item: ArticleListItem;
  /** 최종 감수일 (한국 날짜) */
  reviewedOn: string;
}

export interface InheritanceGiftView {
  path: IgPath;
  title: string;
  notice: string;
  situations: SituationCard[];
  articles: IntroArticle[];
  sm: LinkPair | null;
  fam08: LinkPair | null;
  selfCalculatorHref: string | null;
  /** 게이트가 열린 국세 자체 카드 (W11-g, FAM-14) - 없으면 외부 카드 그대로 */
  own?: OwnState;
}

/** 「지방세로 읽기」 박스 옆 국세 연결 카드 (FAM-08 - 키 inheritance_gift 켜짐 + 박스 세목에 상속세·증여세). 아니면 null(읽지 않는다) */
export async function getLensNationalCard(topics: readonly string[], open: boolean): Promise<LinkPair | null> {
  if (!open || !lensNeedsNationalCard(topics)) return null;
  const rows = await rowsOf<Parameters<typeof toLinkCard>[0]>(publicDb().from("official_links").select(OFFICIAL_LINK_COLUMNS).not("url", "is", null).order("sort").order("id"), "박스 국세 연결 카드");
  return fam08Card(rows.flatMap((r) => toLinkCard(r) ?? []));
}

export async function getInheritanceGift(path: IgPath): Promise<InheritanceGiftView | null> {
  const settings = await readPublicSettings();
  const f = settings.features;
  if (!f.inheritance_gift) return null;
  const db = publicDb();
  const [setRows, intro, linkRows] = await Promise.all([
    rowsOf<{ key: string; value: unknown }>(db.from("settings").select("key, value").in("key", ["inheritance_gift_notice", "inheritance_gift_situations"]), "상속·증여 설정"),
    rowsOf<{ article_id: number; reviewed_at: string }>(db.from("public_inheritance_intro").select("article_id, reviewed_at"), "상속·증여 입문 기사"),
    rowsOf<Parameters<typeof toLinkCard>[0]>(db.from("official_links").select(OFFICIAL_LINK_COLUMNS).not("url", "is", null).order("sort").order("id"), "상속·증여 연결 카드"),
  ]);
  const setting = (k: string) => setRows.find((r) => r.key === k)?.value;
  const slugs = parseSituationSlugs(setting("inheritance_gift_situations"));
  const reviewedBy = new Map(intro.map((r) => [Number(r.article_id), isoToKstDate(r.reviewed_at)]));
  const [situationRows, list] = await Promise.all([
    slugs.length ? rowsOf<SituationRow>(db.from("situations").select(SITUATION_COLUMNS).in("slug", slugs), "상속·증여 상황") : Promise.resolve([] as SituationRow[]),
    reviewedBy.size ? readArticleList(db, { ids: [...reviewedBy.keys()], contentType: "explainer", limit: 50 }) : Promise.resolve({ items: [] as ArticleListItem[], total: 0 }),
  ]);
  const cards: OfficialLinkCard[] = linkRows.flatMap((r) => toLinkCard(r) ?? []);
  const situations = slugs.flatMap((s) => {
    const row = situationRows.find((r) => r.slug === s);
    return (row && toSituationCard(row)) || [];
  });
  const articles = list.items.flatMap((item) => {
    const reviewedOn = reviewedBy.get(item.id);
    return reviewedOn ? [{ item, reviewedOn }] : [];
  });
  return {
    path,
    title: IG_TITLE[path],
    notice: parseNotice(setting("inheritance_gift_notice")),
    situations,
    articles,
    sm: smAcquisitionCard(cards, f.sm_calculator),
    fam08: fam08Card(cards),
    selfCalculatorHref: selfCalculatorHref(f.self_calculator),
    own: await getOwnCardState(),
  };
}
