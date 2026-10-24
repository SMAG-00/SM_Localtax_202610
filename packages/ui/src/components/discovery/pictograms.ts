/**
 * 픽토그램 24종 도형 자료 (PRD-00 8.6 · R11, PRD-01A UX-04)
 * - 24px 격자: 모든 좌표는 viewBox 0 0 24 24 안. 경로는 절대 좌표 명령만 쓴다 (격자 검사가 쉬움)
 * - lines는 navy-900 1.75 선(색은 Pictogram이 svg에 한 번 정한다), point는 hermes-500 채움 하나
 * - after는 포인트 위에 다시 긋는 navy 선 (포인트를 가리지 않게 순서만 바꾼다 — 색은 같다)
 * - 평면: 그라데이션·필터·그림자·투시 없음
 *
 * 상황 8종 — PRD-01A UX-05 상황 카드 초안 12개 중 고유 그림이 필요한 것. 나머지 4개는 기존 그림을 쓴다:
 *   세금을 돌려받고 싶어요 → 세목 '환급' · 지방세 실무자예요 → 분야 '지방세'
 *   상속 2종(부모님 집을 상속받았어요·형제자매와 공동상속했어요) → '상속' · 증여 2종(자녀에게 집을 증여·부담부증여) → '증여'
 */

export type Shape =
  | { type: "path"; d: string }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; rx?: number };

export type PictogramGroup = "tax" | "situation" | "field" | "hub";

export type PictogramDef = {
  group: PictogramGroup;
  /** 견본·기본 라벨 — 컴포넌트에서는 label을 반드시 따로 준다 */
  label: string;
  lines: readonly Shape[];
  /** hermes-500 포인트 — 하나만 (타입으로 하나) */
  point: Shape;
  after?: readonly Shape[];
};

