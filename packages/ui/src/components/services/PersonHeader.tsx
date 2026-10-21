import type { ReactNode } from "react";
import { Chip } from "../base";
import { DateText, MONO, TEXT_LINK, TypeBadge } from "./parts";
import { isBlank } from "./format";

export type PersonRole = "reporter" | "writer" | "reviewer" | "expert";

/** 약력 항목 — 증빙 기록(evidenceId)이 있는 것만 화면·구조화 데이터에 나온다 (BR-02) */
export type BioItem = { id: string; text: string; evidenceId?: string | null };

export type PersonBook = { id: string; title: string; edition?: string; publisher: string; year: number | string; /** 스토어 상품 — '자사 상품' 표기 */ productHref?: string };

export type PersonHeaderProps = {
  name: string;
  roles: readonly PersonRole[];
  affiliation?: string;
  /** 확인일 — 없으면 줄째 없다 */
  checkedAt?: string | null;
  bio: readonly BioItem[];
  /** 사진 — 동의·권리 기록(rightsRecordId)이 있을 때만 보인다 (BR-07) */
  photo?: { src: string; alt: string; rightsRecordId?: string | null };
  /** 사진이 없을 때의 픽토그램 자리 */
  placeholder?: ReactNode;
  books?: readonly PersonBook[];
};

const ROLE_LABEL: Record<PersonRole, string> = { reporter: "기자", writer: "필자", reviewer: "감수자", expert: "전문가" };

/** 증빙된 약력만 — 화면과 `Person` 구조화 데이터가 같은 목록을 쓴다 */
export function verifiedBio(bio: readonly BioItem[]): BioItem[] {
  return bio.filter((b) => !isBlank(b.evidenceId) && !isBlank(b.text));
}

/** 약력 줄의 증빙 앵커 id — 영숫자·`-`·`_`만, 같은 증빙 번호의 첫 줄에만 (W3 8단계 근거 링크) */
function evidenceAnchorId(evidenceId: string | null | undefined, index: number, bio: readonly BioItem[]): string | undefined {
  const id = (evidenceId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return undefined;
  return bio.findIndex((b) => (b.evidenceId ?? "").trim() === id) === index ? `evidence-${id}` : undefined;
}

/** 인물 페이지 머리 — `/people/[slug]` (BR-02 · BR-07 · EXPL-02). 기자·필자·감수자·전문가가 같은 틀을 쓴다 */
export function PersonHeader({ name, roles, affiliation, checkedAt, bio, photo, placeholder, books }: PersonHeaderProps) {
  const shownBio = verifiedBio(bio);
  const showPhoto = photo && !isBlank(photo.rightsRecordId);

  return (
    <header data-ui="person-header" className="py-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {showPhoto ? (
          <img src={photo.src} alt={photo.alt} className="h-24 w-24 shrink-0 rounded-2xl border border-navy-100 object-cover" />
        ) : (
          <div aria-hidden="true" className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-navy-100 bg-navy-50">
            {placeholder}
          </div>
        )}
        <div className="min-w-0">
          <ul className="flex flex-wrap gap-1.5" aria-label="역할">
            {roles.map((r) => (
              <li key={r}>
                <Chip>{ROLE_LABEL[r]}</Chip>
              </li>
            ))}
          </ul>
          <h1 className="mt-2 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">{name}</h1>
          {!isBlank(affiliation) && <p className="mt-1 text-[16px] text-navy-600">{affiliation}</p>}
          {!isBlank(checkedAt) && (
            <p className={`mt-1 ${MONO}`}>
              확인일 <DateText value={checkedAt!} />
            </p>
          )}
        </div>
      </div>

      {shownBio.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[19px] font-black text-navy-900">약력</h2>
          <ul aria-label="검증된 약력" className="mt-2 list-disc space-y-1 pl-5 text-[16px] text-navy-800">
            {shownBio.map((b, i) => (
              // 증빙 번호 앵커 — 경력 연수 표기의 근거 링크(#evidence-<번호>)가 이 줄을 가리킨다. 같은 증빙의 첫 줄에만 (id 겹침 0)
              <li key={b.id} id={evidenceAnchorId(b.evidenceId, i, shownBio)}>
                {b.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {books && books.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[19px] font-black text-navy-900">저서</h2>
          <ul aria-label="저서" className="mt-2 space-y-2 text-[16px] text-navy-800">
            {books.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3">
                <span>
                  「{b.title}」{b.edition ? ` ${b.edition}` : ""} · {b.publisher} · {b.year}
                </span>
                {b.productHref && (
                  <a href={b.productHref} className={`${TEXT_LINK} text-[15px]`}>
                    <TypeBadge>자사 상품</TypeBadge>
                    <span className="sr-only">「{b.title}」</span>
                    상품 보기
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </header>
  );
}
