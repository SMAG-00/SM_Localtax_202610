import {
  ARTICLE_TYPE_BADGE_ORDER,
  ArticleTypeBadge,
  CheckboxField,
  EditorialFieldBadge,
  Footer,
  Header,
  Hero,
  HomeSearch,
  HotBadge,
  InfoListMarker,
  PartnerBadge,
  ProgressStageBadge,
  RadioField,
  SelectField,
  SourceLine,
  StepTimeline,
  TaxAccordion,
  TaxKindBadge,
  TextField,
  UnconfirmedChip,
  type ProgressStageEvent,
  type TaxAccordionItem,
} from "@ltr/ui";
import { SectionTitle, Specimen } from "./specimen";

const taxItems: TaxAccordionItem[] = [
  {
    id: "acquisition",
    name: "취득세",
    kind: "local",
    summary: "부동산·차량 등을 취득하면 냅니다",
    base: "취득 당시의 가액",
    rate: "주택 유상거래 1~3% (주택 수·지역에 따라 다름)",
    due: "취득일부터 60일 안에 신고·납부",
    law: "지방세법 제11조",
    detail: "생애최초 주택이면 감면 요건을 먼저 확인하세요.",
  },
  {
    id: "property",
    name: "재산세",
    kind: "local",
    summary: "6월 1일에 가진 부동산에 매년 고지됩니다",
    base: "시가표준액 × 공정시장가액비율",
    rate: "주택 0.1~0.4%",
    due: "7월·9월 (과세기준일 6월 1일)",
    law: "지방세법 제111조",
  },
  {
    id: "comprehensive",
    name: "종합부동산세",
    kind: "national",
    summary: "공시가격 합계가 공제금액을 넘으면 냅니다",
    base: "(공시가격 합계 − 공제금액) × 공정시장가액비율",
    rate: "주택 0.5~2.7% (2주택 이하)",
    due: "12월 1일~15일",
    law: "종합부동산세법 제9조",
  },
  {
    id: "bond",
    name: "국민주택채권",
    kind: "other",
    summary: "등기할 때 사야 하는 채권입니다",
    base: "시가표준액",
    rate: "지역·금액별 매입 비율",
    due: "등기 신청 때",
    law: "주택도시기금법 제8조",
  },
];

const beforePromulgation: ProgressStageEvent[] = [
  { stage: "announced", occurredOn: "2026-07-15", sourceUrl: "#" },
  { stage: "pre_notice", occurredOn: "2026-08-03", sourceUrl: "#" },
  { stage: "submitted", occurredOn: "2026-09-21", sourceUrl: "#" },
];

const scheduled: ProgressStageEvent[] = [
  ...beforePromulgation,
  { stage: "passed", occurredOn: "2026-12-02", sourceUrl: "#" },
  { stage: "promulgated", occurredOn: "2026-12-24", sourceUrl: "#" },
  { stage: "effective", occurredOn: "2027-01-01", sourceUrl: "#" },
];

const footerLinks = [
  { label: "회사 소개", href: "#" },
  { label: "편집 원칙", href: "#" },
  { label: "윤리강령", href: "#" },
  { label: "정정·반론 창구", href: "#" },
  { label: "광고 정책", href: "#" },
  { label: "개인정보처리방침", href: "#", emphasis: true },
  { label: "고객센터", href: "#" },
  { label: "이용약관", href: "#" },
  { label: "이메일무단수집거부", href: "#" },
  { label: "측정 거부", href: "#" },
];

const note = "mb-2 text-[13px] font-semibold text-navy-600";

