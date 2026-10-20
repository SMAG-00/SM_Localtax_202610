import { NEWS_TAB_LABELS, SECTION_KEYS } from "@/lib/server/public/constants";
import type { CategoryOption, RegionOption } from "@/lib/server/accounts/my-data";

// 관심 분야(4분야+하위 분야)·관심 지역 고르기 칸 — 가입 화면과 /my가 함께 쓴다. 일반 HTML 폼(JS 없이 동작).
const label = "block text-[15px] font-bold text-navy-900";
const row = "mt-1 flex min-h-11 items-center gap-2 text-[15px] text-navy-900";

export function InterestFields({
  categories,
  regions,
  interests,
  regionCodes,
  interestMax,
  regionLimit,
  idPrefix,
}: {
  categories: readonly CategoryOption[];
  regions: readonly RegionOption[];
  interests: readonly string[];
  regionCodes: readonly string[];
  interestMax: number;
  regionLimit: number;
  idPrefix: string;
}) {
  const sidos = regions.filter((r) => r.level === "sido");
  return (
    <>
      <fieldset>
        <legend className={label}>관심 분야 (선택, {interestMax}개까지)</legend>
        {SECTION_KEYS.map((key) => (
          <div key={key}>
            <label className={row}>
              <input type="checkbox" name="interests" value={key} defaultChecked={interests.includes(key)} className="size-5" /> {NEWS_TAB_LABELS[key]}
            </label>
            {categories
              .filter((c) => c.section === key)
              .map((c) => (
                <label key={c.slug} className={`${row} pl-7`}>
                  <input type="checkbox" name="interests" value={`${key}:${c.slug}`} defaultChecked={interests.includes(`${key}:${c.slug}`)} className="size-5" /> {c.name}
                </label>
              ))}
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend className={label}>관심 지역 (선택, {regionLimit}곳까지)</legend>
        {sidos.map((s) => {
          const children = regions.filter((r) => r.parentCode === s.code);
          const open = regionCodes.includes(s.code) || children.some((c) => regionCodes.includes(c.code));
          return (
            <details key={s.code} open={open} className="mt-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-navy-900">{s.name}</summary>
              <label className={row}>
                <input type="checkbox" name="regionCodes" value={s.code} defaultChecked={regionCodes.includes(s.code)} id={`${idPrefix}-${s.code}`} className="size-5" /> {s.name} 전체
              </label>
              {children.map((c) => (
                <label key={c.code} className={`${row} pl-7`}>
                  <input type="checkbox" name="regionCodes" value={c.code} defaultChecked={regionCodes.includes(c.code)} className="size-5" /> {c.name}
                </label>
              ))}
            </details>
          );
        })}
      </fieldset>
    </>
  );
}
