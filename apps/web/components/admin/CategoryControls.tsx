"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { categoryFormToBody, moveInOrder, type CategoryForm as Form } from "@/lib/admin/category-rules";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { SECTION_LABELS } from "@/lib/admin/labels";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { MONO, OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

export interface CategoryItem {
  id: number;
  section: string;
  slug: string;
  name: string;
  intro: string | null;
  sort: number;
  visible: boolean;
  needs_disclaimer: boolean;
  needs_tax_lens: boolean;
}

type Section = keyof typeof SECTION_LABELS;

/** 경고 문장 (긴 문장·풀이 없는 용어) — 저장은 됐다 */
function warningsOf(body: Record<string, unknown>): string[] {
  const checks = Array.isArray(body.checks) ? body.checks : [];
  return checks.flatMap((c) => (typeof c === "object" && c !== null && typeof (c as { message?: unknown }).message === "string" ? [(c as { message: string }).message] : []));
}

/** 하위 분야 더하기·고치기 폼 (CAT-01) — 이름·주소·소개·공개·면책 대상·「지방세로 읽기」 필수 */
export function CategoryForm({ mode, section, category }: { mode: "create" | "patch"; section: Section; category?: CategoryItem }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = mode === "create" ? `cat-new-${section}` : `cat-${category!.id}`;
  const [form, setForm] = useState<Form>({
    section,
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    intro: category?.intro ?? "",
    visible: category?.visible ?? false,
    needsDisclaimer: category?.needs_disclaimer ?? false,
    needsTaxLens: category?.needs_tax_lens ?? section !== "tax",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const text = (key: "name" | "slug" | "intro") => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const flag = (key: "visible" | "needsDisclaimer" | "needsTaxLens") => (e: { target: { checked: boolean } }) => setForm((f) => ({ ...f, [key]: e.target.checked }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    setWarnings([]);
    const v = categoryFormToBody(form, mode, base);
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(Object.keys(v.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = mode === "create" ? await adminApi("POST", "/api/admin/categories", v.body) : await adminApi("PATCH", `/api/admin/categories/${category!.id}`, v.body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(mode === "create" ? `하위 분야를 더했습니다 — ${form.name.trim()}` : "저장했습니다");
      setWarnings(warningsOf(r.body));
      if (mode === "create") setForm((f) => ({ ...f, name: "", slug: "", intro: "" }));
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={mode === "create" ? `${SECTION_LABELS[section]} 하위 분야 더하기` : `${category!.name} 고치기`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-name`} label="이름" required value={form.name} onChange={text("name")} error={errors[`${base}-name`]} />
        <TextField
          id={`${base}-slug`}
          label="주소(slug)"
          required
          hint={`/${section}/주소 — 영문 소문자·숫자·'-'`}
          value={form.slug}
          onChange={text("slug")}
          error={errors[`${base}-slug`]}
        />
      </div>
      <TextAreaField
        id={`${base}-intro`}
        label="소개 문구"
        hint="허브에 보이는 안내 문장입니다. 금지·공포 표현은 저장되지 않고, 60자 넘는 문장·3문장 넘는 소개는 경고가 뜹니다"
        value={form.intro}
        onChange={text("intro")}
        error={errors[`${base}-intro`]}
      />
      <div className="grid gap-1 sm:grid-cols-3">
        <CheckboxField id={`${base}-visible`} label="공개" checked={form.visible} onChange={flag("visible")} />
        <CheckboxField id={`${base}-disclaimer`} label="면책·세무 감수 대상" checked={form.needsDisclaimer} onChange={flag("needsDisclaimer")} />
        <CheckboxField id={`${base}-taxlens`} label="「지방세로 읽기」 필수" checked={form.needsTaxLens} onChange={flag("needsTaxLens")} />
      </div>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      {warnings.length > 0 && <ErrorSummary title="저장했지만 확인할 문장이 있습니다" messages={warnings} />}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "하위 분야 더하기" : "저장"}
      </DarkButton>
    </form>
  );
}

/** 한 분야(허브)의 하위 분야 목록 — 위로·아래로(순서 저장), 고치기 */
export function CategoryList({ section, categories }: { section: Section; categories: readonly CategoryItem[] }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const ids = categories.map((c) => c.id);

  async function move(id: number, direction: -1 | 1) {
    const next = moveInOrder(ids, id, direction);
    if (next.every((x, i) => x === ids[i])) return;
    setPending(true);
    setError("");
    setDone("");
    const r = await adminApi("POST", "/api/admin/categories/order", { section, ids: next });
    setPending(false);
    if (r.status === 200) {
      const name = categories.find((c) => c.id === id)?.name ?? "";
      setDone(`순서를 바꿨습니다 — ${name} ${direction < 0 ? "위로" : "아래로"}`);
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label={`${SECTION_LABELS[section]} 하위 분야 순서`}>
        {categories.map((c, i) => (
          <li key={c.id} data-testid={`category-${c.id}`} className="rounded-xl border border-navy-100 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${MONO} text-navy-600`}>{i + 1}</span>
              <span data-testid="category-name" className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">
                {c.name}
              </span>
              <span className={`${MONO} text-navy-600 [overflow-wrap:anywhere]`}>
                /{c.section}/{c.slug}
              </span>
              <ToneChip tone={c.visible ? "emerald" : "plain"}>{c.visible ? "공개" : "숨김"}</ToneChip>
              {c.needs_disclaimer && <ToneChip tone="amber">세무 감수 대상</ToneChip>}
              {c.needs_tax_lens && <ToneChip>「지방세로 읽기」 필수</ToneChip>}
            </div>
            {c.intro && <p className="mt-2 text-[15px] text-navy-700 [overflow-wrap:anywhere]">{c.intro}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated || i === 0} onClick={() => void move(c.id, -1)} aria-label={`${c.name} 위로`}>
                위로
              </button>
              <button
                type="button"
                className={OUTLINE_BUTTON}
                disabled={pending || !hydrated || i === categories.length - 1}
                onClick={() => void move(c.id, 1)}
                aria-label={`${c.name} 아래로`}
              >
                아래로
              </button>
            </div>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
              <CategoryForm mode="patch" section={section} category={c} />
            </details>
          </li>
        ))}
      </ol>
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}
