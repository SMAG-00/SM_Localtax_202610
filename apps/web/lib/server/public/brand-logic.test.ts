// 인물 페이지 순수 판정 시험 (W3 7단계 — BR-01·02 · OPT-02) — 증빙 승인 약력만 화면·구조화 데이터에 같은 글자로, 역할별 블록은 그 역할에만
import { describe, expect, test } from "vitest";
import { compareRendered, MISMATCH, pageJsonLd, profilePage } from "@ltr/structured-data";
import { publicBioItems } from "./article-logic";
import { bioText, personStructuredView, roleBlocks } from "./brand-logic";

const URL = "https://news.example/people/sihum-pilja";

describe("personStructuredView — 구조화 데이터 원본은 화면 값만", () => {
  test("증빙 승인 약력 2줄 → description = 두 줄을 ' · '로 이은 글자, 화면 대조 불일치 0", () => {
    const bio = publicBioItems([
      { item: "시험용 약력 가", evidence_id: "11" },
      { item: "시험용 약력 나", evidence_id: "12" },
    ]);
    const view = personStructuredView(URL, "시험용 필자", bio);
    expect(view).toEqual({ url: URL, name: "시험용 필자", description: "시험용 약력 가 · 시험용 약력 나" });
    const jsonld = pageJsonLd({ kind: "person", person: view });
    expect(compareRendered({ title: "시험용 필자", description: bioText(bio) }, jsonld)).toEqual([]);
  });

  test("승인 약력 0줄 → description 칸 자체가 없다 (빈 글자 0), 화면 대조 불일치 0", () => {
    const view = personStructuredView(URL, "시험용 기자", []);
    expect(view).toEqual({ url: URL, name: "시험용 기자" });
    expect(JSON.stringify(profilePage(view))).not.toContain("description");
    expect(compareRendered({ title: "시험용 기자" }, pageJsonLd({ kind: "person", person: view }))).toEqual([]);
  });

  test("직함·소속·자격·수상·sameAs·사진은 넣지 않는다 (증빙 칸이 생길 때까지 — 화면에 없는 값 0)", () => {
    const view = personStructuredView(URL, "시험용 감수위원", publicBioItems([{ item: "시험용 약력", evidence_id: "3" }]));
    expect(Object.keys(view).sort()).toEqual(["description", "name", "url"]);
  });

  test("화면이 승인 약력만 그리는데 구조화 데이터에 다른 줄이 있으면 게이트가 잡는다", () => {
    const jsonld = pageJsonLd({ kind: "person", person: { url: URL, name: "시험용 필자", description: "시험용 약력 가 · 증빙 없는 줄" } });
    expect(compareRendered({ title: "시험용 필자", description: "시험용 약력 가" }, jsonld)).toEqual([MISMATCH.PERSON_DESCRIPTION]);
  });
});

describe("roleBlocks — 같은 틀, 역할별 블록은 그 역할에만 (BR-02)", () => {
  test("people_pages가 꺼져 있으면 역할과 상관없이 블록 0", () => {
    expect(roleBlocks(["writer", "reviewer"], false)).toEqual([]);
  });
  test("켜져 있으면 필자 = 칼럼, 감수위원 = 감수 기사, 기자·전문가만이면 0", () => {
    expect(roleBlocks(["writer"], true)).toEqual(["columns"]);
    expect(roleBlocks(["reviewer"], true)).toEqual(["reviewed"]);
    expect(roleBlocks(["reviewer", "writer"], true)).toEqual(["columns", "reviewed"]);
    expect(roleBlocks(["reporter"], true)).toEqual([]);
    expect(roleBlocks(["expert"], true)).toEqual([]);
  });
});
