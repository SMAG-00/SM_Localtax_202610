// 점검 함수 — 규칙 ID마다 하나. 기준값(params)과 문구(messages)는 규칙 파일에서 받는다. 네트워크·AI·현재 시각을 쓰지 않는다.
import { calendarDateAt, parseCalendarDate, parseInstant } from "./dates";
import type { Vars } from "./text";
import type { ArticleForLint, LintContext } from "./types";

export type Outcome =
  | { kind: "pass"; vars?: Vars }
  /** variant = 규칙 파일 messages의 키 */
  | { kind: "fail"; variant: string; vars?: Vars }
  /** 이 원고에는 해당 없음 — messages.notApplicable, 점수에서 뺀다 */
  | { kind: "not_applicable" }
  /** 비교할 대상이 없어 판단 못 함 — messages.unverified, 등급은 규칙의 unverifiedLevel */
  | { kind: "unverified" };

export type ParamType = "int" | "string" | "strings";
type ParamSpec = Readonly<Record<string, ParamType>>;
type ParamValues<S extends ParamSpec> = {
  readonly [K in keyof S]: S[K] extends "int" ? number : S[K] extends "string" ? string : readonly string[];
};

export interface CheckDef<S extends ParamSpec = ParamSpec> {
  /** 규칙 파일 params의 이름과 형식 */
  params: S;
  /** 규칙 파일 messages에 꼭 있어야 하는 키 (그 밖의 키는 거부) */
  messageKeys: readonly string[];
  /** 'unverified'를 낼 수 있음 — 규칙에 unverifiedLevel이 있어야 한다 */
  canBeUnverified?: boolean;
  /** text(key) = 규칙 파일 messages[key] (목록 항목 이름 등) */
  run(article: ArticleForLint, context: LintContext, params: ParamValues<S>, text: (key: string) => string): Outcome;
}

const define = <S extends ParamSpec>(def: CheckDef<S>): CheckDef => def as unknown as CheckDef;
const pass = (vars?: Vars): Outcome => ({ kind: "pass", vars });
const fail = (variant: string, vars?: Vars): Outcome => ({ kind: "fail", variant, vars });
const blank = (s: string | null | undefined) => (s ?? "").trim() === "";
const sortedUnique = (xs: readonly string[]) => [...new Set(xs)].sort();

