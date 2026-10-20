// 이메일 모양 판정·가림 표기 (W2-e 설계 2.7) — 공개 화면 표기와 크롤링 검사가 같은 정규식을 쓴다. 순수 모듈.
// 전각 `＠`·`．`은 NFKC로 먼저 바꾸고, HTML 엔티티(`&#64;` `&#x40;` `&commat;` `&period;`)는 풀어서 본다. `mailto:` 링크는 만들지 않는다.

export const EMAIL_SOURCE = "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}";
const EMAIL_RE = () => new RegExp(EMAIL_SOURCE, "g");

const NAMED: Readonly<Record<string, string>> = { commat: "@", period: ".", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML 엔티티 풀기 (이메일 판정에 필요한 만큼 — 숫자 참조·이름 몇 개) */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[name!] ?? m;
  });
}

/** 판정용 글 — 엔티티 풀기 + NFKC */
export const normalizeForEmailScan = (s: string): string => decodeEntities(s).normalize("NFKC");

/** 이메일 모양이 들어 있나 (크롤링 검사·게시 점검이 쓴다) */
export const hasEmailShape = (s: string): boolean => EMAIL_RE().test(normalizeForEmailScan(s));

/** 이메일 모양을 모두 찾는다 */
export const findEmails = (s: string): string[] => normalizeForEmailScan(s).match(EMAIL_RE()) ?? [];

/** 화면 표기 — `hong@example.com` → `hong [at] example [dot] com`. 이메일 모양이 아닌 글은 그대로 */
export function maskEmailForDisplay(s: string): string {
  // 엔티티 풀기·NFKC는 이메일 모양을 찾는 데에만 쓴다 — 원문(①②③·㈜·전각 괄호 등)은 그대로 두고 이메일 모양 구간만 바꾼다
  const units: Array<{ orig: string; norm: string }> = [];
  const entity = /&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/y;
  for (let i = 0; i < s.length; ) {
    entity.lastIndex = i;
    const m = entity.exec(s);
    if (m) {
      units.push({ orig: m[0], norm: decodeEntities(m[0]).normalize("NFKC") });
      i += m[0].length;
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      units.push({ orig: ch, norm: ch.normalize("NFKC") });
      i += ch.length;
    }
  }
  let norm = "";
  const owner: number[] = [];
  units.forEach((u, idx) => {
    for (let k = 0; k < u.norm.length; k++) owner.push(idx);
    norm += u.norm;
  });
  let out = "";
  let next = 0;
  for (const m of norm.matchAll(EMAIL_RE())) {
    const first = owner[m.index!]!;
    const last = owner[m.index! + m[0].length - 1]!;
    if (first < next) continue;
    out += units.slice(next, first).map((u) => u.orig).join("");
    const at = m[0].indexOf("@");
    out += `${m[0].slice(0, at)} [at] ${m[0].slice(at + 1).split(".").join(" [dot] ")}`;
    next = last + 1;
  }
  return out + units.slice(next).map((u) => u.orig).join("");
}
