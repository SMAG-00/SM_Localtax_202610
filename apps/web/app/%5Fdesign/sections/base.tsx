import { Callout, Chip, DarkButton, Eyebrow, LinkCard, LockBadge, PrimaryButton, RulesetLabel, SecondaryButton, StatusBox, Tabs, ToolCard } from "@ltr/ui";
import { SectionTitle, Specimen } from "./specimen";

export function BaseSection() {
  return (
    <section>
      <SectionTitle>기본 (SM에서 그대로)</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Specimen name="주 버튼">
          <PrimaryButton>검색하기</PrimaryButton>
        </Specimen>
        <Specimen name="보조 버튼 (어두운 바탕)" dark>
          <SecondaryButton>전체 기사 보기</SecondaryButton>
        </Specimen>
        <Specimen name="어두운 버튼">
          <DarkButton>환급금 조회하러 가기</DarkButton>
        </Specimen>
        <Specimen name="링크 카드">
          <LinkCard href="#">
            <span className="text-[19px] font-black text-navy-900">차를 팔았어요</span>
          </LinkCard>
        </Specimen>
        <Specimen name="도구 카드">
          <ToolCard href="#">
            <span className="text-[19px] font-black text-navy-900">취득세</span>
          </ToolCard>
        </Specimen>
        <Specimen name="아이브로">
          <Eyebrow>LOCAL TAX LENS</Eyebrow>
        </Specimen>
        <Specimen name="칩">
          <Chip>지방세법 제11조</Chip>
        </Specimen>
        <Specimen name="강조 문단">
          <Callout>잔금을 치른 날부터 60일 안에 신고합니다.</Callout>
        </Specimen>
        <Specimen name="탭">
          <Tabs
            label="예시 탭"
            items={[
              { id: "a", label: "전체", panel: <p className="text-[15px]">전체 목록</p> },
              { id: "b", label: "지방세", panel: <p className="text-[15px]">지방세 목록</p> },
            ]}
          />
        </Specimen>
        <Specimen name="상태 상자">
          <StatusBox kind="tip" title="절세 체크포인트">
            생애최초 주택 감면 요건을 확인하세요.
          </StatusBox>
        </Specimen>
        <Specimen name="잠금 배지">
          <LockBadge>구독 전용</LockBadge>
        </Specimen>
        <Specimen name="룰셋 라벨">
          <RulesetLabel version="2026.10" />
        </Specimen>
      </div>
    </section>
  );
}
