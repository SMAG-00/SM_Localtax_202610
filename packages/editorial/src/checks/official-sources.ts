// REG1-07 공식 자료 종류 · REG1-09 공식 원자료 필수 칸 · PR-07 공공누리 유형 (01B W4 5단계 — docs/dev/W4_설계.md 1장 5단계 · 2.1 · 12장 #13)
// DB 트리거(마이그레이션 20261022000041)와 같은 규칙을 발행 서비스 쪽에서 한 번 더 본다 — 한쪽만 우회한 발행도 막힌다.
import { finding, type Finding } from "../findings";
import {
  BLOCKED_OFFICIAL_SOURCE_TYPES,
  KOGL_NEVER,
  KOGL_USAGE_DEFAULT,
  LICENSE_REQUIRED_KINDS,
  LICENSE_TYPE_LABELS,
  OFFICIAL_SOURCE_KINDS,
  OFFICIAL_SOURCE_TYPES,
  type ArticleForPublish,
  type ArticleSource,
  type LicenseType,
  type PublishContext,
  type SourceKind,
} from "../model";
import { isBlank } from "../text";

/** 공식 자료 필수 칸 — [판정 입력 칸, 편집 화면 칸 이름, API 칸 이름] (DB official_source_missing과 같은 순서·글자) */
export const OFFICIAL_REQUIRED_FIELDS = [
  ["publishedOn", "발표일", "publishedOn"],
  ["referenceDate", "기준일", "referenceDate"],
  ["regionUnit", "지역 단위", "regionUnit"],
  ["collectedAt", "수집일", "collectedAt"],
  ["accessedAt", "확인일", "lastVerifiedAt"],
] as const satisfies readonly (readonly [keyof ArticleSource, string, string])[];

const isOfficial = (kind: SourceKind) => (OFFICIAL_SOURCE_KINDS as readonly string[]).includes(kind);
const needsLicense = (kind: SourceKind) => (LICENSE_REQUIRED_KINDS as readonly string[]).includes(kind);
const label = (t: LicenseType | null | undefined) => (t ? LICENSE_TYPE_LABELS[t] : "공공누리 유형 없음");
const sourceName = (s: ArticleSource) => `「${s.title || s.id}」(${s.id})`;

/** 자료 종류 판정 — null이면 문제 없음, 아니면 편집자 문장 (DB 트리거·운영 설정 API와 같은 규칙) */
export function sourceTypeProblem(kind: SourceKind, sourceType: string | null | undefined, allowed: readonly string[] = OFFICIAL_SOURCE_TYPES): string | null {
  if (isBlank(sourceType)) return null;
  const t = sourceType!.trim();
  if (!isOfficial(kind)) return "자료 종류는 공식 자료(official_doc·dataset) 출처에만 씁니다 (REG1-07)";
  if ((BLOCKED_OFFICIAL_SOURCE_TYPES as readonly string[]).includes(t)) {
    return `자료 종류 ${t}는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)`;
  }
  if (!allowed.includes(t)) return `자료 종류 ${t}는 허용 목록(official_source_types)에 없습니다 (REG1-07)`;
  return null;
}

/** 이 유형의 사진을 게시할 수 있나 — 제4유형·미표시는 설정과 상관없이 아니다 */
export function photoLicenseAllowed(t: LicenseType | null | undefined, kogl = KOGL_USAGE_DEFAULT): boolean {
  if (!t || (KOGL_NEVER as readonly string[]).includes(t)) return false;
  return kogl.photoTypes.includes(t);
}

/** 사진 게시 불가 사유 (편집 화면·발행 422 같은 글자) — 게시할 수 있으면 null */
export function photoLicenseProblem(t: LicenseType | null | undefined, kogl = KOGL_USAGE_DEFAULT): string | null {
  if (photoLicenseAllowed(t, kogl)) return null;
  if (!t) return "공공누리 유형이 없습니다 — 이미지 권리 확인 때 유형(자체 촬영은 '해당 없음')을 적으세요 (PR-07)";
  if ((KOGL_NEVER as readonly string[]).includes(t)) return `${label(t)} 사진은 게시하지 않습니다 — 원문 링크만 씁니다 (PR-07)`;
  return `${label(t)} 사진은 법률 검토 전에는 게시하지 않습니다 — 지금 게시하는 유형: ${kogl.photoTypes.map((x) => LICENSE_TYPE_LABELS[x]).join(" · ") || "없음"} (PR-07 · 설정 kogl_usage)`;
}

