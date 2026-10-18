// 수집·집계 설정 모양 시험 — 설계 2.5 씨앗은 검사를 지나고, 틀린 값은 칸 경로가 붙은 오류. 버전 규칙. 수집 설정 읽기
import { describe, expect, test } from "vitest";
import {
  ANALYTICS_SETTING_KEYS,
  checkAnalytics,
  checkBotList,
  checkHotWeights,
  checkPopularRules,
  checkReferrers,
  parseCollectSettings,
  parseCheckedSettings,
  ANALYTICS_SETTING_CHECKS,
} from "./settings";
import { designList, designSeeds } from "./test-design";

const SEEDS = designSeeds();
const seed = <T = Record<string, unknown>>(key: string) => structuredClone(SEEDS.get(key)) as T;

describe("설계 문서와 같은 키·씨앗", () => {
  test("설정 키 5개 = 2.3 settings.analytics_keys = 2.5 씨앗 블록", () => {
    expect([...ANALYTICS_SETTING_KEYS]).toEqual(designList("2.3", "settings.analytics_keys"));
    expect([...SEEDS.keys()].sort()).toEqual([...ANALYTICS_SETTING_KEYS].sort());
  });
  test.each([...ANALYTICS_SETTING_KEYS])("씨앗 %s는 검사를 지난다", (key) => {
    expect(ANALYTICS_SETTING_CHECKS[key](SEEDS.get(key))).toEqual([]);
  });
});

describe("analytics", () => {
  test("범위 밖·모르는 칸·빠진 칸", () => {
    const v: Record<string, unknown> = { ...seed("analytics"), version: "v2" };
    expect(checkAnalytics({ ...v, stage: 6 })).toEqual(["stage: 1~5 정수여야 합니다"]);
    expect(checkAnalytics({ ...v, session_idle_minutes: 0 })).toEqual(["session_idle_minutes: 1~1440 정수여야 합니다"]);
    expect(checkAnalytics({ ...v, visitor_id_days: 401 })).toEqual(["visitor_id_days: 1~400 정수여야 합니다"]);
    expect(checkAnalytics({ ...v, retention_days: 30 })).toEqual(["retention_days: 31~1825 정수여야 합니다"]);
    expect(checkAnalytics({ ...v, respect_dnt: "no" })).toEqual(["respect_dnt: true/false여야 합니다"]);
    expect(checkAnalytics({ ...v, extra: 1 })).toEqual(["extra: 모르는 칸입니다"]);
    const { stage: _stage, ...missing } = v;
    void _stage;
    expect(checkAnalytics(missing)).toEqual(["stage: 필요합니다"]);
    expect(checkAnalytics([])).toEqual(["값은 JSON 객체여야 합니다"]);
  });
  test("속도 제한 — 10 이상, IP 상한은 방문자 상한 이상", () => {
    const v = { ...seed("analytics"), version: "v2" };
    expect(checkAnalytics({ ...v, rate_limits: { visitor_per_minute: 9, ip_per_minute: 600 } })).toEqual(["rate_limits.visitor_per_minute: 10~10000 정수여야 합니다"]);
    expect(checkAnalytics({ ...v, rate_limits: { visitor_per_minute: 200, ip_per_minute: 100 } })).toEqual(["rate_limits.ip_per_minute: 방문자 상한보다 작을 수 없습니다 (한 IP 뒤에 여러 방문자)"]);
    expect(checkAnalytics({ ...v, rate_limits: { visitor_per_minute: 100 } })).toEqual(["rate_limits.ip_per_minute: 필요합니다"]);
  });
  test("내용을 바꾸면서 버전을 그대로 두면 거부 — 같은 값이면 통과", () => {
    const current = seed("analytics");
    expect(checkAnalytics({ ...current, session_idle_minutes: 20 }, current)).toEqual(["version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 2026-10-18.1)"]);
    expect(checkAnalytics({ ...current, rate_limits: { visitor_per_minute: 100, ip_per_minute: 600 } }, current)).toHaveLength(1);
    expect(checkAnalytics(seed("analytics"), current)).toEqual([]);
    expect(checkAnalytics({ ...current, version: "2026-10-19.1", session_idle_minutes: 20 }, current)).toEqual([]);
  });
});

