"use client";

import { useRef, useState } from "react";
import { CheckboxField, SelectField, TextField } from "@ltr/ui";
import { BLOCK_TYPES, ROSE_BOX_TITLE, type BlockType } from "@ltr/editorial";
import { addBlock, moveBlock, needsActionCheck, removeBlock, updateBlock, type BlockDraft } from "@/lib/admin/editor-state";
import { BLOCK_TYPE_LABELS, CALLOUT_KIND_LABELS, EVIDENCE_RIGHTS_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { FieldErrorText, TextAreaField } from "../fields";
import { OUTLINE_BUTTON } from "../ui";
import type { RefOption, SectionProps } from "./types";

type Media = { id: number; path: string; alt: string | null; rights_status: string };

/**
 * 블록 편집기 (ART-01) — 문단·표·이미지·인용·상자·인포그래픽·동영상·FAQ·핵심 요약. 더하기·지우기·위아래로 옮기기.
 * 인용 블록은 인터뷰 기록(ev:) 또는 문서 출처(src:)를 잇는다 (NAV-11). '기한'·'가산세'가 든 블록에는 '할 일을 함께 썼다' 확인 (UX-03).
 */
export function BlockEditor({ state, update, errors, readOnly, refs, media, makeKey }: SectionProps & { refs: readonly RefOption[]; media: readonly Media[]; makeKey: () => string }) {
  const [addType, setAddType] = useState<BlockType>("paragraph");
  const listRef = useRef<HTMLOListElement>(null);
  const blocks = state.blocks;
  const setBlocks = (next: BlockDraft[]) => update({ blocks: next });
  const patch = (key: string, p: Partial<BlockDraft>) => setBlocks(updateBlock(blocks, key, p));
  const mediaOptions = media.map((m) => ({ value: String(m.id), label: `${m.id} · ${m.alt || m.path} (${labelOf(EVIDENCE_RIGHTS_LABELS, m.rights_status)})` }));

  function add() {
    setBlocks(addBlock(blocks, addType, makeKey));
    // 새 블록의 첫 칸으로 초점을 옮긴다 (키보드 사용)
    requestAnimationFrame(() => listRef.current?.lastElementChild?.querySelector<HTMLElement>("textarea, input, select")?.focus());
  }

  return (
    <div className="space-y-4">
      <FieldErrorText id="blocks" error={errors.blocks} />
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
                      hint={mediaOptions.length === 0 ? "등록된 이미지가 없습니다 — 이미지 등록 뒤 고릅니다" : "권리 상태는 이미지 기록에서 읽습니다"}
                      options={mediaOptions}
                      placeholder="골라 주세요"
                      value={b.mediaId}
                      onChange={(e) => patch(b.key, { mediaId: e.target.value })}
                      error={errors[f("mediaId")]}
                    />
                    <TextField id={f("alt")} label="대체 텍스트" disabled={readOnly} value={b.alt} onChange={(e) => patch(b.key, { alt: e.target.value })} />
                  </>
                )}

                {(b.type === "table" || b.type === "infographic") && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField id={f("axis")} label="축" disabled={readOnly} value={b.axis} onChange={(e) => patch(b.key, { axis: e.target.value })} />
                    <TextField id={f("unit")} label="단위" disabled={readOnly} value={b.unit} onChange={(e) => patch(b.key, { unit: e.target.value })} />
                    <TextField id={f("source")} label="출처" disabled={readOnly} value={b.source} onChange={(e) => patch(b.key, { source: e.target.value })} />
                  </div>
                )}

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
                  <TextField id={f("embedUrl")} label="동영상 주소" disabled={readOnly} value={b.embedUrl} onChange={(e) => patch(b.key, { embedUrl: e.target.value })} error={errors[f("embedUrl")]} />
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
