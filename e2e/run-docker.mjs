#!/usr/bin/env node
// Docker 이미지 E2E — 이미지 검증 + 같은 API 시험을 컨테이너로 (FND-07). 운영체제와 무관하게 E2E_TARGET을 넘긴다.
import { spawnSync } from "node:child_process";

const run = (file, env = {}) =>
  spawnSync(process.execPath, ["--test", "--test-concurrency=1", file], { stdio: "inherit", env: { ...process.env, ...env } }).status;

const a = run("e2e/docker-image.test.mjs");
const b = run("e2e/api-health-jobs.test.mjs", { E2E_TARGET: "docker" });
process.exit(a || b ? 1 : 0);
