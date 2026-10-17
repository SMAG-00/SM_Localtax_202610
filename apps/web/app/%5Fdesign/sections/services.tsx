import {
  AnswerCard,
  AssistantLauncher,
  AssistantPanel,
  CorrectionHistory,
  ExpertCard,
  ExternalCalculatorCard,
  FaqBlock,
  InterpretationSource,
  KeySummary,
  OptimizationPanel,
  PartnerReadinessCard,
  PersonHeader,
  ProductCard,
  ProgressStatus,
  ReporterBlock,
  SmCalculatorCard,
  TaxLensBox,
  UpdateBanner,
} from "@ltr/ui";
import { SectionTitle, Specimen } from "./specimen";

// 견본 값 — 실존 인물·실제 계산기 주소를 쓰지 않는다 (계산기 주소는 운영에서 official_links 설정값)
const checked = (url: string, checkedAt = "2026-10-12") => ({ url, status: "ok" as const, checkedAt });
const SM_ACQUISITION = checked("https://sm-calculator.example.org/acquisition");
const SM_TRANSFER = checked("https://sm-calculator.example.org/transfer");
const WETAX = checked("https://www.wetax.go.kr/", "2026-10-10");
const NTS = checked("https://www.nts.go.kr/", "2026-10-10");
const EXPERTS = { findHref: "/experts?field=local-tax", requestHref: "/experts/request" };

