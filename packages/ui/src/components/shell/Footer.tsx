import { brand } from "../../brand";
import { cx } from "../base";
import { UiLink } from "../link";

export type FooterLink = {
  label: string;
  href: string;
  /** 다른 링크와 구분되게 굵게 (개인정보처리방침 — HELP-05) */
  emphasis?: boolean;
};

/** 매체 정보·연락처 한 줄 — 값은 settings에서 오고, 비어 있으면 그 줄을 숨긴다 (HELP-05, 운영 주체 미정 기간) */
export type FooterInfo = { label: string; value?: string | null };

const filled = (rows: readonly FooterInfo[]) => rows.map((row) => ({ label: row.label, value: row.value?.trim() ?? "" })).filter((row) => row.value);

/** 저작권 표시 한 줄 — 제호는 brand에서 온다 (제호가 확정되면 brand.ts 한 줄만 바꾼다) */
const footerCopyright = () => `Copyright © ${brand.mastheadName}. All rights reserved.`;

export type FooterProps = {
  /** 면책 문구 */
  disclaimer: string;
  /** 정책·안내 링크 — 공개 승인된 것만 이 순서로 (HELP-05) */
  links: readonly FooterLink[];
  /** 안내 문단 — 저작권 보호 문구·열린보도원칙 (비어 있으면 그 문단을 숨김) */
  notices?: readonly string[];
  /** 매체 정보 줄 — 제호·등록일·등록번호·발행·편집인 등 */
  info?: readonly FooterInfo[];
  /** 연락처 줄 — 주소·전화·FAX */
  contact?: readonly FooterInfo[];
};

/**
 * 바닥글 — SM 바닥글 그대로 (PRD-00 8.6). navy-800 → 900 세로 그라데이션 + 오렌지 짧은 선 + 면책 14px navy-200.
 * 회사·정책 링크는 헤더가 아니라 여기에 모은다 (HELP-05). 어두운 바탕의 링크·보조 글자는 navy-200·navy-300(4.5:1 이상).
 */
export function Footer({ disclaimer, links, notices = [], info = [], contact = [] }: FooterProps) {
  const paragraphs = notices.map((n) => n.trim()).filter(Boolean);
  const mediaRows = filled(info);
  const contactRows = filled(contact);
  return (
    <footer data-ui="footer" className="bg-gradient-to-b from-navy-800 to-navy-900">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div aria-hidden="true" className="h-px w-12 bg-hermes-500" />
        <p className="mt-5 text-[14px] leading-relaxed text-navy-200">{disclaimer}</p>
        {links.length > 0 && (
          <nav aria-label="바닥글 메뉴" className="mt-3">
            <ul className="flex flex-wrap gap-x-4 text-[13px]">
              {links.map((link) => (
                <li key={`${link.href}-${link.label}`}>
                  <UiLink
                    href={link.href}
                    className={cx(
                      "inline-flex min-h-11 items-center underline underline-offset-4 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400",
                      link.emphasis ? "font-bold text-white" : "text-navy-200",
                    )}
                  >
                    {link.label}
                  </UiLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {paragraphs.length > 0 && (
          <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-navy-300">
            {paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        )}
        {[
          { name: "매체 정보", rows: mediaRows },
          { name: "연락처", rows: contactRows },
        ].map(
          ({ name, rows }) =>
            rows.length > 0 && (
              <dl key={name} aria-label={name} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-navy-300">
                {rows.map((row) => (
                  <div key={row.label} className="flex gap-1.5">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ),
        )}
        <p className="mt-6 text-[13px] font-semibold text-navy-300">{footerCopyright()}</p>
        <p className="mt-1 text-[13px] text-navy-300">운영 {brand.operatorName}</p>
      </div>
    </footer>
  );
}
