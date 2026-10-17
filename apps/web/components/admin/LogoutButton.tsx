"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SecondaryButton } from "@ltr/ui";
import { adminApi } from "@/lib/admin/api-client";
import { useHydrated } from "./useHydrated";

/** 로그아웃 — 세션을 끝내고 로그인 화면으로 (어두운 바탕 위 보조 버튼) */
export function LogoutButton() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    await adminApi("POST", "/api/auth/logout");
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <SecondaryButton onClick={logout} disabled={pending || !hydrated} className="px-4 py-2 text-[14px]">
      {pending ? "로그아웃 중" : "로그아웃"}
    </SecondaryButton>
  );
}
