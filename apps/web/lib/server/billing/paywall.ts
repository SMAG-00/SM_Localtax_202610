import "server-only";
import { getViewer } from "@/lib/server/dal";
import { HttpError } from "@/lib/server/http";
import { anonClient, adminClient } from "@/lib/server/supabase";
import type { PaywallPreview } from "./paywall-logic";
import { hasDigitalEntitlement, readPaidBody } from "./service";

// 페이월 읽기 (W10-f, BIZ-04) - 요청마다 그린다(공유 캐시·캐시 태그 0). 미리보기는 공개 뷰 public_paid_previews(본문 칸 없음),
// 본문은 권한 판정(has_entitlement)을 지난 서버 함수 read_paid_body로만 읽는다. 로그인 여부는 서버 쿠키 세션에서 정하고 클라이언트 값은 보지 않는다.

interface PreviewRow {
  kind: PaywallPreview["kind"];
  ref_key: string;
  article_id: number | null;
  article_slug: string | null;
  title: string | null;
  preview: string;
  first_published_at: string | null;
}

const toPreview = (r: PreviewRow): PaywallPreview => ({
  kind: r.kind,
  refKey: r.ref_key,
  articleId: r.article_id,
  slug: r.article_slug,
  title: r.title ?? "",
  preview: r.preview,
  firstPublishedAt: r.first_published_at,
});

/** 기사 주소로 유료 기사 미리보기 - 공개 뷰에 없으면(기능 키 꺼짐·판매 권리 미확인·발행 전) null */
export async function getPaywallPreview(slug: string): Promise<PaywallPreview | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db
    .from("public_paid_previews")
    .select("kind, ref_key, article_id, article_slug, title, preview, first_published_at")
    .eq("kind", "article")
    .eq("article_slug", slug)
    .limit(1);
  if (error) {
    console.error("[paywall] 미리보기 읽기 실패:", error.code);
    return null;
  }
  const row = ((data ?? []) as PreviewRow[])[0];
  return row ? toPreview(row) : null;
}

export interface PaywallState {
  preview: PaywallPreview;
  /** 로그인했고 권한이 있어 본문을 읽은 경우에만 값이 있다 */
  body: string | null;
  loggedIn: boolean;
}

export async function resolvePaywall(slug: string): Promise<PaywallState | null> {
  const preview = await getPaywallPreview(slug);
  if (!preview) return null;
  let userId: string | null = null;
  try {
    userId = (await getViewer())?.userId ?? null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err; // 세션을 확인하지 못하면 비로그인으로 본다 - 본문은 열지 않는다
  }
  const db = adminClient();
  if (!userId || !db) return { preview, body: null, loggedIn: userId !== null };
  const entitled = await hasDigitalEntitlement(db, userId);
  const body = entitled ? await readPaidBody(db, userId, preview.kind, preview.refKey) : null;
  return { preview, body, loggedIn: true };
}
