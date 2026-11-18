"use client";

import { useState, type FormEvent } from "react";
import { CONTENT_TYPE_LABELS, SECTION_LABELS } from "@/lib/admin/labels";
import { DRAFT_CONTENT_TYPES, DRAFT_SECTIONS, type DraftDefaults } from "@/lib/editorial/article-draft";

// 결과물 → 기사 초안 옮기기 (PO 2026-11-18) — 누르면 확인 창(제목 40자·요약 60자·분야·하위 분야·유형·주소)을 미리 채워 열고,
// [초안 만들기]로 편집국에 초안 기사를 만든다(발행은 편집 화면에서 사람이 [발행]). 기사를 쓸 수 있는 사람에게만 보인다(페이지가 판정).
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";
const hint = "mt-1 text-[13px] text-navy-500";
const TITLE_MAX = 40;
const SUMMARY_MAX = 60;
const count = (s: string) => [...s.trim()].length;

interface Preview {
  defaults: DraftDefaults;
  categories: { section: string; slug: string; name: string }[];
  images: { path: string; kind: string; lead: boolean; confirmed: boolean }[];
  sources: number;
  needsCheck: string[];
  warnings: string[];
  mdPath: string;
  existing: { id: number; title: string } | null;
}
interface Done {
  article: { id: number; slug: string; title: string };
  images: { path: string; confirmed: boolean }[];
  sources: number;
  needsCheck: string[];
  warnings: string[];
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; body: T & { error?: string; errors?: string[] } }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({ error: "서버 응답을 읽지 못했습니다" }));
  return { ok: res.ok, body };
}

