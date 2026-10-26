// FND-08 Vercel 전용 서비스 패키지 차단 · FND-01 1단계 AI SDK 위치 (packages/assistant만)
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { checkDeps } from "../check-deps.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-deps.mjs");
const RULES = {
  vercelOnly: ["@vercel/blob", "@vercel/kv", "@vercel/queue", "workflow", "@workflow/*", "botid", "@ai-sdk/gateway"],
  aiSdk: ["ai", "@ai-sdk/*", "@anthropic-ai/*"],
  aiSdkAllowed: ["packages/assistant"],
};
const LOCK = `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\npackages:\n\n  next@16.3.8:\n    resolution: {integrity: sha512-x}\n\n  '@types/node@24.19.2':\n    resolution: {integrity: sha512-y}\n`;

function base(over = {}) {
  return {
    "scripts/forbidden-packages.json": RULES,
    "pnpm-lock.yaml": LOCK,
    "package.json": { name: "root", private: true },
    "apps/web/package.json": { name: "@ltr/web", dependencies: { next: "16.3.8" } },
    "apps/web/app/page.tsx": 'import Link from "next/link";\nexport default function P() { return null; }\n',
    "packages/assistant/package.json": { name: "@ltr/assistant", dependencies: { ai: "6.0.0", "@ai-sdk/anthropic": "3.0.0" } },
    "packages/assistant/src/route.ts": 'import { streamText } from "ai";\nimport { anthropic } from "@ai-sdk/anthropic";\n',
    ...over,
  };
}

test("규칙을 지킨 저장소는 오류 0 — AI SDK가 packages/assistant에만 있다", () => {
  const r = checkDeps({ root: tempRepo(base()).dir });
  assert.deepEqual(r.errors, []);
});

for (const pkg of ["@vercel/blob", "workflow", "@workflow/core", "botid", "@ai-sdk/gateway"]) {
  test(`FND-08 — ${pkg}를 의존성에 넣으면 오류`, () => {
    const r = checkDeps({ root: tempRepo(base({ "apps/web/package.json": { name: "@ltr/web", dependencies: { next: "16.3.8", [pkg]: "1.0.0" } } })).dir });
    assert.ok(r.errors.some((e) => e.includes(pkg) && e.includes("apps/web/package.json")), r.errors.join("\n"));
  });
}

test("FND-08 — 다른 패키지를 통해 들어온(lockfile) Vercel 전용 패키지도 오류", () => {
  const lock = LOCK + "\n  '@vercel/kv@3.0.0':\n    resolution: {integrity: sha512-z}\n";
  const r = checkDeps({ root: tempRepo(base({ "pnpm-lock.yaml": lock })).dir });
  assert.ok(r.errors.some((e) => e.includes("@vercel/kv") && e.includes("pnpm-lock.yaml")), r.errors.join("\n"));
});

test("FND-08 — 이름이 비슷한 다른 패키지(@vercel/blobby, workflow-utils)는 오류가 아니다", () => {
  const r = checkDeps({
    root: tempRepo(base({ "apps/web/package.json": { name: "@ltr/web", dependencies: { "@vercel/blobby": "1.0.0", "workflow-utils": "1.0.0" } } })).dir,
  });
  assert.deepEqual(r.errors, []);
});

test("FND-01 — apps/web의 의존성에 AI SDK가 있으면 오류", () => {
  const r = checkDeps({ root: tempRepo(base({ "apps/web/package.json": { name: "@ltr/web", dependencies: { next: "16.3.8", ai: "6.0.0" } } })).dir });
  assert.ok(r.errors.some((e) => e.includes("ai") && e.includes("apps/web/package.json")), r.errors.join("\n"));
});

test("FND-01 — packages/assistant 밖의 코드가 AI SDK를 import하면 오류", () => {
  const r = checkDeps({ root: tempRepo(base({ "apps/web/lib/x.ts": 'export { generateText } from "ai";\n' })).dir });
  assert.ok(r.errors.some((e) => e.includes("apps/web/lib/x.ts")), r.errors.join("\n"));
});

