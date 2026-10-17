import { connection } from "next/server";
import { HomeSections } from "@/components/site/HomeSections";
import { closedHomeData, getHomeData, readPublic, type HomeData } from "@/lib/server/public";

// 홈 (HOME-01~04 · PRD_최종 §4.1) — 섹션 순서 고정, 내용 0건 섹션은 빠진다. 공개 데이터 함수(anon 키·RLS)만 부른다.
// 요청 때 그린다(빌드 때 DB를 읽지 않는다). 읽은 공개 행은 30초까지 캐시 — 편집국 쓰기는 바로 만료한다 (설계 7.1).
// 공개 데이터를 읽지 못하면 DB가 필요 없는 4대 분야 카드와 짧은 안내만 보인다 (닫힌 홈 — 원인은 서버 로그에만).
async function home(): Promise<HomeData> {
  return readPublic("홈", () => getHomeData(), () => closedHomeData());
}

export default async function HomePage() {
  await connection();
  return <HomeSections home={await home()} />;
}
