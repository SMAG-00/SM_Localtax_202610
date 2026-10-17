"use client";

import { useRouter } from "next/navigation";
import { CheckPanel } from "./CheckPanel";

/** 서버 화면(검토·발행)에 놓는 점검 패널 — 발행 뒤 화면을 다시 그린다 */
export function CheckPanelLive(props: { articleId: number; status: string; canPublishRole: boolean; blockTypes: readonly string[]; refreshKey: string }) {
  const router = useRouter();
  return <CheckPanel {...props} onChanged={() => router.refresh()} />;
}