export function DraftFromPackage({ packageId, existingArticleId }: { packageId: string; existingArticleId: number | null }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState<DraftDefaults | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const url = `/api/editorial/packages/${packageId}/draft`;

  if (existingArticleId !== null && !done) {
    return (
      <p data-testid="draft-existing" className="text-[15px] text-navy-800">
        이 결과물로 만든 기사 초안이 있습니다.{" "}
        <a href={`/admin/articles/${existingArticleId}`} className="font-bold text-navy-900 underline">
          초안 열기 (기사 {existingArticleId}번)
        </a>
      </p>
    );
  }

  async function open() {
    setBusy("원고 읽는 중…");
    setErrors([]);
    const r = await call<{ preview: Preview }>(url);
    setBusy(null);
    if (!r.ok) return setErrors(r.body.errors ?? [r.body.error ?? "원고를 읽지 못했습니다"]);
    setPreview(r.body.preview);
    setForm(r.body.preview.defaults);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy("초안 만드는 중… (그림을 사진 보관함에 옮깁니다)");
    setErrors([]);
    const { title, summary, section, contentType, categorySlug, slug } = form;
    const r = await call<Done>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, summary, section, contentType, categorySlug: categorySlug ?? "", slug }) });
    setBusy(null);
    if (!r.ok) return setErrors(r.body.errors ?? [r.body.error ?? "초안을 만들지 못했습니다"]);
    setDone(r.body);
  }

  if (done) {
    const unconfirmed = done.images.filter((i) => !i.confirmed);
    return (
      <div data-testid="draft-done" role="status" className="space-y-2 text-[15px] text-navy-800">
        <p className="font-bold text-navy-900">기사 초안을 만들었습니다 — 편집 화면에서 확인하고 [발행]을 누르세요.</p>
        <p>
          <a href={`/admin/articles/${done.article.id}`} className="inline-flex min-h-11 items-center font-bold text-navy-900 underline">
            초안 열기 (기사 {done.article.id}번 · {done.article.title})
          </a>
        </p>
        <p>
          그림 {done.images.length}장을 사진 보관함에 넣었습니다{unconfirmed.length ? ` — 권리 미확인 ${unconfirmed.length}장은 사진 보관함에서 확인해야 발행됩니다` : " (모두 권리 확인됨)"}. 출처 {done.sources}건을 넣었습니다.
        </p>
        {done.needsCheck.length > 0 && <NeedsCheck items={done.needsCheck} />}
        {done.warnings.length > 0 && <Warnings items={done.warnings} />}
      </div>
    );
  }

  if (!preview || !form) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={open} disabled={busy !== null} data-testid="draft-open" className="min-h-11 rounded-xl border border-navy-900 bg-white px-5 text-[16px] font-bold text-navy-900 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
          {busy ?? "기사 초안으로 옮기기"}
        </button>
        <p className={hint}>기사 원고(.md)와 그림으로 편집국에 초안 기사를 만듭니다. 발행은 편집 화면에서 직접 합니다.</p>
        <ErrorList errors={errors} />
      </div>
    );
  }

  const cats = preview.categories.filter((c) => c.section === form.section);
  const set = (patch: Partial<DraftDefaults>) => setForm({ ...form, ...patch });
  const confirmed = preview.images.filter((i) => i.confirmed).length;

  return (
    <form onSubmit={submit} data-testid="draft-form" className="space-y-4" noValidate>
      <p className="text-[14px] text-navy-600">원고: {preview.mdPath}</p>
      <div>
        <label htmlFor="df-title" className={label}>
          제목 <span className={count(form.title) > TITLE_MAX ? "text-rose-700" : "text-navy-500"}>{count(form.title)}/{TITLE_MAX}자</span>
        </label>
        <input id="df-title" value={form.title} onChange={(e) => set({ title: e.target.value })} className={input} />
        {preview.defaults.titleOptions.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {preview.defaults.titleOptions.map((t) => (
              <button key={t} type="button" onClick={() => set({ title: t })} className="min-h-9 rounded-lg border border-navy-200 px-2 text-left text-[13px] text-navy-800">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label htmlFor="df-summary" className={label}>
          요약 <span className={count(form.summary) > SUMMARY_MAX ? "text-rose-700" : "text-navy-500"}>{count(form.summary)}/{SUMMARY_MAX}자</span>
        </label>
        <input id="df-summary" value={form.summary} onChange={(e) => set({ summary: e.target.value })} className={input} />
        <p className={hint}>원고의 [부제]를 넣었습니다. 원고의 [요약] 문장은 본문 맨 위 핵심 요약 상자로 들어갑니다.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="df-section" className={label}>분야</label>
          <select id="df-section" value={form.section} onChange={(e) => set({ section: e.target.value as DraftDefaults["section"], categorySlug: null })} className={input}>
            {DRAFT_SECTIONS.map((s) => (
              <option key={s} value={s}>{SECTION_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="df-category" className={label}>하위 분야</label>
          <select id="df-category" value={form.categorySlug ?? ""} onChange={(e) => set({ categorySlug: e.target.value || null })} className={input}>
            <option value="">없음</option>
            {cats.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="df-type" className={label}>기사 유형</label>
          <select id="df-type" value={form.contentType} onChange={(e) => set({ contentType: e.target.value as DraftDefaults["contentType"] })} className={input}>
            {DRAFT_CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="df-slug" className={label}>주소(slug)</label>
        <input id="df-slug" value={form.slug} onChange={(e) => set({ slug: e.target.value })} className={input} />
        <p className={hint}>공백과 &apos;/&apos; 없이 씁니다. 발행한 뒤에는 바꿀 수 없습니다.</p>
      </div>
      <p className="text-[14px] text-navy-700">
        그림 {preview.images.length}장 (권리 확인됨 {confirmed}장{preview.images.length - confirmed ? ` · 미확인 ${preview.images.length - confirmed}장` : ""}) · 출처 {preview.sources}건을 함께 넣습니다.
      </p>
      {preview.needsCheck.length > 0 && <NeedsCheck items={preview.needsCheck} />}
      {preview.warnings.length > 0 && <Warnings items={preview.warnings} />}
      <ErrorList errors={errors} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy !== null} data-testid="draft-submit" className="min-h-11 rounded-xl bg-navy-900 px-6 text-[16px] font-bold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
          {busy ?? "초안 만들기"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => setPreview(null)} className="min-h-11 rounded-xl px-4 text-[15px] text-navy-700 underline">
          닫기
        </button>
      </div>
    </form>
  );
}

function NeedsCheck({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50 px-4 py-3">
      <p className="text-[14px] font-bold text-navy-900">원고의 [확인 필요] — 발행 전에 확인하세요</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] text-navy-800">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  return (
    <ul data-testid="draft-warnings" className="list-disc space-y-1 pl-5 text-[14px] text-navy-700">
      {items.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div aria-live="polite">
      {errors.length > 0 && (
        <ul role="alert" data-testid="draft-errors" className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
