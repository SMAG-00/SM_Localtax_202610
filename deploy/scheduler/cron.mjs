// 일정(cron) 해석 — "분 시 일 월 요일" 5칸, UTC 기준 (Vercel Cron과 같다). 의존성 없음.
// 지원: *, 숫자, 목록(1,30), 범위(9-18), 간격(*/15, 9-18/3). 요일 0과 7은 일요일.
// 일과 요일을 둘 다 지정하면 둘 중 하나만 맞아도 실행한다 (표준 cron 규칙).

const FIELDS = [
  { name: "분", min: 0, max: 59 },
  { name: "시", min: 0, max: 23 },
  { name: "일", min: 1, max: 31 },
  { name: "월", min: 1, max: 12 },
  { name: "요일", min: 0, max: 7 },
];

function parseField(text, { name, min, max }) {
  const values = new Set();
  for (const part of text.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`일정의 ${name} 칸을 읽을 수 없다: ${text}`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`일정의 ${name} 칸 간격은 1 이상: ${text}`);
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b === undefined ? (m[2] === undefined ? a : max) : b;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`일정의 ${name} 칸 범위(${min}~${max}) 밖: ${text}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") throw new Error(`일정은 5칸(분 시 일 월 요일)이어야 한다: ${JSON.stringify(expr)}`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

export function matches(cron, date) {
  if (!cron.minute.has(date.getUTCMinutes()) || !cron.hour.has(date.getUTCHours()) || !cron.month.has(date.getUTCMonth() + 1)) return false;
  const domOk = cron.dom.has(date.getUTCDate());
  const dowOk = cron.dow.has(date.getUTCDay());
  if (cron.domAny && cron.dowAny) return true;
  if (cron.domAny) return dowOk;
  if (cron.dowAny) return domOk;
  return domOk || dowOk;
}

/** vercel.json의 crons → 지금 실행할 작업 이름 목록 */
export function dueJobs(crons, date) {
  return crons
    .map(({ path, schedule }) => {
      const m = String(path).match(/^\/api\/jobs\/([a-z0-9-]+)$/);
      if (!m) throw new Error(`일정의 경로는 /api/jobs/<작업>이어야 한다: ${path}`);
      return { job: m[1], cron: parseCron(schedule) };
    })
    .filter(({ cron }) => matches(cron, date))
    .map(({ job }) => job);
}
