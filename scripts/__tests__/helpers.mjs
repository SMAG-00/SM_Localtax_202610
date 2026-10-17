// 시험용 임시 git 저장소
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export function tempRepo(files = {}, { email = "admin@sunmyung.kr" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-repo-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", email);
  git("config", "user.name", "시험");
  git("config", "commit.gpgsign", "false");
  const write = (rel, text) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof text === "string" ? text : JSON.stringify(text, null, 2));
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  git("add", "-A");
  return {
    dir,
    git,
    write,
    commit(message, { authorEmail, committerEmail } = {}) {
      git("add", "-A");
      const env = { ...process.env };
      if (authorEmail) env.GIT_AUTHOR_EMAIL = authorEmail;
      if (committerEmail) env.GIT_COMMITTER_EMAIL = committerEmail;
      execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", message], { env });
    },
  };
}

export function runScript(script, args = [], { cwd, env } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