test("FND-01 — require·동적 import·하위 경로(@anthropic-ai/sdk/resources)도 찾는다", () => {
  const r = checkDeps({
    root: tempRepo(
      base({
        "workflows/a.mjs": 'const A = require("@anthropic-ai/sdk");\n',
        "packages/db/b.ts": 'const m = await import("ai/rsc");\n',
        "packages/ui/c.ts": 'import x from "@anthropic-ai/sdk/resources";\n',
      }),
    ).dir,
  });
  for (const f of ["workflows/a.mjs", "packages/db/b.ts", "packages/ui/c.ts"]) {
    assert.ok(r.errors.some((e) => e.includes(f)), `${f}\n${r.errors.join("\n")}`);
  }
});

test("FND-01 — 'ai'로 시작하는 다른 패키지(aiohttp-like, airtable)는 AI SDK가 아니다", () => {
  const r = checkDeps({ root: tempRepo(base({ "apps/web/lib/y.ts": 'import t from "airtable";\nimport z from "ai-helpers";\n' })).dir });
  assert.deepEqual(r.errors, []);
});

test("저장소 전체 — 스크립트가 종료 코드 0", () => {
  const r = runScript(SCRIPT, [], { cwd: ROOT });
  assert.equal(r.code, 0, r.out);
});

// W11-g — AI·워크플로 위치는 상속·증여 엔진(aiForbidden)을 의존하거나 불러올 수 없다 (국세 금액은 AI가 만들지 않는다)
const ENGINE = ["@ltr/", "i", "gt", "-engine"].join("");
const AI_RULES = { ...RULES, aiForbidden: [ENGINE], aiForbiddenDirs: ["packages/assistant", "packages/agent", "workflows", "apps/web/lib/assistant", "apps/web/lib/server/assistant", "apps/web/lib/server/ops-ai", "apps/web/lib/agent", "apps/web/lib/server/agent"] };

for (const dir of ["packages/assistant", "packages/agent", "workflows", "apps/web/lib/assistant", "apps/web/lib/server/assistant", "apps/web/lib/server/ops-ai", "apps/web/lib/agent", "apps/web/lib/server/agent"]) {
  test(`W11-g — ${dir}가 상속·증여 엔진을 import 하면 오류, package.json 의존도 오류`, () => {
    const imp = checkDeps({ root: tempRepo(base({ "scripts/forbidden-packages.json": AI_RULES, [`${dir}/src/a.ts`]: `import { f } from "${ENGINE}/sub";\n` })).dir });
    assert.ok(imp.errors.some((e) => e.includes(`${dir}/src/a.ts`) && e.includes("AI·워크플로")), imp.errors.join("\n"));
    const dep = checkDeps({ root: tempRepo(base({ "scripts/forbidden-packages.json": AI_RULES, [`${dir}/package.json`]: { name: "x", dependencies: { [ENGINE]: "workspace:*" } } })).dir });
    assert.ok(dep.errors.some((e) => e.includes(`${dir}/package.json`) && e.includes(ENGINE)), dep.errors.join("\n"));
  });
}

test("W12-0 — 웹 앱의 AI 위치가 아닌 곳(lib/calc 등)은 엔진을 써도 오류 아님", () => {
  const ok = checkDeps({ root: tempRepo(base({ "scripts/forbidden-packages.json": AI_RULES, "apps/web/lib/calc/x.ts": `import { f } from "${ENGINE}";
`, "apps/web/lib/assistant-ui/y.ts": `import { f } from "${ENGINE}";
` })).dir });
  assert.deepEqual(ok.errors, []);
});

test("W11-g — 웹 앱이 상속·증여 엔진을 쓰는 것과 목록이 없는 규칙 파일은 오류 아님", () => {
  const web = checkDeps({ root: tempRepo(base({ "scripts/forbidden-packages.json": AI_RULES, "apps/web/lib/x.ts": `import { f } from "${ENGINE}";\n`, "apps/web/package.json": { name: "@ltr/web", dependencies: { [ENGINE]: "workspace:*" } } })).dir });
  assert.deepEqual(web.errors, []);
  const noList = checkDeps({ root: tempRepo(base({ "packages/agent/src/a.ts": `import { f } from "${ENGINE}";\n` })).dir });
  assert.deepEqual(noList.errors, []);
});
