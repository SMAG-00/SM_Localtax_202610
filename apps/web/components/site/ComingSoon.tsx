import { Eyebrow, UiLink } from "@ltr/ui";
import { TEXT_LINK } from "./SiteSection";

// '준비 중' 안내 (W10-i 바로가기 도착) - 바로가기는 메뉴라 도착 화면이 아직 닫혀 있어도 404가 아니라 이 화면을 보여준다.
// 짧은 안내 글자와 갈 곳 링크만 있고 법률·세무 내용은 없다. 색인하지 않는다(noindex).
export interface ComingSoonLink {
  href: string;
  label: string;
}

export function ComingSoon({ title, notice, links = [], children }: { title: string; notice: string; links?: readonly ComingSoonLink[]; children?: React.ReactNode }) {
  return (
    <section data-part="coming-soon" className="mx-auto w-full max-w-[780px] px-4 py-16">
      <meta name="robots" content="noindex, follow" />
      <Eyebrow>NOTICE</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900">{title}</h1>
      <p className="mt-3 text-[17px] text-navy-600" role="status">
        {notice}
      </p>
      {children}
      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <UiLink href={l.href} className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
              {l.label}
            </UiLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
