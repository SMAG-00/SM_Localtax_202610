import { UiLink } from "@ltr/ui";
import { libraryFeatureOn } from "@/lib/server/library/read";
import { TEXT_LINK } from "./SiteSection";

// 지식창고 허브 링크 한 줄 (W13-a, 5단계 설계 5장 #5) - /store와 /tax 허브 두 곳에서 쓴다.
// 기능 키 library가 꺼져 있으면 아무것도 그리지 않는다. 결제·가격 요소 0, 무상 범위 화면의 본문 흐름을 바꾸지 않는다.
export async function LibraryLink() {
  if (!(await libraryFeatureOn())) return null;
  return (
    <p data-part="library-link" className="mx-auto max-w-3xl px-4 pb-10 text-[16px]">
      <UiLink href="/library" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
        지식창고
      </UiLink>
    </p>
  );
}
