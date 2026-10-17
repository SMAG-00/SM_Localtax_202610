// 기사 편집 화면 조각들이 함께 쓰는 모양
import type { EditorState } from "@/lib/admin/editor-state";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { EVIDENCE_TYPE_LABELS, SOURCE_KIND_LABELS, labelOf } from "@/lib/admin/labels";

/** 근거 참조 선택지 — 공개 출처 src:<번호> · 비공개 근거 ev:<번호> */
export interface RefOption {
  value: string;
  label: string;
  kind: "source" | "evidence";
  /** 출처 종류 또는 근거 유형 */
  type: string;
  /** 인터뷰 기록이 있는 근거 */
  hasInterview: boolean;
}

export interface EditorPermissions {
  canEdit: boolean;
  canSkipTaxLens: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canReview: boolean;
  canRequestCorrection: boolean;
  canDecideCorrection: boolean;
  canPlace: boolean;
  canHot: boolean;
  /** 이 사람이 고를 수 있는 기사 유형 (광고·협찬은 광고 담당만) */
  contentTypes: string[];
}

export type Update = (patch: Partial<EditorState>) => void;

export interface SectionProps {
  state: EditorState;
  update: Update;
  errors: FieldErrors;
  readOnly: boolean;
}

export interface SourceBrief {
  id: number;
  kind: string;
  title: string | null;
}

export interface EvidenceRefBrief {
  id: number;
  evidence_type: string;
  location: string;
  interview: unknown;
}

export function refOptions(sources: readonly SourceBrief[], evidence: readonly EvidenceRefBrief[]): RefOption[] {
  return [
    ...sources.map((s) => ({
      value: `src:${s.id}`,
      label: `src:${s.id} · ${labelOf(SOURCE_KIND_LABELS, s.kind)} · ${s.title ?? "제목 없음"}`,
      kind: "source" as const,
      type: s.kind,
      hasInterview: false,
    })),
    ...evidence.map((e) => ({
      value: `ev:${e.id}`,
      label: `ev:${e.id} · ${labelOf(EVIDENCE_TYPE_LABELS, e.evidence_type)} · ${e.location}`,
      kind: "evidence" as const,
      type: e.evidence_type,
      hasInterview: e.interview !== null,
    })),
  ];
}
