import { getEventList } from "@/lib/server/public/local-news";
import { isMonth } from "@/lib/server/public/local-news-logic";
import { PublicDataError } from "@/lib/server/public/db";

// 행사 목록 읽기 API (W6 REG1-04 - GET /api/local/events?region=&month=YYYY-MM). 화면 /local/events와 같은 함수(getEventList)의 결과라 같은 조건이면 같다.
// 키 local_events 꺼짐 404 · month 형식 틀림 400 · 알 수 없는 지역 404. 축제는 없다 (LG-10).
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (month !== null && month !== "" && !isMonth(month)) return Response.json({ error: "month는 YYYY-MM 형식입니다" }, { status: 400 });
  try {
    const view = await getEventList({ region: url.searchParams.get("region"), month: month || null });
    if (!view.open || view.badRegion) return Response.json({ error: "찾을 수 없습니다" }, { status: 404 });
    return Response.json({
      range: { from: view.range.from, to: view.range.to, months: view.range.months },
      region: view.regionCode,
      count: view.cards.length,
      events: view.cards.map((c) => ({ slug: c.slug, title: c.title, category: c.category, status: c.statusLabel, startDate: c.startDate, endDate: c.endDate, period: c.period, venue: c.venue, organizer: c.organizer, regionCode: c.regionCode, sponsored: c.sponsored, officialUrl: c.officialUrl, confirmedOn: c.confirmedOn, recheckDue: c.recheckDue, href: c.href })),
    });
  } catch (err) {
    if (!(err instanceof PublicDataError)) throw err;
    return Response.json({ error: "지금은 읽지 못합니다" }, { status: 503 });
  }
}
