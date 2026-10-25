import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UiLink } from "@ltr/ui";
import { cache } from "react";
import { ArticleView } from "@/components/site/ArticleView";
import { MeasureView } from "@/components/site/Measure";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { ColumnDisclosureBlock } from "@/components/site/ColumnDisclosureBlock";
import { CaseBlock } from "@/components/site/FinanceViews";
import { getFinanceCase } from "@/lib/server/public/finance";
import { PaywallArticle } from "@/components/site/BillingViews";
import { LegalDocBlock } from "@/components/site/InterpretationView";
import { JsonLd } from "@/components/site/JsonLd";
import { PAYWALL_SELECTOR } from "@/lib/server/billing/paywall-logic";
import { paywalledArticle, toJsonLdScriptContent } from "@ltr/structured-data";
import { resolvePaywall } from "@/lib/server/billing/paywall";
import { siteUrl } from "@/lib/server/env";
import { ThenNowBlock } from "@/components/site/ThenNowBlock";
import { getArticleDetail, getArticleLegalDocs, getArticleReviewMark, getArticleSignature, getColumnDisclosure, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { articleViewWithReviewer } from "@/lib/server/public/brand-logic";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 기사 상세 (/news/[slug] — ART-02 · ART-03 카드뉴스 · ART-04 칼럼 · CAT-05 해결 사례) — 분야·유형·형식과 상관없이 기사 상세 경로는 이것 하나다.
//  · 발행되지 않은(초안·검토·보류) 기사와 없는 주소는 404, 삭제된 기사 주소는 410 + 삭제 안내(proxy.ts — 화면보다 먼저 정한다)
//  · 발행된 기사의 주소(slug)는 바꿀 수 없다(편집국 API 409 — W2-a) → 옛 주소가 생기지 않아 301이 없다. 이관 기사의 옛 주소 301은 W9 MIG-02
//  · 공개 데이터를 읽지 못하면 proxy가 503 "잠시 뒤 다시 확인해 주세요"를 먼저 보낸다 — 확인을 지난 뒤 읽기가 실패하면 같은 안내를 이 화면이 그린다
//  · 요청 때 그린다 — 편집국 쓰기는 공개 데이터 캐시를 바로 만료한다(설계 7.1)
const SLUG = /^[^\s/]+$/;

const load = cache(async (slug: string) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  return readPublic("기사 상세", () => getArticleDetail(slug), () => UNAVAILABLE);
});

