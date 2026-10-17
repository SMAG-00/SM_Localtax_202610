import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cronSecret } from "./env";

/**
 * /api/jobs/* 호출 인증 (FND-07) — `Authorization: Bearer <CRON_SECRET>`.
 * 서버에 CRON_SECRET이 없으면 어떤 요청도 통과시키지 않는다 (닫힌 쪽으로 실패).
 */
export function isAuthorizedCron(authorization: string | null): boolean {
  const secret = cronSecret();
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type JobTrigger = "vercel-cron" | "scheduler" | "manual";

/** Vercel Cron은 user-agent `vercel-cron/…`로 부르고, 사내 스케줄러는 `x-job-trigger: scheduler`를 붙인다 */
export function jobTrigger(headers: Headers): JobTrigger {
  if (headers.get("user-agent")?.startsWith("vercel-cron/")) return "vercel-cron";
  if (headers.get("x-job-trigger") === "scheduler") return "scheduler";
  return "manual";
}
