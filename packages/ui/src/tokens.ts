/**
 * 브랜드 3색 체계 — 딥네이비 · 에르메스 오렌지 · 아이보리 (DS-01, PRD-00 8.3)
 * SM 부동산 세금 플랫폼 `tailwind.config.ts`의 값을 그대로 옮겼다. 값을 바꾸지 않는다 (PO 결정 — SM 톤앤매너 유지).
 * 화면 코드에 hex를 직접 쓰지 않고 이 토큰(Tailwind 클래스 navy-800 등)만 쓴다 — scripts/check-design.mjs가 검사한다.
 * src/theme.css의 @theme 값과 같아야 한다 (tests/tokens.test.mjs가 문서·코드·CSS 세 곳을 대조).
 *
 * 대비 규칙 (WCAG AA 본문 4.5:1)
 *   주 버튼은 navy-900 글자 / hermes-500 바탕 — 흰 글자 / hermes-500은 금지(3.1:1)
 *   hermes-500은 면이지 글자색이 아니다. 밝은 바탕 위 작은 주황 글자는 hermes-800
 *   hermes-700 글자는 ivory 위 본문 크기에서만 (ivory-dark 위 금지)
 */
export const colors = {
  "navy-50": "#EEF3F8",
  "navy-100": "#D6E2EE",
  "navy-200": "#A9C1D9",
  "navy-300": "#6F93B8",
  "navy-400": "#3D6A96",
  "navy-500": "#1E4E7C",
  "navy-600": "#153C63",
  "navy-700": "#0E2E4D",
  "navy-800": "#0A2540",
  "navy-900": "#06182A",
  "hermes-50": "#FFF4EC",
  "hermes-100": "#FFE4D1",
  "hermes-200": "#FFC49B",
  "hermes-300": "#FF9D5C",
  "hermes-400": "#FA8231",
  "hermes-500": "#F26A1B",
  "hermes-600": "#DE5A0E",
  "hermes-700": "#C2410C",
  "hermes-800": "#9A3412",
  "hermes-900": "#7C2D12",
  ivory: "#FAF7F2",
  "ivory-dark": "#F1EBE1",
} as const;

export type ColorToken = keyof typeof colors;

/** WCAG 2.x 상대 휘도 */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** WCAG 2.x 대비 (1 ~ 21) */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
