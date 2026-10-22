import type { Metadata } from "next";
import { ConfirmLinkForm, CreateLinkForm, RemoveLinkForm, SuggestLinksButton } from "@/components/admin/RegionalLinkControls";
import { EmptyNote, MONO, OUTLINE_BUTTON, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { LINK_ORIGIN_LABELS, LINK_RELATION_LABELS, LINK_STATUS_LABELS, LINK_TYPE_LABELS, OPEN_LINK_TYPES, SUGGEST_FROM_TYPES, parseLinkRef } from "@/lib/admin/regional-link-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadLinkBoard, type LinkView } from "@/lib/server/regional-links/board";

// 지역 연결 편집 (/admin/regions/links — W4 13단계, PRD-01B REG1-10 · LG-14, docs/dev/W4_설계.md 1장 13단계 · 5장 · 6장 · 12장 100번~) — 편집 책임자·관리자(regional_link.confirm).
//  · ?from=<종류>:<번호> — 그 대상(기사·공식 자료·프로젝트·지역)에서 나가는 연결: 같은 지역 자동 후보·편집자 후보(확인·지우기) · 확인된 연결(지금 공개 여부) · 최근 지운 연결
//  · from 없이 — 열린 후보(확인 대기) 최근 50건
// 후보는 이 화면에만 보인다. 확인된 연결만 공개 화면(기사 상세 '확인된 연결')에 나오고, 목적지가 비공개가 되면 다음 렌더부터 링크 0.
// 관광 항목 종류(명소·음식점·관광 정보)는 고르기 목록에 없고 저장도 거부된다(PRD-X). 메뉴 항목은 늘리지 않았다 — 지역 기사 판정판 머리·기사 편집 화면에서 연다.
export const metadata: Metadata = { title: "지역 연결" };
export const dynamic = "force-dynamic";

const SELECT = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3";

function End({ label, info }: { label: string; info: LinkView["to"] }) {
  return (
    <>
      <span className="font-semibold">{label}</span>{" "}
      {info.adminHref ? (
        <a className={TEXT_LINK} href={info.adminHref}>
          {info.title}
        </a>
      ) : (
        <span>{info.title}</span>
      )}{" "}
      <span className={`${MONO} text-navy-600`}>{info.note}</span>
    </>
  );
}

function LinkHead({ link, showFrom }: { link: LinkView; showFrom?: boolean }) {
  const live = link.status === "confirmed" && link.from_public && link.to_public && link.in_scope;
  return (
    <>
      <p className="text-[15px] text-navy-900">
        <ToneChip tone={link.status === "confirmed" ? "emerald" : link.status === "candidate" ? "amber" : "navy"}>{LINK_STATUS_LABELS[link.status]}</ToneChip>{" "}
        <ToneChip tone="navy">{LINK_RELATION_LABELS[link.relation]}</ToneChip>{" "}
        {showFrom && (
          <>
            <End label={`${LINK_TYPE_LABELS[link.from_type]} →`} info={link.from} />{" "}
          </>
        )}
        <End label={`→ ${LINK_TYPE_LABELS[link.to_type]}`} info={link.to} />
      </p>
      <p className={`${MONO} mt-1 text-[14px] text-navy-600`}>
        연결 #{link.id} · {LINK_ORIGIN_LABELS[link.origin]} · 만든 때 {isoToKstDateTime(link.created_at)}
        {link.confirmed_at && ` · 확인 ${isoToKstDateTime(link.confirmed_at)} ${link.confirmed_by}`}
        {link.reason && ` · 이유 ${link.reason}`}
      </p>
      <p className="mt-1 text-[14px]" data-part="link-public" data-live={live ? "true" : "false"}>
        {link.to_public ? "도착 공개" : "도착 비공개 — 확인할 수 없습니다(확인된 연결이면 공개 화면 링크 0)"}
        {!link.in_scope && " · 지역 범위 밖 — 확인할 수 없습니다"}
        {link.status === "confirmed" && (live ? " · 지금 공개 화면에 보입니다" : " · 지금 공개 화면에 보이지 않습니다")}
      </p>
    </>
  );
}

export default async function RegionalLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await pageViewer();
  requirePage(viewer, "regional_link.confirm");
  // ?from=종류:번호 (링크) 또는 ?t=종류&n=번호 (이 화면의 '보기' 폼 — JS 없이)
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : null);
  const fromText = one(params.from) ?? (one(params.t) !== null && one(params.n) !== null ? `${one(params.t)}:${one(params.n)}` : null);
  const from = parseLinkRef(fromText);
  const board = await loadLinkBoard(serviceDb(), from);
  const [typeDefault, idDefault] = from ? [from.type, from.id] : ["article", ""];

  return (
    <>
      <PageTitle
        title="지역 연결"
        description="프로젝트·기사·공식 자료·지역 허브를 잇습니다. 같은 지역 자동 후보는 이 화면에만 보이고, 편집자가 이유를 적어 확인한 연결만 공개됩니다. 명소·맛집 같은 관광 항목은 연결하지 않습니다."
      >
        <a className={TEXT_LINK} href="/admin/regions">
          지역 기사 판정으로
        </a>
      </PageTitle>
      <div className="space-y-8">
        <Panel id="link-from" title="연결을 볼 대상" description="종류와 번호(지역은 행정구역 코드 10자리)를 넣습니다. 기사 편집 화면의 '지역 연결' 링크로도 옵니다.">
          <form method="get" action="/admin/regions/links" className="grid gap-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end" data-form="regional-link-from">
            <label className="block text-[15px] font-bold text-navy-900" htmlFor="rl-from-type">
              출발 종류
              <select id="rl-from-type" name="t" defaultValue={typeDefault} className={SELECT}>
                {OPEN_LINK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LINK_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[15px] font-bold text-navy-900" htmlFor="rl-from-id">
              번호
              <input id="rl-from-id" name="n" defaultValue={idDefault} inputMode="numeric" className={SELECT} />
            </label>
            <button type="submit" className={OUTLINE_BUTTON}>
              보기
            </button>
          </form>
          {fromText !== null && !from && <p className="mt-3 text-[15px] text-rose-700">주소의 대상 모양이 틀립니다 — 종류:번호 (예: article:12 · region:1100000000)</p>}
        </Panel>

        {board.from ? (
          <>
            <Panel
              id="link-source"
              title={`${LINK_TYPE_LABELS[board.from.type]} — ${board.from.title}`}
              description={board.from.exists ? board.from.note : "없는 대상입니다 — 번호를 확인하세요"}
            >
              <div data-testid="link-from" data-from={`${board.from.type}:${board.from.id}`} className="space-y-4">
                {board.from.adminHref && (
                  <a className={TEXT_LINK} href={board.from.adminHref}>
                    편집 화면으로
                  </a>
                )}
                {board.from.exists && SUGGEST_FROM_TYPES.includes(board.from.type) && <SuggestLinksButton fromType={board.from.type} fromId={board.from.id} />}
              </div>
            </Panel>

            <Panel id="link-candidates" title={`후보 ${board.candidates.length}건`} description="같은 지역 자동 후보와 편집자가 만든 후보입니다. 공개 화면에는 보이지 않습니다.">
              {board.candidates.length === 0 ? (
                <EmptyNote>후보가 없습니다.</EmptyNote>
              ) : (
                <ul className="space-y-6" data-testid="link-candidates">
                  {board.candidates.map((l) => (
                    <li key={l.id} data-link-id={l.id} data-to={`${l.to_type}:${l.to_id}`} data-origin={l.origin} className="rounded-xl border border-navy-100 p-4">
                      <LinkHead link={l} />
                      {l.to_public && l.in_scope && <ConfirmLinkForm id={l.id} relation={l.relation} />}
                      <RemoveLinkForm id={l.id} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel id="link-confirmed" title={`확인된 연결 ${board.confirmed.length}건`} description="목적지가 비공개가 되면 다음 렌더부터 공개 화면 링크가 빠집니다(연결 기록은 남습니다).">
              {board.confirmed.length === 0 ? (
                <EmptyNote>확인된 연결이 없습니다.</EmptyNote>
              ) : (
                <ul className="space-y-6" data-testid="link-confirmed">
                  {board.confirmed.map((l) => (
                    <li key={l.id} data-link-id={l.id} data-to={`${l.to_type}:${l.to_id}`} className="rounded-xl border border-navy-100 p-4">
                      <LinkHead link={l} />
                      <RemoveLinkForm id={l.id} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {board.from.exists && (
              <Panel id="link-create" title="연결 만들기" description="관계·이유를 적습니다. 바로 확인하면 확인 기록(확인자·시각·이유)이 남고 공개 화면에 나옵니다.">
                <CreateLinkForm fromType={board.from.type} fromId={board.from.id} />
              </Panel>
            )}

            <Panel id="link-removed" title="최근 지운 연결 20건">
              {board.removed.length === 0 ? (
                <EmptyNote>지운 연결이 없습니다.</EmptyNote>
              ) : (
                <ul className="space-y-3 text-[14px]" data-testid="link-removed">
                  {board.removed.map((l) => (
                    <li key={l.id} data-link-id={l.id}>
                      <LinkHead link={l} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : (
          <Panel id="link-open" title={`열린 후보 ${board.candidates.length}건`} description="확인을 기다리는 연결 후보입니다(최근 50건). 대상을 열어 확인하거나 지웁니다.">
            {board.candidates.length === 0 ? (
              <EmptyNote>열린 후보가 없습니다.</EmptyNote>
            ) : (
              <ul className="space-y-4" data-testid="link-open">
                {board.candidates.map((l) => (
                  <li key={l.id} data-link-id={l.id}>
                    <LinkHead link={l} showFrom />
                    <a className={TEXT_LINK} href={`/admin/regions/links?from=${l.from_type}:${l.from_id}`}>
                      이 대상의 연결 열기
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
