"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

/** 기사 목록의 [삭제] — 확인을 한 번 받고 지운다. 공개 중 기사에는 그리지 않는다(서버도 거부) */
export function DeleteArticleButton({ id, title }: { id: number; title: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(`「${title}」 기사를 삭제할까요?\n삭제한 기사는 목록에서 '삭제됨'으로 남고 되돌릴 수 없습니다.`)) return;
    setPending(true);
    setError("");
    const r = await adminApi("DELETE", `/api/admin/articles/${id}`);
    setPending(false);
    if (r.status === 200) {
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <span>
      <button type="button" className={OUTLINE_BUTTON} onClick={remove} disabled={!hydrated || pending} aria-label={`${title} 삭제`}>
        {pending ? "삭제 중" : "삭제"}
      </button>
      {error && (
        <span role="alert" className="mt-1 block text-[13px] text-rose-800">
          {error}
        </span>
      )}
    </span>
  );
}
