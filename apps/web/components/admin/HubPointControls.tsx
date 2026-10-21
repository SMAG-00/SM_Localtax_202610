"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { HUB_POINT_MAX_LINES, lineCountError, splitPointLines, splitPointLinks, type HubPointSection, type HubPointState, type StoredHubPoint } from "@/lib/admin/hub-point-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 허브 "이 분야의 지방세 포인트" 한 분야 편집 (CORE-02 · W3 9단계) — 문구(한 줄에 하나, 3줄까지)·기준일·지방세 해설 링크("이름 | 주소" 한 줄에 하나).
// 4번째 줄은 화면에서 먼저 막고(서버로 보내지 않는다) 서버도 422로 막는다. 저장하면 감수 서명이 지워지고, 세무 감수위원이 다시 서명해야 공개된다.
// 문구는 사람이 쓴다(기본값 0).

export interface HubPointRowView {
  section: HubPointSection;
  name: string;
  state: HubPointState;
  point: StoredHubPoint | null;
}

export function HubPointForm({ row, canEdit, canReview }: { row: HubPointRowView; canEdit: boolean; canReview: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const id = `hp-${row.section}`;
  const [linesText, setLinesText] = useState((row.point?.lines ?? []).join("\n"));
  const [baseDate, setBaseDate] = useState(row.point?.base_date ?? "");
  const [linksText, setLinksText] = useState((row.point?.links ?? []).map((l) => `${l.label} | ${l.href}`).join("\n"));
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lineError = (() => {
    const e = lineCountError(splitPointLines(linesText));
    return e && splitPointLines(linesText).length > HUB_POINT_MAX_LINES ? e.replace(/^lines: /, "") : undefined;
  })();

  async function send(body: Record<string, unknown>, okText: string) {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/hub-points", body);
    if (r.status === 200) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    const lines = splitPointLines(linesText);
    const countError = lineCountError(lines);
    // 4번째 줄 — 보내지 않고 바로 알린다 (서버도 같은 문장으로 422)
    if (countError) {
      setDone(null);
      setError({ title: "입력값을 확인하세요", details: [countError] });
      return;
    }
    void send({ op: "draft", section: row.section, lines, baseDate, links: splitPointLinks(linksText) }, "초안을 저장했습니다. 세무 감수 서명 뒤에 공개됩니다.");
  };

  return (
    <form onSubmit={save} data-form="hub-point" data-section={row.section} data-state={row.state} className="space-y-3" aria-label={`${row.name} 지방세 포인트 편집`}>
      <TextAreaField
        id={`${id}-lines`}
        label={`포인트 문구 (한 줄에 하나, ${HUB_POINT_MAX_LINES}줄까지)`}
        rows={4}
        value={linesText}
        onChange={(e) => setLinesText(e.target.value)}
        error={lineError}
        disabled={!canEdit}
      />
      <TextField id={`${id}-date`} label="기준일 (YYYY-MM-DD)" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} disabled={!canEdit} />
      <TextAreaField
        id={`${id}-links`}
        label="지방세 해설 링크 (한 줄에 '이름 | 주소', 1~3개 — /tax… 또는 /news/…)"
        rows={3}
        value={linksText}
        onChange={(e) => setLinksText(e.target.value)}
        disabled={!canEdit}
      />
      {error && <ErrorSummary id={`${id}-error`} title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <DarkButton type="submit" disabled={!hydrated}>
            초안 저장
          </DarkButton>
        )}
        {canReview && row.state === "draft" && (
          <button type="button" disabled={!hydrated} data-action="review" className="rounded-lg border border-navy-200 px-4 py-2 text-[15px] font-bold" onClick={() => void send({ op: "review", section: row.section }, "세무 감수 서명을 기록했습니다. 바로 공개됩니다.")}>
            세무 감수 서명
          </button>
        )}
        {canEdit && row.state !== "none" && (
          <button type="button" disabled={!hydrated} data-action="clear" className="rounded-lg border border-navy-200 px-4 py-2 text-[15px] font-bold" onClick={() => void send({ op: "clear", section: row.section }, "지웠습니다. 블록이 숨습니다.")}>
            지우기
          </button>
        )}
      </div>
    </form>
  );
}
