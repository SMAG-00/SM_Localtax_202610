import type { Metadata } from "next";
import { TabNav } from "@ltr/ui";
import { GlossaryDelete, GlossaryForm, GlossaryVisibility, PhraseEditor } from "@/components/admin/DictionaryControls";
import { SynonymDelete, SynonymForm, TermKey } from "@/components/admin/SynonymControls";
import { EmptyNote, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { PHRASE_DICTIONARIES, isPhraseKind, readPhraseDictionary } from "@/lib/admin/dictionary-rules";
import { glossaryWarnings } from "@/lib/admin/glossary-rules";
import { SYNONYM_LIMITS } from "@/lib/admin/synonym-rules";
import { SECTION_LABELS, labelOf } from "@/lib/admin/labels";
import { listGlossary, readSetting } from "@/lib/server/admin/backoffice";
import { listSynonyms } from "@/lib/server/admin/synonyms";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 사전 (/admin/dictionaries, UX-01 · UX-03 · ADM-01 · W2-d 설계 5장) — 탭 4개: 금지 표현 · 공포 표현 · 쉬운 말 사전(용어) · 검색 동의어. 편집 책임자·관리자.
// 금지·공포 표현은 settings(forbidden_phrases·fear_phrases)에, 용어는 glossary_terms에, 검색 동의어는 search_synonyms에 있다. 바꾸면 배포 없이 다음 점검·검색부터 적용된다.
export const metadata: Metadata = { title: "사전" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = [
  { id: "forbidden", label: "금지 표현" },
  { id: "fear", label: "공포 표현" },
  { id: "glossary", label: "쉬운 말 사전" },
  { id: "synonyms", label: "검색 동의어" },
] as const;

export default async function DictionariesPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "dictionary.edit");
  const params = await searchParams;
  const requested = queryValue(params.tab);
  const tab = TABS.some((t) => t.id === requested) ? requested : "forbidden";
  const db = serviceDb();

  return (
    <>
      <PageTitle title="사전" description="발행 점검이 쓰는 사전입니다. 고치면 배포 없이 다음 점검·저장부터 적용됩니다." />
      <TabNav label="사전 종류" items={TABS.map((t) => ({ id: t.id, label: t.label, href: `/admin/dictionaries?tab=${t.id}` }))} current={tab} />
      <div className="mt-6">{isPhraseKind(tab) ? <PhraseTab kind={tab} db={db} /> : tab === "synonyms" ? <SynonymTab db={db} prefill={synonymPrefill(queryValue(params.term))} /> : <GlossaryTab db={db} />}</div>
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
  const shown = terms.filter((t) => t.visible).length;
  return (
    <div className="space-y-6">
      <Panel id="glossary-add" title="용어 더하기" description="전문 용어와 쉬운 풀이 한 줄. 기사에 처음 나오는 문단에 풀이가 없으면 점검 패널이 경고합니다 (저장·발행은 됩니다). 새 용어는 숨김으로 저장됩니다 — 감수를 마친 뒤 [공개하기]를 누르면 용어사전·용어 칩·기사 본문 풀이·검색에 보입니다.">
        <details>
          <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">새 용어 적기</summary>
          <GlossaryForm mode="create" />
        </details>
      </Panel>
      <Panel id="glossary-list" title={`용어 ${terms.length}개 · 공개 ${shown}개`}>
        {terms.length === 0 && <EmptyNote>사전에 용어가 없습니다.</EmptyNote>}
        <ul className="space-y-3">
          {terms.map((t) => (
            <li key={t.id} data-testid={`glossary-${t.id}`} className="rounded-xl border border-navy-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">{t.term}</span>
                {t.reading && <span className="text-[14px] text-navy-600">({t.reading})</span>}
                {t.visible ? <ToneChip tone="emerald">공개</ToneChip> : <ToneChip tone="plain">숨김</ToneChip>}
                {t.jargon ? <ToneChip tone="amber">전문 용어</ToneChip> : <ToneChip tone="plain">일반 용어</ToneChip>}
                {t.section.map((s) => (
                  <ToneChip key={s} tone="plain">
                    {labelOf(SECTION_LABELS, s)}
                  </ToneChip>
                ))}
              </div>
              <p className="mt-1 text-[15px] text-navy-800 [overflow-wrap:anywhere]">{t.plain ? `쉬운 풀이: ${t.plain}` : "쉬운 풀이 없음"}</p>
              {t.related.length > 0 && <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">관련 용어: {t.related.join(", ")}</p>}
              {glossaryWarnings(t).length > 0 && (
                <ul data-part="glossary-item-warnings" aria-label="확인할 문장" className="mt-2 list-disc space-y-0.5 pl-5 text-[14px] text-amber-800">
                  {glossaryWarnings(t).map((w) => (
                    <li key={`${w.id}-${w.field}`} className="[overflow-wrap:anywhere]">
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-start gap-4">
                <details className="min-w-0 flex-1">
                  <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
                  <GlossaryForm mode="patch" item={t} />
                </details>
                <GlossaryVisibility id={t.id} term={t.term} visible={t.visible} />
                <GlossaryDelete id={t.id} term={t.term} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** 검색어 화면(/admin/query-terms)의 '동의어 더하기'가 넘긴 낱말 — 앞뒤 공백을 떼고 낱말 한도까지. 비면 null (W2-d 설계 8.3) */
function synonymPrefill(raw: string): string | null {
  const term = Array.from(raw.trim()).slice(0, SYNONYM_LIMITS.termChars).join("");
  return term === "" ? null : term;
}

/** 검색 동의어 (W2-d 설계 5장) — 검색어의 낱말 하나가 낱말(띄어쓰기·기호를 뺀 열쇠)과 같으면 동의어도 함께 찾는다. 한쪽 방향 */
async function SynonymTab({ db, prefill }: { db: ReturnType<typeof serviceDb>; prefill: string | null }) {
  const rows = await listSynonyms(db);
  return (
    <div className="space-y-6">
      <Panel
        id="synonym-add"
        title="동의어 더하기"
        description="독자가 다르게 부르는 말을 함께 찾습니다. 예: '매도'를 찾으면 '양도'·'팔기'도 찾기. 반대 방향은 따로 한 줄을 더합니다. 저장하면 다음 검색부터 바로 쓰입니다."
      >
        <details open={prefill !== null}>
          <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">새 줄 적기</summary>
          <SynonymForm mode="create" initialTerm={prefill ?? undefined} />
        </details>
      </Panel>
      <Panel id="synonym-list" title={`검색 동의어 ${rows.length}줄`}>
        {rows.length === 0 && <EmptyNote>동의어 사전이 비어 있습니다.</EmptyNote>}
        <ul className="space-y-3" data-testid="synonym-list">
          {rows.map((r) => (
            <li key={r.id} id={`synonym-${r.id}`} data-testid={`synonym-${r.id}`} className="scroll-mt-4 rounded-xl border border-navy-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">{r.term}</span>
                <ToneChip tone={r.enabled ? "emerald" : "plain"}>{r.enabled ? "사용 중" : "쉬는 중"}</ToneChip>
                <span className="text-[14px] text-navy-600">
                  찾는 열쇠 <TermKey value={r.term_key} />
                </span>
              </div>
              <p className="mt-1 text-[15px] text-navy-800 [overflow-wrap:anywhere]">함께 찾을 말: {r.synonyms.join(", ")}</p>
              {r.note && <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">메모: {r.note}</p>}
              <div className="mt-2 flex flex-wrap items-start gap-4">
                <details className="min-w-0 flex-1">
                  <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
                  <SynonymForm mode="patch" item={{ id: r.id, term: r.term, termKey: r.term_key, synonyms: r.synonyms, enabled: r.enabled, note: r.note }} />
                </details>
                <SynonymDelete id={r.id} term={r.term} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