const path = (d: string): Shape => ({ type: "path", d });
const circle = (cx: number, cy: number, r: number): Shape => ({ type: "circle", cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx?: number): Shape => ({ type: "rect", x, y, width, height, rx });

export const PICTOGRAM_NAMES = [
  // 세목 8 (PRD 순서)
  "acquisition",
  "property",
  "comprehensive-property",
  "vehicle",
  "local-income",
  "registration-license",
  "resident",
  "refund",
  // 상황 8
  "notice-received",
  "car-sold",
  "home-bought",
  "redevelopment-member",
  "inheritance",
  "gift",
  "trust-property",
  "corporate-purchase",
  // 4대 분야 4
  "field-local-tax",
  "field-real-estate",
  "field-development-finance",
  "field-local-news",
  // 지자체 허브 블록 4 (LG-08 순서)
  "hub-weekly-hot",
  "hub-local-tax-finance",
  "hub-real-estate-development",
  "hub-events",
] as const;

export type PictogramName = (typeof PICTOGRAM_NAMES)[number];

export const PICTOGRAMS: Record<PictogramName, PictogramDef> = {
  // ── 세목 ──────────────────────────────────────────────
  acquisition: {
    group: "tax",
    label: "취득세",
    // 집 + 채운 문 (새로 들어가는 집)
    lines: [path("M3 11.5 L12 4 L21 11.5"), path("M5.5 9.5 V20 H18.5 V9.5")],
    point: rect(10, 14, 4, 6, 1),
  },
  property: {
    group: "tax",
    label: "재산세",
    // 공동주택 한 동 + 채운 출입문 (갖고 있는 집)
    lines: [rect(5.5, 3.5, 13, 17, 1.5), path("M9 7.5 H10.5 M13.5 7.5 H15 M9 11 H10.5 M13.5 11 H15"), path("M3 20.5 H21")],
    point: rect(10.5, 15, 3, 5.5, 0.75),
  },
  "comprehensive-property": {
    group: "tax",
    label: "종부세",
    // 건물 두 채 (여러 부동산을 합쳐 매김) + 작은 건물의 채운 창
    lines: [path("M3.5 20.5 V10 H10.5 V20.5"), path("M10.5 20.5 V3.5 H20.5 V20.5"), path("M2.5 20.5 H21.5"), path("M14 7.5 H17 M14 11 H17 M14 14.5 H17")],
    point: rect(5.5, 13, 3, 3, 0.75),
  },
  vehicle: {
    group: "tax",
    label: "자동차세",
    // 승용차 옆모습 + 채운 앞바퀴
    lines: [
      path("M5.25 16.5 H3.5 V13.5 C3.5 12.95 3.95 12.5 4.5 12.5 H5 L7.5 8.5 H15.5 L18.5 12.5 H19.5 C20.05 12.5 20.5 12.95 20.5 13.5 V16.5 H18.75"),
      path("M14.25 16.5 H9.75"),
      path("M5 12.5 H18.5 M12 8.5 V12.5"),
      circle(7.5, 16.5, 2.25),
    ],
    point: circle(16.5, 16.5, 2.25),
  },
  "local-income": {
    group: "tax",
    label: "지방소득세",
    // 사람 + 채운 동전 (소득)
    lines: [circle(9, 7.5, 3), path("M3.5 20 C3.5 15.86 5.96 13 9 13 C12.04 13 14.5 15.86 14.5 20")],
    point: circle(18, 15.5, 3),
  },
  "registration-license": {
    group: "tax",
    label: "등록면허세",
    // 면허·등록증 + 채운 인장
    lines: [rect(3, 5, 18, 14, 2), path("M6.5 9.5 H13 M6.5 13 H11")],
    point: circle(16.25, 14, 2.25),
  },
  resident: {
    group: "tax",
    label: "주민세",
    // 주민 두 사람 — 뒷사람 머리를 채운다
    lines: [
      circle(8.5, 8, 2.75),
      path("M3.5 19.5 C3.5 15.91 5.74 13.5 8.5 13.5 C11.26 13.5 13.5 15.91 13.5 19.5"),
      path("M14.75 13.9 C15.15 13.8 15.57 13.75 16 13.75 C18.49 13.75 20.5 15.97 20.5 19.5"),
    ],
    point: circle(16, 9.25, 2.25),
  },
  refund: {
    group: "tax",
    label: "환급",
    // 되돌아오는 화살표 + 가운데 채운 동전
    lines: [path("M5 12 A7 7 0 1 0 7.05 7.05"), path("M10.55 7.05 H7.05 V3.55")],
    point: circle(12, 12, 2.5),
  },

  // ── 상황 ──────────────────────────────────────────────
  "notice-received": {
    group: "situation",
    label: "고지서를 받았어요",
    // 봉투 + 모서리의 채운 알림 점
    lines: [rect(3, 7, 16, 12, 2), path("M3.5 8 L11 13.5 L18.5 8")],
    point: circle(19, 6.5, 3),
  },
  "car-sold": {
    group: "situation",
    label: "차를 팔았어요·폐차했어요",
    // 작은 차 + 떠나는 화살표(채운 화살촉)
    lines: [
      path("M4.75 19 H2.5 V16 C2.5 15.45 2.95 15 3.5 15 H4 L6 11.5 H12 L14.5 15 H15 C15.55 15 16 15.45 16 16 V19 H14.25"),
      path("M10.75 19 H8.25"),
      path("M4 15 H14.5"),
      circle(6.5, 19, 1.75),
      circle(12.5, 19, 1.75),
      path("M13.5 6.5 H18.5"),
    ],
    point: path("M18 3.5 L21.5 6.5 L18 9.5 Z"),
  },
  "home-bought": {
    group: "situation",
    label: "집을 샀어요",
    // 집 + 채운 확인 배지 (배지 위 확인 표시는 navy 선)
    lines: [path("M3 11 L10.5 4.5 L18 11"), path("M5 9.5 V19.5 H12.5"), path("M16 9.5 V11.5")],
    point: circle(17.25, 17, 4.25),
    after: [path("M15.25 17 L16.6 18.35 L19.25 15.7")],
  },
  "redevelopment-member": {
    group: "situation",
    label: "재건축·재개발 조합원이에요",
    // 타워크레인 + 새 건물 + 채운 짐
    lines: [path("M6.5 21 V3.5"), path("M3.5 6 H20.5"), path("M16.5 6 V10"), path("M11 21 V15 H19.5 V21"), path("M2.5 21 H21.5")],
    point: rect(14.75, 10, 3.5, 2.75, 0.5),
  },
  inheritance: {
    group: "situation",
    label: "상속받았어요",
    // 집이 두 갈래로 이어짐 (상속·공동상속) — 받는 사람 하나를 채운다
    lines: [
      path("M8 8 L12 4.5 L16 8"),
      path("M9.5 7 V10.5 H14.5 V7"),
      path("M12 10.5 V12.5 M6.5 12.5 H17.5 M6.5 12.5 V14.25 M17.5 12.5 V14"),
      circle(6.5, 17, 2.25),
    ],
    point: circle(17.5, 17, 3),
  },
  gift: {
    group: "situation",
    label: "증여하려 해요",
    // 선물 상자 + 채운 매듭
    lines: [
      rect(4.5, 11, 15, 9.5, 1),
      rect(3.5, 7.5, 17, 3.5, 1),
      path("M12 7.5 V20.5"),
      path("M12 7.5 C10.5 4.5 7.25 4.25 7.75 6.25 C8 7.25 10 7.5 12 7.5"),
      path("M12 7.5 C13.5 4.5 16.75 4.25 16.25 6.25 C16 7.25 14 7.5 12 7.5"),
    ],
    point: circle(12, 7.5, 1.75),
  },
  "trust-property": {
    group: "situation",
    label: "신탁 부동산이에요",
    // 방패(맡겨 둔 재산) 안의 집 + 채운 문
    lines: [
      path("M12 3 L19.5 5.75 V11.25 C19.5 15.9 16.3 19.6 12 21 C7.7 19.6 4.5 15.9 4.5 11.25 V5.75 Z"),
      path("M8.5 12.25 L12 9.25 L15.5 12.25"),
      path("M9.75 11.25 V16 H14.25 V11.25"),
    ],
    point: rect(11, 12.5, 2, 2.6, 0.5),
  },
  "corporate-purchase": {
    group: "situation",
    label: "법인이 부동산을 사요",
    // 서류 가방(법인) + 건물 — 가방 잠금쇠를 채운다
    lines: [
      rect(2.75, 12, 9.5, 8.5, 1.5),
      path("M5.75 12 V10.5 C5.75 9.95 6.2 9.5 6.75 9.5 H8.25 C8.8 9.5 9.25 9.95 9.25 10.5 V12"),
      path("M14 20.5 V4 H20.5 V20.5"),
      path("M16.5 7.5 H18 M16.5 11 H18 M16.5 14.5 H18"),
      path("M2 20.5 H22"),
    ],
    point: rect(6.5, 15, 2, 2, 0.5),
  },

  // ── 4대 분야 ───────────────────────────────────────────
  "field-local-tax": {
    group: "field",
    label: "지방세·부동산세금",
    // 영수증 + 채운 인장
    lines: [path("M5.5 3.5 H18.5 V20.5 L16.33 19 L14.17 20.5 L12 19 L9.83 20.5 L7.67 19 L5.5 20.5 Z"), path("M8.5 7.5 H15.5 M8.5 11 H13")],
    point: circle(14.5, 15, 2),
  },
  "field-real-estate": {
    group: "field",
    label: "부동산재테크",
    // 집과 높은 건물 + 집의 채운 문
    lines: [path("M2.5 13 L7.5 8.5 L12.5 13"), path("M4 11.75 V20.5 M11 11.75 V20.5"), path("M13.5 20.5 V4 H20.5 V20.5"), path("M16 7.5 H18 M16 11 H18 M16 14.5 H18"), path("M2 20.5 H22")],
    point: rect(6.5, 15.5, 2, 5, 0.5),
  },
  "field-development-finance": {
    group: "field",
    label: "부동산금융",
    // 건물 + 쌓인 동전 + 떨어지는 채운 동전 (개발 자금)
    lines: [
      path("M4.5 20.5 V4.5 H12.5 V20.5"),
      path("M7.5 8 H9.5 M7.5 11.5 H9.5 M7.5 15 H9.5"),
      path("M2.5 20.5 H21.5"),
      rect(14.5, 17.25, 6, 3.25, 1.5),
      rect(14.5, 14, 6, 3.25, 1.5),
    ],
    point: circle(17.5, 9.5, 3),
  },
  "field-local-news": {
    group: "field",
    label: "지자체뉴스",
    // 지자체 청사(기둥 건물) + 박공의 채운 문장
    lines: [path("M3.5 9 L12 4 L20.5 9 Z"), path("M7 11.5 V18 M12 11.5 V18 M17 11.5 V18"), path("M3.5 20.5 H20.5")],
    point: circle(12, 7, 1.2),
  },

  // ── 지자체 허브 블록 ────────────────────────────────────
  "hub-weekly-hot": {
    group: "hub",
    label: "금주 핫뉴스",
    // 신문 + 채운 불꽃
    lines: [
      rect(3.5, 4, 13.5, 16.5, 1.5),
      path("M17 8.5 H19 C19.83 8.5 20.5 9.17 20.5 10 V18.5 C20.5 19.6 19.6 20.5 18.5 20.5 H17"),
      path("M6.5 15 H14 M6.5 17.75 H11.5"),
    ],
    point: path("M10.25 12.5 C8.73 12.5 7.75 11.5 7.75 10.15 C7.75 8.85 8.75 8.1 9.3 7 C9.65 7.95 10.1 8.35 10.65 8.6 C10.8 7.95 11.15 7.45 11.7 7.05 C12.45 7.95 12.75 9 12.75 10.15 C12.75 11.5 11.77 12.5 10.25 12.5 Z"),
  },
  "hub-local-tax-finance": {
    group: "hub",
    label: "지방세·지방재정",
    // 원그래프(재정) — 떨어져 나온 한 조각을 채운다
    lines: [path("M18 13.5 A7.5 7.5 0 1 1 10.5 6 V13.5 Z")],
    point: path("M12.5 11.5 V4 A7.5 7.5 0 0 1 20 11.5 Z"),
  },
  "hub-real-estate-development": {
    group: "hub",
    label: "부동산·개발",
    // 건물 + 채운 공사 표지 고깔
    lines: [path("M4.5 20.5 V4.5 H13.5 V20.5"), path("M7.5 8 H10.5 M7.5 11.5 H10.5 M7.5 15 H10.5"), path("M2.5 20.5 H21.5")],
    point: path("M17.75 10 L21 20.5 H14.5 Z"),
  },
  "hub-events": {
    group: "hub",
    label: "행사안내",
    // 달력 + 채운 행사일
    lines: [rect(3.5, 5, 17, 15.5, 2), path("M3.5 9.5 H20.5"), path("M8 3 V6.5 M16 3 V6.5")],
    point: rect(13, 13, 4.5, 4.5, 1),
  },
};
