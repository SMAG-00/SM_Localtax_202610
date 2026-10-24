import Link from "next/link";
import { brand } from "@ltr/ui";
import type { Viewer } from "@/lib/access";
import { ROLE_LABELS } from "@/lib/admin/labels";
import { LogoutButton } from "./LogoutButton";

/** 백오피스 머리 — SM 헤더 바탕(navy-800) · 워드마크 + '편집국' · 로그인한 사람의 이메일·역할 · 로그아웃. AI 도우미 런처 없음 (ADM-01) */
export function AdminHeader({ viewer }: { viewer: Viewer }) {
  return (
    <header className="bg-navy-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {/* 미리 받기 끔 — 편집국 화면은 매번 로그인·DB를 확인하는 요청 때 그리는 화면이라, 미리 받으면 서버 일만 늘고(화면마다 /admin 한 번 더) 얻는 것이 없다 */}
        <Link
          href="/admin"
          prefetch={false}
          className="mr-auto inline-flex min-h-11 items-center text-[17px] font-extrabold tracking-tight text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400"
        >
          {brand.productName} <span className="text-hermes-500">·</span> 편집국
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] text-navy-100">
          <span data-testid="viewer-email" className="[overflow-wrap:anywhere]">
            {viewer.email ?? "이메일 없음"}
          </span>
          <ul aria-label="내 역할" className="flex flex-wrap gap-1">
            {viewer.isAdmin && (
              <li>
                <span className="inline-flex items-center rounded-md border border-navy-500 px-2 py-0.5 text-[13px] font-bold text-white">관리자</span>
              </li>
            )}
            {viewer.roles.map((r) => (
              <li key={r}>
                <span className="inline-flex items-center rounded-md border border-navy-500 px-2 py-0.5 text-[13px] font-bold text-white">{ROLE_LABELS[r]}</span>
              </li>
            ))}
            {!viewer.isAdmin && viewer.roles.length === 0 && (
              <li>
                <span className="inline-flex items-center rounded-md border border-navy-500 px-2 py-0.5 text-[13px] font-bold text-white">역할 없음</span>
              </li>
            )}
          </ul>
          {/* 로그인한 상태의 비밀번호 바꾸기 (W2-e 4.2) — 메일 없이 현재 비밀번호만으로 */}
          <Link
            href="/account/password"
            prefetch={false}
            data-testid="password-link"
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-[14px] font-bold text-white underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400"
          >
            비밀번호 바꾸기
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
