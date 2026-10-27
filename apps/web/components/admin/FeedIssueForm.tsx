"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 제휴 피드 키 발급 폼 (W13-i). 키 원문은 발급 응답에서 이 화면에 한 번만 보이고, 새로고침하면 사라진다(저장은 해시뿐).
export function FeedIssueForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [partner, setPartner] = useState("");
  const [contract, setContract] = useState("");
  const [scope, setScope] = useState("summary");
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<{ title: string; details: string[] } | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setKey(null);
    setErr(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/feeds", { op: "issue", partner_id: partner.trim(), contract_id: contract.trim(), scope });
    setPending(false);
    if (r.status === 201) {
      setKey(String((r.body as { created?: { key?: string } }).created?.key ?? ""));
      router.refresh();
    } else {
      setErr({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    }
  }
  return (
    <form noValidate onSubmit={onSubmit} aria-label="제휴 피드 키 발급" data-form="feed-issue" className="grid gap-4 sm:grid-cols-2">
      <TextField id="feed-partner" label="제휴사 번호" value={partner} onChange={(e) => setPartner(e.target.value)} required />
      <TextField id="feed-contract" label="데이터 라이선스 계약 번호 (계약이 있어야 발급)" value={contract} onChange={(e) => setContract(e.target.value)} required />
      <SelectField id="feed-scope" label="범위" options={[{ value: "summary", label: "요약 + 원문 링크" }, { value: "full", label: "전문 (계약 허용 + 권리 근거 필요)" }]} value={scope} onChange={(e) => setScope(e.target.value)} />
      <div className="space-y-3 sm:col-span-2">
        {key && (
          <StatusNote>
            <span data-feed-key>{key}</span> - 이 키는 지금 한 번만 보입니다. 안전한 곳에 옮겨 적으세요.
          </StatusNote>
        )}
        {err && <ErrorSummary id="feed-issue-error" title={err.title} messages={err.details} />}
        <DarkButton type="submit" disabled={!hydrated || pending}>
          키 발급
        </DarkButton>
      </div>
    </form>
  );
}
