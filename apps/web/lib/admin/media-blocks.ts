// 편집 화면의 형식 콘텐츠 블록 도우미 (ART-07 인포그래픽 · ART-08 동영상 · ART-09 포토) — 순수 함수 (시험: media-blocks.test.ts)
//  · 인포그래픽: 템플릿 고르기 → 같은 내용 칸의 틀(표 머리 칸·목록), 칸 글자 ↔ 같은 내용(InfographicData)
//  · 동영상·포토: 블록마다 '발행 전 확인' 줄 — 발행 판정(@ltr/editorial)과 같은 조건을 화면에서 미리 보인다(최종 판정은 점검 패널)
import { infographicSaveProblems, isSixteenByNine, parseYoutubeEmbed, type InfographicData, type InfographicTemplate } from "@ltr/editorial";
import { textToRows } from "./table-text";

/** 편집 화면이 받는 이미지 기록 (media 표 — 서버가 service_role로 읽어 넘긴다) */
export interface EditorMedia {
  id: number;
  path: string;
  alt: string | null;
  rights_status: string;
  credit: string | null;
  photographer: string | null;
  license: string | null;
  kind: string;
  width: number | null;
  height: number | null;
}

/** 이미지 기록의 권리 상태 글자 (media.rights_status — W2-a 설계 §2) */
export const MEDIA_RIGHTS_LABELS: Readonly<Record<string, string>> = { unconfirmed: "권리 미확인", confirmed: "권리 확인", rejected: "사용 불가" };

/** 이미지 고르기 칸의 글자 — 번호 · 설명(없으면 경로) · 크기 · 권리 상태 */
export function mediaOptionLabel(m: EditorMedia): string {
  const size = m.width && m.height ? ` · ${m.width}×${m.height}` : "";
  return `${m.id} · ${m.alt || m.path}${size} (${MEDIA_RIGHTS_LABELS[m.rights_status] ?? m.rights_status})`;
}

// ── 인포그래픽 ────────────────────────────────────────────

export const INFOGRAPHIC_TEMPLATE_LABELS: Readonly<Record<InfographicTemplate, string>> = { flow: "절차 흐름", compare: "비교", numbers: "핵심 숫자" };

export type InfographicDataKind = InfographicData["kind"];

/**
 * 템플릿의 같은 내용 칸 틀 — 절차 흐름은 차례 목록, 비교는 '구분 | 비교 1 | 비교 2' 머리 칸 표, 핵심 숫자는 '항목 | 숫자' 머리 칸 표.
 * 머리 칸만 채운다(내용 행은 편집자가 쓴다 — 내용 행이 0이면 저장되지 않는다)
 */
export const INFOGRAPHIC_SKELETONS: Readonly<Record<InfographicTemplate, { kind: InfographicDataKind; text: string }>> = {
  flow: { kind: "list", text: "" },
  compare: { kind: "table", text: "구분 | 비교 1 | 비교 2" },
  numbers: { kind: "table", text: "항목 | 숫자" },
};

/** 템플릿을 바꿀 때 — 같은 내용 칸이 비어 있으면 그 템플릿의 틀로, 이미 쓴 내용은 그대로 둔다 */
export function changeTemplate(current: { dataKind: InfographicDataKind; dataText: string }, template: InfographicTemplate): { template: InfographicTemplate; dataKind: InfographicDataKind; dataText: string } {
  if (current.dataText.trim() !== "") return { template, dataKind: current.dataKind, dataText: current.dataText };
  const skeleton = INFOGRAPHIC_SKELETONS[template];
  return { template, dataKind: skeleton.kind, dataText: skeleton.text };
}

/** 같은 내용 칸 글자 → 저장 모양. 표는 첫 줄이 머리 칸(칸은 | 로 나눈다), 목록은 줄마다 한 항목. 빈 글자면 null(저장 불가) */
export function infographicDataFromText(kind: InfographicDataKind, text: string): InfographicData | null {
  if (text.trim() === "") return null;
  if (kind === "list") return { kind, items: text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "") };
  const [columns = [], ...rows] = textToRows(text);
  return { kind, columns, rows };
}

