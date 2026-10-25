"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, HEADER_SHORTCUTS } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { CAMPAIGN_CHANNELS, CAMPAIGN_TARGETS, suggestDestinations } from "@/lib/campaigns/channels";
import { ErrorSummary, StatusNote } from "./fields";

// 캠페인 랜딩 백오피스 입력 (GROW-03·04) - 문구는 사람이 직접 쓴다(빈 칸으로 시작). 값 검사·문구 검사·승인 판정은 서버/DB.
const BOX = "min-h-11 w-full rounded-lg border border-navy-200 px-3 text-[15px]";
// 바로가기 이름 글자는 HEADER_SHORTCUTS 한 곳에만 있다 (HOME-14)
const TARGET_LABEL: Record<string, string> = Object.fromEntries(HEADER_SHORTCUTS.map((x) => [x.key, x.label]));
const CHANNEL_LABEL: Record<string, string> = { search: "검색 광고", sns: "SNS 광고", display: "디스플레이 광고", email: "이메일", other: "기타" };
const SCOPES = ["표시광고법", "세무사 광고 기준", "자본시장법"];

function useSend() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = async (body: Record<string, unknown>, okText: string) => {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/campaigns", body);
    if (r.status === 200) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  };
  return { error, done, send };
}

export function CampaignForm() {
  const { error, done, send } = useSend();
  const [f, setF] = useState({ campaignKey: "", title: "", body: "", channel: "search", primaryTarget: "calc", primaryTool: "", secondaryTarget: "", startsAt: "", endsAt: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const suggested = suggestDestinations(f.channel);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ op: "create", ...f, startsAt: f.startsAt ? `${f.startsAt}:00+09:00` : "", endsAt: f.endsAt ? `${f.endsAt}:00+09:00` : "" }, "초안으로 저장했습니다.");
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-form="campaign">
      <label className="block text-[14px] font-bold">
        캠페인 키 (주소 /go/키)
        <input className={BOX} value={f.campaignKey} onChange={set("campaignKey")} />
      </label>
      <label className="block text-[14px] font-bold">
        제목 (30자 이하)
        <input className={BOX} value={f.title} onChange={set("title")} />
      </label>
      <label className="block text-[14px] font-bold">
        본문 (120자 이하)
        <textarea className={`${BOX} py-2`} rows={3} value={f.body} onChange={set("body")} />
      </label>
      <label className="block text-[14px] font-bold">
        광고 채널
        <select className={BOX} value={f.channel} onChange={set("channel")}>
          {CAMPAIGN_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[13px] text-navy-600" data-part="suggest">
        이 채널에는 {suggested.map((t) => TARGET_LABEL[t]).join(" · ")}을(를) 권합니다. 제안일 뿐이며 직접 고르세요.
      </p>
      <label className="block text-[14px] font-bold">
        주 버튼 도착
        <select className={BOX} value={f.primaryTarget} onChange={set("primaryTarget")}>
          {CAMPAIGN_TARGETS.map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {f.primaryTarget === "calc" && (
        <label className="block text-[14px] font-bold">
          계산기 지정 (선택)
          <select className={BOX} value={f.primaryTool} onChange={set("primaryTool")}>
            <option value="">계산기 허브</option>
            <option value="acquisition">취득세</option>
            <option value="holding">재산세·종합부동산세</option>
            <option value="refund">환급 자가진단</option>
          </select>
        </label>
      )}
      <label className="block text-[14px] font-bold">
        보조 링크 (선택, 1개까지)
        <select className={BOX} value={f.secondaryTarget} onChange={set("secondaryTarget")}>
          <option value="">없음</option>
          {CAMPAIGN_TARGETS.filter((t) => t !== f.primaryTarget).map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[14px] font-bold">
          시작 (한국 시각)
          <input type="datetime-local" className={BOX} value={f.startsAt} onChange={set("startsAt")} />
        </label>
        <label className="block text-[14px] font-bold">
          끝 (한국 시각)
          <input type="datetime-local" className={BOX} value={f.endsAt} onChange={set("endsAt")} />
        </label>
      </div>
      <DarkButton type="submit">초안 저장</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </form>
  );
}

export function CampaignActions({ id, status, canApprove, canReview }: { id: number; status: string; canApprove: boolean; canReview: boolean }) {
  const { error, done, send } = useSend();
  const [r, setR] = useState({ reviewer: "", basisRef: "", result: "approved", note: "" });
  const [scope, setScope] = useState<string[]>([]);
  const review = (e: FormEvent) => {
    e.preventDefault();
    void send({ op: "review", id, scope, ...r }, "검토 기록을 붙였습니다.");
  };
  return (
    <div className="space-y-3" data-part="campaign-actions" data-campaign-id={id}>
      <div className="flex flex-wrap gap-3">
        {status === "draft" && (
          <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => void send({ op: "submit", id }, "제출했습니다.")}>
            제출
          </button>
        )}
        {status === "submitted" && canApprove && (
          <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => void send({ op: "approve", id }, "승인했습니다.")}>
            승인
          </button>
        )}
        {status !== "withdrawn" && canApprove && (
          <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => void send({ op: "withdraw", id }, "철회했습니다.")}>
            철회
          </button>
        )}
      </div>
      {canReview && status !== "withdrawn" && (
        <form onSubmit={review} className="space-y-2 rounded-lg border border-navy-100 p-3" data-form="ad-review">
          <p className="text-[14px] font-bold">광고 표시 규칙 검토 기록 (지금 문구 기준)</p>
          <input className={BOX} placeholder="검토자 이름" value={r.reviewer} onChange={(e) => setR({ ...r, reviewer: e.target.value })} />
          <input className={BOX} placeholder="검토 문서 위치" value={r.basisRef} onChange={(e) => setR({ ...r, basisRef: e.target.value })} />
          <div className="flex flex-wrap gap-3 text-[14px]">
            {SCOPES.map((s) => (
              <label key={s} className="inline-flex min-h-11 items-center gap-1">
                <input type="checkbox" checked={scope.includes(s)} onChange={(e) => setScope(e.target.checked ? [...scope, s] : scope.filter((x) => x !== s))} />
                {s}
              </label>
            ))}
          </div>
          <select className={BOX} value={r.result} onChange={(e) => setR({ ...r, result: e.target.value })}>
            <option value="approved">통과</option>
            <option value="rejected">통과 아님</option>
          </select>
          <input className={BOX} placeholder="메모 (선택)" value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} />
          <DarkButton type="submit">검토 기록 붙이기</DarkButton>
        </form>
      )}
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}
