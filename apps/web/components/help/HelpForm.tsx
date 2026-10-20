import Link from "next/link";
import { CODE_MESSAGES, HELP_FORMS, isHelpCode, signHelpToken, type HelpSlug } from "@/lib/help/forms";

// 고객센터 폼 (W2-e 설계 7.1) — 일반 HTML 폼(JS 없이 동작), 서버 컴포넌트. 열린 시각 토큰은 호출하는 화면이 만들어 넘긴다(렌더 안에서 시계를 읽지 않는다).
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";

export const openHelpToken = (secret: string): string => signHelpToken(secret, Date.now());

export const HELP_TABS: ReadonlyArray<{ slug: Exclude<HelpSlug, "corrections">; label: string }> = [
  { slug: "report", label: "기사 제보" },
  { slug: "subscribe", label: "구독 문의" },
  { slug: "ad", label: "광고 문의" },
  { slug: "contribute", label: "독자 투고" },
];

export function HelpTabs({ current }: { current: string }) {
  return (
    <nav aria-label="고객센터" className="mb-6 flex flex-wrap gap-2">
      {HELP_TABS.map((t) => (
        <Link key={t.slug} href={HELP_FORMS[t.slug].path} prefetch={false} aria-current={t.slug === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-[15px] font-bold ${t.slug === current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function HelpForm({ slug, fill, sent, errorCode, maxFiles, extensions }: { slug: HelpSlug; fill: string; sent: string | null; errorCode: string | null; maxFiles: number; extensions: readonly string[] }) {
  const spec = HELP_FORMS[slug];
  const code = errorCode && isHelpCode(errorCode) && errorCode !== "sent" ? errorCode : null;
  if (sent) {
    return (
      <p role="status" data-testid="help-sent" className="rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
        {CODE_MESSAGES.sent}. 접수 번호는 <span data-testid="help-ref">{sent}</span> 입니다.
      </p>
    );
  }
  const id = `help-${slug}`;
  return (
    <form method="post" action={`/api/help/${slug}`} encType={spec.attachments ? "multipart/form-data" : "application/x-www-form-urlencoded"} className="space-y-4" data-testid={`help-form-${slug}`}>
      {code && (
        <p role="alert" data-testid="help-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          {CODE_MESSAGES[code]}
        </p>
      )}
      {spec.requestType && (
        <fieldset>
          <legend className={label}>구분 (필수)</legend>
          <label className="mt-1 flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="requestType" value="correction" required className="size-5" /> 정정 요청</label>
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="requestType" value="rebuttal" required className="size-5" /> 반론 요청</label>
        </fieldset>
      )}
      {spec.article !== "none" && (
        <div>
          <label htmlFor={`${id}-article`} className={label}>관련 기사 주소{spec.article === "required" ? " (필수)" : " (선택)"}</label>
          <input id={`${id}-article`} name="articleUrl" type="text" required={spec.article === "required"} maxLength={300} className={input} />
        </div>
      )}
      {(spec.titleRequired) && (
        <div>
          <label htmlFor={`${id}-title`} className={label}>제목 (필수)</label>
          <input id={`${id}-title`} name="title" type="text" required maxLength={100} className={input} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-body`} className={label}>내용 (필수)</label>
        <textarea id={`${id}-body`} name="body" required rows={8} maxLength={5000} aria-describedby={`${id}-body-help`} className={`${input} py-2`} />
        <p id={`${id}-body-help`} className="mt-1 text-[14px] text-navy-600">연락처는 내용에 적지 말고 아래 연락 이메일 칸에 적어 주세요. 내용에 적힌 이메일·전화번호·긴 번호는 저장할 때 가려집니다.</p>
      </div>
      {spec.organization && (
        <div>
          <label htmlFor={`${id}-org`} className={label}>회사 이름 (선택)</label>
          <input id={`${id}-org`} name="organization" type="text" maxLength={100} className={input} />
        </div>
      )}
      {spec.contactName && (
        <div>
          <label htmlFor={`${id}-name`} className={label}>{spec.contactName.label} (선택)</label>
          <input id={`${id}-name`} name="contactName" type="text" maxLength={100} className={input} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-email`} className={label}>연락 이메일{spec.emailRequired ? " (필수)" : " (선택 — 비워 두면 익명 제보)"}</label>
        <input id={`${id}-email`} name="contactEmail" type="email" required={spec.emailRequired} maxLength={254} autoComplete="email" className={input} />
      </div>
      {spec.attachments && (
        <div>
          <label htmlFor={`${id}-files`} className={label}>첨부 (선택, 최대 {maxFiles}개)</label>
          <input id={`${id}-files`} name="files" type="file" multiple accept={extensions.map((e) => `.${e}`).join(",")} className={input} />
          <p className="mt-1 text-[14px] text-navy-600">허용 형식: {extensions.join(" · ")}</p>
        </div>
      )}
      <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
        <input type="checkbox" name="agreePrivacy" required={spec.emailRequired} className="size-5" /> 개인정보 수집·이용에 동의합니다{spec.emailRequired ? " (필수)" : " (이메일을 적은 경우 필수)"}
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${id}-website`}>웹사이트</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="fill" value={fill} />
      <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
        접수하기
      </button>
    </form>
  );
}
