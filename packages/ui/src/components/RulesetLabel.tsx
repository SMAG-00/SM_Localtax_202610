/** 룰셋 라벨 — 고정폭 "적용 룰셋 2026.10" (한글은 Pretendard로 떨어진다, 8.4). 어두운 바탕은 navy-300 */
export function RulesetLabel({ version, tone = "light" }: { version: string; tone?: "light" | "dark" }) {
  return (
    <p data-ui="ruleset-label" className={tone === "dark" ? "font-mono text-[13px] tracking-wide text-navy-300" : "font-mono text-[13px] tracking-wide text-navy-600"}>
      적용 룰셋 {version}
    </p>
  );
}
