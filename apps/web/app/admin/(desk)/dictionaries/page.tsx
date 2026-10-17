import type { Metadata } from "next";
import { TabNav } from "@ltr/ui";
import { GlossaryDelete, GlossaryForm, PhraseEditor } from "@/components/admin/DictionaryControls";
import { EmptyNote, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { PHRASE_DICTIONARIES, isPhraseKind, readPhraseDictionary } from "@/lib/admin/dictionary-rules";
import { SECTION_LABELS, labelOf } from "@/lib/admin/labels";
import { listGlossary, readSetting } from "@/lib/server/admin/backoffice";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 사전 (/admin/dictionaries, UX-01 · UX-03 · ADM-01) — 탭 3개: 금지 표현 · 공포 표현 · 쉬운 말 사전(용어). 편집 책임자·관리자.
// 금지·공포 표현은 settings(forbidden_phrases·fear_phrases)에, 용어는 glossary_terms에 있다. 바꾸면 배포 없이 다음 점검부터 적용된다.
export const metadata: Metadata = { title: "사전" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = [
  { id: "forbidden", label: "금지 표현" },
  { id: "fear", label: "공포 표현" },
  { id: "glossary", label: "쉬운 말 사전" },
] as const;

export default async function DictionariesPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "dictionary.edit");
  const requested = queryValue((await searchParams).tab);
  const tab = TABS.some((t) => t.id === requested) ? requested : "forbidden";
  const db = serviceDb();

  return (
    <>
      <PageTitle title="사전" description="발행 점검이 쓰는 사전입니다. 고치면 배포 없이 다음 점검·저장부터 적용됩니다." />
      <TabNav label="사전 종류" items={TABS.map((t) => ({ id: t.id, label: t.label, href: `/admin/dictionaries?tab=${t.id}` }))} current={tab} />
      <div className="mt-6">{isPhraseKind(tab) ? <PhraseTab kind={tab} db={db} /> : <GlossaryTab db={db} />}</div>
    </>
  );
}

async function PhraseTab({ kind, db }: { kind: keyof typeof PHRASE_DICTIONARIES; db: ReturnType<typeof serviceDb> }) {
  const spec = PHRASE_DICTIONARIES[kind];
  const row = await readSetting(db, spec.key);
  const dict = row ? readPhraseDictionary(row.value) : null;
  return (
    <Panel id={`dict-${kind}`} title={`${spec.label} 사전 (${spec.ruleRef})`} description={`운영 설정 ${spec.key}`}>
      {dict ? <PhraseEditor kind={kind} phrases={dict.phrases} version={dict.version} /> : <EmptyNote>사전을 읽지 못했습니다 — 관리자에게 알려 주세요.</EmptyNote>}
    </Panel>
  );
}

async function GlossaryTab({ db }: { db: ReturnType<typeof serviceDb> }) {
  const terms = await listGlossary(db);
  return (
    <div className="space-y-6">
      <Panel id="glossary-add" title="용어 더하기" description="전문 용어와 쉬운 풀이 한 줄. 기사에 처음 나오는 문단에 풀이가 없으면 점검 패널이 경고합니다 (저장·발행은 됩니다).">
        <details>
          <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">새 용어 적기</summary>
          <GlossaryForm mode="create" />
        </details>
      </Panel>
      <Panel id="glossary-list" title={`용어 ${terms.length}개`}>
        {terms.length === 0 && <EmptyNote>사전에 용어가 없습니다.</EmptyNote>}
        <ul className="space-y-3">
          {terms.map((t) => (
            <li key={t.id} data-testid={`glossary-${t.id}`} className="rounded-xl border border-navy-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">{t.term}</span>
                {t.reading && <span className="text-[14px] text-navy-600">({t.reading})</span>}
                {t.jargon ? <ToneChip tone="amber">전문 용어</ToneChip> : <ToneChip tone="plain">일반 용어</ToneChip>}
                {t.section.map((s) => (
                  <ToneChip key={s} tone="plain">
                    {labelOf(SECTION_LABELS, s)}
                  </ToneChip>
                ))}
              </div>
              <p className="mt-1 text-[15px] text-navy-800 [overflow-wrap:anywhere]">{t.plain ? `쉬운 풀이: ${t.plain}` : "쉬운 풀이 없음"}</p>
              {t.related.length > 0 && <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">관련 용어: {t.related.join(", ")}</p>}
              <div className="mt-2 flex flex-wrap items-start gap-4">
                <details className="min-w-0 flex-1">
                  <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
                  <GlossaryForm mode="patch" item={t} />
                </details>
                <GlossaryDelete id={t.id} term={t.term} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
