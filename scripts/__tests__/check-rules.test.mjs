// 룰셋 파일 검사 시험 (scripts/check-rules.mjs) - 임시 폴더에 룰셋 폴더를 만들어 규칙마다 통과·실패를 확인한다. 시험용 파일이라 값은 지어낸 것이다(시험용).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { checkRules, ruleDirs } from "../check-rules.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function setup({ bundle = [], lockOverride = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  fs.mkdirSync(path.join(root, "rules"));
  const body = JSON.stringify({ version: "2099.01", status: "draft", note: "시험용" });
  fs.writeFileSync(path.join(root, "rules", "2099.01.json"), body);
  fs.writeFileSync(path.join(root, "rules", "versions.lock.json"), JSON.stringify({ versions: { "2099.01": sha(body), ...lockOverride } }));
  fs.writeFileSync(path.join(root, "rules", "bundle.json"), JSON.stringify({ versions: bundle }));
  return { root, body };
}

test("정상 - 파일·잠금·빈 번들이 맞으면 오류 0", () => {
  const { root } = setup();
  assert.deepEqual(checkRules({ root, baselines: [] }).errors, []);
});

test("R2 - 이미 있는 버전 파일 내용을 고치면 실패한다 (RULE-01)", () => {
  const { root } = setup();
  fs.writeFileSync(path.join(root, "rules", "2099.01.json"), JSON.stringify({ version: "2099.01", status: "draft", note: "시험용 고침" }));
  const { errors } = checkRules({ root, baselines: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^R2 2099\.01: 파일 내용이 잠금과 다릅니다/);
});

test("R2 - 새 버전 파일을 잠금 항목 없이 더하면 실패한다", () => {
  const { root } = setup();
  fs.writeFileSync(path.join(root, "rules", "2099.02.json"), JSON.stringify({ version: "2099.02", status: "draft" }));
  assert.match(checkRules({ root, baselines: [] }).errors.join("\n"), /R2 2099\.02: versions\.lock\.json에 항목이 없습니다/);
});

test("R1 - 파일 이름과 안의 version이 다르거나 status가 draft가 아니면 실패한다", () => {
  const { root } = setup();
  const bad = JSON.stringify({ version: "2099.09", status: "active" });
  fs.writeFileSync(path.join(root, "rules", "2099.01.json"), bad);
  fs.writeFileSync(path.join(root, "rules", "versions.lock.json"), JSON.stringify({ versions: { "2099.01": sha(bad) } }));
  const text = checkRules({ root, baselines: [] }).errors.join("\n");
  assert.match(text, /version\(2099\.09\)이 파일 이름과 다릅니다/);
  assert.match(text, /status는 draft여야 합니다/);
});

test("R1 - YYYY.NN.json 모양이 아닌 파일 이름은 실패한다", () => {
  const { root } = setup();
  fs.writeFileSync(path.join(root, "rules", "latest.json"), "{}");
  assert.match(checkRules({ root, baselines: [] }).errors.join("\n"), /R1 latest\.json: 파일 이름이/);
});

test("R3 - 직전 커밋에 있던 잠금 항목이 바뀌거나 지워지면 실패한다", () => {
  const { root, body } = setup();
  const changed = checkRules({ root, baselines: [{ ref: "HEAD~1", versions: { "2099.01": "0".repeat(64) } }] });
  assert.match(changed.errors.join("\n"), /R3 2099\.01: HEAD~1에 있던 잠금 항목이 바뀌었습니다/);
  const removed = checkRules({ root, baselines: [{ ref: "HEAD", versions: { "2099.01": sha(body), "2098.01": "a".repeat(64) } }] });
  assert.match(removed.errors.join("\n"), /R3 2098\.01: HEAD에 있던 잠금 항목이 지워졌습니다/);
});

test("R4 - 서명 기록이 없는 버전은 번들에 들어갈 수 없다 (CALC-08)", () => {
  const { root } = setup({ bundle: [{ version: "2099.01" }] });
  const { errors } = checkRules({ root, baselines: [] });
  assert.equal(errors.filter((e) => e.startsWith("R4")).length, 3, "signedBy·signedAt·sha256 세 칸 모두 지적");
});

test("R4 - 서명 기록이 있고 파일 SHA-256이 같으면 통과, 다르거나 파일이 없으면 실패", () => {
  const { root, body } = setup();
  const entry = { version: "2099.01", signedBy: "시험용 감수위원", signedAt: "2099-01-01T00:00:00Z", sha256: sha(body) };
  fs.writeFileSync(path.join(root, "rules", "bundle.json"), JSON.stringify({ versions: [entry] }));
  assert.deepEqual(checkRules({ root, baselines: [] }).errors, []);
  fs.writeFileSync(path.join(root, "rules", "bundle.json"), JSON.stringify({ versions: [{ ...entry, sha256: "f".repeat(64) }, { ...entry, version: "2077.01" }] }));
  const text = checkRules({ root, baselines: [] }).errors.join("\n");
  assert.match(text, /서명한 파일 SHA-256이 현재 파일과 다릅니다/);
  assert.match(text, /R4 bundle 2077\.01: 파일이 없는 버전입니다/);
});

test("실제 저장소 rules 폴더 - 지금은 번들 0개, 초안만", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
  const r = checkRules({ root });
  assert.deepEqual(r.errors, []);
  assert.equal(r.bundled, 0);
  assert.ok(r.versions.length >= 3);
});

// W11-g - 상속·증여 룰셋 폴더가 있으면 같은 규칙으로 함께 본다 (폴더 이름은 조각을 이어 붙인다)
const EXTRA = ["rules", "i" + "gt"].join("-");

function setupExtra({ tamper = false } = {}) {
  const { root } = setup();
  const dir = path.join(root, EXTRA);
  fs.mkdirSync(dir);
  const body = JSON.stringify({ version: "2099.02", status: "draft", note: "시험용" });
  fs.writeFileSync(path.join(dir, "2099.02.json"), tamper ? body.replace("시험용", "고침") : body);
  fs.writeFileSync(path.join(dir, "versions.lock.json"), JSON.stringify({ versions: { "2099.02": sha(body) } }));
  return root;
}

test("ruleDirs - 추가 룰셋 폴더가 없으면 rules만, 있으면 둘 다", () => {
  const { root } = setup();
  assert.deepEqual(ruleDirs(root), ["rules"]);
  fs.mkdirSync(path.join(root, EXTRA));
  assert.deepEqual(ruleDirs(root), ["rules", EXTRA]);
});

test("추가 룰셋 폴더 - 파일 없는 빈 폴더는 통과, 잠금과 같은 파일은 통과, 내용을 고치면 R2 실패", () => {
  const { root } = setup();
  fs.mkdirSync(path.join(root, EXTRA));
  assert.deepEqual(checkRules({ root, dirName: EXTRA, baselines: [] }).errors, []);
  assert.deepEqual(checkRules({ root: setupExtra(), dirName: EXTRA, baselines: [] }).errors, []);
  const { errors } = checkRules({ root: setupExtra({ tamper: true }), dirName: EXTRA, baselines: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^R2 2099\.02: 파일 내용이 잠금과 다릅니다/);
});
