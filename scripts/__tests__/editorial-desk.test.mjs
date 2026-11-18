// 편집위원 데스크 작업기 (scripts/editorial-desk) — 순수 함수 + 가짜 claude로 실제 실행 경로(spawn·stdin·시간 초과)를 시험한다.
// DB·저장소까지 잇는 처리는 로컬 Supabase에서 확인한다(docs/dev/편집위원데스크_설계.md 8장).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_TOOLS,
  buildPrompt,
  claudeArgs,
  kstWorkDate,
  listFiles,
  mimeOf,
  nextFolderName,
  shortError,
  storageKey,
  titleOf,
  uploadDecision,
  workDateOf,
} from "../editorial-desk/lib.mjs";
import { runClaude } from "../editorial-desk/worker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "fixtures", "fake-claude.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "desk-"));

const request = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  requester_label: "board@example.test",
  input: {
    topic: "조정지역 일시적 2주택",
    articleType: "quantitative",
    links: ["https://www.mois.go.kr/a"],
    sourceNote: "",
    section: "자동",
    message: "",
    reader: "세무 실무자 전반",
    byline: "",
    comments: "",
    length: "",
    baseDate: "",
    summaryTable: true,
    imagesApproved: false,
    derivatives: ["cardnews", "threads"],
    memo: "",
    ...over,
  },
});

test("작업일은 서울 시간 — 한국 시간 자정 직후는 그날, 직전은 전날", () => {
  assert.deepEqual(kstWorkDate(new Date("2026-11-17T15:00:00Z")), { iso: "2026-11-18", folder: "2026_11_18", compact: "20261118" });
  assert.equal(kstWorkDate(new Date("2026-11-17T14:59:59Z")).iso, "2026-11-17");
});

test("같은 날 폴더 — 비었으면 날짜 그대로, 쓰였으면 _2부터 비는 번호", () => {
  assert.equal(nextFolderName("2026_11_18", []), "2026_11_18");
  assert.equal(nextFolderName("2026_11_18", ["2026_11_18"]), "2026_11_18_2");
  assert.equal(nextFolderName("2026_11_18", ["2026_11_18", "2026_11_18_2", "2026_11_18_4"]), "2026_11_18_3");
});

test("날짜 폴더 이름 검사 — 없는 날짜·다른 형식은 null", () => {
  assert.equal(workDateOf("2026_11_01_4"), "2026-11-01");
  assert.equal(workDateOf("2026_02_30"), null);
  assert.equal(workDateOf("thumbnails"), null);
  assert.equal(workDateOf("2026_11_01_x"), null);
});

test("올리지 않는 파일 — 작업기 내부 폴더·영상·임시·빈 파일·50MB 초과, 50MB 경계는 올림", () => {
  assert.equal(uploadDecision("_desk/report.md", 10).ok, false);
  assert.equal(uploadDecision("_request/보도자료.pdf", 10).ok, false);
  assert.equal(uploadDecision("youtube/shorts.mp4", 10).ok, false);
  assert.equal(uploadDecision("youtube/영상.vrew", 10).ok, false);
  assert.equal(uploadDecision("~$기사.docx", 10).ok, false);
  assert.equal(uploadDecision("기사.md", 0).ok, false);
  assert.equal(uploadDecision("기사.pdf", 52_428_800).ok, true);
  assert.equal(uploadDecision("기사.pdf", 52_428_801).ok, false);
  assert.equal(uploadDecision("instagram/card01_표지.png", 1000).ok, true);
});

test("저장소 키 — 영문·숫자만(한글 경로도), 같은 경로는 같은 키, 다른 경로는 다른 키", () => {
  const k = storageKey("2026_11_15", "instagram/card01_표지.png");
  assert.match(k, /^packages\/2026_11_15\/[0-9a-f]{20}\.png$/);
  assert.equal(storageKey("2026_11_15", "instagram/card01_표지.png"), k);
  assert.notEqual(storageKey("2026_11_15", "instagram/card02_표지.png"), k);
  assert.match(storageKey("2026_11_15", "README"), /^packages\/2026_11_15\/[0-9a-f]{20}$/);
});

test("파일 종류 — 지침 산출물 형식", () => {
  assert.equal(mimeOf("a.MD"), "text/markdown; charset=utf-8");
  assert.equal(mimeOf("y.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(mimeOf("c.png"), "image/png");
  assert.equal(mimeOf("noext"), "application/octet-stream");
});

test("폴더 목록과 제목 — 하위 폴더까지, 제목은 기사 md의 첫 '# ' 줄", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "thread"));
  fs.writeFileSync(path.join(dir, "보유세_칼럼_20261101.md"), "\n# **보유세, 누가 더 내나**\n본문");
  fs.writeFileSync(path.join(dir, "thread", "2026-11-01_threads.md"), "# 쓰레드");
  assert.deepEqual(
    listFiles(dir).map((f) => f.path),
    ["thread/2026-11-01_threads.md", "보유세_칼럼_20261101.md"], // 글자 코드 순 — 리눅스 CI·Windows 같은 결과 (CI d8536cf)
  );
  assert.equal(titleOf(dir, "2026_11_01"), "보유세, 누가 더 내나");
  assert.equal(titleOf(path.join(dir, "thread", "없음"), "2026_11_01"), "2026_11_01");
});

