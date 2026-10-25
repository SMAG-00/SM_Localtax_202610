// 조문 본문 -> 항·호·목 블록과 앵커 (LAW-01 · LAW-04). 순수 모듈 - 본문 글자는 그대로 두고 줄머리 기호만 읽는다.
//  · 항: 동그라미 숫자 -> 앵커 p1 p2 ... (항 표시가 하나도 없는 조문은 본문 첫 줄이 p1)
//  · 호: '1.' '2의2.' -> p1-i1 (항 앞에 나오면 p1 아래로 본다)
//  · 목: '가.' '나.' -> p1-i1-s1 (순서 번호)
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const ITEM = /^(\d{1,3})(?:의(\d{1,3}))?\.\s/;
const SUBITEM = /^([가-하])\.\s/;

export interface ProvisionBlock {
  id: string;
  level: "lead" | "paragraph" | "item" | "subitem";
  text: string;
}

export function splitProvision(body: string): ProvisionBlock[] {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const hasCircled = lines.some((l) => CIRCLED.includes(l[0]!));
  const out: ProvisionBlock[] = [];
  let p = 0;
  let item: string | null = null;
  let sub = 0;
  for (const line of lines) {
    const c = CIRCLED.indexOf(line[0]!);
    const im = ITEM.exec(line);
    const sm = SUBITEM.exec(line);
    if (c >= 0) {
      p = c + 1;
      item = null;
      sub = 0;
      out.push({ id: `p${p}`, level: "paragraph", text: line });
    } else if (im) {
      if (p === 0) p = 1;
      item = `p${p}-i${im[1]}${im[2] ? `-${im[2]}` : ""}`;
      sub = 0;
      out.push({ id: item, level: "item", text: line });
    } else if (sm && item !== null) {
      sub += 1;
      out.push({ id: `${item}-s${sub}`, level: "subitem", text: line });
    } else if (out.length === 0) {
      if (hasCircled) out.push({ id: "lead", level: "lead", text: line });
      else {
        p = 1;
        out.push({ id: "p1", level: "paragraph", text: line });
      }
    } else {
      out[out.length - 1]!.text += `\n${line}`;
    }
  }
  return out;
}
