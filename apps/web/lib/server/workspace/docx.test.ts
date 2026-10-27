import { inflateRawSync, crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildDocx, documentXml } from "./docx";
import { citationLine, countCitations, type ExportItem } from "./logic";

// zip을 다시 읽는다 - 중앙 디렉터리를 따라 항목을 꺼내고 CRC를 대조한다 (저장만/deflate 모두 읽음)
function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 0 ? raw : inflateRawSync(raw);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const mk = (n: number, over: Partial<ExportItem> = {}): ExportItem => ({ kind: "article", id: String(n), title: `시험용 항목 ${n}`, version: "3", checkedOn: "2026-10-27", memo: `메모 ${n}`, aiDraft: false, excerpt: "", ...over });
const NOW = new Date("2026-10-27T03:00:00Z");

describe("docx 생성기", () => {
  it("필수 부분이 들어 있고 zip을 다시 읽으면 CRC가 맞는다", () => {
    const files = readZip(buildDocx({ title: "워크스페이스 스크랩", exportedOn: "2026-10-27", items: [mk(1)] }, NOW));
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
    expect(files.get("word/document.xml")!.toString("utf8")).toContain("내보낸 날짜: 2026-10-27");
  });

  it("문서 속 인용 문단 수가 화면(입력)의 인용 수와 같다 - 0건/1건/여러 건", () => {
    for (const n of [0, 1, 7]) {
      const items = Array.from({ length: n }, (_, i) => mk(i + 1));
      items.push(mk(99, { kind: null, id: null })); // 대상 없는 메모는 인용이 아니다
      const xml = readZip(buildDocx({ title: "t", exportedOn: "2026-10-27", items }, NOW)).get("word/document.xml")!.toString("utf8");
      expect((xml.match(/w:pStyle w:val="Citation"/g) ?? []).length).toBe(countCitations(items));
      expect(countCitations(items)).toBe(n);
    }
  });

  it("인용 문장·AI 초안 표기·발췌가 문서에 실린다", () => {
    const items = [mk(1, { aiDraft: true, excerpt: "발췌 글" }), mk(2)];
    const xml = documentXml({ title: "t", exportedOn: "2026-10-27", items });
    expect(xml).toContain(citationLine(items[0]!));
    expect((xml.match(/\[AI 초안\]/g) ?? []).length).toBe(1);
    expect(xml).toContain("발췌: 발췌 글");
  });

  it("XML 특수문자는 이스케이프하고 금지 제어 문자는 지운다", () => {
    const xml = documentXml({ title: "a<b>&c", exportedOn: "2026-10-27", items: [mk(1, { memo: "x\u0000y\u0008z\n둘째 줄" })] });
    expect(xml).toContain("a&lt;b&gt;&amp;c");
    expect(xml).not.toMatch(/[\u0000-\u0008]/);
    expect(xml).toContain("<w:br/>");
    expect(xml).toContain("xyz");
  });

  it("발췌가 없으면 발췌 문단이 없다 (한도 0 또는 권한 끝)", () => {
    expect(documentXml({ title: "t", exportedOn: "2026-10-27", items: [mk(1)] })).not.toContain("발췌:");
  });
});
