"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { moveInOrder } from "@/lib/admin/category-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

// 상황 카드 작업 단추 (UX-05) — 공개·내리기·허브에 넣기·빼기·허브 순서(편집 책임자), 세무 감수 서명(세무 감수위원).
// 화면이 먼저 막는 것: 감수 전 공개 단추 0, 허브가 찬 분야의 [허브에 넣기]는 꺼 두고 사유를 보인다. 서버(DB)가 거부하면 그 문장을 보인다.

export interface SituationRowState {
  id: number;
  title: string;
  section: string;
  visible: boolean;
  hubSlot: number | null;
  reviewed: boolean;
}

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  async function run(method: "POST" | "PATCH", path: string, body: unknown, ok: string) {
    setPending(true);
    setError(null);
    setDone("");
    const r = await adminApi(method, path, body);
    setPending(false);
    if (r.status === 200) {
      setDone(ok);
      router.refresh();
      return true;
    }
    setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    return false;
  }
  return { pending, error, done, run };
}

/** 한 상황의 공개·허브 단추 — 편집 책임자에게만 그린다 */
export function SituationPlacement({ item, hubIds, freeSlot, limit }: { item: SituationRowState; hubIds: readonly number[]; freeSlot: number | null; limit: number }) {
  const hydrated = useHydrated();
  const { pending, error, done, run } = useAction();
  const at = hubIds.indexOf(item.id);
  const disabled = pending || !hydrated;
  const label = item.title;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {item.visible ? (
          <button type="button" className={OUTLINE_BUTTON} disabled={disabled} onClick={() => void run("PATCH", `/api/admin/situations/${item.id}`, { visible: false }, `내렸습니다 — ${label}`)} aria-label={`${label} 내리기`}>
            내리기
          </button>
        ) : item.reviewed ? (
          <button type="button" className={OUTLINE_BUTTON} disabled={disabled} onClick={() => void run("PATCH", `/api/admin/situations/${item.id}`, { visible: true }, `공개했습니다 — ${label}`)} aria-label={`${label} 공개하기`}>
            공개하기
          </button>
        ) : (
          <span className="inline-flex min-h-11 items-center text-[14px] text-navy-600">감수 서명 뒤에 공개할 수 있습니다</span>
        )}
        {item.hubSlot === null ? (
          <button
            type="button"
            className={OUTLINE_BUTTON}
            disabled={disabled || freeSlot === null}
            onClick={() => freeSlot !== null && void run("PATCH", `/api/admin/situations/${item.id}`, { hubSlot: freeSlot }, `허브 ${freeSlot}번 자리에 넣었습니다 — ${label}`)}
            aria-label={`${label} 허브에 넣기`}
          >
            허브에 넣기
          </button>
        ) : (
          <>
            <button type="button" className={OUTLINE_BUTTON} disabled={disabled} onClick={() => void run("PATCH", `/api/admin/situations/${item.id}`, { hubSlot: null }, `허브에서 뺐습니다 — ${label}`)} aria-label={`${label} 허브에서 빼기`}>
              허브에서 빼기
            </button>
            <button
              type="button"
              className={OUTLINE_BUTTON}
              disabled={disabled || at <= 0}
              onClick={() => void run("POST", "/api/admin/situations/order", { section: item.section, ids: moveInOrder(hubIds, item.id, -1) }, `순서를 바꿨습니다 — ${label} 위로`)}
              aria-label={`${label} 위로`}
            >
              위로
            </button>
            <button
              type="button"
              className={OUTLINE_BUTTON}
              disabled={disabled || at === -1 || at === hubIds.length - 1}
              onClick={() => void run("POST", "/api/admin/situations/order", { section: item.section, ids: moveInOrder(hubIds, item.id, 1) }, `순서를 바꿨습니다 — ${label} 아래로`)}
              aria-label={`${label} 아래로`}
            >
              아래로
            </button>
          </>
        )}
      </div>
      {item.hubSlot === null && freeSlot === null && (
        <p data-testid={`hub-full-${item.id}`} className="text-[14px] font-bold text-amber-800">
          {`이 분야 허브에 상황 카드가 ${limit}장 있습니다 — ${limit + 1}번째는 넣을 수 없습니다. 다른 카드를 빼고 넣으세요.`}
        </p>
      )}
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}

/** 세무 감수 서명 — 감수위원이 읽은 판(updatedAt)을 함께 보낸다. 그 사이 바뀌었으면 서버가 409 */
export function SituationReviewButton({ id, updatedAt, reviewed }: { id: number; updatedAt: string; reviewed: boolean }) {
  const hydrated = useHydrated();
  const { pending, error, done, run } = useAction();
  return (
    <div className="space-y-2">
      <DarkButton type="button" disabled={pending || !hydrated} onClick={() => void run("POST", `/api/admin/situations/${id}/review`, { updatedAt }, "감수 서명을 남겼습니다")}>
        {pending ? "서명하는 중" : reviewed ? "이 판으로 다시 감수 서명" : "감수 서명"}
      </DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}
