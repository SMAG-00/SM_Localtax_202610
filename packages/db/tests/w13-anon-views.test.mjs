// 공개 뷰 읽기 가능성 - anon·authenticated에게 SELECT가 열린 모든 public 뷰를 그 역할로 실제로 읽어 본다.
// 뷰 안에서 부르는 함수의 실행 권한은 읽는 사람 기준이라, 함수를 anon에게 열지 않은 채 뷰가 함수를 부르면 화면에서만 "읽지 못했습니다"가 난다 (W13-g에서 발견).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

for (const role of ["anon", "authenticated"]) {
  test(`${role}에게 열린 모든 공개 뷰를 ${role} 역할로 읽을 수 있다 (권한 오류 0)`, () =>
    h.tx(async () => {
      const views = (
        await client.query(
          "select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and has_table_privilege($1, c.oid, 'select') order by 1",
          [role],
        )
      ).rows.map((r) => r.relname);
      assert.ok(views.length > 50, `뷰가 너무 적다: ${views.length}`);
      const failed = [];
      for (const v of views) {
        const r = await h.attempt(`select count(*) from public.${v}`, [], role);
        if (!r.ok) failed.push(`${v}: ${r.message}`);
      }
      assert.deepEqual(failed, []);
    }));
}