/** canonical 비교 열쇠 — 절대 http(s) 주소만. 호스트 대소문자·끝 슬래시·#조각·http/https 차이는 같은 주소로 본다 */
export function canonicalKey(value: string | null): string | null {
  if (blank(value)) return null;
  let url: URL;
  try {
    url = new URL(value!.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${url.host}${path}${url.search}`;
}

const titleKey = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

interface DateCheck {
  /** missing = 값이 없거나(필수) 형식 오류 · mismatch = 기록과 화면이 다름(한쪽만 있음 포함) */
  status: "ok" | "missing" | "mismatch";
  instant: number | null;
}

/** 기록 값(시간대 붙은 시각)과 화면 값(시각, 또는 날짜만)을 비교 */
function compareDate(recorded: string | null, shown: string | null, required: boolean, offsetMinutes: number): DateCheck {
  const instant = recorded === null ? null : parseInstant(recorded);
  const shownInstant = shown === null ? null : parseInstant(shown);
  const shownDate = shown === null ? null : parseCalendarDate(shown);
  const malformed = (recorded !== null && instant === null) || (shown !== null && shownInstant === null && shownDate === null);
  if (malformed) return { status: "missing", instant };
  if (instant === null && shown === null) return { status: required ? "missing" : "ok", instant };
  if (instant === null || shown === null) return { status: required ? "missing" : "mismatch", instant };
  const same = shownInstant !== null ? shownInstant === instant : calendarDateAt(instant, offsetMinutes) === shownDate;
  return { status: same ? "ok" : "mismatch", instant };
}

export const CHECKS: Readonly<Record<string, CheckDef>> = {
  "seo.canonical": define({
    params: {},
    messageKeys: ["pass", "missing", "duplicate"],
    run(a, ctx) {
      const key = canonicalKey(a.canonical);
      if (key === null) return fail("missing");
      const others = ctx.publishedArticles.filter((p) => p.id !== a.id && canonicalKey(p.canonical) === key).map((p) => p.id);
      return others.length ? fail("duplicate", { others: sortedUnique(others).join(", ") }) : pass();
    },
  }),

  "seo.unique-title": define({
    params: {},
    messageKeys: ["pass", "missing", "duplicate"],
    run(a, ctx) {
      if (blank(a.title)) return fail("missing");
      const key = titleKey(a.title);
      const others = ctx.publishedArticles.filter((p) => p.id !== a.id && titleKey(p.title) === key).map((p) => p.id);
      return others.length ? fail("duplicate", { others: sortedUnique(others).join(", ") }) : pass();
    },
  }),

  "seo.meta-description": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run: (a) => (blank(a.metaDescription) ? fail("fail") : pass()),
  }),

  "seo.internal-links": define({
    params: { min: "int" },
    messageKeys: ["pass", "fail"],
    run(a, _ctx, p) {
      const vars = { actual: a.internalLinkCount, min: p.min };
      return a.internalLinkCount >= p.min ? pass(vars) : fail("fail", vars);
    },
  }),

  "seo.official-source": define({
    params: { kinds: "strings" },
    messageKeys: ["pass", "fail"],
    run(a, _ctx, p) {
      const count = a.sources.filter((s) => p.kinds.includes(s.kind)).length;
      return count > 0 ? pass({ count }) : fail("fail");
    },
  }),

  "seo.image-alt": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run(a) {
      const count = a.images.filter((img) => blank(img.alt)).length;
      return count === 0 ? pass() : fail("fail", { count });
    },
  }),

  "aeo.question-heading": define({
    params: { suffixes: "strings" },
    messageKeys: ["pass", "fail"],
    run(a, _ctx, p) {
      const count = a.headings.filter((h) => p.suffixes.some((s) => h.text.trim().endsWith(s))).length;
      return count > 0 ? pass({ count }) : fail("fail");
    },
  }),

  "aeo.summary-box": define({
    params: { maxLines: "int" },
    messageKeys: ["pass", "missing", "tooLong"],
    run(a, _ctx, p) {
      const actual = a.summaryBoxLines.filter((l) => !blank(l)).length;
      if (actual === 0) return fail("missing");
      return actual > p.maxLines ? fail("tooLong", { actual, max: p.maxLines }) : pass({ actual });
    },
  }),

  "aeo.faq": define({
    params: { min: "int", max: "int" },
    messageKeys: ["pass", "fail"],
    run(a, _ctx, p) {
      const actual = a.faqs.filter((f) => !blank(f.question) && !blank(f.answer)).length;
      return actual >= p.min && actual <= p.max ? pass({ actual }) : fail("fail", { actual, min: p.min, max: p.max });
    },
  }),

  "geo.claim-evidence": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run(a) {
      const known = new Set([...a.sources.map((s) => s.id), ...a.evidence.map((e) => e.id)]);
      const count = a.claims.filter((c) => !c.evidenceIds.some((id) => known.has(id))).length;
      return count === 0 ? pass() : fail("fail", { count });
    },
  }),

  "geo.author": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run(a) {
      const count = a.authors.filter((au) => !blank(au.name) && !blank(au.peopleId)).length;
      return count > 0 ? pass({ count }) : fail("fail");
    },
  }),

  "geo.dates": define({
    params: { displayUtcOffsetMinutes: "int" },
    messageKeys: ["pass", "missing", "order", "mismatch", "field.publishedAt", "field.updatedAt"],
    run(a, _ctx, p, text) {
      const { data, displayed } = a.dates;
      const published = compareDate(data.publishedAt, displayed.publishedAt, true, p.displayUtcOffsetMinutes);
      const updated = compareDate(data.updatedAt, displayed.updatedAt, false, p.displayUtcOffsetMinutes);
      const checked = { publishedAt: published, updatedAt: updated };
      const fields = (status: DateCheck["status"]) =>
        (Object.keys(checked) as (keyof typeof checked)[])
          .filter((k) => checked[k].status === status)
          .map((k) => text(`field.${k}`))
          .join(", ");
      if (published.status === "missing" || updated.status === "missing") return fail("missing", { fields: fields("missing") });
      if (published.instant !== null && updated.instant !== null && updated.instant < published.instant) return fail("order");
      if (published.status === "mismatch" || updated.status === "mismatch") return fail("mismatch", { fields: fields("mismatch") });
      return pass();
    },
  }),

  "geo.law-basis-date": define({
    params: { targetSections: "strings" },
    messageKeys: ["pass", "fail", "notApplicable", "reason.section", "reason.taxReview", "reason.taxLens"],
    run(a, _ctx, p, text) {
      const reasons = [
        p.targetSections.includes(a.section) && text("reason.section"),
        a.taxReviewTarget && text("reason.taxReview"),
        a.hasTaxLens && text("reason.taxLens"),
      ].filter((r): r is string => typeof r === "string");
      if (reasons.length === 0) return { kind: "not_applicable" };
      const date = a.lawBasisDate === null ? null : parseCalendarDate(a.lawBasisDate);
      return date !== null ? pass({ date }) : fail("fail", { reasons: reasons.join(" · ") });
    },
  }),

  "common.structured-data": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run(a) {
      const fields = sortedUnique(a.structuredDataMismatches);
      return fields.length === 0 ? pass() : fail("fail", { fields: fields.join(", ") });
    },
  }),

  "common.similarity": define({
    params: {},
    messageKeys: ["pass", "fail", "unverified"],
    canBeUnverified: true,
    run(a) {
      if (a.similarity.status === "no_sources" || a.similarity.status === "no_body") return { kind: "unverified" };
      return a.similarity.status === "pass" ? pass() : fail("fail");
    },
  }),

  "common.sponsor-label": define({
    params: { labels: "strings", markerFormat: "string" },
    messageKeys: ["pass", "missing", "unlabeled", "place.badge", "place.metaTitle", "place.metaDescription", "place.headline"],
    run(a, _ctx, p, text) {
      const { label, pageBadge, structuredHeadline } = a.sponsorship;
      const marker = (l: string) => p.markerFormat.replaceAll("{label}", l);
      const texts = [
        ["metaTitle", a.metaTitle],
        ["metaDescription", a.metaDescription],
        ["headline", structuredHeadline],
      ] as const;
      const places: string[] = [];
      if (label === "없음") {
        if (!blank(pageBadge)) places.push("badge");
        for (const [place, value] of texts) if (p.labels.some((l) => value.includes(marker(l)))) places.push(place);
      } else {
        if ((pageBadge ?? "").trim() !== label) places.push("badge");
        for (const [place, value] of texts) if (!value.includes(marker(label))) places.push(place);
      }
      if (places.length === 0) return pass();
      const where = places.map((pl) => text(`place.${pl}`)).join(", ");
      return label === "없음" ? fail("unlabeled", { places: where }) : fail("missing", { label, places: where });
    },
  }),
};
