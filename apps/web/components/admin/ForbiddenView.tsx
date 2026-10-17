import Link from "next/link";
import { Callout, Eyebrow } from "@ltr/ui";
import { TEXT_LINK } from "./ui";

/** 403 화면 — 역할이 쓸 수 없는 백오피스 화면 (forbidden()). 어떤 역할이 필요한지는 접근 판정 문장이 정한다 — 여기서는 일반 안내만 */
export function ForbiddenView() {
  return (
    <section aria-labelledby="forbidden-title" className="rounded-2xl border border-navy-100 bg-white p-6">
      <Eyebrow>403 FORBIDDEN</Eyebrow>
      <h1 id="forbidden-title" className="mt-3 text-[28px] leading-tight font-black text-navy-900">
        이 화면을 쓸 권한이 없습니다
      </h1>
      <p className="mt-2 text-[17px] text-navy-800">지금 역할로는 이 화면을 열 수 없습니다.</p>
      <Callout className="mt-4">필요한 역할은 관리자에게 요청하세요. 편집국 외 역할은 기사 승인·정렬·발행을 하지 않습니다.</Callout>
      <p className="mt-4">
        <Link href="/admin" className={TEXT_LINK}>
          첫 화면으로 가기
        </Link>
      </p>
    </section>
  );
}
