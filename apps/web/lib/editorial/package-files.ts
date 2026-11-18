// 편집위원 데스크 결과물 파일 묶기 (PO 2026-11-18) — 순수 모듈.
// 날짜 폴더 구조는 프로젝트 지침 통합본 v4 14-1: 기사 4종(폴더 바로 아래) · images · instagram · thread · youtube.
// 예전 코워크 폴더의 thumbnails·cardnews도 같은 묶음으로 보인다(image/Instagram/CLAUDE.md 옛 규칙).

export interface PackageFile {
  /** 날짜 폴더 기준 상대 경로 (/ 구분) — 화면에 보이는 원래 이름 */
  path: string;
  size: number;
  mime: string;
  /**
   * 저장소 키 — packages/<날짜 폴더>/<경로 해시>.<확장자>. 저장소(Supabase Storage)가 한글 키를 받지 않아 영문·숫자로만 짓고,
   * 원래 이름은 path에 둔다(작업기 scripts/editorial-desk/lib.mjs storageKey와 같은 규칙)
   */
  key: string;
}

export const GROUPS = [
  { key: "article", label: "기사", folders: [""] },
  { key: "images", label: "이미지", folders: ["images", "thumbnails"] },
  { key: "instagram", label: "카드뉴스", folders: ["instagram", "cardnews"] },
  { key: "thread", label: "쓰레드", folders: ["thread"] },
  { key: "youtube", label: "유튜브", folders: ["youtube"] },
  { key: "other", label: "기타", folders: [] },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];

/** 파일 → 묶음 (첫 폴더 이름으로) */
export function groupOf(path: string): GroupKey {
  const parts = path.split("/");
  const top = parts.length === 1 ? "" : parts[0]!.toLowerCase();
  return GROUPS.find((g) => (g.folders as readonly string[]).includes(top))?.key ?? "other";
}

/** 기사 4종은 md → html → docx → pdf, 나머지는 이름순 */
const ARTICLE_ORDER = ["md", "html", "docx", "pdf"];
function rank(f: PackageFile): [number, string] {
  const ext = f.path.split(".").pop()!.toLowerCase();
  const i = ARTICLE_ORDER.indexOf(ext);
  return [groupOf(f.path) === "article" && i >= 0 ? i : ARTICLE_ORDER.length, f.path];
}

export function packageFileGroups(files: readonly PackageFile[]): { key: GroupKey; label: string; files: PackageFile[] }[] {
  return GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    files: files
      .filter((f) => groupOf(f.path) === g.key)
      .sort((a, b) => {
        const [ra, pa] = rank(a);
        const [rb, pb] = rank(b);
        return ra - rb || pa.localeCompare(pb, "ko");
      }),
  })).filter((g) => g.files.length > 0);
}

/** 화면에 보일 크기 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 이미지 미리보기를 붙일 파일 */
export const isPreviewImage = (f: PackageFile) => /^image\/(png|jpeg|webp)$/.test(f.mime);
