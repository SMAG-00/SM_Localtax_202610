"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ARTICLE_TYPES,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  DERIVATIVES,
  READERS,
  SECTIONS,
  attachmentName,
  type Derivative,
} from "@/lib/editorial/request-input";

// 편집위원 데스크 새 요청 양식 (PO 2026-11-18) — 지침 v4 2장 접수 인터뷰 ①~⑫. 비운 칸은 지침 기본값으로 진행한다.
// 순서: 요청 만들기(작성 중) → 첨부 하나씩 올리기 → 제출(대기열). 첨부가 하나라도 실패하면 제출하지 않고 요청을 취소한다.
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const area = "mt-1 block w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";
const hint = "mt-1 text-[13px] text-navy-500";

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; body: { error?: string; errors?: string[]; request?: { id: string } } }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: "서버 응답을 읽지 못했습니다" }));
  return { ok: res.ok, body };
}

export function RequestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  function pickFiles(list: FileList | null) {
    const next = [...files, ...Array.from(list ?? [])];
    const problems: string[] = [];
    if (next.length > ATTACHMENT_MAX_COUNT) problems.push(`첨부는 ${ATTACHMENT_MAX_COUNT}개까지입니다`);
    for (const f of next) {
      const n = attachmentName(f.name);
      if (!n.ok) problems.push(`${f.name}: ${n.error}`);
      else if (f.size > ATTACHMENT_MAX_BYTES) problems.push(`${f.name}: 한 파일 4MB까지입니다 — 큰 자료는 링크로 적어 주세요`);
    }
    setErrors(problems);
    if (problems.length === 0) setFiles(next);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "");
    const payload = {
      topic: text("topic"),
      articleType: text("articleType"),
      links: text("links"),
      sourceNote: text("sourceNote"),
      section: text("section"),
      message: text("message"),
      reader: text("reader"),
      byline: text("byline"),
      comments: text("comments"),
      length: text("length"),
      baseDate: text("baseDate"),
      summaryTable: fd.get("summaryTable") === "on",
      imagesApproved: fd.get("imagesApproved") === "on",
      derivatives: (Object.keys(DERIVATIVES) as Derivative[]).filter((d) => fd.get(`d_${d}`) === "on"),
      memo: text("memo"),
    };
    setErrors([]);
    setBusy("요청을 만드는 중");
    const created = await call("/api/editorial/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!created.ok || !created.body.request) {
      setBusy(null);
      setErrors(created.body.errors ?? [created.body.error ?? "요청을 만들지 못했습니다"]);
      return;
    }
    const id = created.body.request.id;
    for (const [i, f] of files.entries()) {
      setBusy(`첨부 올리는 중 (${i + 1}/${files.length})`);
      const body = new FormData();
      body.append("file", f);
      const up = await call(`/api/editorial/requests/${id}/attachments`, { method: "POST", body });
      if (!up.ok) {
        await call(`/api/editorial/requests/${id}/cancel`, { method: "POST" });
        setBusy(null);
        setErrors([`${f.name}: ${up.body.error ?? "첨부를 올리지 못했습니다"} — 요청은 취소했습니다. 고쳐서 다시 요청해 주세요`]);
        return;
      }
    }
    setBusy("제출하는 중");
    const sent = await call(`/api/editorial/requests/${id}/submit`, { method: "POST" });
    setBusy(null);
    if (!sent.ok) {
      setErrors([sent.body.error ?? "제출하지 못했습니다"]);
      return;
    }
    router.push("/editorial?tab=requests&submitted=1");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-5" aria-describedby="form-errors">
      <div>
        <label htmlFor="d-topic" className={label}>주제 (필수)</label>
        <input id="d-topic" name="topic" required maxLength={200} className={input} placeholder="예: 조정대상지역 일시적 2주택 처분기한 단축" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="d-type" className={label}>① 기사 유형</label>
          <select id="d-type" name="articleType" className={input} defaultValue="auto">
            {Object.entries(ARTICLE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="d-section" className={label}>③ 게재 섹션</label>
          <select id="d-section" name="section" className={input} defaultValue="자동">
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{s === "자동" ? "소재에 맞춰 제안" : s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="d-reader" className={label}>⑤ 주 독자</label>
          <select id="d-reader" name="reader" className={input} defaultValue={READERS[0]}>
            {READERS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="d-links" className={label}>② 소재 링크</label>
        <textarea id="d-links" name="links" rows={3} className={area} placeholder={"https://www.mois.go.kr/…\nhttps://www.law.go.kr/…"} />
        <p className={hint}>뉴스·보도자료·법령·통계 주소를 한 줄에 하나씩 (https만, 20개까지). 첨부와 링크가 1차 자료입니다.</p>
      </div>
      <div>
        <label htmlFor="d-files" className={label}>② 첨부 자료</label>
        <input id="d-files" type="file" multiple accept={ATTACHMENT_EXTENSIONS.map((x) => `.${x}`).join(",")} className={input} onChange={(e) => pickFiles(e.currentTarget.files)} />
        <p className={hint}>파일당 4MB, {ATTACHMENT_MAX_COUNT}개까지 ({ATTACHMENT_EXTENSIONS.join("·")}). 큰 자료는 링크로 적어 주세요.</p>
        {files.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="picked-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-xl border border-navy-200 py-1 pr-1 pl-3 text-[14px] text-navy-900">
                {f.name}
                <button type="button" className="min-h-9 rounded-lg px-2 text-navy-600 underline" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`${f.name} 빼기`}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor="d-note" className={label}>소재 설명·붙여 넣을 자료 글</label>
        <textarea id="d-note" name="sourceNote" rows={4} maxLength={4000} className={area} />
      </div>
      <div>
        <label htmlFor="d-message" className={label}>④ 관점과 핵심 메시지</label>
        <input id="d-message" name="message" maxLength={600} className={input} placeholder="비우면 취재 뒤 제안합니다" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="d-byline" className={label}>⑥ 필자 정보</label>
          <input id="d-byline" name="byline" maxLength={300} className={input} placeholder="비우면 [기자명] 자리 표시" />
        </div>
        <div>
          <label htmlFor="d-length" className={label}>⑧ 분량</label>
          <input id="d-length" name="length" maxLength={100} className={input} placeholder="비우면 유형별 기본값" />
        </div>
        <div>
          <label htmlFor="d-date" className={label}>⑧ 기준일</label>
          <input id="d-date" name="baseDate" type="date" className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="d-comments" className={label}>⑦ 확보된 코멘트</label>
        <textarea id="d-comments" name="comments" rows={3} maxLength={4000} className={area} placeholder="실제로 받은 발언만 — 비우면 공개 출처에서 확인된 발언만 씁니다" />
      </div>
      <fieldset className="rounded-xl border border-navy-100 p-4">
        <legend className="px-1 text-[15px] font-bold text-navy-900">⑨·⑩·⑫ 부속물·이미지·SNS 파생물</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-navy-900">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="checkbox" name="summaryTable" defaultChecked /> 요약표
          </label>
          {(Object.entries(DERIVATIVES) as [Derivative, string][]).map(([k, v]) => (
            <label key={k} className="inline-flex min-h-11 items-center gap-2">
              <input type="checkbox" name={`d_${k}`} defaultChecked /> {v}
            </label>
          ))}
        </div>
        <label className="mt-2 flex min-h-11 items-start gap-2 text-[15px] text-navy-900">
          <input type="checkbox" name="imagesApproved" className="mt-1" />
          <span>
            AI 이미지 생성 승인 (썸네일 1장 + 본문 2장, OpenAI 요금 발생)
            <span className="block text-[13px] text-navy-500">체크하지 않으면 이미지 계획만 남기고 만들지 않습니다. 카드뉴스는 표지·글자 카드로 만듭니다.</span>
          </span>
        </label>
      </fieldset>
      <div>
        <label htmlFor="d-memo" className={label}>그 밖에 전할 말</label>
        <textarea id="d-memo" name="memo" rows={2} maxLength={4000} className={area} />
      </div>
      <div id="form-errors" aria-live="polite">
        {errors.length > 0 && (
          <ul role="alert" data-testid="desk-form-errors" className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" disabled={busy !== null} className="min-h-11 rounded-xl bg-navy-900 px-6 text-[16px] font-bold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
        {busy ?? "제작 요청"}
      </button>
    </form>
  );
}