/** 저장 모양 → 같은 내용 칸 글자 */
export function infographicDataToText(data: InfographicData | null): { kind: InfographicDataKind; text: string } {
  if (!data) return { kind: "list", text: "" };
  if (data.kind === "list") return { kind: "list", text: data.items.join("\n") };
  return { kind: "table", text: [data.columns, ...data.rows].map((r) => r.join(" | ")).join("\n") };
}

// ── 발행 전 확인 줄 (동영상·포토·인포그래픽) ────────────────

export interface CheckLine {
  key: string;
  label: string;
  ok: boolean;
}

const mediaOf = (media: readonly EditorMedia[], id: string) => media.find((m) => String(m.id) === id.trim());

/** 인포그래픽 블록 — 저장 조건(대체 텍스트·같은 내용) + 그림 권리 */
export function infographicChecks(b: { mediaId: string; alt: string; dataKind: InfographicDataKind; dataText: string }, media: readonly EditorMedia[]): CheckLine[] {
  const problems = infographicSaveProblems({ alt: b.alt, data: infographicDataFromText(b.dataKind, b.dataText) });
  const m = mediaOf(media, b.mediaId);
  return [
    { key: "alt", label: "대체 텍스트", ok: !problems.some((p) => p.field === "alt") },
    { key: "data", label: "같은 내용의 표·목록", ok: !problems.some((p) => p.field === "data") },
    { key: "rights", label: "그림 이용 권리 확인", ok: m?.rights_status === "confirmed" },
  ];
}

/** 동영상 블록 — 주소(youtube-nocookie) · 요약 · '자막 있음' 확인 · 썸네일 고름 · 썸네일 16:9 · 썸네일 권리 (ART-08 · NAV-04) */
export function videoChecks(b: { embedUrl: string; summary: string; captions: boolean; thumbnailMediaId: string }, media: readonly EditorMedia[]): CheckLine[] {
  const thumb = b.thumbnailMediaId.trim() === "" ? undefined : mediaOf(media, b.thumbnailMediaId);
  return [
    { key: "embedUrl", label: "유튜브 개인정보 보호 주소", ok: parseYoutubeEmbed(b.embedUrl).ok },
    { key: "summary", label: "요약 텍스트", ok: b.summary.trim() !== "" },
    { key: "captions", label: "'자막 있음' 확인", ok: b.captions },
    { key: "thumbnail", label: "썸네일 고름", ok: thumb !== undefined },
    { key: "ratio", label: "썸네일 16:9", ok: thumb !== undefined && isSixteenByNine(thumb.width, thumb.height) },
    { key: "rights", label: "썸네일 이용 권리 확인", ok: thumb?.rights_status === "confirmed" },
  ];
}

/** 포토 기사의 사진 한 장 — 출처 · 이용 조건 · 대체 텍스트(블록 또는 이미지 기록) · 권리 확인 (ART-09 · NAV-04) */
export function photoChecks(b: { mediaId: string; alt: string }, media: readonly EditorMedia[]): CheckLine[] {
  const m = mediaOf(media, b.mediaId);
  const has = (v: string | null | undefined) => typeof v === "string" && v.trim() !== "";
  return [
    { key: "credit", label: "출처", ok: has(m?.credit) },
    { key: "license", label: "이용 조건", ok: has(m?.license) },
    { key: "alt", label: "대체 텍스트", ok: has(b.alt) || has(m?.alt) },
    { key: "rights", label: "이용 권리 확인", ok: m?.rights_status === "confirmed" },
  ];
}

/** 포토 기사 사진 묶음 요약 — 사진 수와 표기가 빠진 사진 수 */
export function photoSetSummary(blocks: readonly { type: string; mediaId: string; alt: string }[], media: readonly EditorMedia[]): { photos: number; incomplete: number } {
  const photos = blocks.filter((b) => b.type === "image");
  return { photos: photos.length, incomplete: photos.filter((b) => photoChecks(b, media).some((c) => !c.ok)).length };
}

/** 재생 시간 칸 — 비우면 null, 0~86400 정수 초가 아니면 NaN(저장 전 확인이 막는다) */
export function durationFromText(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  return /^\d{1,5}$/.test(t) && Number(t) <= 86_400 ? Number(t) : Number.NaN;
}
