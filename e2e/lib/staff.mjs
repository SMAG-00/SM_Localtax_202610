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
    /** 시험이 만든 운영 행 — 분야·제휴사·용어 (기사를 지운 뒤 지운다) · 홈 배치·개정 트래커 (W2-b — 기사보다 먼저 지운다) */
    this.extraRows = { categories: new Set(), partners: new Set(), glossary_terms: new Set(), home_curations: new Set(), amendments: new Set(), situations: new Set(), media: new Set(), search_synonyms: new Set() };
    /** 시험 전 운영 설정·분야 행 — 끝나면 그대로 되돌린다 (씨앗 데이터 시험이 값을 대조한다) */
    this.settingsSnapshot = null;
    this.categoriesSnapshot = null;
    this.run = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    /** 이 시험이 시작한 시각 — 공개 화면을 브라우저로 열면 측정 이벤트(W2-c analytics_events)가 생긴다. 정리 단계가 이 뒤의 측정 행을 지운다 (로컬 DB) */
    this.startedAt = new Date();
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

  /** 시험이 만든 분야(categories)·제휴사(partners)·용어(glossary_terms)·홈 배치(home_curations)·개정 트래커(amendments)·상황(situations)·이미지(media)·검색 동의어(search_synonyms — W2-d) 행 */
  trackRow(table, id) {
    if (!this.extraRows[table]) throw new Error(`지울 수 없는 표: ${table}`);
    if (id) this.extraRows[table].add(Number(id));
  }

  /** 운영 설정·분야를 시험 전 모습으로 기억한다 — cleanup이 되돌린다 */
  async snapshotOperations() {
    this.settingsSnapshot = (await this.db.query("select key, value, updated_by from public.settings")).rows;
    this.categoriesSnapshot = (
      await this.db.query("select id, slug, name, intro, sort, visible, needs_disclaimer, needs_tax_lens from public.categories")
    ).rows;
  }

  async #restoreOperations(q) {
    for (const table of ["glossary_terms", "partners", "categories"]) {
      const ids = [...this.extraRows[table]];
      if (ids.length) await q(`delete from public.${table} where id = any($1::bigint[])`, [ids]);
    }
    if (this.settingsSnapshot) {
      for (const r of this.settingsSnapshot) {
        await q(
          "update public.settings set value = $2::jsonb, updated_by = $3 where key = $1 and (value is distinct from $2::jsonb or updated_by is distinct from $3)",
          [r.key, JSON.stringify(r.value), r.updated_by],
        );
      }
    }
    if (this.categoriesSnapshot) {
      for (const c of this.categoriesSnapshot) {
        await q(
          "update public.categories set slug = $2, name = $3, intro = $4, sort = $5, visible = $6, needs_disclaimer = $7, needs_tax_lens = $8 where id = $1",
          [c.id, c.slug, c.name, c.intro, c.sort, c.visible, c.needs_disclaimer, c.needs_tax_lens],
        );
      }
    }
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
      // 홈 배치 → 개정 트래커(단계 기록·스냅샷) — 트리거를 끈 세션이라 외래 키 cascade가 돌지 않으니 직접 지운다
      // 상황 카드(W2-b) — 시험이 넣은 행과 시험 계정이 API로 만든 행 (감수자 인물보다 먼저)
      await q("delete from public.situations where id = any($1::bigint[]) or updated_by = any($2::text[])", [[...this.extraRows.situations], actors]);
      // 검색 동의어(W2-d) — 시험이 넣은 줄과 시험 계정이 사전 화면·API로 만든 줄
      await q("delete from public.search_synonyms where id = any($1::bigint[]) or updated_by = any($2::text[])", [[...this.extraRows.search_synonyms], actors]);
      const curationIds = [...this.extraRows.home_curations];
      const amendmentIds = [...this.extraRows.amendments];
      await q("delete from public.home_curations where id = any($1::bigint[]) or article_id = any($2::bigint[]) or amendment_id = any($3::bigint[])", [
        curationIds,
        articleIds,
        amendmentIds,
      ]);
      if (amendmentIds.length) {
        const { rows: amSnaps } = await q("select snapshot_id from public.amendment_events where amendment_id = any($1::bigint[]) and snapshot_id is not null", [amendmentIds]);
        await q("delete from public.amendment_events where amendment_id = any($1::bigint[])", [amendmentIds]);
        await q("update public.articles set amendment_id = null where amendment_id = any($1::bigint[])", [amendmentIds]);
        await q("delete from public.amendments where id = any($1::bigint[])", [amendmentIds]);
        if (amSnaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [amSnaps.map((s) => s.snapshot_id)]);
      }
      if (articleIds.length) {
        const ids = [articleIds];
        const { rows: snaps } = await q("select snapshot_id from public.article_sources where article_id = any($1::bigint[]) and snapshot_id is not null", ids);
        await q("delete from public.article_corrections where article_id = any($1::bigint[])", ids);
        // 삭제된 기사 주소(W2-b 4단계 — 추가만 되는 표, 트리거를 끈 세션이라 지울 수 있다)
        await q("delete from public.article_tombstones where article_id = any($1::bigint[])", ids);
        await q("delete from public.seo_checks where target_type = 'article' and target_id = any($1::text[])", [articleIds.map(String)]);
        await q("delete from public.editorial_reviews where article_id = any($1::bigint[])", ids);
        await q("delete from public.article_interviews where evidence_id in (select id from public.article_evidence where article_id = any($1::bigint[]))", ids);
        await q("delete from public.article_datasets where evidence_id in (select id from public.article_evidence where article_id = any($1::bigint[]))", ids);
        await q("delete from public.article_evidence where article_id = any($1::bigint[])", ids);
        await q("delete from public.article_sources where article_id = any($1::bigint[])", ids);
        if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps.map((s) => s.snapshot_id)]);
        await q("delete from public.article_revisions where article_id = any($1::bigint[])", ids);
        await q("delete from public.inquiries where related_article_id = any($1::bigint[])", ids);
        // 기사 시간 단위 집계·순위(W2-c) — 트리거를 끈 세션이라 외래 키 cascade가 돌지 않으니 기사보다 먼저 직접 지운다
        await q("delete from public.article_stats where article_id = any($1::bigint[])", ids);
        await q("delete from public.article_rankings where article_id = any($1::bigint[])", ids);
        // 시험 기사의 측정 이벤트 — 집계 시험이 지난 시각으로 넣은 행까지 (시작 시각 앞이라 아래 시각 정리에 걸리지 않는다)
        await q("delete from public.analytics_events where props ? 'article_id' and props ->> 'article_id' = any($1::text[])", [articleIds.map(String)]);
        await q("delete from public.articles where id = any($1::bigint[])", ids);
      }
      // 시험이 넣은 이미지 (W2-b 4단계 — 기사가 대표·본문 이미지로 가리키므로 기사 뒤에)
      if (this.extraRows.media.size) await q("delete from public.media where id = any($1::bigint[])", [[...this.extraRows.media]]);
      if (assignmentIds.length) {
        await q("delete from public.story_assignment_events where assignment_id = any($1::bigint[])", [assignmentIds]);
        await q("delete from public.story_assignments where id = any($1::bigint[])", [assignmentIds]);
      }
      // 제휴 규정 버전(W2-c 5단계) — 시험 계정이 화면·API로 만든 버전. 확정 버전은 트리거가 지우기를 막아 트리거를 끈 이 세션에서 지운다
      await q("delete from public.news_partner_requirements where created_by = any($1::text[])", [actors]);
      // 측정 이벤트(W2-c) — 시험 동안 공개 화면·수집 API가 만든 행. 로컬 DB에서 시험은 하나씩 도므로 시작 시각 뒤의 행은 이 시험의 것이다
      await q("delete from public.analytics_events where occurred_at >= $1", [this.startedAt]);
      await this.#restoreOperations(q);
      const targets = [
        ...articleIds.map((id) => `articles:${id}`),
        ...assignmentIds.map((id) => `story_assignments:${id}`),
        ...userIds.map((id) => `staff_roles:${id}`),
        ...userIds.map((id) => `members:${id}`),
        ...[...this.extraRows.categories].map((id) => `categories:${id}`),
        ...[...this.extraRows.partners].map((id) => `partners:${id}`),
        ...[...this.extraRows.glossary_terms].map((id) => `glossary_terms:${id}`),
        ...[...this.extraRows.home_curations].map((id) => `home_curations:${id}`),
        ...[...this.extraRows.situations].map((id) => `situations:${id}`),
        ...[...this.extraRows.search_synonyms].map((id) => `search_synonyms:${id}`),
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
