"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary } from "./fields";
import { OUTLINE_BUTTON, TEXT_LINK } from "./ui";

// [이번 주 카드뉴스 초안 만들기] (기사 목록) — 지난 7일 많이 본 기사 3건(조회 기록이 없으면 최신 3건)으로 카드뉴스 5장 초안을 만든다.
// 고르기·만들기는 서버가 하고(POST /api/admin/articles/weekly-cardnews), 화면은 고른 방식·고른 기사·초안 링크만 보여 준다.

interface Created {
  article: { id: number; title: string };
  note: string;
  range: string;
  mode: "views" | "latest";
  picked: { id: number; title: string; views: number }[];
}

type Problem = { title: string; details: string[] } | null;

export function WeeklyCardNewsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<Problem>(null);

  async function make() {
    setBusy(true);
    setError(null);
    const r = await adminApi("POST", "/api/admin/articles/weekly-cardnews", {});
    setBusy(false);
    if (r.status === 201) {
      setCreated(r.body as unknown as Created);
      router.refresh();
    } else {
      setCreated(null);
      setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    }
  }

  return (
    <div className="w-full sm:w-auto sm:max-w-xl" data-testid="weekly-cardnews">
      <button type="button" className={OUTLINE_BUTTON} onClick={() => void make()} disabled={busy} data-testid="weekly-cardnews-make">
        {busy ? "만드는 중입니다…" : "이번 주 카드뉴스 초안 만들기"}
      </button>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {created && (
        <div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[15px] text-navy-900" data-testid="weekly-cardnews-result" data-mode={created.mode}>
          <p className="font-bold">카드뉴스 초안을 만들었습니다 ({created.range}).</p>
          <p className="mt-1">{created.note}.</p>
          <ol className="mt-2 list-decimal pl-5">
            {created.picked.map((a) => (
              <li key={a.id}>
                {a.title}
                {created.mode === "views" && <span className="font-mono text-[13px] text-navy-600"> · 조회 {a.views}</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2">
            장 글자는 기사 제목·요약·주소만 옮겼습니다. 점검 결과를 보고 고친 뒤 검토를 요청하세요.{" "}
            <Link href={`/admin/articles/${created.article.id}`} className={TEXT_LINK}>
              초안 열기
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