/** 원문 본문을 옮겨도 되는 출처인가 — 공공누리 해당 없음(자체 자료)이거나 설정이 연 유형. 유형이 없으면 필수 종류만 막는다 */
function fullTextAllowed(s: ArticleSource, kogl = KOGL_USAGE_DEFAULT): boolean {
  const t = s.licenseType ?? null;
  if (t === "not_applicable") return true;
  if (t === null) return !needsLicense(s.kind);
  if ((KOGL_NEVER as readonly string[]).includes(t)) return false;
  return kogl.fullTextTypes.includes(t);
}

export function checkOfficialSources(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  const kogl = ctx.kogl ?? KOGL_USAGE_DEFAULT;
  const allowedTypes = ctx.officialSourceTypes ?? OFFICIAL_SOURCE_TYPES;

  for (const s of article.sources) {
    const typeProblem = sourceTypeProblem(s.kind, s.sourceType, allowedTypes);
    if (typeProblem) out.push(finding("reg1_07.source-type", `${sourceName(s)} — ${typeProblem}`, { field: "sources.sourceType", phrase: s.id }));
    if (isOfficial(s.kind)) {
      for (const [key, name, api] of OFFICIAL_REQUIRED_FIELDS) {
        if (isBlank(s[key] as string | null | undefined)) {
          out.push(
            finding("reg1_09.official-fields", `공식 자료 ${sourceName(s)}의 ${name}(${api})이(가) 비었습니다 — 발표일·기준일·지역 단위·수집일·확인일이 모두 있어야 발행됩니다 (REG1-09)`, {
              field: `sources.${api}`,
              phrase: s.id,
            }),
          );
        }
      }
    }
    if (needsLicense(s.kind) && !s.licenseType) {
      out.push(
        finding("pr07.license-required", `출처 ${sourceName(s)}에 공공누리 유형(licenseType)이 없습니다 — 공식 자료·보도자료·사진은 유형을 적어야 발행됩니다 (PR-07)`, {
          field: "sources.licenseType",
          phrase: s.id,
        }),
      );
    }
  }

  // 사진 — 권리가 확인된 이미지만 본다 (미확인은 nav04.image-rights가 막는다)
  const lead = article.leadImage;
  if (lead && lead.rightsStatus === "confirmed") {
    const p = photoLicenseProblem(lead.licenseType, kogl);
    if (p) out.push(finding("pr07.photo-license", `대표 사진 — ${p}`, { field: "leadImage", phrase: lead.mediaId }));
  }
  article.blocks.forEach((block, blockIndex) => {
    if ((block.type === "image" || block.type === "infographic") && block.rightsStatus === "confirmed") {
      const p = photoLicenseProblem(block.licenseType, kogl);
      if (p) out.push(finding("pr07.photo-license", `본문 이미지 — ${p}`, { field: "blocks", blockIndex, phrase: block.mediaId }));
    }
    if (block.type === "video" && block.thumbnailMediaId && block.thumbnail?.rightsStatus === "confirmed") {
      const p = photoLicenseProblem(block.thumbnail.licenseType, kogl);
      if (p) out.push(finding("pr07.photo-license", `동영상 썸네일 — ${p}`, { field: "blocks", blockIndex, phrase: block.thumbnailMediaId }));
    }
  });

  // 원문 전재 — 유사도 검사기가 원문 문장과 같다고 본 본문 문장(직접 인용 블록 제외)
  const copied = ctx.similarity?.copied ?? [];
  const bySource = new Map<string, number[]>();
  for (const c of copied) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c.sentenceIndex]);
  for (const s of article.sources) {
    const hits = bySource.get(s.id);
    if (!hits || fullTextAllowed(s, kogl)) continue;
    out.push(
      finding("pr07.full-text", `본문 문장 ${hits.length}개가 ${sourceName(s)}(${label(s.licenseType)}) 원문을 그대로 옮겼습니다 — 공공 자료 원문은 링크·요약만 씁니다 (PR-07)`, {
        field: "blocks",
        sentenceIndex: Math.min(...hits),
        phrase: s.id,
      }),
    );
  }
  return out;
}
