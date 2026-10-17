import {
  ArticleCard,
  FieldCards,
  InfographicBlock,
  NextActionBand,
  PICTOGRAMS,
  PICTOGRAM_NAMES,
  Pictogram,
  PopularArticles,
  SituationCard,
  SolvedCaseCard,
  VideoCard,
  colors,
  type PictogramGroup,
} from "@ltr/ui";
import { SectionTitle, Specimen } from "./specimen";

// 견본용 그림 — 색은 토큰 파일(colors)의 값을 그대로 쓴다 (화면 코드에 색 값 직접 쓰지 않음, DS-01). 평면 도형만
function svgImage(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const VIDEO_THUMBNAIL = svgImage(
  1280,
  720,
  `<rect width="1280" height="720" fill="${colors["navy-50"]}"/>
   <rect x="0" y="560" width="1280" height="160" fill="${colors["ivory-dark"]}"/>
   <circle cx="1010" cy="170" r="70" fill="${colors["hermes-200"]}"/>
   <path d="M380 330 L640 140 L900 330" fill="none" stroke="${colors["navy-800"]}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
   <path d="M440 290 V560 H840 V290" fill="none" stroke="${colors["navy-800"]}" stroke-width="28" stroke-linejoin="round"/>
   <rect x="590" y="420" width="100" height="140" rx="12" fill="${colors["hermes-500"]}"/>`,
);

const FONT = "Pretendard, 'Malgun Gothic', sans-serif";
const step = (x: number, n: string, title: string, sub: string) =>
  `<rect x="${x}" y="150" width="300" height="220" rx="28" fill="${colors.ivory}" stroke="${colors["navy-100"]}" stroke-width="4"/>
   <circle cx="${x + 60}" cy="215" r="30" fill="${colors["navy-900"]}"/>
   <text x="${x + 60}" y="226" font-family="${FONT}" font-size="30" font-weight="800" fill="${colors.ivory}" text-anchor="middle">${n}</text>
   <text x="${x + 32}" y="300" font-family="${FONT}" font-size="34" font-weight="900" fill="${colors["navy-900"]}">${title}</text>
   <text x="${x + 32}" y="345" font-family="${FONT}" font-size="24" fill="${colors["navy-600"]}">${sub}</text>`;
const arrow = (x: number) => `<path d="M${x} 260 H${x + 60} M${x + 40} 240 L${x + 60} 260 L${x + 40} 280" fill="none" stroke="${colors["hermes-700"]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;

const INFOGRAPHIC = svgImage(
  1200,
  520,
  `<rect width="1200" height="520" fill="${colors.ivory}"/>
   <text x="60" y="90" font-family="${FONT}" font-size="40" font-weight="900" fill="${colors["navy-900"]}">집을 샀을 때 취득세 신고 순서</text>
   ${step(60, "1", "잔금 지급", "계약서의 잔금일")}
   ${arrow(370)}
   ${step(450, "2", "취득세 신고", "잔금일부터 60일 안")}
   ${arrow(760)}
   ${step(840, "3", "취득세 납부", "신고와 함께")}
   <text x="60" y="450" font-family="${FONT}" font-size="24" fill="${colors["navy-600"]}">60일 안에 신고·납부하면 가산세가 없습니다</text>`,
);

const GROUP_TITLE: Record<PictogramGroup, string> = {
  tax: "세목 8종",
  situation: "상황 8종",
  field: "4대 분야 4종",
  hub: "지자체 허브 블록 4종",
};

export function DiscoverySection() {
  return (
    <section>
      <SectionTitle>찾기·읽기</SectionTitle>
      <div className="space-y-4">
        <Specimen name="픽토그램">
          <div className="space-y-6">
            {(Object.keys(GROUP_TITLE) as PictogramGroup[]).map((group) => (
              <div key={group}>
                <p className="mb-3 text-[15px] font-bold text-navy-800">{GROUP_TITLE[group]}</p>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  {PICTOGRAM_NAMES.filter((name) => PICTOGRAMS[name].group === group).map((name) => (
                    <li key={name} className="flex rounded-xl border border-navy-100 bg-ivory p-3">
                      <Pictogram name={name} label={PICTOGRAMS[name].label} size={40} className="w-full" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen name="4대 분야 카드">
          <FieldCards
            points={{
              tax: "고지서·신고 기한·환급을 한곳에서 확인합니다",
              realestate: "살 때와 갖고 있을 때 내는 지방세를 정리합니다",
              finance: "신탁·PF 구조에서 취득세를 누가 내는지 봅니다",
              local: "우리 지역의 지방세·지방재정 소식을 전합니다",
            }}
          />
        </Specimen>

        <Specimen name="상황 카드">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <li>
              <SituationCard href="/situations/car-sold" pictogram="car-sold" title="차를 팔았어요·폐차했어요" description="미리 낸 자동차세를 돌려받는 순서" />
            </li>
            <li>
              <SituationCard href="/situations/notice" pictogram="notice-received" title="고지서를 받았어요" description="고지서에서 먼저 확인할 세 가지" />
            </li>
            <li>
              <SituationCard href="/situations/home-bought" pictogram="home-bought" title="집을 샀어요" description="취득세 신고 기한과 감면 요건" />
            </li>
            <li>
              <SituationCard href="/situations/refund" pictogram="refund" title="세금을 돌려받고 싶어요" description="환급 신청 방법과 필요한 서류" />
            </li>
          </ul>
        </Specimen>

        <div className="grid gap-4 lg:grid-cols-2">
          <Specimen name="기사 카드">
            <div className="grid gap-4">
              <ArticleCard
                href="/news/seongdong-redevelopment-acquisition-tax"
                section="realestate"
                subsection="정비사업"
                title="성동구 재개발 구역, 관리처분인가 뒤 취득세는 언제 내나"
                summary="관리처분인가가 나면 입주권을 사는 사람의 취득세 기준이 바뀝니다. 신고 기한과 준비할 서류를 차례로 정리했습니다."
                publishedAt="2026-10-14"
                region="서울 성동구"
                typeBadge={
                  // 자리 예시 — 실제 화면에는 기사 유형 배지 컴포넌트가 들어간다
                  <span className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[13px] font-bold text-navy-800">보도</span>
                }
                format="인포그래픽"
              />
              <ArticleCard
                href="/news/vehicle-tax-prepaid-refund"
                section="tax"
                title="자동차세를 1년치 미리 냈다면, 차를 판 뒤 남은 기간만큼 돌려받습니다"
                summary="연납한 자동차세는 차를 판 날 이후 기간만큼 날짜로 나누어 돌려받습니다. 신청 순서를 카드뉴스로 정리했습니다."
                publishedAt="2026-10-10"
                format="카드뉴스"
              />
            </div>
          </Specimen>

          <Specimen name="많이 본 기사 목록">
            <PopularArticles
              items={[
                { href: "/news/2026-local-tax-reform", title: "2026년 지방세제 개편안, 무엇이 바뀌나" },
                { href: "/news/first-home-acquisition-relief", title: "생애최초 주택 취득세 감면 요건 정리" },
                { href: "/news/property-tax-bill-july-september", title: "재산세 7월·9월 고지서 읽는 법" },
                { href: "/news/trust-property-tax-payer", title: "신탁 부동산의 재산세는 누가 내나" },
                { href: "/news/occupancy-right-acquisition-tax", title: "관리처분인가 뒤 입주권 취득세 기준과 신고 기한 한눈에 보기" },
              ]}
            />
          </Specimen>

          <Specimen name="동영상 카드">
            <VideoCard
              title="생애 첫 집, 취득세 감면 요건 3가지"
              summary="처음 집을 산 사람이 받을 수 있는 취득세 감면 요건을 4분 동안 차례로 설명합니다. 자막과 같은 내용의 글을 기사 본문에 함께 둡니다."
              thumbnail={{ src: VIDEO_THUMBNAIL, width: 1280, height: 720 }}
              durationSeconds={272}
              captions
              embedUrl="https://www.youtube-nocookie.com/embed/sample-localtax"
            />
          </Specimen>

          <Specimen name="인포그래픽 블록">
            <InfographicBlock
              title="취득세 신고 순서"
              image={{
                src: INFOGRAPHIC,
                alt: "집을 샀을 때 취득세 신고 순서. 1 잔금 지급, 2 잔금일부터 60일 안에 취득세 신고, 3 신고와 함께 납부. 60일 안에 신고·납부하면 가산세가 없습니다.",
                width: 1200,
                height: 520,
              }}
              data={{
                kind: "table",
                caption: "취득세 신고 순서",
                columns: ["순서", "할 일", "기한"],
                rows: [
                  ["1", "잔금 지급", "계약서의 잔금일"],
                  ["2", "취득세 신고", "잔금일부터 60일 안"],
                  ["3", "취득세 납부", "신고와 함께"],
                ],
              }}
            />
          </Specimen>

          <Specimen name="해결 사례 카드">
            <SolvedCaseCard
              title="잔금일과 등기일이 다를 때 취득일을 다툰 사례"
              href="/news/solved-acquisition-date-balance-payment"
              situation="아파트 잔금을 3월에 치르고 등기는 5월에 했습니다. 등기일을 기준으로 신고했더니 신고가 늦었다는 안내를 받았습니다."
              issue="돈을 주고 산 집의 취득일을 잔금일로 볼지, 등기일로 볼지가 쟁점이었습니다."
              result={{
                conclusion: "rejected",
                text: "잔금을 치른 날이 취득일이라는 판단으로 청구가 받아들여지지 않았습니다.",
                basis: [{ label: "지방세법 제20조 제1항", href: "https://www.law.go.kr/", external: true }, { label: "조심2026지0085" }],
              }}
              lesson="돈을 주고 산 집은 보통 잔금을 치른 날이 취득일입니다. 잔금일부터 60일 안에 신고하면 가산세가 없습니다."
            />
          </Specimen>
        </div>

        <Specimen name="다음 행동 띠">
          <NextActionBand
            similarCases={[
              { kind: "해결 사례", title: "잔금일과 등기일이 다를 때 취득일을 다툰 사례", href: "/news/solved-acquisition-date-balance-payment" },
              { kind: "상담 사례", title: "분양권으로 산 아파트의 취득세 신고 시점", href: "/news/consult-presale-right-acquisition-date" },
              { kind: "해결 사례", title: "생애최초 감면을 받은 뒤 전입이 늦어진 사례", href: "/news/solved-first-home-relief-move-in" },
            ]}
            actions={[
              { key: "situation", label: "이 상황 모아 보기", href: "/situations/home-bought", enabled: true },
              { key: "sm-calculator", label: "SM 계산기로 계산하기", href: "https://sm-tax-platform-six.vercel.app/calc", enabled: true, external: true },
              // 2단계 자체 계산기 — 1단계에는 열리지 않아 렌더되지 않는다
              { key: "self-calculator", label: "계산해 보기", href: "/calc/acquisition", enabled: false },
            ]}
          />
        </Specimen>
      </div>
    </section>
  );
}