describe("bot_user_agents", () => {
  test("사람 브라우저 견본에 들어 있는 조각(mozilla·chrome·kakaotalk·naver·daum·mobile)은 거부 — 사람을 봇으로 센다", () => {
    for (const p of ["mozilla", "chrome", "kakaotalk", "naver", "daumapps", "mobile", "safari"]) {
      expect(checkBotList({ version: "v2", patterns: ["bot", p] }), p).toEqual(["patterns[1]: 사람 브라우저 견본 User-Agent에 들어 있어 사람을 봇으로 셉니다"]);
    }
  });
  test("소문자·공백 없음·2~60자·중복 없음·1~500개", () => {
    expect(checkBotList({ version: "v2", patterns: ["Bot"] })).toEqual(["patterns[0]: 공백 없는 소문자 영문·숫자·기호 2~60자여야 합니다"]);
    expect(checkBotList({ version: "v2", patterns: ["my bot"] })).toEqual(["patterns[0]: 공백 없는 소문자 영문·숫자·기호 2~60자여야 합니다"]);
    expect(checkBotList({ version: "v2", patterns: ["b"] })).toEqual(["patterns[0]: 공백 없는 소문자 영문·숫자·기호 2~60자여야 합니다"]);
    expect(checkBotList({ version: "v2", patterns: ["bot", "bot"] })).toEqual(["patterns[1]: 같은 조각이 앞에 있습니다"]);
    expect(checkBotList({ version: "v2", patterns: [] })).toEqual(["patterns: 글자 조각 1~500개 목록이어야 합니다"]);
  });
  test("목록을 바꾸면 버전도 바꾼다", () => {
    const current = seed<{ version: string; patterns: string[] }>("bot_user_agents");
    expect(checkBotList({ ...current, patterns: [...current.patterns, "mymonitor"] }, current)).toEqual(["version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 2026-10-18.1)"]);
    expect(checkBotList({ version: "2026-10-19.1", patterns: [...current.patterns, "mymonitor"] }, current)).toEqual([]);
  });
});

describe("analytics_referrers", () => {
  test("호스트 이름만(https://·경로·대문자 거부), 한 호스트는 한 목록에만", () => {
    const v = { ...seed<Record<string, unknown>>("analytics_referrers"), version: "v2" };
    expect(checkReferrers({ ...v, search: ["https://www.google.com"] })).toEqual(["search[0]: 소문자 호스트 이름이어야 합니다 (예: chatgpt.com — 경로·https:// 없음)"]);
    expect(checkReferrers({ ...v, search: ["google.com/search"] })).toHaveLength(1);
    expect(checkReferrers({ ...v, search: ["Google.com"] })).toHaveLength(1);
    expect(checkReferrers({ ...v, search: ["localhost"] })).toHaveLength(1);
    expect(checkReferrers({ ...v, search: ["naver.com"] })).toEqual(["search[0]: 같은 호스트가 naver에 있습니다"]);
    expect(checkReferrers({ ...v, naver: [] })).toEqual([]);
  });
});

