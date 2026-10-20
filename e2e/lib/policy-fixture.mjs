// 가입이 열리려면 이용약관·개인정보처리방침 게시본이 있어야 한다(W2-e 설계 6.3) — 가입을 쓰는 시험은 가짜 게시본을 만들고 끝나면 지운다.
//  · 본문은 시험용 표시 문장 한 줄뿐이다(정책 문구 0 — 설계 12장 #1)
//  · 이미 게시본이 있는 문서는 건드리지 않는다(실제 게시본이나 다른 시험의 것)
//  · 게시본은 트리거가 지우지 못하게 막는다 — 이 시험이 만든 행(번호가 시작 때보다 크고 updated_by가 이 실행 표시)만 트리거를 끈 트랜잭션으로 지운다
//  · StaffFixture.cleanup()은 DB 연결을 닫으므로, 지우기는 그 앞에서 부른다

const FAKE_BODY = [{ heading: "시험", blocks: [{ type: "paragraph", text: "시험용 가짜 게시본 — 실제 문구가 아니다" }] }];

/** @param {import("pg").Client} db  @param {string} run 실행 표시(StaffFixture.run) @returns {Promise<() => Promise<void>>} 지우기 함수 */
export async function publishSignupPolicies(db, run) {
  const mark = Number((await db.query("select coalesce(max(id), 0) m from public.policy_versions")).rows[0].m);
  const by = `e2e-signup-policy-${run}`;
  for (const doc of ["terms", "privacy"]) {
    if ((await db.query("select 1 from public.policy_versions where doc_key = $1 and status = 'published'", [doc])).rowCount) continue;
    const v = Number((await db.query("select coalesce(max(version), 0) + 1 v from public.policy_versions where doc_key = $1", [doc])).rows[0].v);
    await db.query(
      `insert into public.policy_versions (doc_key, version, status, body, change_summary, effective_on, published_at, approved_by, approved_on, approval_note, updated_by)
       values ($1, $2, 'published', $3::jsonb, $4, current_date, now(), '시험 법률 검토자', current_date, '시험 승인 근거', $5)`,
      [doc, v, JSON.stringify(FAKE_BODY), v > 1 ? "시험 개정" : null, by],
    );
  }
  return async function removeSignupPolicies() {
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("delete from public.policy_versions where id > $1 and updated_by = $2", [mark, by]);
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };
}
