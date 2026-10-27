// 검토용 원고 미리 보기 (서버에서 그린다) — 블록을 읽기 쉬운 모양으로. 공개 기사 화면(W2-b)과 다르다: 근거 참조(src:·ev:)를 함께 보인다.
import type { EditorView } from "@/lib/server/articles/editor-view";
import { BLOCK_TYPE_LABELS, CALLOUT_KIND_LABELS, CLAIM_KIND_LABELS, labelOf } from "@/lib/admin/labels";
import { INFOGRAPHIC_TEMPLATE_LABELS } from "@/lib/admin/media-blocks";
import { MONO, Panel } from "./ui";

const TEXT = "whitespace-pre-wrap text-[17px] text-navy-900 [overflow-wrap:anywhere]";

export function ArticlePreview({ view }: { view: EditorView }) {
  const a = view.article;
  return (
    <Panel id="preview" title="원고" description={`버전 ${a.version} — 저장된 원고입니다.`}>
      {a.summary && <p className="text-[17px] font-bold text-navy-800 [overflow-wrap:anywhere]">{a.summary}</p>}
      <ol className="space-y-4">
        {a.body.blocks.map((b, i) => (
          <li key={i} className="space-y-1">
            <p className={`text-navy-600 ${MONO}`}>
              {i + 1} · {BLOCK_TYPE_LABELS[b.type]}
            </p>
            {b.type === "paragraph" && <p className={TEXT}>{b.text || "(빈 문단)"}</p>}
            {b.type === "heading" && <p className={`${TEXT} font-black`}>{`${"#".repeat(b.level)} ${b.text || "(빈 소제목)"}`}</p>}
            {b.type === "key_summary" && (
              <ul className="list-disc space-y-1 rounded-xl bg-ivory p-4 pl-8 text-[17px] text-navy-900">
                {b.lines.map((l, j) => (
                  <li key={j} className="[overflow-wrap:anywhere]">
                    {l}
                  </li>
                ))}
              </ul>
            )}
            {b.type === "table" && (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-[15px]">
                  <caption className="text-left font-bold text-navy-800">{b.caption}</caption>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((cell, k) => (
                          <td key={k} className="border border-navy-100 px-3 py-2">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[14px] text-navy-600">{b.chart ? `축 ${b.chart.axis} · 단위 ${b.chart.unit} · 출처 ${b.chart.source}` : "축·단위·출처 표기 없음"}</p>
              </div>
            )}
            {b.type === "quote" && (
              <blockquote className="border-l-2 border-navy-300 pl-3">
                <p className={TEXT}>{b.text}</p>
                <p className="text-[14px] text-navy-600">
                  — {b.speaker || "발언자 없음"} <span className={MONO}>{b.refId ?? "기록 없음"}</span>
                </p>
              </blockquote>
            )}
            {b.type === "callout" && (
              <div className="rounded-xl border border-navy-100 bg-ivory p-4">
                <p className="font-bold text-navy-900">
                  {labelOf(CALLOUT_KIND_LABELS, b.kind)}
                  {b.title ? ` — ${b.title}` : ""}
                </p>
                <p className={TEXT}>{b.text}</p>
              </div>
            )}
            {b.type === "faq" && (
              <dl className="space-y-2">
                {b.items.map((it, j) => (
                  <div key={j}>
                    <dt className="font-bold text-navy-900 [overflow-wrap:anywhere]">{it.question}</dt>
                    <dd className="text-navy-800 [overflow-wrap:anywhere]">{it.answer}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(b.type === "image" || b.type === "infographic") && <p className="text-[15px] text-navy-700">이미지 media {b.mediaId} · {b.alt || "대체 텍스트 없음"}</p>}
            {b.type === "infographic" && (
              <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">
                {`템플릿 ${INFOGRAPHIC_TEMPLATE_LABELS[b.template]} · 같은 내용 ${b.data ? (b.data.kind === "table" ? `표 ${b.data.rows.length}행` : `목록 ${b.data.items.length}항목`) : "없음"}`}
              </p>
            )}
            {b.type === "video" && (
              <div className="space-y-1 text-[15px] text-navy-700 [overflow-wrap:anywhere]">
                <p>동영상 {b.embedUrl}</p>
                <p className="text-[14px] text-navy-600">{`썸네일 ${b.thumbnailMediaId ? `media ${b.thumbnailMediaId}` : "없음"} · 자막 ${b.captions ? "있음 확인" : "확인 안 함"}`}</p>
                <p className={TEXT}>{b.summary || "(요약 텍스트 없음)"}</p>
              </div>
            )}
            {b.type === "slide" && (
              <div className="rounded-xl border border-navy-100 bg-ivory p-4">
                <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">{b.title || "(제목 없음)"}</p>
                <p className={TEXT}>{b.text}</p>
                <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">대체 텍스트 · {b.alt || "없음"}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
      {a.body.claims.length > 0 && (
        <div>
          <p className="text-[15px] font-black text-navy-900">핵심 주장</p>
          <ul className="mt-1 space-y-1 text-[15px] text-navy-800">
            {a.body.claims.map((c) => (
              <li key={c.id} className="[overflow-wrap:anywhere]">
                [{labelOf(CLAIM_KIND_LABELS, c.kind)}] {c.text} <span className={MONO}>{c.evidenceIds.join(", ") || "근거 없음"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