describe("hot_weights (HOME-05) · popular_rules (ART-11)", () => {
  test("가중치 0~100, 모두 0은 거부, 고정 0~10건, 기간 1~90일", () => {
    const v = { ...seed("hot_weights"), version: "v2" };
    expect(checkHotWeights({ ...v, share: -1 })).toEqual(["share: 0~100 숫자여야 합니다"]);
    expect(checkHotWeights({ ...v, view: 0, share: 0, engaged: 0 })).toEqual(["view·share·engaged: 하나는 0보다 커야 합니다"]);
    expect(checkHotWeights({ ...v, view: 1.5 })).toEqual([]);
    expect(checkHotWeights({ ...v, max_pins: 11 })).toEqual(["max_pins: 0~10 정수여야 합니다"]);
    expect(checkHotWeights({ ...v, window_days: 0 })).toEqual(["window_days: 1~90 정수여야 합니다"]);
  });
  test("많이 본 기사 — 제외 유형은 기사 유형 값만·중복 없음, 건수·기간 범위", () => {
    const v = { ...seed("popular_rules"), version: "v2" };
    expect(checkPopularRules({ ...v, exclude_content_types: ["digest", "ads"] })).toEqual([
      "exclude_content_types[1]: reported_news·explainer·guide·opinion·sponsored·digest 중 하나여야 합니다",
    ]);
    expect(checkPopularRules({ ...v, exclude_content_types: ["digest", "digest"] })).toEqual(["exclude_content_types[1]: 같은 유형이 앞에 있습니다"]);
    expect(checkPopularRules({ ...v, exclude_content_types: [] })).toEqual([]);
    expect(checkPopularRules({ ...v, dedupe_minutes: -1 })).toEqual(["dedupe_minutes: 0~1440 정수여야 합니다"]);
    expect(checkPopularRules({ ...v, sidebar_size: 0, list_size: 101 })).toEqual(["sidebar_size: 1~20 정수여야 합니다", "list_size: 1~100 정수여야 합니다"]);
  });
});

describe("수집 설정 읽기 (수집 API)", () => {
  const rows = () => ["analytics", "bot_user_agents", "analytics_referrers"].map((key) => ({ key, value: seed(key) }));
  test("세 키가 모두 맞으면 설정, HOT·많이 본 기사 키는 읽지 않는다", () => {
    const r = parseCollectSettings(rows());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.analytics.session_idle_minutes).toBe(30);
      expect(r.settings.bots.patterns).toContain("headlesschrome");
      expect(r.settings.referrers.naver).toEqual(["naver.com"]);
    }
  });
  test("키가 없거나 모양이 틀리면 문제 목록 (수집 API는 503)", () => {
    expect(parseCollectSettings(rows().filter((r) => r.key !== "bot_user_agents"))).toEqual({ ok: false, problems: ["bot_user_agents: 설정 행이 없습니다"] });
    const broken = rows().map((r) => (r.key === "analytics" ? { ...r, value: { ...(r.value as object), stage: 0 } } : r));
    expect(parseCollectSettings(broken)).toEqual({ ok: false, problems: ["analytics: stage: 1~5 정수여야 합니다"] });
  });
});

describe("집계 배치 설정 읽기 (1시간 집계·보존 기한 정리 — 코드 상수 0)", () => {
  const rows = (keys: string[]) => keys.map((key) => ({ key, value: seed(key) }));
  test("고른 키만 검사해 값으로 — 씨앗이면 가중치 1·5·2, 창 168시간", () => {
    const r = parseCheckedSettings(rows(["popular_rules", "hot_weights", "analytics"]), ["popular_rules", "hot_weights"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([r.values.hot_weights.view, r.values.hot_weights.share, r.values.hot_weights.engaged]).toEqual([1, 5, 2]);
      expect(r.values.popular_rules.window_hours).toBe(168);
      expect(Object.keys(r.values).sort()).toEqual(["hot_weights", "popular_rules"]);
    }
  });
  test("키가 없거나 모양이 틀리면 '키: 문장' 목록 (배치는 실패로 기록하고 순위를 바꾸지 않는다)", () => {
    expect(parseCheckedSettings(rows(["hot_weights"]), ["popular_rules", "hot_weights"])).toEqual({ ok: false, problems: ["popular_rules: 설정 행이 없습니다"] });
    const broken = [{ key: "hot_weights", value: { ...seed<Record<string, unknown>>("hot_weights"), view: 0, share: 0, engaged: 0 } }];
    expect(parseCheckedSettings(broken, ["hot_weights"])).toEqual({ ok: false, problems: ["hot_weights: view·share·engaged: 하나는 0보다 커야 합니다"] });
  });
});
