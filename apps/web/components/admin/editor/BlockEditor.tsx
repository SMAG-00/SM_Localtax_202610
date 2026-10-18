"use client";

import { useRef, useState } from "react";
import { CheckboxField, SelectField, TextField } from "@ltr/ui";
import { BLOCK_TYPES, INFOGRAPHIC_TEMPLATES, ROSE_BOX_TITLE, YOUTUBE_EMBED_PREFIX, type BlockType, type InfographicTemplate } from "@ltr/editorial";
import { addBlock, moveBlock, needsActionCheck, removeBlock, updateBlock, type BlockDraft } from "@/lib/admin/editor-state";
import { BLOCK_TYPE_LABELS, CALLOUT_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import {
  INFOGRAPHIC_TEMPLATE_LABELS,
  changeTemplate,
  infographicChecks,
  mediaOptionLabel,
  photoChecks,
  photoSetSummary,
  videoChecks,
  type CheckLine,
  type EditorMedia,
  type InfographicDataKind,
} from "@/lib/admin/media-blocks";
import { FieldErrorText, TextAreaField } from "../fields";
import { OUTLINE_BUTTON, ToneChip } from "../ui";
import type { RefOption, SectionProps } from "./types";

/** 발행 전 확인 줄 — 글자로 '됨'·'빠짐'을 적는다(색만으로 구분 0). 최종 판정은 점검 패널(발행 판정)이 한다 */
function CheckLines({ title, lines, testId }: { title: string; lines: readonly CheckLine[]; testId: string }) {
  const missing = lines.filter((l) => !l.ok).length;
  return (
    <div data-testid={testId} className="rounded-xl border border-navy-100 bg-white p-3">
      <p className="text-[14px] font-bold text-navy-900">
        {title} — {missing === 0 ? "모두 됨" : `${missing}개 빠짐 (빠지면 발행되지 않습니다)`}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {lines.map((l) => (
          <li key={l.key} data-check={l.key} data-ok={l.ok ? "true" : "false"}>
            <ToneChip tone={l.ok ? "emerald" : "amber"}>{`${l.label} ${l.ok ? "됨" : "빠짐"}`}</ToneChip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 블록 편집기 (ART-01) — 문단·표·이미지·인용·상자·인포그래픽·동영상·FAQ·핵심 요약. 더하기·지우기·위아래로 옮기기.
 * 인용 블록은 인터뷰 기록(ev:) 또는 문서 출처(src:)를 잇는다 (NAV-11). '기한'·'가산세'가 든 블록에는 '할 일을 함께 썼다' 확인 (UX-03).
 * 형식 콘텐츠 (W2-c 4단계): 인포그래픽은 템플릿 3종·대체 텍스트·같은 내용의 표·목록(둘 다 없으면 저장되지 않는다 — ART-07),
 * 동영상은 youtube-nocookie 주소(아니면 저장되지 않는다)·썸네일·요약·'자막 있음' 확인(ART-08), 포토 기사는 사진마다 출처·이용 조건·대체 텍스트 상태(ART-09)
 */
export function BlockEditor({ state, update, errors, readOnly, refs, media, makeKey }: SectionProps & { refs: readonly RefOption[]; media: readonly EditorMedia[]; makeKey: () => string }) {
  const [addType, setAddType] = useState<BlockType>("paragraph");
  const listRef = useRef<HTMLOListElement>(null);
  const blocks = state.blocks;
  const setBlocks = (next: BlockDraft[]) => update({ blocks: next });
  const patch = (key: string, p: Partial<BlockDraft>) => setBlocks(updateBlock(blocks, key, p));
  const mediaOptions = media.map((m) => ({ value: String(m.id), label: mediaOptionLabel(m) }));
  const photo = state.format === "photo";
  const photoSet = photo ? photoSetSummary(blocks, media) : null;
  const has = (type: BlockType) => blocks.some((b) => b.type === type);

  function add() {
    setBlocks(addBlock(blocks, addType, makeKey));
    // 새 블록의 첫 칸으로 초점을 옮긴다 (키보드 사용)
    requestAnimationFrame(() => listRef.current?.lastElementChild?.querySelector<HTMLElement>("textarea, input, select")?.focus());
  }

  return (
    <div className="space-y-4">
      <FieldErrorText id="blocks" error={errors.blocks} />
      {photoSet && (
        <p data-testid="photo-set-summary" className="rounded-xl border border-navy-100 bg-white px-4 py-3 text-[15px] text-navy-800">
          {`포토 기사 — 사진 ${photoSet.photos}장${photoSet.photos === 0 ? " (이미지 블록을 더해 주세요 — 사진이 없으면 발행되지 않습니다)" : photoSet.incomplete > 0 ? ` · 표기가 빠진 사진 ${photoSet.incomplete}장` : " · 모두 표기됨"}`}
        </p>
      )}
      {state.format === "video" && !has("video") && <p className="text-[15px] text-amber-800">형식이 동영상인 기사에는 동영상 블록이 있어야 발행됩니다.</p>}
      {state.format === "infographic" && !has("infographic") && <p className="text-[15px] text-amber-800">형식이 인포그래픽인 기사에는 인포그래픽 블록이 있어야 발행됩니다.</p>}
      <ol ref={listRef} className="space-y-4">
        {blocks.map((b, i) => {
          const f = (name: string) => `block-${b.key}-${name}`;
          const label = `블록 ${i + 1} · ${BLOCK_TYPE_LABELS[b.type]}`;
          const quoteRefs = refs.filter((r) => (b.origin === "interview" ? r.kind === "evidence" && r.type === "interview" : r.kind === "source" || r.type === "document"));
          return (
            <li key={b.key} data-testid={`block-${i}`} data-block-type={b.type}>
              <fieldset className="min-w-0 space-y-3 rounded-xl border border-navy-100 bg-ivory p-4">
                <legend className="px-1 text-[15px] font-black text-navy-900">{label}</legend>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={OUTLINE_BUTTON} disabled={i === 0} onClick={() => setBlocks(moveBlock(blocks, i, -1))} aria-label={`${label} 위로 옮기기`}>
                      위로
                    </button>
                    <button
                      type="button"
                      className={OUTLINE_BUTTON}
                      disabled={i === blocks.length - 1}
                      onClick={() => setBlocks(moveBlock(blocks, i, 1))}
                      aria-label={`${label} 아래로 옮기기`}
                    >
                      아래로
                    </button>
                    <button type="button" className={OUTLINE_BUTTON} onClick={() => setBlocks(removeBlock(blocks, i))} aria-label={`${label} 지우기`}>
                      지우기
                    </button>
                  </div>
                )}

                {b.type === "paragraph" && (
                  <TextAreaField id={f("text")} label="문단" rows={4} disabled={readOnly} value={b.text} onChange={(e) => patch(b.key, { text: e.target.value })} error={errors[f("text")]} />
                )}

                {b.type === "key_summary" && (
                  <TextAreaField
                    id={f("linesText")}
                    label="핵심 요약 (줄마다 한 문장, 3줄 이하)"
                    rows={3}
                    disabled={readOnly}
                    value={b.linesText}
                    onChange={(e) => patch(b.key, { linesText: e.target.value })}
                    error={errors[f("lines")]}
                  />
                )}

                {b.type === "infographic" && (
                  <SelectField
                    id={f("template")}
                    label="인포그래픽 템플릿"
                    disabled={readOnly}
                    hint="고르면 아래 '같은 내용' 칸에 그 템플릿의 틀이 들어갑니다 (이미 쓴 내용은 그대로)"
                    options={INFOGRAPHIC_TEMPLATES.map((t) => ({ value: t, label: INFOGRAPHIC_TEMPLATE_LABELS[t] }))}
                    value={b.template}
                    onChange={(e) => patch(b.key, changeTemplate(b, e.target.value as InfographicTemplate))}
                    error={errors[f("template")]}
                  />
                )}

                {(b.type === "table" || b.type === "infographic" || b.type === "image" || b.type === "video") && (
                  <TextField id={f("caption")} label="설명(캡션)" disabled={readOnly} value={b.caption} onChange={(e) => patch(b.key, { caption: e.target.value })} error={errors[f("caption")]} />
                )}

                {b.type === "table" && (
                  <TextAreaField
                    id={f("rowsText")}
                    label="표 내용"
                    hint="줄마다 한 행, 칸은 | 로 나눕니다. 첫 줄이 머리 행입니다."
                    rows={4}
                    disabled={readOnly}
                    value={b.rowsText}
                    onChange={(e) => patch(b.key, { rowsText: e.target.value })}
                    error={errors[f("rows")]}
                  />
                )}

                {(b.type === "image" || b.type === "infographic") && (
                  <>
                    <SelectField
                      id={f("mediaId")}
                      label="이미지"
                      required
                      disabled={readOnly}
                      hint={mediaOptions.length === 0 ? "등록된 이미지가 없습니다 — 이미지 등록 뒤 고릅니다" : "권리 상태·출처는 이미지 기록에서 읽습니다. 그림은 원본 비율 그대로 보이고 잘리지 않습니다"}
                      options={mediaOptions}
                      placeholder="골라 주세요"
                      value={b.mediaId}
                      onChange={(e) => patch(b.key, { mediaId: e.target.value })}
                      error={errors[f("mediaId")]}
                    />
                    <TextField
                      id={f("alt")}
                      label="대체 텍스트"
                      required={b.type === "infographic" || photo}
                      hint={
                        b.type === "infographic"
                          ? "그림이 보여 주는 내용을 글로 적습니다 — 없으면 저장되지 않습니다 (ART-07)"
                          : photo
                            ? "사진에 무엇이 있는지 적습니다 — 비우면 이미지 기록의 설명을 쓰고, 둘 다 없으면 발행되지 않습니다 (ART-09)"
                            : undefined
                      }
                      disabled={readOnly}
                      value={b.alt}
                      onChange={(e) => patch(b.key, { alt: e.target.value })}
                      error={errors[f("alt")]}
                    />
                  </>
                )}

                {b.type === "infographic" && (
                  <>
                    <SelectField
                      id={f("dataKind")}
                      label="같은 내용의 모양"
                      disabled={readOnly}
                      options={[
                        { value: "table", label: "표" },
                        { value: "list", label: "목록" },
                      ]}
                      value={b.dataKind}
                      onChange={(e) => patch(b.key, { dataKind: e.target.value as InfographicDataKind })}
                    />
                    <TextAreaField
                      id={f("data")}
                      label="그림과 같은 내용의 표·목록"
                      required
                      hint={
                        b.dataKind === "table"
                          ? "첫 줄은 머리 칸, 그 아래 줄마다 한 행 — 칸은 | 로 나눕니다. 공개 화면에는 접혀 있고 눌러서 펼칩니다. 없으면 저장되지 않습니다"
                          : "줄마다 한 항목 — 공개 화면에는 접혀 있고 눌러서 펼칩니다. 없으면 저장되지 않습니다"
                      }
                      rows={4}
                      disabled={readOnly}
                      value={b.dataText}
                      onChange={(e) => patch(b.key, { dataText: e.target.value })}
                      error={errors[f("data")]}
                    />
                  </>
                )}

                {(b.type === "table" || b.type === "infographic") && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField id={f("axis")} label="축" disabled={readOnly} value={b.axis} onChange={(e) => patch(b.key, { axis: e.target.value })} />
                    <TextField id={f("unit")} label="단위" disabled={readOnly} value={b.unit} onChange={(e) => patch(b.key, { unit: e.target.value })} />
                    <TextField id={f("source")} label="출처" disabled={readOnly} value={b.source} onChange={(e) => patch(b.key, { source: e.target.value })} />
                  </div>
                )}

                {b.type === "infographic" && <CheckLines title="인포그래픽 확인" lines={infographicChecks(b, media)} testId={`block-${i}-checks`} />}
                {b.type === "image" && photo && <CheckLines title={`사진 표기`} lines={photoChecks(b, media)} testId={`block-${i}-checks`} />}

                {b.type === "quote" && (
                  <>
                    <TextAreaField id={f("text")} label="인용문" disabled={readOnly} value={b.text} onChange={(e) => patch(b.key, { text: e.target.value })} error={errors[f("text")]} />
                    <TextField id={f("speaker")} label="발언자 표기" disabled={readOnly} value={b.speaker} onChange={(e) => patch(b.key, { speaker: e.target.value })} />
                    <SelectField
                      id={f("origin")}
                      label="인용 종류"
                      disabled={readOnly}
                      options={[
                        { value: "interview", label: "취재원 발언 (인터뷰 기록 필요)" },
                        { value: "document", label: "문서 인용 (출처·문서 근거 필요)" },
                      ]}
                      value={b.origin}
                      onChange={(e) => patch(b.key, { origin: e.target.value as BlockDraft["origin"], refId: "" })}
                    />
                    <SelectField
                      id={f("refId")}
                      label={b.origin === "interview" ? "인터뷰 기록" : "문서 출처·근거"}
                      disabled={readOnly}
                      hint="취재 근거·출처 칸에서 먼저 더한 뒤 고릅니다 (NAV-11)"
                      options={quoteRefs.map((r) => ({ value: r.value, label: r.label }))}
                      placeholder="연결 안 함"
                      value={b.refId}
                      onChange={(e) => patch(b.key, { refId: e.target.value })}
                      error={errors[f("refId")]}
                    />
                  </>
                )}

                {b.type === "callout" && (
                  <>
                    <SelectField
                      id={f("kind")}
                      label="상자 종류"
                      disabled={readOnly}
                      hint="빨간 상자는 '자주 틀리는 점'에만 씁니다"
                      options={optionsOf(CALLOUT_KIND_LABELS)}
                      value={b.kind}
                      onChange={(e) => patch(b.key, { kind: e.target.value as BlockDraft["kind"] })}
                    />
                    <TextField
                      id={f("title")}
                      label="상자 제목"
                      disabled={readOnly || b.kind === "mistake"}
                      value={b.kind === "mistake" ? ROSE_BOX_TITLE : b.title}
                      onChange={(e) => patch(b.key, { title: e.target.value })}
                    />
                    <TextAreaField id={f("text")} label="상자 내용" disabled={readOnly} value={b.text} onChange={(e) => patch(b.key, { text: e.target.value })} error={errors[f("text")]} />
                  </>
                )}

                {b.type === "slide" && (
                  <>
                    <TextField id={f("title")} label="장 제목" disabled={readOnly} value={b.title} onChange={(e) => patch(b.key, { title: e.target.value })} error={errors[f("title")]} />
                    <TextAreaField
                      id={f("text")}
                      label="장 글"
                      hint="글자는 이미지가 아니라 글자로 보입니다 — 한 장에 세 문장 이하"
                      rows={3}
                      disabled={readOnly}
                      value={b.text}
                      onChange={(e) => patch(b.key, { text: e.target.value })}
                      error={errors[f("text")]}
                    />
                    <TextField
                      id={f("alt")}
                      label="대체 텍스트"
                      required
                      hint="장의 그림·배치를 글로 적습니다 (화면 읽기 프로그램이 읽는다) — 없으면 발행되지 않습니다"
                      disabled={readOnly}
                      value={b.alt}
                      onChange={(e) => patch(b.key, { alt: e.target.value })}
                      error={errors[f("alt")]}
                    />
                  </>
                )}

                {b.type === "video" && (
                  <>
                    <TextField
                      id={f("embedUrl")}
                      label="동영상 주소"
                      required
                      inputMode="url"
                      hint={`유튜브 '공유 → 퍼가기'의 개인정보 보호 주소만 저장됩니다 — ${YOUTUBE_EMBED_PREFIX}영상번호`}
                      disabled={readOnly}
                      value={b.embedUrl}
                      onChange={(e) => patch(b.key, { embedUrl: e.target.value })}
                      error={errors[f("embedUrl")]}
                    />
                    <SelectField
                      id={f("thumbnailMediaId")}
                      label="썸네일 이미지"
                      disabled={readOnly}
                      hint="16:9 이미지를 고릅니다 — 원본 비율 그대로 보이고, 누르기 전에는 이 그림만 보입니다"
                      options={mediaOptions}
                      placeholder="골라 주세요"
                      value={b.thumbnailMediaId}
                      onChange={(e) => patch(b.key, { thumbnailMediaId: e.target.value })}
                      error={errors[f("thumbnailMediaId")]}
                    />
                    <TextAreaField
                      id={f("summary")}
                      label="요약 텍스트"
                      required
                      hint="영상을 보지 않아도 내용을 알 수 있게 적습니다 — 없으면 발행되지 않습니다 (ART-08)"
                      rows={3}
                      disabled={readOnly}
                      value={b.summary}
                      onChange={(e) => patch(b.key, { summary: e.target.value })}
                      error={errors[f("summary")]}
                    />
                    <TextField
                      id={f("durationSeconds")}
                      label="재생 시간(초)"
                      inputMode="numeric"
                      hint="예: 95 — 비우면 카드에 시간을 적지 않습니다"
                      disabled={readOnly}
                      value={b.durationText}
                      onChange={(e) => patch(b.key, { durationText: e.target.value })}
                      error={errors[f("durationSeconds")]}
                    />
                    <CheckboxField
                      id={f("captions")}
                      label="자막 있음 — 영상에 자막이 있는지 직접 확인했다 (확인하지 않으면 발행되지 않습니다)"
                      disabled={readOnly}
                      checked={b.captions}
                      onChange={(e) => patch(b.key, { captions: e.target.checked })}
                    />
                    <CheckLines title="동영상 확인" lines={videoChecks(b, media)} testId={`block-${i}-checks`} />
                  </>
                )}

                {b.type === "faq" && (
                  <div className="space-y-3">
                    {b.items.map((item, j) => (
                      <div key={j} className="space-y-2 rounded-xl border border-navy-100 bg-white p-3">
                        <TextField
                          id={f(`q${j}`)}
                          label={`질문 ${j + 1}`}
                          disabled={readOnly}
                          value={item.question}
                          onChange={(e) => patch(b.key, { items: b.items.map((x, k) => (k === j ? { ...x, question: e.target.value } : x)) })}
                        />
                        <TextAreaField
                          id={f(`a${j}`)}
                          label={`답 ${j + 1}`}
                          disabled={readOnly}
                          value={item.answer}
                          onChange={(e) => patch(b.key, { items: b.items.map((x, k) => (k === j ? { ...x, answer: e.target.value } : x)) })}
                        />
                        {!readOnly && (
                          <button type="button" className={OUTLINE_BUTTON} onClick={() => patch(b.key, { items: b.items.filter((_, k) => k !== j) })} aria-label={`질문 ${j + 1} 지우기`}>
                            질문 지우기
                          </button>
                        )}
                      </div>
                    ))}
                    <FieldErrorText id={f("items")} error={errors[f("items")]} />
                    {!readOnly && (
                      <button type="button" className={OUTLINE_BUTTON} onClick={() => patch(b.key, { items: [...b.items, { question: "", answer: "" }] })}>
                        질문 더하기
                      </button>
                    )}
                  </div>
                )}

                {(needsActionCheck(b) || b.actionWritten) && (
                  <CheckboxField
                    id={f("actionWritten")}
                    label="할 일을 함께 썼다 — 언제까지 무엇을 하면 되는지 (UX-03)"
                    disabled={readOnly}
                    checked={b.actionWritten}
                    onChange={(e) => patch(b.key, { actionWritten: e.target.checked })}
                  />
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <SelectField
              id="block-add-type"
              label="더할 블록"
              options={BLOCK_TYPES.map((t) => ({ value: t, label: BLOCK_TYPE_LABELS[t] }))}
              value={addType}
              onChange={(e) => setAddType(e.target.value as BlockType)}
            />
          </div>
          <button type="button" className={OUTLINE_BUTTON} onClick={add}>
            블록 더하기
          </button>
        </div>
      )}
    </div>
  );
}
