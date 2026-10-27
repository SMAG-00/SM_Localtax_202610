import "server-only";
import { certKindLabel, certPlanPublicLine, isCertKind } from "@/lib/security/cert-plan";
import { SECURITY_ITEM_KEYS, findCertClaims, isSecurityItemKey, securityPageReady, type SecurityItemKey } from "@/lib/security/items";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 보안 정책 페이지 공개 데이터 (SEC-01 - docs/dev/W12-g_설계.md). 공개 뷰(public_security_items·public_security_status)만 읽는다.
// 뷰는 7개 항목 게시 + 자가 점검 1회 완료 + 기능 키가 모두 맞을 때만 행을 준다. 화면도 securityPageReady로 한 번 더 본다. 아니면 null -> 404. AI는 쓰지 않는다.
export interface SecurityPageView {
  items: Array<{ item_key: SecurityItemKey; body: string; confirmed_on: string }>;
  lastCheckOn: string | null;
  controls: number | null;
  /** 인증 추진 중 표기 (SEC-02, W13-j) - 기능 키 security_cert_plan 켜짐 + 승인된 계획이 있을 때만. 종류 이름과 승인일뿐이고 취득을 뜻하지 않는다 */
  certPlan: { label: string; approvedOn: string } | null;
}

export async function getSecurityPage(): Promise<SecurityPageView | null> {
  if (!(await readPublicSettings()).features.security_page) return null;
  const db = publicDb();
  const rows = await rowsOf<{ item_key: string; body: string; confirmed_on: string }>(db.from("public_security_items").select("item_key, body, confirmed_on"), "보안 정책 항목");
  const items = SECURITY_ITEM_KEYS.flatMap((k) => rows.filter((r) => r.item_key === k && isSecurityItemKey(r.item_key)).map((r) => ({ item_key: k, body: r.body, confirmed_on: r.confirmed_on })));
  if (!securityPageReady(items)) return null;
  const st = await rowsOf<{ completed_on: string; controls: number }>(db.from("public_security_status").select("completed_on, controls"), "보안 점검 요약");
  let certPlan: SecurityPageView["certPlan"] = null;
  if ((await readPublicSettings()).features.security_cert_plan) {
    const cp = await rowsOf<{ cert_kind: string; other_kind_name: string | null; approved_on: string }>(db.from("public_security_cert_status").select("cert_kind, other_kind_name, approved_on"), "인증 추진 계획");
    const row = cp[0];
    if (row && isCertKind(row.cert_kind)) {
      const label = certKindLabel(row.cert_kind, row.other_kind_name);
      // 이중 방어 - 이름이 비었거나 고정 문구까지 합친 글이 단정 표현 검사에 걸리면 표기하지 않는다
      if (label !== "" && findCertClaims(certPlanPublicLine(label, row.approved_on)).length === 0) certPlan = { label, approvedOn: row.approved_on };
    }
  }
  return { items, lastCheckOn: st[0]?.completed_on ?? null, controls: st[0] ? Number(st[0].controls) : null, certPlan };
}
