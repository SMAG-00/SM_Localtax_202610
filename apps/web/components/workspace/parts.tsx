import Link from "next/link";
import type { Mode } from "@/lib/server/workspace/logic";

// 워크스페이스 공용 부품 (W13-b) - 자바스크립트 없이 동작하는 폼. 모드는 표현 밀도만 바꾸고 권한은 올리지 않는다 (WS-01).

export const cardCls = "rounded-2xl border border-navy-100 bg-white p-5";
export const inputCls = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
export const buttonCls = "min-h-11 rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400";
export const ghostCls = "min-h-11 rounded-xl border border-navy-200 px-4 text-[15px] font-bold text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400";

/** [일반·전문가] 모드 토글 - 헤더에는 리드가 끼운다. 지금은 워크스페이스 화면 머리에 둔다 */
export function ModeToggle({ mode }: { mode: Mode }) {
  return (
    <form method="post" action="/api/workspace/mode" className="inline-flex gap-2" data-testid="mode-toggle">
      {(["general", "expert"] as const).map((m) => (
        <button key={m} type="submit" name="mode" value={m} aria-pressed={mode === m} className={mode === m ? buttonCls : ghostCls}>
          {m === "general" ? "일반" : "전문가"}
        </button>
      ))}
    </form>
  );
}

const TABS = [
  ["/workspace", "대시보드"],
  ["/workspace/notes", "메모"],
  ["/workspace/scraps", "스크랩"],
  ["/workspace/searches", "저장 검색"],
] as const;

export function WorkspaceNav({ current }: { current: string }) {
  return (
    <nav aria-label="워크스페이스" className="mt-4 flex flex-wrap gap-2">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={current === href ? "page" : undefined} className={current === href ? buttonCls : ghostCls}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function ExportLinks({ target }: { target: "notes" | "scraps" | "saved_searches" }) {
  return (
    <p className="mt-4 flex flex-wrap gap-2 text-[15px]" data-testid="export-links">
      <a className={ghostCls + " inline-flex items-center"} href={`/api/workspace/export?target=${target}&format=docx`}>
        .docx로 내보내기
      </a>
      <a className={ghostCls + " inline-flex items-center"} href={`/api/workspace/export?target=${target}&format=csv`}>
        .csv로 내보내기
      </a>
    </p>
  );
}

export function PostButton({ action, id, label, ret }: { action: string; id: number; label: string; ret: string }) {
  return (
    <form method="post" action="/api/workspace/items" className="inline">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="return" value={ret} />
      <button type="submit" className={ghostCls}>
        {label}
      </button>
    </form>
  );
}

export const ERROR_TEXT: Record<string, string> = {
  invalid: "입력 값이 맞지 않습니다",
  limit: "저장 개수 한도에 닿았습니다",
  duplicate: "이미 있습니다",
  no_entitlement: "이용 권한이 있어야 새로 만들 수 있습니다",
  target_not_found: "찾을 수 없거나 공개되지 않은 자료입니다",
};

export function density(mode: Mode): string {
  return mode === "expert" ? "text-[14px] leading-snug" : "text-[16px] leading-normal";
}
