"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";

// 계산기 연결 백오피스 입력 두 개 - 기사별 도구 지정(GROW-02)과 위택스 이용 안내(WETAX-02). 값 검사는 서버(lib/calc/admin-helpers·tool-target).
const BOX = "min-h-11 w-full rounded-lg border border-navy-200 px-3 text-[15px]";

function useSend() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = async (body: Record<string, unknown>, okText: string) => {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/tool-targets", body);
    if (r.status === 200) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  };
  return { error, done, send };
}

export function ToolTargetForm({ articles }: { articles: { id: number; title: string }[] }) {
  const { error, done, send } = useSend();
  const [articleId, setArticleId] = useState(articles[0] ? String(articles[0].id) : "");
  const [tool, setTool] = useState("acquisition");
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ op: "set_target", articleId: Number(articleId), tool, prefillText: text }, "저장했습니다.");
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-form="tool-target">
      <label className="block text-[14px] font-bold">
        기사
        <select className={BOX} value={articleId} onChange={(e) => setArticleId(e.target.value)}>
          {articles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} · {a.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[14px] font-bold">
        이어 줄 도구
        <select className={BOX} value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="acquisition">취득세 계산기</option>
          <option value="holding">재산세·종합부동산세 계산기</option>
          <option value="refund">환급 자가진단</option>
        </select>
      </label>
      <label className="block text-[14px] font-bold">
        미리 채울 값 (줄마다 칸=값, 예: propertyKind=HOUSE)
        <textarea className={`${BOX} py-2`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex gap-3">
        <DarkButton type="submit">저장</DarkButton>
        <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => void send({ op: "clear_target", articleId: Number(articleId) }, "해제했습니다.")}>
          지정 해제
        </button>
      </div>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </form>
  );
}

export function GuideForm() {
  const { error, done, send } = useSend();
  const [v, setV] = useState({ key: "", label: "", body: "", source: "", confirmedOn: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ op: "upsert_guide", ...v }, "저장했습니다.");
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-form="wetax-guide">
      <label className="block text-[14px] font-bold">키 (영문 소문자)<input className={BOX} value={v.key} onChange={set("key")} /></label>
      <label className="block text-[14px] font-bold">제목<input className={BOX} value={v.label} onChange={set("label")} /></label>
      <label className="block text-[14px] font-bold">내용<textarea className={`${BOX} py-2`} rows={3} value={v.body} onChange={set("body")} /></label>
      <label className="block text-[14px] font-bold">출처 (없으면 공개되지 않음)<input className={BOX} value={v.source} onChange={set("source")} /></label>
      <label className="block text-[14px] font-bold">확인일 (YYYY-MM-DD, 없으면 공개되지 않음)<input className={BOX} value={v.confirmedOn} onChange={set("confirmedOn")} /></label>
      <div className="flex gap-3">
        <DarkButton type="submit">저장</DarkButton>
        <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => void send({ op: "delete_guide", key: v.key }, "삭제했습니다.")}>
          삭제
        </button>
      </div>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </form>
  );
}
