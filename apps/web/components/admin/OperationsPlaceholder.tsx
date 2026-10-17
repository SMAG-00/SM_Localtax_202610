import { Callout } from "@ltr/ui";
import { PageTitle } from "./ui";

/** 편집국 외 운영 화면 자리 — 화면은 해당 작업 단위에서 만든다. 이 역할에게 기사 승인·정렬·발행 메뉴는 없다 (ADM-01) */
export function OperationsPlaceholder({ title, work, note }: { title: string; work: string; note: string }) {
  return (
    <>
      <PageTitle title={title} description={note} />
      <Callout>이 화면은 {work}에서 엽니다. 지금은 역할별 메뉴 자리만 있습니다.</Callout>
    </>
  );
}
