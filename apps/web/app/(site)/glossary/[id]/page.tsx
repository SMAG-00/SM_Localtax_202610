import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { GlossaryTermPage } from "@/components/site/GlossaryView";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getGlossaryTerm, isUnavailable, parseGlossaryId, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 용어 쪽 (/glossary/[번호] — GLO-01 · PRD-01A 3장 '/glossary/[term]', docs/dev/W2-d_설계.md 8.2). 검색 결과·본문 풀이의 '용어사전에서 보기'·용어 칩이 이 주소로 온다.
//  · 기능 키 glossary가 꺼져 있거나, 숨긴·없는 용어·번호 형식 밖이면 404
//  · 공개 데이터를 읽지 못하면 proxy가 503을 먼저 보낸다(있는지 모르므로 404 0) — 확인을 지난 뒤 읽기가 실패하면 같은 안내를 이 화면이 그린다
//  · 주소는 용어 번호 — 용어 이름을 고쳐도 주소가 바뀌지 않는다 (W2-d 설계 12장)

const load = cache(async (raw: string) => {
  await connection();
  const id = parseGlossaryId(raw);
  if (id === null) notFound();
  return readPublic("용어", () => getGlossaryTerm(id), () => UNAVAILABLE);
});

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await load((await params).id);
  if (isUnavailable(t)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!t) notFound();
  return { title: pageTitle(`${t.term} — 용어사전`), ...(t.plain ? { description: t.plain } : {}) };
}

export default async function GlossaryTermRoute({ params }: Props) {
  const t = await load((await params).id);
  if (isUnavailable(t)) return <UnavailablePage />;
  if (!t) notFound();
  return <GlossaryTermPage t={t} />;
}
