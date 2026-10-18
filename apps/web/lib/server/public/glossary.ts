import "server-only";
import { cache } from "react";
import { publicDb, rowsOf } from "./db";
import { glossaryIndexView, glossaryTermView, tipTerms, type GlossaryIndexView, type GlossaryTermView } from "./glossary-logic";
import { readPublicSettings } from "./reads";
import { GLOSSARY_COLUMNS, type GlossaryRow } from "./rows";
import type { SectionKey } from "./constants";
import type { TipTerm } from "@/lib/site/glossary-tips";

// 용어사전 공개 데이터 (GLO-01 · GLO-02 — docs/dev/W2-d_설계.md 8.2). anon 키로 읽는다 — 공개 상태(visible) 용어만 온다(RLS).
//  · 화면(/glossary · /glossary/[번호])은 기능 키 glossary가 꺼져 있으면 null → 404 (링크도 0 — isOpenPath)
//  · 공개 용어 목록은 한 요청에서 한 번만 읽는다(React cache) — 색인·용어 쪽·기사 툴팁이 같이 쓴다. 공개 데이터 캐시 30초,
//    사전 API(편집국 쓰기)가 바로 만료한다(W2-b 설계 7.1)

/** 한 번에 읽는 공개 용어 수 상한 — GLO-01 200개 기준의 여유 (PostgREST 기본 최대 행 1000과 같다) */
export const GLOSSARY_READ_MAX = 1000;

export const readGlossaryTerms = cache(
  async (): Promise<GlossaryRow[]> => rowsOf<GlossaryRow>(publicDb().from("glossary_terms").select(GLOSSARY_COLUMNS).order("term").order("id").limit(GLOSSARY_READ_MAX), "용어사전"),
);

/** 색인 화면 — 기능 키가 꺼져 있으면 null(404) */
export async function getGlossaryIndex(section: SectionKey | null): Promise<GlossaryIndexView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.glossary) return null;
  return glossaryIndexView(await readGlossaryTerms(), section);
}

/** 용어 쪽 — 기능 키가 꺼져 있거나 공개 용어가 아니면(숨김·없음) null(404) */
export async function getGlossaryTerm(id: number): Promise<GlossaryTermView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.glossary) return null;
  return glossaryTermView(await readGlossaryTerms(), id);
}

/** 기사 본문 툴팁 용어 (GLO-02) — 쉬운 풀이가 있는 공개 용어. 용어사전 링크는 기능 키가 켜졌을 때만 */
export async function readTipTerms(): Promise<TipTerm[]> {
  const [settings, rows] = await Promise.all([readPublicSettings(), readGlossaryTerms()]);
  return tipTerms(rows, settings.features);
}
