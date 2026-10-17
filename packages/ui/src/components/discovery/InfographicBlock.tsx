import { useId } from "react";

/** 그림과 같은 내용 — 표 또는 목록 (8.9: 그림만으로 정보를 전하지 않는다) */
export type InfographicData =
  | { kind: "table"; caption: string; columns: string[]; rows: string[][] }
  | { kind: "list"; items: string[] };

export type InfographicBlockProps = {
  /** 그림 설명 제목 (figcaption) */
  title: string;
  /** alt 필수 (ART-07). 원본 비율 그대로 줄이고 자르지 않는다 */
  image: { src: string; alt: string; width: number; height: number };
  /** 같은 내용의 표·목록 — 필수, 기본 접힘 */
  data: InfographicData;
};

function hasContent(data: InfographicData): boolean {
  return data.kind === "table" ? data.columns.length > 0 && data.rows.length > 0 : data.items.length > 0;
}

/**
 * 인포그래픽 블록 — 이미지 + 같은 내용의 표·목록(접어 두기, 키보드로 펼침) + 대체 텍스트 필수 (PRD-00 8.6 · 8.9, ART-07)
 * 대체 텍스트나 같은 내용의 자료가 비면 렌더하지 않는다 (CMS 저장 불가 규칙과 같은 조건)
 */
export function InfographicBlock({ title, image, data }: InfographicBlockProps) {
  const captionId = useId();
  if (image.alt.trim() === "" || !hasContent(data)) return null;
  return (
    <figure data-ui="infographic-block" aria-labelledby={captionId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <figcaption id={captionId} className="text-[19px] leading-snug font-black text-navy-900">
        {title}
      </figcaption>
      <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" className="mt-4 block h-auto w-full rounded-xl" />
      <details className="group mt-4 rounded-xl border border-navy-100 bg-ivory">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-[15px] font-bold text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="text-navy-600 transition group-open:rotate-90 motion-reduce:transition-none">
            ▸
          </span>
          <span>{data.kind === "table" ? "같은 내용 표로 보기" : "같은 내용 목록으로 보기"}</span>
        </summary>
        <div className="border-t border-navy-100 px-4 py-4">
          {data.kind === "table" ? (
            <table className="w-full border-collapse text-left text-[15px] text-navy-800">
              <caption className="sr-only">{data.caption}</caption>
              <thead>
                <tr>
                  {data.columns.map((col, i) => (
                    <th key={i} scope="col" className="border-b border-navy-200 px-2 py-2 text-[13px] font-bold text-navy-700">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, r) => (
                  <tr key={r} className="border-b border-navy-100 last:border-b-0">
                    {row.map((cell, c) =>
                      c === 0 ? (
                        <th key={c} scope="row" className="px-2 py-2 font-bold text-navy-900">
                          {cell}
                        </th>
                      ) : (
                        <td key={c} className="px-2 py-2">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-[15px] text-navy-800">
              {data.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </figure>
  );
}
