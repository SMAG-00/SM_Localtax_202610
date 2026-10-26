import { MeasureOnce, StripQuery } from "./MeasureShortcut";
import { CHANNEL_KEYS, channelLandingProps } from "@/lib/channels/kit";

// 채널 유입 측정 (CH-01 - docs/dev/W12-h_설계.md 결정 3). 서버가 '등록된 (채널, 기사) 쌍'을 확인한 뒤에만 그린다 - 그리는 것은 측정 요소와 주소 정리뿐.
// 등록되지 않은 utm 값은 측정하지 않는다(other로 바꾸지도 않음). 측정 뒤 주소창의 utm을 지워 공유·새로고침에 남지 않게 한다.
export function ChannelLandingMeasure({ channel, articleId, slug }: { channel: string; articleId: number; slug: string }) {
  if (!(CHANNEL_KEYS as readonly string[]).includes(channel)) return null;
  return (
    <>
      <MeasureOnce name="channel_landing_viewed" props={channelLandingProps(channel, articleId, slug)} />
      <StripQuery />
    </>
  );
}
