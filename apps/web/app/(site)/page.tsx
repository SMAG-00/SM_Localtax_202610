import { connection } from "next/server";
import { HomeSections } from "@/components/site/HomeSections";
import { ToolCardsRow } from "@/components/site/calc/ToolCardsRow";
import { getToolCards } from "@/lib/server/public/tool-cards";
import { closedHomeData, getHomeData, getHomeHeroMedia, readPublic, type HomeData } from "@/lib/server/public";

// 홈 (HOME-01~04 · PRD_최종 §4.1) — 섹션 순서 고정, 내용 0건 섹션은 빠진다. 공개 데이터 함수(anon 키·RLS)만 부른다.
// 요청 때 그린다(빌드 때 DB를 읽지 않는다). 읽은 공개 행은 30초까지 캐시 — 편집국 쓰기는 바로 만료한다 (설계 7.1).
// 공개 데이터를 읽지 못하면 DB가 필요 없는 4대 분야 카드와 짧은 안내만 보인다 (닫힌 홈 — 원인은 서버 로그에만).
async function home(): Promise<HomeData> {
  return readPublic("홈", () => getHomeData(), () => closedHomeData());
}

export default async function HomePage() {
  await connection();
  const [data, { hero, cards }, tools] = await Promise.all([home(), getHomeHeroMedia(), getToolCards().catch(() => null)]);
  // 계산기 카드 (HOME-08) - 자체 계산기는 게이트 결과로, 아닌 세목은 같은 자리에 SM 카드, 환급 진단은 서명된 판정표가 있을 때만. 홈 블록 수·순서는 그대로
  const toolsRow = tools ? <ToolCardsRow cards={tools.cards} smLinks={tools.smLinks} fallbacks={tools.fallbacks} /> : null;
  return <HomeSections home={data} heroMedia={hero} cardImages={cards} toolsRow={toolsRow} />;
}
