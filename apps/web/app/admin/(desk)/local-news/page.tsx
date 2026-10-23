import type { Metadata } from "next";
import { ForbiddenView } from "@/components/admin/ForbiddenView";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { EVENT_CATEGORY_KEYS, EVENT_ORGANIZER_KEYS, EVENT_STATES, LICENSE_TYPES } from "@/lib/admin/local-news-rules";
import { serviceDb } from "@/lib/server/articles/service";
import { pageViewer } from "@/lib/server/admin/pages";
import { loadLocalNewsBoard } from "@/lib/server/local-news/board";
import { EVENT_CATEGORY_LABELS, EVENT_ORGANIZER_LABELS, EVENT_STATUS_LABELS, LICENSE_LABELS, kstDateTime } from "@/lib/server/public/local-news-logic";

// 지자체뉴스 관리 (/admin/local-news - W6, PRD-01B LG-01~14, docs/dev/W6_설계.md 1장 3단계).
//  · 공개 조건 - 기능 키 weekly_digest(시범 시·도 2곳 이상)·local_events 상태, 시·도별 연속 발행 주 수 (9.1 4주 연속)
//  · 핫뉴스 - 후보 넣기(허용 근거가 있는 출처만) -> 선정(요약) -> 유사도 검사 -> 발행 / 기획 전환
//  · 행사 - 회차 입력 -> 공개 / 상태(취소·변경 확인 중) / 연결 / 재확인 대상
// 보도 내용·행사 사실은 편집국이 공식 원문을 보고 직접 적습니다 (채워 넣는 기본값 0).
export const metadata: Metadata = { title: "지자체뉴스" };
export const dynamic = "force-dynamic";

const opt = (labels: Record<string, string>, keys: readonly string[]) => [{ value: "", label: "고르세요" }, ...keys.map((k) => ({ value: k, label: labels[k] ?? k }))];
const SIM_LABEL: Record<string, string> = { pass: "통과", blocked: "차단 (복제 의심)", no_sources: "비교 원문 없음 (통과 아님)", no_body: "판정할 문장 없음" };

const CANDIDATE_FIELDS = (sidos: { code: string; name: string }[], sources: { id: string; name: string }[]): LnField[] => [
  { name: "sido_code", label: "시·도", type: "select", options: [{ value: "", label: "고르세요" }, ...sidos.map((s) => ({ value: s.code, label: s.name }))], required: true },
  { name: "region_code", label: "시·군·구 코드 (있으면)", hint: "비우면 시·도" },
  { name: "source_id", label: "출처", type: "select", options: [{ value: "", label: "고르세요" }, ...sources.map((s) => ({ value: s.id, label: `${s.name} (${s.id})` }))], required: true },
  { name: "title", label: "제목", required: true },
  { name: "press_org", label: "발표기관", required: true },
  { name: "announced_at", label: "발표일 (YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm, 한국 시각)", required: true },
  { name: "source_url", label: "원문 주소", required: true },
  { name: "license_type", label: "공공누리 유형", type: "select", options: opt(LICENSE_LABELS, LICENSE_TYPES) },
  { name: "original_text", label: "원문 글자 (유사도 비교용, 공개되지 않음)", type: "area" },
];

const EVENT_FIELDS: LnField[] = [
  { name: "slug", label: "주소 이름 (영문 소문자·숫자·-)", required: true },
  { name: "series_key", label: "행사 묶음 키 (같은 행사의 회차는 같은 값)", required: true },
  { name: "title", label: "행사명", required: true },
  { name: "category", label: "분류", type: "select", options: opt(EVENT_CATEGORY_LABELS, EVENT_CATEGORY_KEYS), required: true },
  { name: "organizer", label: "주최", required: true },
  { name: "organizer_type", label: "주최 유형", type: "select", options: opt(EVENT_ORGANIZER_LABELS, EVENT_ORGANIZER_KEYS), required: true },
  { name: "venue", label: "장소", required: true },
  { name: "region_code", label: "지역 코드 (10자리)", required: true },
  { name: "starts_at", label: "시작 (YYYY-MM-DDTHH:mm, 한국 시각)", required: true },
  { name: "ends_at", label: "종료 (YYYY-MM-DDTHH:mm, 한국 시각)", required: true },
  { name: "official_url", label: "공식 주소", required: true },
  { name: "source_name", label: "출처 이름", required: true },
  { name: "confirmed_on", label: "정보 확인일 (YYYY-MM-DD)", required: true },
  { name: "sponsored", label: "광고(sponsored) - 영리 주최·판매 홍보 행사는 반드시 체크", type: "check" },
];