// shell 묶음 견본 — 헤더·히어로·바닥글·단계 타임라인·세목 아코디언·폼 요소·홈 큰 입력창·표시 배지 (PRD-00 8.6)
export function ShellSection() {
  return (
    <section>
      <SectionTitle>화면 틀·배지</SectionTitle>
      <div className="space-y-4">
        <Specimen name="헤더">
          <p className={note}>1024px 미만에서는 [메뉴] 버튼으로 엽니다</p>
          <Header utilities={["calc", "experts", "store", "edu", "search"]} currentSection="tax" account={{ label: "로그인", href: "#" }} />
        </Specimen>

        <Specimen name="히어로">
          <Hero titleLevel={3}
            eyebrow="LOCAL TAX NEWS"
            title="지방세·부동산·지자체 소식을 쉬운 말로"
            highlight="쉬운 말로"
            description="개정 소식과 해설, 지자체 뉴스를 한곳에서 확인하세요."
          />
        </Specimen>

        <Specimen name="홈 큰 입력창" dark>
          <HomeSearch label="무엇이 궁금하세요?" placeholder="예: 취득세 신고 기한" suggestions={["취득세 신고 기한", "재산세 고지서", "재건축 취득세", "지방세 환급"]} />
        </Specimen>

        <Specimen name="바닥글">
          <Footer
            disclaimer="이 사이트의 기사와 해설은 일반 정보이며 개별 세무 자문이 아닙니다. 신고 전에는 세무 전문가에게 확인하세요."
            links={footerLinks}
            info={[
              { label: "대표전화", value: "02-000-0000" },
              { label: "주소", value: "" },
            ]}
          />
        </Specimen>

        <Specimen name="단계 타임라인">
          <StepTimeline
            label="부동산 세금의 전 주기"
            steps={[
              { title: "취득", when: "살 때", chips: ["취득세", "지방교육세", "농어촌특별세"], note: "취득일부터 60일 안에 신고·납부합니다", href: "#" },
              { title: "보유", when: "가지고 있을 때", chips: ["재산세", "지역자원시설세"], note: "6월 1일 소유자에게 7월·9월에 고지됩니다" },
              { title: "양도", when: "팔 때", chips: ["지방소득세"], note: "양도소득세를 신고할 때 지방소득세도 함께 신고합니다" },
            ]}
          />
        </Specimen>

        <Specimen name="세목 아코디언">
          <TaxAccordion items={taxItems} />
        </Specimen>

        <Specimen name="진행 단계 배지">
          <div className="space-y-8">
            <div>
              <p className={note}>공포 전 — 「확정 아님」 칩이 붙습니다</p>
              <ProgressStageBadge events={beforePromulgation} />
            </div>
            <div>
              <p className={note}>공포 뒤 시행일 전 — 시행 예정</p>
              <ProgressStageBadge events={scheduled} />
            </div>
          </div>
        </Specimen>

        <Specimen name="폼 요소">
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField id="specimen-name" label="이름" required hint="실명이 아니어도 됩니다." autoComplete="name" />
            <TextField id="specimen-phone" label="연락처" type="tel" error="숫자와 하이픈(-)만 입력해 주세요." defaultValue="010-0000-00a0" />
            <SelectField
              id="specimen-sido"
              label="시·도"
              placeholder="선택해 주세요"
              options={[
                { value: "seoul", label: "서울특별시" },
                { value: "busan", label: "부산광역시" },
                { value: "gyeonggi", label: "경기도" },
              ]}
            />
            <RadioField
              id="specimen-cause"
              name="specimen-cause"
              legend="취득 원인"
              required
              options={[
                { value: "buy", label: "매매" },
                { value: "inherit", label: "상속" },
                { value: "gift", label: "증여" },
              ]}
            />
            <CheckboxField id="specimen-agree" label="개인정보 수집·이용에 동의합니다" required />
          </div>
        </Specimen>

        <div className="grid gap-4 sm:grid-cols-2">
          <Specimen name="데이터 출처 줄">
            <div className="space-y-2">
              <SourceLine source="행정안전부 지방세통계" baseDate="2025-12-31" checkedAt="2026-10-13" />
              <SourceLine source="국토교통부 실거래가 공개시스템" checkedAt="2026-10-13" />
            </div>
          </Specimen>

          <Specimen name="국세·지방세 배지">
            <div className="flex flex-col gap-2">
              <TaxKindBadge kind="local" reviewedAt="2026-10-13" />
              <TaxKindBadge kind="national" reviewedAt="2026-10-13" />
            </div>
          </Specimen>

          <Specimen name="기사 유형 배지">
            <div className="flex flex-wrap gap-2">
              {ARTICLE_TYPE_BADGE_ORDER.map((type) => (
                <ArticleTypeBadge key={type} type={type} />
              ))}
            </div>
            <p className={`${note} mt-4`}>정보 목록 표시 (기사 유형 아님)</p>
            <div className="flex flex-wrap gap-2">
              <InfoListMarker kind="event" />
              <InfoListMarker kind="presale" />
            </div>
          </Specimen>

          <Specimen name="편집 분야 배지">
            <div className="flex flex-wrap gap-2">
              <EditorialFieldBadge field="local_tax" />
              <EditorialFieldBadge field="realestate" />
              <EditorialFieldBadge field="local_finance" />
              <EditorialFieldBadge field="urban_policy" />
            </div>
          </Specimen>

          <Specimen name="제휴 배지">
            <PartnerBadge partner="가나다 세무법인" />
          </Specimen>

          <Specimen name="HOT 배지">
            <p className="flex items-center gap-2 text-[17px] font-bold text-navy-900">
              <HotBadge />
              다가구주택을 샀는데 취득세는 몇 %인가요?
            </p>
          </Specimen>

          <Specimen name="`확정 아님` 칩">
            <p className="flex flex-wrap items-center gap-2 text-[17px] font-bold text-navy-900">
              지방세법 일부개정안 — 국회 제출
              <UnconfirmedChip />
            </p>
          </Specimen>
        </div>
      </div>
    </section>
  );
}
