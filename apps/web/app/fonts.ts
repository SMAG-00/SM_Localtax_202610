import localFont from "next/font/local";

// Pretendard 셀프 호스팅 (DS-04) — 필요한 굵기만(본문 400 · 칩·버튼 700 · 제목 900), font-display: swap, 외부 CDN 요청 0
export const pretendard = localFont({
  src: [
    { path: "../../../packages/ui/fonts/Pretendard-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../packages/ui/fonts/Pretendard-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../../packages/ui/fonts/Pretendard-Black.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-pretendard",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Malgun Gothic", "sans-serif"],
});
