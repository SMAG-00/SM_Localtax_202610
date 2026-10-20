import "server-only";
import { readPolicyBody, type PolicyDocKey, type PolicySection } from "@/lib/policy/docs";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";
import type { Features } from "./constants";

// 정책 페이지 읽기 (W2-e 6.1) — 공개 뷰 public_policy_versions(게시본·이전 판)만 읽는다. 승인 기록·고친 사람 칸은 뷰에 없다.
export interface PolicyHistoryEntry {
  version: number;
  status: "published" | "superseded";
  publishedAt: string | null;
  effectiveOn: string | null;
  changeSummary: string | null;
}
export interface PolicyView {
  docKey: PolicyDocKey;
  version: number;
  current: boolean;
  body: PolicySection[];
  publishedAt: string | null;
  effectiveOn: string | null;
  history: PolicyHistoryEntry[];
  features: Features;
}

interface Row {
  version: number;
  status: "published" | "superseded";
  body: unknown;
  change_summary: string | null;
  effective_on: string | null;
  published_at: string | null;
}

/** 게시본(또는 ?v= 이전 판)을 읽는다. 기능 키가 닫혔거나 게시본이 없거나 없는 버전이면 null → 404 */
export async function getPolicyView(docKey: PolicyDocKey, feature: keyof Features, version: number | null): Promise<PolicyView | null> {
  const settings = await readPublicSettings();
  if (!settings.features[feature]) return null;
  const rows = await rowsOf<Row>(
    publicDb().from("public_policy_versions").select("version, status, body, change_summary, effective_on, published_at").eq("doc_key", docKey).order("version", { ascending: false }),
    "정책 문서",
  );
  const published = rows.find((r) => r.status === "published");
  if (!published) return null;
  const chosen = version === null ? published : rows.find((r) => r.version === version);
  if (!chosen) return null;
  return {
    docKey,
    version: chosen.version,
    current: chosen.version === published.version,
    body: readPolicyBody(chosen.body),
    publishedAt: chosen.published_at,
    effectiveOn: chosen.effective_on,
    history: rows.map((r) => ({ version: r.version, status: r.status, publishedAt: r.published_at, effectiveOn: r.effective_on, changeSummary: r.change_summary })),
    features: settings.features,
  };
}
