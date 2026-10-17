"use client";

import type { GroupStatus } from "@/lib/admin/editor-state";
import { ToneChip } from "../ui";

/** 정량형 필수 7묶음(NAV-10)·정성형 필수 기록(NAV-11) 안내 — 지금 화면의 입력으로 채움·빔을 보인다. 발행 판정은 점검 패널(서버)이 한다 */
export function MethodGuide({ title, groups, testId }: { title: string; groups: readonly GroupStatus[]; testId: string }) {
  const filled = groups.filter((g) => g.filled).length;
  return (
    <div data-testid={testId} className="space-y-2">
      <p className="text-[15px] font-bold text-navy-900">
        {title} — {filled}/{groups.length} 채움
      </p>
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-start gap-2 text-[15px] text-navy-800">
            <ToneChip tone={g.filled ? "emerald" : "amber"}>{g.filled ? "채움" : "빔"}</ToneChip>
            <span className="min-w-0">
              <span className="block font-bold">{g.name}</span>
              <span className="block text-[14px] text-navy-600">{g.where}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