// 유료 기사(W10-f BIZ-04) - 공개 기사 뷰에는 유료 기사가 없으므로 위에서 못 찾은 주소만 여기로 온다. 요청마다 그린다(공유 캐시 0).
// 미리보기는 공개 뷰, 본문은 권한 판정을 지난 서버 함수로만. 유료 화면은 색인하지 않는다.
const loadWall = cache(async (slug: string) => resolvePaywall(slug));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await load((await params).slug);
  if (isUnavailable(a)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!a) {
    const wall = await loadWall((await params).slug);
    if (!wall) notFound();
    return { title: pageTitle(wall.preview.title), robots: { index: false, follow: false }, openGraph: { type: "article", title: wall.preview.title } };
  }
  const canonical = /^https?:\/\//.test(a.share.url) ? a.share.url : undefined;
  return {
    title: pageTitle(a.title),
    description: a.share.description || undefined,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      type: "article",
      title: a.title,
      ...(a.share.description ? { description: a.share.description } : {}),
      ...(canonical ? { url: canonical } : {}),
      ...(a.share.image ? { images: [a.share.image] } : {}),
      ...(a.firstPublishedAt ? { publishedTime: a.firstPublishedAt } : {}),
      ...(a.substantiveUpdatedAt ? { modifiedTime: a.substantiveUpdatedAt } : {}),
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const a = await load((await params).slug);
  if (isUnavailable(a)) return <UnavailablePage />;
  if (!a) {
    const slug = (await params).slug;
    const wall = await loadWall(slug);
    if (!wall) notFound();
    const base = siteUrl();
    return (
      <>
        <JsonLd
          part="paywall-jsonld"
          content={toJsonLdScriptContent(
            paywalledArticle({
              ...(base ? { url: `${base}/news/${encodeURIComponent(slug)}` } : {}),
              title: wall.preview.title,
              ...(wall.preview.firstPublishedAt ? { datePublished: wall.preview.firstPublishedAt } : {}),
              paywallSelector: PAYWALL_SELECTOR,
            }),
          )}
        />
        <PaywallArticle preview={wall.preview} body={wall.body} loggedIn={wall.loggedIn} />
      </>
    );
  }
  // 해석 해설이면 원문 블록을 해설 본문과 따로 앞에 둔다 (W3 5단계 — 공개 가능한 원문만, 기능 키 꺼짐이면 없음)
  const docs = await readPublic("기사 원문 연결", () => getArticleLegalDocs(a.id), () => ({ subject: [], related: [] }));
  // 칼럼이면 머리 위에 이해관계 줄 + 의견 고지 (W3 6단계 — 기능 키 tax_columns 켜짐·고지 문구 있음일 때만)
  const disclosure = a.contentType === "opinion" ? await readPublic("칼럼 이해관계", () => getColumnDisclosure(a.id), () => null) : null;
  // 개발금융 사례 구조 블록 (W5 DF-03) - 기능 키 finance 켜짐 + 사례 기록이 있는 공개 기사일 때만
  const financeCase = a.section === "finance" ? await readPublic("개발금융 사례 구조", () => getFinanceCase(a.id), () => null) : null;
  // 감수 표시 '감수 ○○' — 세무 감수 서명 기록(뷰 article_review_marks) + 그 뒤 오탈자 아닌 수정 없음 + 서명자 동의서 활성일 때만 (W3 7단계 BR-03).
  // 손으로 넣는 칸이 없다. 읽지 못하면 표시하지 않는다
  const mark = await readPublic("감수 표시", () => getArticleReviewMark(a.id), () => null);
  // 시그니처 연재 회차 — 연재 줄은 연재 틀(설정 제목·회차·근거 링크, 기능 키 tax_columns), 「그때와 지금」은 출처·기준연도가 있는 비교 항목만 (W3 8단계 BR-04).
  // 읽지 못하면 연재 줄·비교 항목 없이 칼럼 본문만
  const signature = a.contentType === "opinion" ? await readPublic("시그니처 연재", () => getArticleSignature(a.id), () => null) : null;
  // 구조화 데이터의 감수자(WebPage.reviewedBy)는 화면 감수 표시와 같은 값에서만 — 서명 기록이 없으면 속성 0 (W3 10단계, compareRendered 감수자 대조)
  const article = { ...(signature ? { ...a, series: signature.series } : a), view: articleViewWithReviewer(a.view, mark) };
  return (
    <>
      {mark && (
        <p data-part="review-mark" className="mx-auto max-w-3xl px-4 pt-4 text-[14px] text-navy-700">
          감수{" "}
          {mark.reviewerHref ? (
            <UiLink href={mark.reviewerHref} className="inline-flex min-h-11 items-center font-bold text-navy-900 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
              {mark.reviewerName}
            </UiLink>
          ) : (
            <span className="font-bold text-navy-900">{mark.reviewerName}</span>
          )}
        </p>
      )}
      <ColumnDisclosureBlock disclosure={disclosure} />
      <CaseBlock view={financeCase} />
      <LegalDocBlock subject={docs.subject} related={docs.related} />
      {/* 원문 블록이 있는 해석 해설 열람 → interpretation_viewed(기사 번호·첫 해설 대상 원문 유형) 1건 (W3 10단계). 그리는 것 0 */}
      {docs.subject[0] && <MeasureView name="interpretation_viewed" section={a.section} props={{ article_id: a.id, doc_type: docs.subject[0].doc_type }} />}
      <ThenNowBlock items={signature?.thenNow ?? []} />
      <ArticleView article={article} today={isoToKstDate(new Date().toISOString())} />
    </>
  );
}