export default async function LocalNewsPage() {
  const viewer = await pageViewer();
  if (!can(viewer, "local_news.manage")) return <ForbiddenView />;
  const board = await loadLocalNewsBoard(serviceDb());
  const sidoName = (code: string) => board.sidos.find((s) => s.code === code)?.name ?? code;
  const liveSources = board.settings.sources;
  const drafts = board.digests.filter((d) => d.status === "draft");
  const published = board.digests.filter((d) => d.status === "published");

  return (
    <>
      <PageTitle title="지자체뉴스" description="금주 핫뉴스(후보 선정 - 요약 - 유사도 검사 - 발행)와 행사안내(회차 입력 - 공개)를 다룹니다. 내용은 공식 원문을 보고 직접 적습니다. 설정 값(시범 시·도, 출처, 요약 길이, 행사 재확인 기준)은 설정 화면에서 고칩니다." />
      <div className="space-y-8">
        <Panel id="ln-gate" title="공개 조건과 연속 발행" description="기능 키 weekly_digest·local_events는 설정 화면에서 켭니다. 금주 핫뉴스는 시범 시·도가 2곳 이상 설정돼야 켜집니다.">
          <p data-testid="ln-gate-state" className="text-[15px] text-navy-800">
            금주 핫뉴스 <ToneChip tone={board.flags.weekly_digest ? "emerald" : "amber"}>{board.flags.weekly_digest ? "켜짐" : "꺼짐"}</ToneChip> · 행사안내{" "}
            <ToneChip tone={board.flags.local_events ? "emerald" : "amber"}>{board.flags.local_events ? "켜짐" : "꺼짐"}</ToneChip> · 이번 주 {board.currentWeek} · 요약 길이 상한 {board.settings.summaryMax}자 · 출처 {liveSources.length}개 · 행사 재확인 {board.settings.recheck.days}일
          </p>
          <ul className="mt-3 space-y-1" data-testid="ln-streak">
            {board.sidos.filter((s) => s.configured).length === 0 ? (
              <li className="text-[14px] text-navy-600">시범 시·도가 아직 설정되지 않았습니다 (설정 digest_sidos).</li>
            ) : (
              board.sidos
                .filter((s) => s.configured)
                .map((s) => (
                  <li key={s.code} data-sido={s.code} data-streak={s.streak} className="text-[15px] text-navy-800">
                    {s.name} - 연속 발행 <span className={MONO}>{s.streak}주</span> (발행 {s.publishedWeeks}주 · 최근 {s.latestWeek ?? "없음"}){s.streak >= 4 ? " - 4주 연속 달성" : ""}
                  </li>
                ))
            )}
          </ul>
        </Panel>

        <Panel id="ln-candidates" title={`핫뉴스 후보 ${board.candidates.filter((c) => c.status === "new").length}건`} description="후보는 발표 시각순입니다 (조회수 정렬 없음). 허용 근거(약관·robots 확인일)가 설정에 있는 출처만 받습니다.">
          <details className="mb-6">
            <summary className="cursor-pointer font-bold text-navy-900">후보 넣기</summary>
            <div className="mt-4">
              {liveSources.length === 0 ? (
                <EmptyNote>설정 digest_sources에 허용 근거가 있는 출처가 없어 후보를 받을 수 없습니다.</EmptyNote>
              ) : (
                <OpForm id="ln-cand" op="candidate" label="핫뉴스 후보 넣기" submit="후보 저장" fields={CANDIDATE_FIELDS(board.sidos, liveSources)} />
              )}
            </div>
          </details>
          {board.candidates.length === 0 ? (
            <EmptyNote>후보가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="ln-candidate-list">
              {board.candidates.map((c) => (
                <li key={c.id as number} data-candidate-id={c.id as number} data-candidate-status={c.status as string} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                    {c.title as string} <ToneChip tone={c.status === "new" ? "navy" : c.status === "selected" ? "emerald" : "amber"}>{c.status === "new" ? "후보" : c.status === "selected" ? "선정됨" : "제외"}</ToneChip>
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600`}>
                    {sidoName(c.sido_code as string)} · {c.press_org as string} · {kstDateTime(c.announced_at as string)} · 원문 글자 {c.has_original ? "있음" : "없음"}
                  </p>
                  {c.status === "new" && (
                    <div className="mt-3 space-y-3">
                      <details>
                        <summary className="cursor-pointer font-bold text-navy-900">선정하고 요약 쓰기</summary>
                        <div className="mt-3">
                          <OpForm id={`ln-sel-${c.id}`} op="select" label="후보 선정" submit="선정 - 초안 주간 페이지에 항목 만들기" ctx={{ candidate_id: c.id }} fields={[{ name: "summary", label: "편집자 요약 (원문을 옮기지 말고 줄여 씁니다)", type: "area", required: true }, { name: "figures_checked", label: "요약의 수치를 원문과 대조했습니다", type: "check" }]} />
                        </div>
                      </details>
                      <OpForm id={`ln-dis-${c.id}`} op="candidate_status" label="후보 제외" submit="제외" ctx={{ id: c.id, status: "dismissed" }} fields={[]} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="ln-drafts" title={`초안 주간 페이지 ${drafts.length}건`} description="항목마다 유사도 검사를 통과해야 발행됩니다. 요약을 고치면 검사 기록이 지워지므로 다시 검사합니다.">
          {drafts.length === 0 ? (
            <EmptyNote>초안 주간 페이지가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="ln-draft-list">
              {drafts.map((d) => (
                <li key={d.id} data-digest-id={d.id} data-week-key={d.week_key} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900">
                    {d.sido_name} {d.week_key} <span className={`${MONO} text-navy-600`}>{d.starts_on} ~ {d.ends_on}</span>
                  </p>
                  <ul className="mt-3 space-y-4">
                    {d.items.map((i) => (
                      <li key={i.id} data-item-id={i.id} data-sim-status={i.sim_current ? (i.sim_status ?? "none") : "none"} className="rounded-lg bg-ivory p-3">
                        <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">{i.title}</p>
                        <p className={`${MONO} mt-1 text-navy-600`}>
                          {i.press_org} · {i.announced_on} · {LICENSE_LABELS[i.license_type]}
                        </p>
                        <p className="mt-2 text-navy-800 [overflow-wrap:anywhere]">{i.summary}</p>
                        <p data-part="sim-state" className="mt-2 text-[14px] text-navy-700">
                          유사도 {i.sim_current && i.sim_status ? (SIM_LABEL[i.sim_status] ?? i.sim_status) : "검사 전 (또는 요약을 고친 뒤 재검사 필요)"}
                          {i.sim_current && i.sim_ratio !== null ? ` · 유사 문장 비율 ${Math.round(i.sim_ratio * 100)}%` : ""} · 수치 확인 {i.figures_checked ? "완료" : "없음"} · 원문 글자 {i.has_original ? "있음" : "없음"}
                        </p>
                        {i.sim_current && i.sim_matches.length > 0 && (
                          <ul data-part="sim-matches" className="mt-2 list-disc pl-5 text-[14px] text-navy-800">
                            {i.sim_matches.map((m) => (
                              <li key={m.index}>유사 문장: {m.text}</li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 space-y-3">
                          <OpButton id={`ln-sim-${i.id}`} op="similarity" label="유사도 검사" ctx={{ id: i.id }} />
                          <details>
                            <summary className="cursor-pointer font-bold text-navy-900">요약 고치기</summary>
                            <div className="mt-3">
                              <OpForm id={`ln-item-${i.id}`} op="item" label="항목 고치기" submit="저장" ctx={{ id: i.id }} initial={{ summary: i.summary, figures_checked: i.figures_checked }} fields={[{ name: "summary", label: "편집자 요약", type: "area", required: true }, { name: "figures_checked", label: "요약의 수치를 원문과 대조했습니다", type: "check" }]} />
                            </div>
                          </details>
                          <OpButton id={`ln-rm-${i.id}`} op="item_remove" label="항목 빼기" ctx={{ id: i.id }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <OpButton id={`ln-pub-${d.id}`} op="publish" label="주간 페이지 발행" ctx={{ digest_id: d.id }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="ln-published" title={`발행된 주간 페이지 ${published.length}건`} description="발행된 주는 되돌리지 않고 주소가 계속 열립니다. 항목은 기사 기획 카드로 전환할 수 있습니다.">
          {published.length === 0 ? (
            <EmptyNote>발행된 주간 페이지가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="ln-published-list">
              {published.map((d) => (
                <li key={d.id} data-digest-id={d.id} data-week-key={d.week_key} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900">
                    {d.sido_name} {d.week_key} <span className={`${MONO} text-navy-600`}>항목 {d.items.length}건</span>
                  </p>
                  <ul className="mt-2 space-y-2">
                    {d.items.map((i) => (
                      <li key={i.id} data-item-id={i.id} className="flex flex-wrap items-center gap-3">
                        <span className="[overflow-wrap:anywhere]">{i.title}</span>
                        {i.assignment_id ? (
                          <span data-part="assignment" className={`${MONO} text-navy-600`}>
                            기획 카드 #{i.assignment_id}
                          </span>
                        ) : (
                          <OpButton id={`ln-conv-${i.id}`} op="convert" label="기획으로 전환" ctx={{ id: i.id }} />
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="ln-events" title={`행사 ${board.events.length}건`} description={`재확인 필요 ${board.recheckList.length}건. 행사는 기사가 아니라 정보 목록입니다. 필수 칸이 하나라도 비면 저장되지 않아 공개되지 않습니다.`}>
          <details className="mb-6">
            <summary className="cursor-pointer font-bold text-navy-900">행사 회차 넣기·고치기</summary>
            <div className="mt-4">
              <OpForm id="ln-event" op="event" label="행사 회차" submit="저장 (공개는 따로)" fields={EVENT_FIELDS} />
            </div>
          </details>
          {board.recheckList.length > 0 && (
            <ul data-testid="ln-recheck" className="mb-6 list-disc pl-5 text-[15px] text-navy-800">
              {board.recheckList.map((r) => (
                <li key={r.slug}>
                  일정 재확인 필요: {r.title} (마지막 확인 {r.confirmed_on})
                </li>
              ))}
            </ul>
          )}
          {board.events.length === 0 ? (
            <EmptyNote>행사가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="ln-event-list">
              {board.events.map((e) => (
                <li key={e.slug} data-event-slug={e.slug} data-event-status={EVENT_STATUS_LABELS[e.status]} data-event-published={e.published ? "true" : "false"} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                    {e.title} <ToneChip tone={e.published ? "emerald" : "amber"}>{e.published ? "공개" : "비공개"}</ToneChip> <ToneChip tone="navy">{EVENT_STATUS_LABELS[e.status]}</ToneChip>
                    {e.sponsored ? <ToneChip tone="amber">광고</ToneChip> : null}
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600`}>
                    /{e.slug} · {EVENT_CATEGORY_LABELS[e.category as keyof typeof EVENT_CATEGORY_LABELS]} · {kstDateTime(e.starts_at)} ~ {kstDateTime(e.ends_at)} · 확인일 {e.confirmed_on}
                    {e.recheck_due ? " · 일정 재확인 필요" : ""}
                  </p>
                  <div className="mt-3 space-y-3">
                    <OpButton id={`ln-evpub-${e.slug}`} op="event_publish" label={e.published ? "내리기" : "공개"} ctx={{ slug: e.slug, published: !e.published }} />
                    <OpForm id={`ln-evst-${e.slug}`} op="event_status" label="행사 상태" submit="상태 바꾸기" ctx={{ slug: e.slug }} fields={[{ name: "state", label: "지정 상태", type: "select", options: [{ value: "", label: "고르세요" }, ...EVENT_STATES.map((s) => ({ value: s, label: s === "normal" ? "정상 (시각으로 계산)" : s === "changing" ? "변경 확인 중" : "취소" }))], required: true }, { name: "source_url", label: "공식 출처 주소 (취소는 필수)" }]} />
                    <OpForm id={`ln-evlk-${e.slug}`} op="event_link" label="행사 연결" submit="연결 확인" ctx={{ slug: e.slug }} fields={[{ name: "target_kind", label: "연결 종류", type: "select", options: [{ value: "", label: "고르세요" }, { value: "project", label: "프로젝트" }, { value: "article", label: "기사" }], required: true }, { name: "target_id", label: "대상 번호", required: true }, { name: "reason", label: "연결 이유", required: true }]} />
                    {e.links.length > 0 && (
                      <ul className="text-[14px] text-navy-700">
                        {e.links.map((l) => (
                          <li key={l.id} data-link-id={l.id}>
                            {l.target_kind} #{l.target_id} - {l.reason}
                            <OpButton id={`ln-unl-${l.id}`} op="event_unlink" label="연결 지우기" ctx={{ id: l.id }} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.history.length > 0 && (
                      <ul data-part="status-history" className="text-[13px] text-navy-600">
                        {e.history
                          .slice()
                          .reverse()
                          .map((h) => (
                            <li key={h.id}>
                              {h.from_state} - {h.to_state} · {kstDateTime(h.created_at)} · {h.changed_by}
                              {h.source_url ? ` · ${h.source_url}` : ""}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
