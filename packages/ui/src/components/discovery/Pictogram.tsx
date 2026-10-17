import { cx } from "../base";
import { PICTOGRAMS, type PictogramName, type Shape } from "./pictograms";

export { PICTOGRAMS, PICTOGRAM_NAMES, type PictogramName, type PictogramGroup } from "./pictograms";

export type PictogramProps = {
  name: PictogramName;
  /** 글자 라벨 — 필수 (R11 '글자 라벨 항상 함께', UX-04 '라벨 없이 쓰면 타입 검사 실패'). 화면 읽기 프로그램이 읽는다 */
  label: string;
  /** 라벨을 글자로 보인다 (기본). false면 그림에 role=img + aria-label로 붙여 화면 읽기에만 남긴다 */
  showLabel?: boolean;
  /** 그림 크기(px) — 24px 격자의 배수 */
  size?: 24 | 32 | 40 | 48;
  /** 보이는 라벨의 글자 모양 — 주면 기본(13px 700 navy-700)을 대신한다 (카드 제목 19px 900 등) */
  labelClassName?: string;
  /** center: 그림 아래 라벨 가운데 · start: 그림 아래 라벨 왼쪽 정렬(카드) · inline: 그림 옆 라벨 */
  layout?: "center" | "start" | "inline";
  className?: string;
};

const LAYOUT = {
  center: "inline-flex flex-col items-center gap-1.5 text-center",
  start: "flex flex-col items-start gap-3",
  inline: "inline-flex items-center gap-2",
} as const;

const POINT_CLASS = "fill-hermes-500 stroke-none";

function ShapeEl({ shape, className }: { shape: Shape; className?: string }) {
  switch (shape.type) {
    case "path":
      return <path d={shape.d} className={className} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} className={className} />;
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} className={className} />;
  }
}

/**
 * 픽토그램 — 24px 격자 SVG, navy-900 1.75px 선 + hermes-500 포인트 하나, 평면 (PRD-00 8.6 · R11, UX-04)
 * 라벨은 늘 글자로 DOM에 있고(보이거나 aria-label), 그림 자체는 겹쳐 읽히지 않게 숨긴다
 */
export function Pictogram({ name, label, showLabel = true, size = 24, labelClassName, layout = "center", className }: PictogramProps) {
  const def = PICTOGRAMS[name];
  const a11y = showLabel ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    <span data-ui="pictogram" data-pictogram={name} className={cx(LAYOUT[layout], className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        className="shrink-0 stroke-navy-900"
        {...a11y}
      >
        {def.lines.map((shape, i) => (
          <ShapeEl key={`l${i}`} shape={shape} />
        ))}
        <ShapeEl shape={def.point} className={POINT_CLASS} />
        {def.after?.map((shape, i) => (
          <ShapeEl key={`a${i}`} shape={shape} />
        ))}
      </svg>
      {showLabel && <span className={labelClassName ?? "text-[13px] font-bold text-navy-700"}>{label}</span>}
    </span>
  );
}
