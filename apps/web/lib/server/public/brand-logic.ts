// 인물 페이지 순수 판정 (W3 7단계 — BR-02 · OPT-02) — 화면과 구조화 데이터가 같은 값에서 나오게 한 곳에 둔다. 서버 전용 아님(단위 시험)
import type { ArticleView, PersonView } from "@ltr/structured-data";

/** 화면 약력 한 줄 — 증빙 승인 항목만 (publicBioItems 결과) */
export interface BioLine {
  id: string;
  text: string;
  evidenceId: string;
}

/** 약력 줄을 이은 글자 — 화면 '약력'의 줄들과 Person.description이 같은 글자다 */
export const bioText = (bio: readonly BioLine[]): string => bio.map((b) => b.text).join(" · ");

/**
 * 인물 페이지 구조화 데이터 원본 — 이름·주소 + 증빙 승인 약력(있을 때만 description).
 * 직함·소속·자격·수상·sameAs·사진은 증빙·확인 기록 칸이 생길 때까지 넣지 않는다 (화면에 없는 값 0)
 */
export function personStructuredView(url: string, name: string, bio: readonly BioLine[]): PersonView {
  const description = bioText(bio);
  return { url, name, ...(description ? { description } : {}) };
}

/** 역할별 블록 (BR-02 — 같은 틀, 그 역할에만). 기능 키 people_pages가 꺼져 있으면 공통 블록(머리·쓴 기사)만 */
export type RoleBlock = "columns" | "reviewed";
export function roleBlocks(roles: readonly string[], pagesOpen: boolean): RoleBlock[] {
  if (!pagesOpen) return [];
  const out: RoleBlock[] = [];
  if (roles.includes("writer")) out.push("columns");
  if (roles.includes("reviewer")) out.push("reviewed");
  return out;
}

/**
 * 기사 구조화 데이터의 감수자 (W3 10단계 · BR-03) — 기사 화면의 감수 표시('감수 ○○' — 세무 감수 서명 기록 + 서명자 동의서)가 있을 때만
 * ArticleView.reviewer를 단다. 서명 기록이 없으면(mark null) 그대로 — 감수자 속성 0. 서명자 인물 페이지 주소는 기사 주소와 같은 사이트의 절대 주소로,
 * 기사 주소가 상대 주소(사이트 주소 설정 없음)이면 이름만
 */
export function articleViewWithReviewer(view: ArticleView, mark: { reviewerName: string; reviewerHref: string | null } | null): ArticleView {
  if (!mark) return view;
  const origin = /^https?:\/\//.test(view.url) ? new URL(view.url).origin : null;
  const url = mark.reviewerHref && origin ? `${origin}${mark.reviewerHref}` : undefined;
  return { ...view, reviewer: { name: mark.reviewerName, ...(url ? { url } : {}) } };
}
