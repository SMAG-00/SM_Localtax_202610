// E2E 편집국 계정 도우미 — 로컬 Supabase Auth Admin API로 계정을 만들고(이메일 확인 완료), 인물(people)·서비스 역할(staff_roles)을 붙이고,
// 비밀번호 로그인(GoTrue REST)으로 access token을 받는다. 끝나면 만든 계정과 시험이 남긴 행을 지운다.
// 로컬 DB에서만 쓴다 — 추가만 되는 표(수정 이력·정정 이력·점검 이력·감사 로그)는 트리거를 끈 세션(session_replication_role)으로
// 이 시험이 만든 행만 지운다. 키·토큰은 로그에 찍지 않는다.
import crypto from "node:crypto";
import pg from "pg";

const PASSWORD_BYTES = 18;

function isLocalUrl(url) {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export class StaffFixture {
  /** @param {{ url: string, anonKey: string, serviceRoleKey: string, dbUrl: string }} sb */
  constructor(sb) {
    if (!isLocalUrl(sb.url) || !isLocalUrl(sb.dbUrl)) throw new Error("StaffFixture는 로컬 Supabase에서만 쓴다");
    this.sb = sb;
    this.db = new pg.Client({ connectionString: sb.dbUrl });
    this.userIds = new Set();
    this.personIds = new Set();
    this.articleIds = new Set();
    this.assignmentIds = new Set();
    this.run = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  }

  async connect() {
    await this.db.connect();
  }

  /** 이 실행만의 이메일 */
  email(label) {
    return `${label}-${this.run}@e2e.example.test`;
  }

  async #auth(path, { method = "POST", body, key = "anon" } = {}) {
    const apikey = key === "service" ? this.sb.serviceRoleKey : this.sb.anonKey;
    const headers = { apikey, "content-type": "application/json" };
    if (key === "service") headers.authorization = `Bearer ${this.sb.serviceRoleKey}`;
    const res = await fetch(`${this.sb.url}/auth/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: json };
  }

  /** 같은 이메일의 남은 계정(지난 실행이 중간에 멈춘 경우)을 지운다 */
  async removeLeftover(email) {
    const { rows } = await this.db.query("select id from auth.users where lower(email) = lower($1)", [email]);
    for (const { id } of rows) await this.#cleanUserRows([id]);
  }

  /**
   * 계정 만들기 — 이메일 확인 완료. roles = staff_roles, person = people 행(roles는 people 역할 값: reporter·editor·writer·reviewer·expert)
   * @returns {Promise<{ id: string, email: string, password: string, token: string, personId: number | null, roles: string[] }>}
   */
  async createUser({ label, email, roles = [], person = null, metadata = undefined }) {
    const address = email ?? this.email(label);
    const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
    const created = await this.#auth("/admin/users", {
      key: "service",
      body: { email: address, password, email_confirm: true, ...(metadata ? { user_metadata: metadata } : {}) },
    });
    if (created.status >= 300 || !created.body?.id) throw new Error(`계정 만들기 실패 (${created.status})`);
    const id = created.body.id;
    this.userIds.add(id);
    let personId = null;
    if (person) {
      const { rows } = await this.db.query(
        "insert into public.people (slug, name, roles, staff_user_id, visibility) values ($1, $2, $3, $4, 'public') returning id",
        [`e2e-${label}-${this.run}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"), person.name, person.roles, id],
      );
      personId = Number(rows[0].id); // pg는 bigint를 글자로 준다
      this.personIds.add(personId);
    }
    for (const role of roles) {
      await this.db.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'admin:e2e-setup')", [id, role]);
    }
    const token = await this.signIn(address, password);
    return { id, email: address, password, token, personId, roles };
  }

  async signIn(email, password) {
    const r = await this.#auth("/token?grant_type=password", { body: { email, password } });
    if (r.status !== 200 || !r.body?.access_token) throw new Error(`로그인 실패 (${r.status})`);
    return r.body.access_token;
  }

  /** 일반 가입(공개 키) — 가입 메타데이터를 마음대로 넣을 수 있는 경로 (ACC-04 위조 시험) */
  async signUp(email, password, data) {
    const r = await this.#auth("/signup", { body: { email, password, data } });
    if (r.status >= 300) throw new Error(`가입 실패 (${r.status})`);
    const id = r.body?.user?.id ?? r.body?.id;
    if (id) this.userIds.add(id);
    const token = r.body?.access_token ?? r.body?.session?.access_token ?? (await this.signIn(email, password));
    return { id, token };
  }

  trackArticle(id) {
    if (id) this.articleIds.add(Number(id));
  }

  trackAssignment(id) {
    if (id) this.assignmentIds.add(Number(id));
  }

  async #cleanUserRows(userIds) {
    if (userIds.length === 0) return;
    const actors = userIds.map((id) => `user:${id}`);
    const targets = userIds.map((id) => `staff_roles:${id}`);
    await this.#inReplica(async () => {
      await this.db.query("delete from public.audit_logs where actor = any($1::text[]) or target = any($2::text[])", [actors, targets]);
    });
    for (const id of userIds) {
      const r = await this.#auth(`/admin/users/${id}`, { method: "DELETE", key: "service" });
      if (r.status >= 300 && r.status !== 404) throw new Error(`계정 지우기 실패 (${r.status})`);
    }
  }

  async #inReplica(fn) {
    await this.db.query("begin");
    try {
      await this.db.query("set local session_replication_role = replica");
      await fn();
      await this.db.query("commit");
    } catch (err) {
      await this.db.query("rollback");
      throw err;
    }
  }

  /** 만든 계정·인물·기사·기획과 그 연결 기록, 이 시험의 감사 로그를 지운다 */
  async cleanup() {
    const userIds = [...this.userIds];
    const actors = userIds.map((id) => `user:${id}`);
    const personIds = [...this.personIds];
    // 시험 계정이 쓴 기사는 응답에서 못 받은 것까지 찾는다
    if (personIds.length) {
      const { rows } = await this.db.query("select id from public.articles where author_id = any($1::bigint[])", [personIds]);
      for (const r of rows) this.articleIds.add(Number(r.id));
    }
    const articleIds = [...this.articleIds];
    const assignmentIds = [...this.assignmentIds];
    await this.#inReplica(async () => {
      const q = (sql, params) => this.db.query(sql, params);
      if (articleIds.length) {
        const ids = [articleIds];
        const { rows: snaps } = await q("select snapshot_id from public.article_sources where article_id = any($1::bigint[]) and snapshot_id is not null", ids);
        await q("delete from public.article_corrections where article_id = any($1::bigint[])", ids);
        await q("delete from public.seo_checks where target_type = 'article' and target_id = any($1::text[])", [articleIds.map(String)]);
        await q("delete from public.editorial_reviews where article_id = any($1::bigint[])", ids);
        await q("delete from public.article_interviews where evidence_id in (select id from public.article_evidence where article_id = any($1::bigint[]))", ids);
        await q("delete from public.article_datasets where evidence_id in (select id from public.article_evidence where article_id = any($1::bigint[]))", ids);
        await q("delete from public.article_evidence where article_id = any($1::bigint[])", ids);
        await q("delete from public.article_sources where article_id = any($1::bigint[])", ids);
        if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps.map((s) => s.snapshot_id)]);
        await q("delete from public.article_revisions where article_id = any($1::bigint[])", ids);
        await q("delete from public.inquiries where related_article_id = any($1::bigint[])", ids);
        await q("delete from public.articles where id = any($1::bigint[])", ids);
      }
      if (assignmentIds.length) {
        await q("delete from public.story_assignment_events where assignment_id = any($1::bigint[])", [assignmentIds]);
        await q("delete from public.story_assignments where id = any($1::bigint[])", [assignmentIds]);
      }
      const targets = [
        ...articleIds.map((id) => `articles:${id}`),
        ...assignmentIds.map((id) => `story_assignments:${id}`),
        ...userIds.map((id) => `staff_roles:${id}`),
      ];
      await q("delete from public.audit_logs where actor = any($1::text[]) or target = any($2::text[])", [actors, targets]);
      if (personIds.length) await q("delete from public.people where id = any($1::bigint[])", [personIds]);
    });
    for (const id of userIds) {
      const r = await this.#auth(`/admin/users/${id}`, { method: "DELETE", key: "service" });
      if (r.status >= 300 && r.status !== 404) throw new Error(`계정 지우기 실패 (${r.status})`);
    }
    await this.db.end();
  }
}
