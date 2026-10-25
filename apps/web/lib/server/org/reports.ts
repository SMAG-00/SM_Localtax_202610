import "server-only";
import { getViewer } from "@/lib/server/dal";
import { HttpError, dbError } from "@/lib/server/http";
import { adminClient, anonClient } from "@/lib/server/supabase";

// 프리미엄 리포트 읽기 (W11-f, BIZ-07). 요청마다 그린다(공유 캐시·캐시 태그 0).
//  · 목록·미리보기는 공개 뷰 public_premium_report_previews(본문 칸 없음)에서만 읽는다.
//  · 본문은 DB 함수 read_premium_report 하나만 준다 - 안에서 리포트 권한 판정을 지난 요청에만. 개인 디지털 구독 권한으로는 null.
//  · 로그인 여부와 회원 번호는 서버 쿠키 세션에서 정한다(요청 본문·쿼리의 등급·좌석 값은 읽지 않는다).

export interface ReportPreview {
  slug: string;
  title: string;
  periodLabel: string;
  asOf: string;
  sources: Array<{ title: string; url?: string }>;
  taxReviewer: string;
  taxReviewedOn: string;
  publishedAt: string;
  preview: string;
}
interface Row {
  slug: string; title: string; period_label: string; as_of: string; sources: unknown; tax_reviewer: string; tax_reviewed_on: string; published_at: string; preview: string;
}
const COLUMNS = "slug, title, period_label, as_of, sources, tax_reviewer, tax_reviewed_on, published_at, preview";

function toPreview(r: Row): ReportPreview {
  const sources = Array.isArray(r.sources) ? (r.sources as unknown[]).flatMap((s) => (s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string" ? [{ title: (s as { title: string }).title, url: typeof (s as { url?: unknown }).url === "string" ? (s as { url: string }).url : undefined }] : [])) : [];
  return { slug: r.slug, title: r.title, periodLabel: r.period_label, asOf: r.as_of, sources, taxReviewer: r.tax_reviewer, taxReviewedOn: r.tax_reviewed_on, publishedAt: r.published_at, preview: r.preview };
}

/** 목록 - 공개 뷰가 비어 있으면(기능 키 꺼짐·정책 길이 없음·발행 없음) 빈 배열, 설정이 없으면 null */
export async function listReportPreviews(): Promise<ReportPreview[] | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db.from("public_premium_report_previews").select(COLUMNS).order("published_at", { ascending: false }).limit(100);
  if (error) {
    console.error("[reports] 목록 읽기 실패:", error.code);
    return null;
  }
  return ((data ?? []) as Row[]).map(toPreview);
}

export async function getReportPreview(slug: string): Promise<ReportPreview | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db.from("public_premium_report_previews").select(COLUMNS).eq("slug", slug).limit(1);
  if (error) {
    console.error("[reports] 미리보기 읽기 실패:", error.code);
    return null;
  }
  const row = ((data ?? []) as Row[])[0];
  return row ? toPreview(row) : null;
}

export interface ReportState {
  preview: ReportPreview;
  /** 리포트 권한(기관 좌석)이 있어 본문을 읽은 경우에만 값이 있다 */
  body: string | null;
  loggedIn: boolean;
}

export async function resolveReport(slug: string): Promise<ReportState | null> {
  const preview = await getReportPreview(slug);
  if (!preview) return null;
  let userId: string | null = null;
  try {
    userId = (await getViewer())?.userId ?? null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err; // 세션을 확인하지 못하면 비로그인으로 본다 - 본문은 열지 않는다
  }
  const db = adminClient();
  if (!userId || !db) return { preview, body: null, loggedIn: userId !== null };
  const { data, error } = await db.rpc("read_premium_report", { p_user: userId, p_slug: slug });
  if (error) throw dbError(error, "read_premium_report");
  return { preview, body: typeof data === "string" ? data : null, loggedIn: true };
}
