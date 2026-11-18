// 시험용 가짜 claude (편집위원 데스크 작업기 시험) — 진짜 claude처럼 stdin으로 지시를 받고, 작업 폴더(cwd)에 결과를 쓰고, JSON 한 덩어리를 출력한다.
// 동작은 지시문의 '주제: MODE:<동작>'으로 고른다(환경변수 없이): ok · no-result · fail · sleep
import fs from "node:fs";
import path from "node:path";

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", async () => {
  const mode = /주제: MODE:([a-z-]+)/.exec(prompt)?.[1] ?? "ok";
  fs.mkdirSync("_desk", { recursive: true });
  fs.writeFileSync(path.join("_desk", "fake_args.json"), JSON.stringify({ argv: process.argv.slice(2), prompt }));
  if (mode === "sleep") await new Promise((r) => setTimeout(r, 60_000));
  if (mode === "fail") {
    process.stderr.write("가짜 오류");
    process.exit(3);
  }
  fs.writeFileSync(path.join("_desk", "progress.txt"), "카드뉴스 캡처 중\n");
  fs.writeFileSync("시험_정량_20261118.md", "# 시험 기사 제목\n\n본문\n");
  fs.mkdirSync("images", { recursive: true });
  fs.writeFileSync(path.join("images", "ai1_거실.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mode === "ok") {
    fs.writeFileSync(path.join("_desk", "report.md"), "[완료 보고] 시험\n");
    fs.writeFileSync(path.join("_desk", "result.json"), JSON.stringify({ title: "시험 기사 제목", article_file: "시험_정량_20261118.md", status: "done", notes: [] }));
  }
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "[완료 보고] 시험" }));
});
