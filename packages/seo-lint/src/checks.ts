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
    // labels = [공동 기획 label, 광고 label] (articles.label 표기 값), badgeFormats = 같은 순서의 배지 모양({partner} = 제휴사 이름),
    // markerFormat = 메타·headline에 넣는 모양({badge} = 배지 글자)
    params: { labels: "strings", badgeFormats: "strings", markerFormat: "string" },
    messageKeys: ["pass", "missing", "unlabeled", "mixed", "partnerMissing", "place.badge", "place.metaTitle", "place.metaDescription", "place.headline"],
    run(a, _ctx, p, text) {
      const { label, partnerName, pageBadge, structuredHeadline } = a.sponsorship;
      const texts = [
        ["metaTitle", a.metaTitle],
        ["metaDescription", a.metaDescription],
        ["headline", structuredHeadline],
      ] as const;
      const formatOf = (l: string) => p.badgeFormats[p.labels.indexOf(l)] ?? l;
      const marker = (badge: string) => p.markerFormat.replaceAll("{badge}", badge);
      // 표기 형식 찾기 (표기 없는 기사·섞인 표기) — 배지 모양의 {partner} 자리는 아무 이름이나, 이름이 빠진 "[공동 기획]"도 표기로 본다
      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = (l: string) => {
        const [before, after] = p.markerFormat.split("{badge}") as [string, string | undefined];
        const format = formatOf(l);
        const name = format.includes("{partner}") ? "(?:\\s[^\\]\\n]*)?" : "";
        const badge = escape(format.replace(/\s*\{partner\}/, "")) + name;
        return new RegExp(`${escape(before)}${badge}${escape(after ?? "")}`);
      };
      const where = (places: readonly string[]) => places.map((pl) => text(`place.${pl}`)).join(", ");

      if (label === "없음") {
        const places: string[] = [];
        if (!blank(pageBadge)) places.push("badge");
        for (const [place, value] of texts) if (p.labels.some((l) => pattern(l).test(value))) places.push(place);
        return places.length === 0 ? pass() : fail("unlabeled", { places: where(places) });
      }
      const needsPartner = formatOf(label).includes("{partner}");
      if (needsPartner && blank(partnerName)) return fail("partnerMissing");
      const badge = formatOf(label).replaceAll("{partner}", (partnerName ?? "").trim());
      const missing: string[] = [];
      if ((pageBadge ?? "").trim() !== badge) missing.push("badge");
      for (const [place, value] of texts) if (!value.includes(marker(badge))) missing.push(place);
      if (missing.length > 0) return fail("missing", { label: badge, places: where(missing) });
      const others = p.labels.filter((l) => l !== label);
      const mixed = texts.filter(([, value]) => others.some((l) => pattern(l).test(value))).map(([place]) => place);
      return mixed.length === 0 ? pass() : fail("mixed", { places: where(mixed) });
    },
  }),

  "aeo.lead-answer": define({
    // maxSentences = 리드(본문 첫 문단)에 허용하는 문장 수 — 질문에 대한 직접 답을 1~2문장에 (OPT-03 AEO)
    params: { maxSentences: "int" },
    messageKeys: ["pass", "missing", "long"],
    run(a, _ctx, p) {
      const sentences = splitSentences(a.lead);
      if (sentences.length === 0) return fail("missing");
      return sentences.length <= p.maxSentences ? pass({ actual: sentences.length }) : fail("long", { actual: sentences.length, max: p.maxSentences });
    },
  }),

  "seo.keyword-density": define({
    // 같은 낱말(minTokenLength자 이상, 숫자만인 낱말 제외)이 본문 낱말 수의 maxPercent%를 넘으면 경고 (OPT-10 키워드 반복 금지).
    // 본문이 minTokens 낱말보다 짧으면 판단하지 않는다. 기준과 같은 값은 통과, 넘으면 경고
    params: { maxPercent: "int", minTokens: "int", minTokenLength: "int" },
    messageKeys: ["pass", "fail", "notApplicable"],
    run(a, _ctx, p) {
      const tokens = tokensOf(a.bodyText, p.minTokenLength);
      if (tokens.length < p.minTokens) return { kind: "not_applicable" };
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      // 가장 많이 나온 낱말 — 같은 횟수면 글자 순서가 앞선 것 (결정론)
      const [word, count] = [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]!;
      const percent = Math.round((1000 * count) / tokens.length) / 10;
      return count * 100 > p.maxPercent * tokens.length ? fail("fail", { word, count, percent, max: p.maxPercent }) : pass({ percent });
    },
  }),

  "common.quote-ratio": define({
    params: {},
    messageKeys: ["pass", "fail"],
    run(a) {
      return a.similarity.quoteWarning === true ? fail("fail") : pass();
    },
  }),
};

/** 문장 나누기 — 마침표·물음표·느낌표 뒤 공백, 줄바꿈 기준. 숫자 소수점(3.5)은 공백이 없어 나뉘지 않는다 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** 낱말 목록 — 글자·숫자가 아닌 것으로 나누고, 짧은 낱말과 숫자만인 낱말은 뺀다 */
export function tokensOf(text: string, minLength: number): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => [...t].length >= minLength && !/^\p{N}+$/u.test(t));
}
