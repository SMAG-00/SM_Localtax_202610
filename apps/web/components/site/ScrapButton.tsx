"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// [스크랩] 버튼 (W13-c) - 기존 워크스페이스 API(/api/workspace/items, scrap_add)로 보낸다. 대상 종류·번호·제목만 보내고 원문 버전은 서버가 정한다.
// 기능 키·로그인·권한 판정은 서버가 한다 (응답 코드만 안내로 바꾼다).
const MESSAGES: Record<string, string> = {
  no_entitlement: "스크랩은 워크스페이스 이용 권한이 있어야 합니다",
  duplicate: "이미 스크랩했습니다",
  limit: "저장 개수 한도에 닿았습니다",
  target_not_found: "찾을 수 없거나 공개되지 않은 자료입니다",
  invalid: "스크랩할 수 없는 자료입니다",
};

export function ScrapButton({ targetKind, targetId, label }: { targetKind: "law_article" | "legal_doc"; targetId: number; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "done" | "error"; text: string }>({ kind: "idle", text: "" });
  async function submit() {
    try {
      const res = await fetch("/api/workspace/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "scrap_add", targetKind, targetId: String(targetId), label }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      setState(j.ok ? { kind: "done", text: "스크랩했습니다" } : { kind: "error", text: MESSAGES[j.code ?? ""] ?? "스크랩하지 못했습니다" });
    } catch {
      setState({ kind: "error", text: "스크랩하지 못했습니다. 잠시 뒤 다시 시도하세요" });
    }
  }
  return (
    <span data-part="scrap" className="inline-flex items-center gap-2">
      <button type="button" onClick={submit} className="rounded-lg border border-navy-300 bg-white px-3 py-1.5 text-[14px] font-bold text-navy-900">
        스크랩
      </button>
      <span role="status" aria-live="polite" className="text-[13px] text-navy-700">
        {state.text}
      </span>
    </span>
  );
}
