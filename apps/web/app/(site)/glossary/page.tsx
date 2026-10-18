import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GlossaryIndex, GlossaryUnavailable } from "@/components/site/GlossaryView";
import type { SearchParams } from "@/components/site/routes";
import { getGlossaryIndex, isUnavailable, parseGlossarySection, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 용어사전 색인 (/glossary — GLO-01 · PRD-01A 3장 '용어사전', docs/dev/W2-d_설계.md 8.2). 기능 키 glossary가 꺼져 있으면 404(사이트 안 링크도 0 — isOpenPath).
// 공개 용어(visible)만 가나다 색인으로 — 분야 거르개는 ?section=(모르는 값은 전체). 요청 때 그린다 — 사전 API 쓰기는 공개 데이터 캐시를 바로 만료한다.
// 검색 노출(robots)은 사이트 설정 그대로(루트 레이아웃). 공개 데이터를 읽지 못하면 머리와 안내 한 줄(200 — 다른 목록 화면과 같다)

export const metadata: Metadata = {
  title: pageTitle("용어사전"),
  description: "어려운 세금·부동산 말을 쉬운 말로 풀었습니다. 가나다 차례로 찾아보세요.",
};

export default async function GlossaryPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const section = parseGlossarySection((await searchParams).section);
  const data = await readPublic("용어사전", () => getGlossaryIndex(section), () => UNAVAILABLE);
  if (isUnavailable(data)) return <GlossaryUnavailable />;
  if (data === null) notFound();
  return <GlossaryIndex data={data} />;
}