// services 묶음 견본 — 기사 신뢰 블록 · 스토어 · 전문가 · AI 도우미 · 백오피스 (PRD-00 8.6)
export function ServicesSection() {
  return (
    <section>
      <SectionTitle>기사 신뢰·서비스·AI 도우미</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Specimen name="기자 소개 블록">
            <ReporterBlock
              kind="explainer"
              author={{ name: "홍길동", slug: "hong-gildong", beat: "지방세·부동산", bio: "취득세와 재산세 제도 변화를 취재합니다." }}
              editor={{ name: "이몽룡" }}
              taxReviewer={{ name: "성춘향 세무사" }}
              publishedAt="2026-10-17T00:30:00Z"
              modifiedAt="2026-10-18T05:00:00Z"
            />
          </Specimen>
        </div>
        <Specimen name="정정 이력 블록">
          <CorrectionHistory
            entries={[
              { id: "c1", kind: "correction", date: "2026-10-18", what: "신고 기한을 '30일'에서 '60일'로 고쳤습니다", why: "법령 조문을 다시 확인한 결과 잘못 적었습니다", compareHref: "#" },
              { id: "c2", kind: "rebuttal", date: "2026-10-20", what: "구청의 설명을 덧붙였습니다", why: "반론 요청을 받아 반영했습니다" },
            ]}
          />
        </Specimen>
        <Specimen name="갱신 배너">
          <UpdateBanner stage="국회 제출" changedAt="2026-10-15" trackerHref="#" />
        </Specimen>
        <Specimen name="해석 원문 블록">
          <InterpretationSource
            docType="유권해석"
            issuer="행정안전부"
            docNumber="지방세운영과-0000"
            decidedAt="2026-03-02"
            summary="생애최초 주택 감면은 취득일부터 실제 거주 여부를 함께 봅니다."
            sourceUrl="https://www.law.go.kr/"
            rightsConfirmed
          />
        </Specimen>
        <Specimen name="「지방세로 읽기」 박스">
          <TaxLensBox
            taxes={["취득세", "재산세"]}
            points={["관리처분계획인가 뒤 입주권은 주택 수에 들어갑니다.", "새로 지은 집은 원시취득 세율을 적용합니다.", "조합원 분담금도 취득 가격에 들어갑니다."]}
            links={{
              explainer: { href: "#", enabled: true },
              smCalculator: { href: SM_ACQUISITION.url, enabled: true },
              product: { href: "#", enabled: true },
              experts: { href: "/experts?field=local-tax", enabled: false },
            }}
            reviewer="성춘향 세무사"
            basisDate="2026-10-01"
          />
        </Specimen>
        <Specimen name="FAQ 블록">
          <FaqBlock
            items={[
              { id: "q1", question: "취득세는 언제까지 신고하나요?", answer: "잔금을 치른 날부터 60일 안에 신고합니다.", sources: [{ label: "지방세법 제20조", href: "https://www.law.go.kr/" }] },
              { id: "q2", question: "생애최초 감면은 따로 신청하나요?", answer: "네, 취득세 신고 때 감면 신청서를 함께 냅니다." },
            ]}
          />
        </Specimen>
        <Specimen name="핵심 요약 상자">
          <KeySummary lines={["잔금일부터 60일 안에 취득세를 신고합니다.", "생애최초 감면은 신고 때 함께 신청합니다.", "위택스에서 온라인으로 신고할 수 있습니다."]} />
        </Specimen>
        <Specimen name="상품 카드">
          <div className="space-y-4">
            <ProductCard
              name="지방세 실무"
              audience="지자체 세무 공무원·세무사"
              format="book"
              verifiedAt="2026-10-01"
              saleStatus="on_sale"
              detailHref="#"
              order={{ mode: "existing_channel", link: checked("https://books.example.org/local-tax-practice"), helpdeskHref: "#" }}
            />
            <ProductCard variant="own" name="지방세 편람" description="세목별 과세표준과 신고 기한을 한 권에 담았습니다" detailHref="#" approved saleStatus="on_sale" />
          </div>
        </Specimen>
        <Specimen name="외부 계산기 연결 카드">
          <ExternalCalculatorCard link={checked("https://inheritance-calculator.example.org/")} fallback={NTS} />
        </Specimen>
        <Specimen name="SM 계산기 카드">
          <div className="grid gap-4">
            <SmCalculatorCard calcKey="acquisition" link={SM_ACQUISITION} fallback={WETAX} usageNote="승인 회원만 이용할 수 있습니다 (확인 필요)" />
            <SmCalculatorCard calcKey="transfer" link={SM_TRANSFER} fallback={WETAX} usageNote="승인 회원만 이용할 수 있습니다 (확인 필요)" />
          </div>
        </Specimen>
        <Specimen name="전문가 카드">
          <ExpertCard
            name="성춘향"
            slug="seong-chunhyang"
            category="tax-accountant"
            fields={["지방세", "상속·증여"]}
            affiliation="춘향세무회계"
            region="서울"
            registrationNo="제00000호"
            checkedAt="2026-09-30"
            relations={["월간지방세연구 감수위원"]}
            interest="이 플랫폼의 기사를 감수하고 감수료를 받습니다"
            verification="verified"
          />
        </Specimen>
        <div className="sm:col-span-2">
          <Specimen name="인물 페이지 머리">
            <PersonHeader
              name="성춘향"
              roles={["reviewer", "expert"]}
              affiliation="춘향세무회계"
              checkedAt="2026-10-01"
              bio={[
                { id: "b1", text: "지방세 실무 강의", evidenceId: "ev-001" },
                { id: "b2", text: "증빙 없는 경력 항목은 보이지 않습니다", evidenceId: null },
              ]}
              books={[{ id: "k1", title: "지방세 편람", edition: "제2판", publisher: "선명출판", year: 2026, productHref: "#" }]}
            />
          </Specimen>
        </div>
        <Specimen name="AI 도우미 런처">
          <AssistantLauncher placement="inline" />
        </Specimen>
        <Specimen name="진행 상태">
          <ProgressStatus stage="writing" count={3} />
        </Specimen>
        <Specimen name="AI 도우미 패널">
          <AssistantPanel
            placement="inline"
            autoFocus={false}
            aiNotice="생성형 AI가 이 사이트의 자료를 찾아 쓴 안내입니다"
            firstUseNotice={[
              "AI가 이 사이트의 자료를 찾아 안내합니다.",
              "세무 자문이 아닙니다.",
              "대화는 국외(미국)의 AI 서비스에서 처리됩니다.",
              "대화는 30일 동안 보관한 뒤 지웁니다.",
              "개인정보와 계산 입력값은 넣지 마세요.",
            ]}
            suggestions={["취득세 신고 기한", "재산세 납부 시기"]}
            messages={[
              { id: "m1", kind: "question", text: "취득세는 언제까지 신고하나요?" },
              {
                id: "m2",
                kind: "answer",
                answer: { paragraphs: ["잔금을 치른 날부터 60일 안에 신고합니다."], citations: [{ title: "취득세 신고 기한 해설", href: "#" }] },
              },
            ]}
            experts={EXPERTS}
          />
        </Specimen>
        <Specimen name="답변 카드">
          <AnswerCard
            paragraphs={["재산세는 7월과 9월에 나눠 냅니다.", "주택분은 절반씩 두 번 고지됩니다."]}
            citations={[
              { title: "재산세 납부 시기 해설", href: "#" },
              { title: "위택스 재산세 안내", href: "https://www.wetax.go.kr/" },
            ]}
            experts={EXPERTS}
          />
        </Specimen>
        <Specimen name="최적화 점검 패널">
          <OptimizationPanel
            scores={{ seo: 86, aeo: 72, geo: 64, common: 90 }}
            checks={[
              { id: "title", label: "제목 길이", result: "pass" },
              { id: "faq", label: "FAQ 답과 본문 일치", result: "warn", detail: "2번 답이 본문보다 깁니다" },
              { id: "basis", label: "법령 기준일", result: "block", detail: "「지방세로 읽기」가 있는 기사는 기준일이 필요합니다" },
            ]}
          />
        </Specimen>
        <Specimen name="제휴 준비 지표 카드">
          <PartnerReadinessCard name="기획·탐사 실적" value="1건" monthsOfData={8} lowestThreeMonths="0건" zeroRisk rule={{ version: "2026.03", checkedAt: "2026-10-01" }} />
        </Specimen>
      </div>
    </section>
  );
}
