import type { Metadata } from "next";
import { componentRegistry, Eyebrow } from "@ltr/ui";
import { BaseSection } from "./sections/base";
import { ShellSection } from "./sections/shell";
import { DiscoverySection } from "./sections/discovery";
import { LocalSection } from "./sections/local";
import { ServicesSection } from "./sections/services";

// 디자인 견본 (DS-02) — PRD-00 8.6 단계 칸 1인 컴포넌트 70종을 모두 보인다. 검색 노출 없음
export const metadata: Metadata = { title: "디자인 견본", robots: { index: false, follow: false } };

export default function DesignPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-20">
      <Eyebrow>DESIGN SYSTEM</Eyebrow>
      <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900">디자인 견본</h1>
      <p className="mt-2 text-[15px] text-navy-600">
        1단계 컴포넌트 <span data-testid="registry-count">{componentRegistry.length}</span>종 / 목표 70종 (PRD-00 8.6)
      </p>
      <div className="mt-16 space-y-20">
        <BaseSection />
        <ShellSection />
        <DiscoverySection />
        <LocalSection />
        <ServicesSection />
      </div>
    </main>
  );
}
