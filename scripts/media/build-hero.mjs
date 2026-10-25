#!/usr/bin/env node
// 히어로 배경 미디어 변환 (PO 결정 2026-10-25) — 원본 폴더의 NN_*.mp4 / NN_*.png를 번호로 찾아 공개 폴더에 웹용으로 만든다.
//   01 홈(home) · 02 지방세(tax) · 03 부동산(realestate) · 04 부동산금융(finance) · 05 지자체뉴스(local)
// 사용: node scripts/media/build-hero.mjs [--src image/SM_promo_keyframes_5pack] [--out apps/web/public/media/hero] [--only 01,03]
// 필요: ffmpeg · ffprobe (PATH). 원본(image/)은 저장소에 올리지 않는다(.gitignore) — 결과(apps/web/public/media/hero/)만 올린다.
// 만드는 것 (키마다):
//   {key}.mp4      데스크톱 영상 — H.264 1920폭, 소리 없음, faststart, 끝 2초를 처음 2초와 겹쳐(디졸브) 끝↔처음이 끊기지 않는 반복 — 영상은 원본 2초 지점에서 시작
//   {key}-m.mp4    모바일 영상 — 1280폭
//   {key}.avif     데스크톱 포스터 (원본 폭, 최대 1920) · {key}-m.avif 모바일 포스터 1080폭 · {key}-card.avif 홈 분야 카드용 작은 그림 640폭
// 끝나면 설정 hero_media에 넣을 값(JSON)을 출력한다 — 관리자 설정 화면에서 붙여 넣는다.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HERO_KEYS = { "01": "home", "02": "tax", "03": "realestate", "04": "finance", "05": "local" };
/** 끝↔처음 겹침 길이(초) */
const LOOP_FADE = 2;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} 실행 실패 — ffmpeg가 설치돼 있고 PATH에 있어야 합니다 (${r.error.message})`);
  if (r.status !== 0) throw new Error(`${cmd} 오류 (종료 ${r.status}): ${(r.stderr ?? "").split("\n").slice(-6).join("\n")}`);
  return r.stdout;
}
const probe = (file, entries) => run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "json", file]);
const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)}KB`;

/** 영상 한 벌 — width 폭, 소리 없음, 반복 이음 */
function encodeVideo(src, out, { width, maxrate }) {
  const info = JSON.parse(probe(src, "stream=duration"));
  const len = Number(info.streams[0].duration);
  const d = LOOP_FADE;
  if (!(len > d * 3)) throw new Error(`${src}: 영상이 너무 짧습니다 (${len}초)`);
  const filter = [
    `[0:v]fps=30,scale=${width}:-2:flags=lanczos,split=3[a][b][c]`,
    `[a]trim=start=0:end=${d},setpts=PTS-STARTPTS[head]`,
    `[b]trim=start=${(len - d).toFixed(3)}:end=${len.toFixed(3)},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=start=${d}:end=${(len - d).toFixed(3)},setpts=PTS-STARTPTS[body]`,
    `[tail][head]xfade=transition=fade:duration=${d - 0.05}:offset=0[x]`,
    `[body][x]concat=n=2:v=1:a=0,format=yuv420p[v]`,
  ].join(";");
  run("ffmpeg", [
    "-v", "error", "-y", "-i", src, "-filter_complex", filter, "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "slower", "-crf", "28", "-maxrate", `${maxrate}k`, "-bufsize", `${maxrate * 2}k`,
    "-profile:v", width > 1280 ? "high" : "main", "-movflags", "+faststart", out,
  ]);
}

/** 포스터 한 장 — 원본보다 크게 늘리지 않는다 */
function encodePoster(src, out, { width, crf }) {
  const srcWidth = Number(JSON.parse(probe(src, "stream=width")).streams[0].width);
  run("ffmpeg", [
    "-v", "error", "-y", "-i", src, "-vf", `scale=${Math.min(width, srcWidth)}:-2:flags=lanczos`, "-pix_fmt", "yuv420p",
    "-c:v", "libaom-av1", "-crf", String(crf), "-b:v", "0", "-cpu-used", "4", "-still-picture", "1", out,
  ]);
}

function main() {
  const src = path.resolve(root, arg("src", "image/SM_promo_keyframes_5pack"));
  const out = path.resolve(root, arg("out", "apps/web/public/media/hero"));
  const only = arg("only", "").split(",").filter(Boolean);
  if (!fs.existsSync(src)) throw new Error(`원본 폴더가 없습니다: ${src}`);
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(src);
  const setting = { aiLabel: true };
  for (const [num, key] of Object.entries(HERO_KEYS)) {
    if (only.length && !only.includes(num)) continue;
    const mp4 = files.find((f) => f.startsWith(`${num}_`) && f.toLowerCase().endsWith(".mp4"));
    const png = files.find((f) => f.startsWith(`${num}_`) && f.toLowerCase().endsWith(".png"));
    const entry = {};
    if (png) {
      const p = path.join(src, png);
      encodePoster(p, path.join(out, `${key}.avif`), { width: 1920, crf: 27 });
      encodePoster(p, path.join(out, `${key}-m.avif`), { width: 1080, crf: 29 });
      encodePoster(p, path.join(out, `${key}-card.avif`), { width: 640, crf: 32 });
      Object.assign(entry, { poster: `/media/hero/${key}.avif`, posterMobile: `/media/hero/${key}-m.avif`, card: `/media/hero/${key}-card.avif` });
      console.log(`${num} ${key} 포스터 ${kb(path.join(out, `${key}.avif`))} · 모바일 ${kb(path.join(out, `${key}-m.avif`))} · 카드 ${kb(path.join(out, `${key}-card.avif`))}`);
    } else console.warn(`${num} ${key}: PNG 없음 — 포스터를 만들지 않습니다`);
    if (mp4) {
      const v = path.join(src, mp4);
      encodeVideo(v, path.join(out, `${key}.mp4`), { width: 1920, maxrate: 2000 });
      encodeVideo(v, path.join(out, `${key}-m.mp4`), { width: 1280, maxrate: 900 });
      Object.assign(entry, { video: `/media/hero/${key}.mp4`, videoMobile: `/media/hero/${key}-m.mp4` });
      console.log(`${num} ${key} 영상 ${kb(path.join(out, `${key}.mp4`))} · 모바일 ${kb(path.join(out, `${key}-m.mp4`))}`);
    } else console.log(`${num} ${key}: 영상 없음 — 포스터 정지 그림만 씁니다`);
    if (Object.keys(entry).length) setting[key] = entry;
  }
  console.log("\n설정 hero_media 값 (관리자 설정 화면 > hero_media 에 붙여 넣기):");
  console.log(JSON.stringify(setting, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