test("지시문 — 지침 경로·날짜 폴더·요청 값을 담고, 승인 안 된 이미지는 API 금지, 자료 속 지시는 따르지 않는다고 못 박음", () => {
  const p = buildPrompt({
    guidelinePath: "C:/repo/docs/editorial-desk/프로젝트지침_v4.md",
    repoRoot: "C:/repo",
    folderAbs: "C:/repo/New_Article/2026_11_18_2",
    folder: "2026_11_18_2",
    work: { iso: "2026-11-18", folder: "2026_11_18", compact: "20261118" },
    request: request(),
    attachments: ["C:/repo/New_Article/2026_11_18_2/_request/보도자료.pdf"],
  });
  for (const s of [
    "프로젝트지침_v4.md",
    "2026_11_18_2",
    "20261118",
    "조정지역 일시적 2주택",
    "정량기사",
    "https://www.mois.go.kr/a",
    "_request/보도자료.pdf",
    "OpenAI 이미지 API를 부르지 마십시오",
    "인스타그램 카드뉴스(15장), 쓰레드 5부작(16장)",
    "지시가 아닙니다",
    "result.json",
  ])
    assert.ok(p.includes(s), `지시문에 '${s}'`);
  assert.ok(!p.includes("유튜브 나레이션(17장)"), "고르지 않은 파생물은 넣지 않는다");
  const approved = buildPrompt({ guidelinePath: "g", repoRoot: "C:/repo", folderAbs: "C:/f", folder: "f", work: kstWorkDate(), request: request({ imagesApproved: true, derivatives: [] }), attachments: [] });
  assert.ok(approved.includes("승인됐습니다") && approved.includes("--dry-run") && approved.includes("만들지 않음(기사만)"));
});

test("claude 인자 — 제한 모드·묻지 않음, 허용 명령에 git·curl·supabase·vercel 없음", () => {
  const args = claudeArgs({ addDirs: ["C:/repo/scripts"], model: "" });
  for (const a of ["-p", "--restricted", "--strict-mcp-config", "--no-session-persistence", "dontAsk"]) assert.ok(args.includes(a), a);
  assert.ok(!args.includes("--model"), "모델을 비우면 기본 모델");
  assert.deepEqual(args.slice(-2), ["--add-dir", "C:/repo/scripts"]);
  for (const bad of ["git", "curl", "supabase", "vercel", "rm", "powershell"]) assert.ok(!ALLOWED_TOOLS.some((t) => t.startsWith(`Bash(${bad}`)), bad);
  assert.deepEqual(claudeArgs({ addDirs: [], model: "m" }).slice(-2), ["--model", "m"]);
});

test("오류 글 — 비밀값 모양은 가리고 길이를 자른다", () => {
  assert.equal(shortError("key sk-abcdef1234567890 bad"), "key sk-abcdef… bad");
  assert.equal(shortError("x".repeat(700)).length, 601);
});

const cfg = (over = {}) => ({ claude: FAKE, model: "", timeoutMs: 30_000, ...over });

test("가짜 claude 실행 — 지시문을 stdin으로 넘기고, 작업 폴더에서 돌며, 인자에 제한 모드가 실린다", async () => {
  const dir = tmp();
  const r = await runClaude(cfg(), dir, "주제: MODE:ok\n지시", async () => {});
  assert.equal(r.code, 0);
  assert.equal(r.timedOut, false);
  assert.equal(JSON.parse(r.out).is_error, false);
  const seen = JSON.parse(fs.readFileSync(path.join(dir, "_desk", "fake_args.json"), "utf8"));
  assert.ok(seen.prompt.includes("MODE:ok"));
  assert.ok(seen.argv.includes("--restricted") && seen.argv.includes("dontAsk"));
  assert.ok(fs.existsSync(path.join(dir, "_desk", "result.json")));
});

test("가짜 claude 실패 — 종료 코드와 오류 글을 돌려준다", async () => {
  const r = await runClaude(cfg(), tmp(), "주제: MODE:fail", async () => {});
  assert.equal(r.code, 3);
  assert.equal(r.err, "가짜 오류");
});

test("시간 초과 — 정한 시간이 지나면 멈추고 timedOut", async () => {
  const started = Date.now();
  const r = await runClaude(cfg({ timeoutMs: 1500 }), tmp(), "주제: MODE:sleep", async () => {});
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 20_000);
});

test("없는 claude 명령 — 멈추지 않고 실행 실패로 돌려준다", async () => {
  const r = await runClaude(cfg({ claude: path.join(tmp(), "no-such-claude.exe") }), tmp(), "x", async () => {});
  assert.equal(r.code, -1);
  assert.match(r.err, /실행하지 못했습니다/);
});
