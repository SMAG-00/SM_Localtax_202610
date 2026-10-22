// 통합 검색 성능 하네스 (W2-d 1단계 — docs/dev/W2-d_설계.md 9장 · PRD-01A SRCH-02 · PRD-01B REG1-11 '검색 응답 p95 ≤ 800ms')
// 로컬 Supabase에 이관 규모 자료를 넣고(기사 20,000 · 트래커 300 · 상황 40 · 용어 200 · 시·군·구 250 · 인물 40 · 동의어 30 —
// 이관 기사 수 [확인 필요], PRD '이관 기사 전량'), 실제 API(PostgREST)에 anon 키로 정해진 검색어 묶음을 차례로 불러 p50·p95·최대를 찍는다.
// p95 > 800ms면 실패. 넣은 자료는 끝나면 지우고(실패해도) 표 행 수가 시험 전과 같은지 본다. 로컬 DB에서만 돈다.
// 실행: node --test --test-concurrency=1 e2e/search-perf.test.mjs   (SEARCH_PERF_ARTICLES=숫자 로 기사 수를 바꿀 수 있다 — 기본 20000)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { localSupabase } from "./lib/local.mjs";

const P95_LIMIT_MS = 800;
const ARTICLES = Number(process.env.SEARCH_PERF_ARTICLES ?? 20000);
const RUNS = 8; // 검색어마다 잰 횟수 (앞에 한 번 더 데워 두고 버린다)
const TAG = "perf-search";
const TABLES = ["articles", "amendments", "amendment_events", "situations", "glossary_terms", "regions", "people", "search_synonyms", "raw_snapshots"];

let db;
let sb;
const before_counts = {};

// ── 글 조각 (실제 기사 문장 길이·낱말 분포를 흉내 — 흔한 낱말은 기사 대부분에 나온다) ─────────
const SENTENCES = [
  "올해 지방세 세입 예산은 지난해보다 소폭 늘어난 것으로 집계됐다.",
  "주택을 산 사람은 취득일로부터 60일 안에 취득세를 신고하고 납부해야 한다.",
  "다주택자의 취득세 중과 기준이 바뀌면서 실수요자의 문의가 늘고 있다.",
  "재건축 조합원 입주권을 물려받는 경우 상속세와 취득세를 함께 따져야 한다.",
  "재개발 구역의 관리처분 인가 이후에는 세금 부담이 달라질 수 있다.",
  "재산세 과세표준은 공시가격에 공정시장가액비율을 곱해 정한다.",
  "지방교육세는 취득세와 재산세에 일정 비율로 덧붙어 부과된다.",
  "자동차를 팔거나 폐차하면 남은 기간의 자동차세를 돌려받을 수 있다.",
  "부동산 신탁을 활용한 개발 사업은 신탁사의 역할이 쟁점이 된다.",
  "프로젝트파이낸싱(PF) 대출의 만기 연장 여부가 시장의 관심사다.",
  "리츠는 부동산에 투자해 얻은 수익을 투자자에게 배당하는 회사다.",
  "지자체는 지방재정 건전성을 높이기 위해 세출 구조조정에 나섰다.",
  "행정안전부는 지방세제 개편안을 발표하고 의견을 듣는다고 밝혔다.",
  "개정안은 국회 심의를 거쳐 내년부터 시행될 예정이다.",
  "부모님 집을 증여받을 때에는 증여세 외에 취득세도 내야 한다.",
  "형제자매가 공동으로 상속받은 주택은 지분만큼 세금을 나눠 낸다.",
  "부담부증여는 채무를 함께 넘기는 증여로 양도세 문제가 생길 수 있다.",
  "법인이 부동산을 사면 일반 세율보다 높은 세율이 적용될 수 있다.",
  "지방세 감면 조례는 지자체마다 내용이 다르므로 확인이 필요하다.",
  "고지서를 받았다면 납부 기한과 가산세 기준을 먼저 확인하는 것이 좋다.",
  "세금을 돌려받으려면 경정청구 기한 안에 신청해야 한다.",
  "공공주택 공급 계획에 따라 신도시 분양 일정이 앞당겨졌다.",
  "도시정비 사업의 공사비 갈등으로 착공이 늦어지는 곳이 많다.",
  "신속통합기획 대상지로 선정되면 정비계획 수립 기간이 줄어든다.",
  "주민설명회에서는 분담금과 이주 대책에 대한 질문이 이어졌다.",
  "지방소멸 대응 기금이 인구감소 지역에 우선 배분된다.",
  "시군구별 재정자립도 차이가 해마다 커지고 있다는 분석이 나왔다.",
  "취득세 감면 특례의 일몰 기한이 다가오면서 연장 여부가 주목된다.",
  "생애최초 주택 구입자에 대한 취득세 감면 한도가 조정됐다.",
  "임대사업자의 재산세 감면 요건이 강화될 예정이다.",
  "토지거래허가구역 지정이 연장되면서 거래량이 줄었다.",
  "개발부담금과 기반시설 설치비용 분담 기준이 논의되고 있다.",
  "공시가격 현실화 계획의 속도 조절이 재산세에 영향을 준다.",
  "종합부동산세와 재산세의 이중 부담 논란이 다시 불거졌다.",
  "정비사업 조합의 임원 선출을 둘러싼 소송이 이어지고 있다.",
  "지자체 금고 선정 결과에 따라 이자 수입이 달라진다.",
  "주민참여예산 제도로 생활 밀착형 사업이 늘어났다.",
  "지역 축제 예산의 효과를 두고 의회에서 공방이 벌어졌다.",
  "공유재산 매각 절차의 투명성을 높이는 조례가 통과됐다.",
  "세무조사 대상 선정 기준이 공개되면서 납세자 권리가 강화됐다.",
];
/** 드문 문장 — 기사 97건 중 1건에만 (드문 낱말 검색) */
const RARE = "이 사업장은 신탁사의 책임준공 확약 이행 여부를 두고 소송이 진행 중이다.";
const TITLE_WORDS = ["취득세", "재산세", "지방세", "재건축", "재개발", "상속", "증여", "자동차세", "지방재정", "개편안", "감면", "신탁", "PF", "리츠", "분양", "공시가격", "조례", "예산", "경정청구", "가산세"];
const TITLE_TAILS = ["무엇이 달라지나", "기준 바뀐다", "신고 전에 확인할 것", "논란 이어져", "연장 여부 주목", "Q&A로 정리", "현장을 가다", "지자체별 비교", "숫자로 본 변화", "쟁점 정리"];
const GLOSSARY = [
  "취득세", "재산세", "지방교육세", "지역자원시설세", "주민세", "자동차세", "지방소득세", "등록면허세", "레저세", "담배소비세",
  "지방소비세", "과세표준", "공시가격", "공정시장가액비율", "중과세", "감면", "비과세", "경정청구", "가산세", "납세의무자",
  "재건축", "재개발", "신속통합기획", "관리처분인가", "사업시행인가", "조합원 입주권", "분양권", "분담금", "이주비", "정비계획",
  "신탁", "관리형 토지신탁", "차입형 토지신탁", "책임준공", "PF", "브릿지론", "본PF", "리츠", "부동산펀드", "자산유동화",
  "상속", "증여", "부담부증여", "공동상속", "상속세", "증여세", "유류분", "지방재정", "재정자립도", "교부세",
];
const REGION_NAMES = ["성동구", "강남구", "중구", "동구", "서구", "남구", "북구", "수원시", "성남시", "고양시", "용인시", "경주시", "포항시", "창원시", "김해시", "전주시", "청주시", "천안시", "춘천시", "강릉시", "제주시", "서귀포시", "여수시", "순천시", "안동시"];
const SIDO = ["11", "26", "27", "28", "29", "30", "31", "36", "41", "43", "44", "46", "47", "48", "50", "51", "52"];

/** 잰 검색 — 이름, search_public 인자 */
const CASES = [
  ["흔한 낱말 · 전체(종류별 3)", { p_query: "지방세", p_per_kind: 3 }],
  ["흔한 낱말 · 기사 탭 1쪽", { p_query: "지방세", p_kinds: ["article"] }],
  ["흔한 낱말 · 기사 탭 10쪽", { p_query: "지방세", p_kinds: ["article"], p_offset: 180 }],
  ["취득세 · 전체", { p_query: "취득세", p_per_kind: 3 }],
  ["취득 세 (띄어쓰기) · 전체", { p_query: "취득 세", p_per_kind: 3 }],
  ["재건축 · 기사 탭", { p_query: "재건축", p_kinds: ["article"] }],
  ["재 건축 (띄어쓰기) · 기사 탭", { p_query: "재 건축", p_kinds: ["article"] }],
  ["개편안 · 전체", { p_query: "개편안", p_per_kind: 3 }],
  ["차 팔았 (다시 찾기) · 전체", { p_query: "차 팔았", p_per_kind: 3 }],
  ["성동구 재개발 (지역 + 주제)", { p_query: "성동구 재개발", p_per_kind: 3 }],
  ["경주 취득세", { p_query: "경주 취득세", p_per_kind: 3 }],
  // W4 10단계 — 지역 + 주제 분류의 가장 무거운 꼴: 시·도 후보(그 아래 시·군·구 태그까지) + 흔한 주제 낱말
  ["서울 취득세 (시·도 + 주제 분류)", { p_query: "서울 취득세", p_per_kind: 3 }],
  ["서울특별시 재건축 (시·도 + 주제 별칭) · 기사 탭", { p_query: "서울특별시 재건축", p_kinds: ["article"] }],
  ["여러 낱말 6개", { p_query: "2026년 지방세제 개편안 취득세 감면 연장", p_per_kind: 3 }],
  ["드문 낱말", { p_query: "책임준공 확약", p_per_kind: 3 }],
  ["없는 낱말", { p_query: "없는낱말큐엑스", p_per_kind: 3 }],
  ["한 글자", { p_query: "세", p_per_kind: 3 }],
  ["영문 PF", { p_query: "PF 대출", p_kinds: ["article"] }],
  ["동의어 낱말", { p_query: "자동차매도", p_per_kind: 3 }],
  ["기사 유형 거르개 (보도)", { p_query: "취득세", p_content_type: "reported_news" }],
  ["분야 거르개 (부동산)", { p_query: "재건축", p_section: "realestate" }],
  ["지역 거르개 (서울)", { p_query: "취득세", p_region: "1100000000" }],
  ["기간 거르개 (최근 1년)", { p_query: "지방세", p_from: new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10) }],
  ["용어 탭", { p_query: "세", p_kinds: ["glossary"] }],
  ["지역 탭", { p_query: "구", p_kinds: ["region"] }],
  ["트래커 탭", { p_query: "개정안", p_kinds: ["tracker"] }],
];

async function counts() {
  const out = {};
  for (const t of TABLES) out[t] = Number((await db.query(`select count(*)::int n from public.${t}`)).rows[0].n);
  return out;
}

async function cleanup() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica"); // 추가만 되는 단계 기록을 지운다 (이 하네스가 넣은 것만)
    await db.query("delete from public.search_synonyms where updated_by = $1", [TAG]);
    await db.query("delete from public.situations where slug like $1", [`${TAG}-%`]);
    await db.query("delete from public.articles where slug like $1", [`${TAG}-%`]);
    await db.query("delete from public.amendment_events where amendment_id in (select id from public.amendments where slug like $1)", [`${TAG}-%`]);
    await db.query("delete from public.amendments where slug like $1", [`${TAG}-%`]);
    await db.query("delete from public.raw_snapshots where source = $1", [TAG]);
    await db.query("delete from public.glossary_terms where source = $1", [TAG]);
    await db.query("delete from public.regions where slug like $1", [`${TAG}-%`]);
    // 복제 모드에서는 외래 키 연쇄 삭제가 돌지 않는다 — 동의서(W3 7단계)를 먼저 지운다
    await db.query("delete from public.name_likeness_consents where person_id in (select id from public.people where slug like $1)", [`${TAG}-%`]);
    await db.query("delete from public.people where slug like $1", [`${TAG}-%`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  // PGroonga 색인의 지운 행 자리를 비운다 (트랜잭션 밖)
  for (const t of ["articles", "amendments", "situations", "glossary_terms", "regions", "people"]) await db.query(`vacuum public.${t}`);
}

async function seed() {
  const lit = (xs) => `array[${xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
  await db.query("begin");
  try {
    await db.query("select setseed(0.42)");
    // 인물 40 — 기자·필자 (공개)
    await db.query(
      `insert into public.people (slug, name, roles, visibility, affiliation, beat)
       select '${TAG}-p-' || i, (${lit(["김", "이", "박", "최", "정", "강", "조", "윤"])})[1 + i % 8] || (${lit(["민수", "지현", "서준", "하은", "도윤", "수빈", "예준", "지우"])})[1 + (i / 8) % 8],
              case when i % 5 = 0 then '{writer}'::text[] else '{reporter}'::text[] end, 'public', '편집국', (${lit(TITLE_WORDS)})[1 + i % 20]
       from generate_series(1, 40) i`,
    );
    // 시·군·구 250 — 시·도마다 15개 안팎 (이름은 실제 이름을 돌려 쓴다 — 성동구는 서울, 경주시는 경북에)
    await db.query(
      `insert into public.regions (code, parent_code, level, name, slug, aliases)
       select s.sd || lpad((700 + k)::text, 3, '0') || '00000', s.sd || '00000000', 'sigungu',
              case when s.sd = '11' and k = 0 then '성동구' when s.sd = '47' and k = 0 then '경주시' else (${lit(REGION_NAMES)})[1 + (k + s.n) % ${REGION_NAMES.length}] end,
              '${TAG}-r-' || s.sd || '-' || k, case when k % 7 = 0 then array['옛' || k || '군'] else '{}'::text[] end
       from unnest(${lit(SIDO)}) with ordinality as s(sd, n) cross join generate_series(0, case when s.n <= 12 then 14 else 13 end) k`,
    );
    const regions = (await db.query("select code from public.regions where slug like $1 order by code", [`${TAG}-%`])).rows.map((r) => r.code);
    const authors = (await db.query("select id from public.people where slug like $1 order by id", [`${TAG}-%`])).rows.map((r) => r.id);
    // 시험용 이름·초상 동의서 (W3 7단계 — 칼럼 발행·인물 결과 링크에 필요). 인물을 지우면 함께 지워진다
    await db.query(
      "insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) select id, '시험용', '{profile_page,column,home}', '시험용 동의서 위치', 'admin:e2e-setup' from public.people where slug like $1",
      [`${TAG}-%`],
    );
    const cats = (await db.query("select id, section from public.categories where visible order by id")).rows;
    // 기사 — 유형 분포: 보도 30 · 해설 35 · 가이드 15 · 오피니언 10 · 광고 5 · 이관 미분류 5(%), 발행 95%, 5년에 걸쳐, 30%에 지역 태그
    await db.query(
      `insert into public.articles (slug, title, summary, body, section, content_type, reporting_method, origin, label, category_id, author_id, status, first_published_at, region_codes)
       select '${TAG}-a-' || g,
              t.w1 || ' ' || t.w2 || ' ' || t.tail,
              case when g % 6 = 0 then null else (${lit(SENTENCES)})[1 + (g * 7) % ${SENTENCES.length}] end,
              b.body, x.section, x.ct,
              case when x.ct = 'reported_news' then (array['quantitative', 'qualitative', 'mixed'])[1 + g % 3] end,
              case when x.ct is null then 'legacy' else 'new' end,
              case when x.ct = 'sponsored' then 'ad' else 'none' end,
              (select c.id from public.categories c where c.section = x.section and c.visible order by c.id offset (g % 3) limit 1),
              ($1::bigint[])[1 + g % cardinality($1::bigint[])],
              case when g % 20 = 0 then 'draft' else 'published' end,
              case when g % 20 = 0 then null else now() - make_interval(days => (g * 37) % 1825, hours => g % 24) end,
              case when g % 10 < 3 then array[case when g % 2 = 0 then left(($2::text[])[1 + g % cardinality($2::text[])], 2) || '00000000' else ($2::text[])[1 + g % cardinality($2::text[])] end] else '{}'::text[] end
       from generate_series(1, $3::int) g
       cross join lateral (select (array['tax', 'realestate', 'finance', 'local'])[1 + g % 4] as section,
                                  (case when g % 20 < 6 then 'reported_news' when g % 20 < 13 then 'explainer' when g % 20 < 16 then 'guide'
                                        when g % 20 < 18 then 'opinion' when g % 20 = 18 then 'sponsored' else null end) as ct) x
       cross join lateral (select (${lit(TITLE_WORDS)})[1 + floor(random() * ${TITLE_WORDS.length} + g * 0)::int] as w1,
                                  (${lit(TITLE_WORDS)})[1 + (g * 3) % ${TITLE_WORDS.length}] as w2,
                                  (${lit(TITLE_TAILS)})[1 + g % ${TITLE_TAILS.length}] as tail) t
       cross join lateral (
         select jsonb_build_object('claims', '[]'::jsonb, 'blocks', jsonb_agg(jsonb_build_object('type', 'paragraph', 'text', case when p.n = 1 and g % 97 = 0 then '${RARE} ' else '' end || case when p.n = 2 and g % 10 < 4 then (${lit(REGION_NAMES)})[1 + g % ${REGION_NAMES.length}] || '에서는 ' || (${lit(TITLE_WORDS)})[1 + (g * 5) % ${TITLE_WORDS.length}] || ' 관련 문의가 이어졌다. ' else '' end || p.txt) order by p.n)) as body
         from (select n, (select string_agg((${lit(SENTENCES)})[1 + floor(random() * ${SENTENCES.length})::int], ' ')
                          from generate_series(1, 4 + (n + g) % 3) k where k > 0 * n) as txt
               from generate_series(1, 8 + g % 5) n) p
       ) b`,
      [authors, regions, ARTICLES],
    );
    // 개정 트래커 300 (공개 90%) + 단계 기록
    await db.query(`insert into public.raw_snapshots (source, url, content_hash, payload) values ('${TAG}', 'https://www.mois.go.kr/perf', 'h', '원문')`);
    await db.query(
      `insert into public.amendments (slug, title, summary, law_names, status)
       select '${TAG}-am-' || i,
              (2020 + i % 7) || '년 ' || (array['지방세제 개편안', '취득세 감면 개정안', '재산세 특례 연장안', '지방재정법 개정안', '정비사업 세제 지원안'])[1 + i % 5] || ' ' || i || '차',
              (${lit(SENTENCES)})[1 + i % ${SENTENCES.length}], array['지방세법', '지방세특례제한법'], case when i % 10 = 0 then 'draft' else 'public' end
       from generate_series(1, 300) i`,
    );
    await db.query(
      `insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by)
       select m.id, 'announced', current_date - (m.id % 400)::int, 'https://www.mois.go.kr/perf', s.id, '${TAG}'
       from public.amendments m cross join (select id from public.raw_snapshots where source = '${TAG}' limit 1) s where m.slug like '${TAG}-%'`,
    );
    // 상황 40 (공개 · 감수 기록 · 검색 별칭)
    await db.query(
      `insert into public.situations (slug, section, title, subtitle, pictogram, checks, aliases, visible, reviewer_id, reviewed_at, sort)
       select '${TAG}-s-' || i, (array['tax', 'realestate', 'finance', 'local'])[1 + i % 4],
              (array['차를 팔았어요·폐차했어요', '집을 샀어요', '고지서를 받았어요', '부모님 집을 상속받았어요', '재건축·재개발 조합원이에요', '신탁 부동산이에요', '세금을 돌려받고 싶어요', '자녀에게 집을 증여하려 해요'])[1 + i % 8] || ' ' || i,
              (${lit(SENTENCES)})[1 + i % ${SENTENCES.length}], 'car-sold',
              '[{"title":"먼저 확인할 것 하나"},{"title":"먼저 확인할 것 둘"},{"title":"먼저 확인할 것 셋"}]'::jsonb,
              case when i % 8 = 0 then array['차 팔았어요', '폐차'] else '{}'::text[] end, true, $1::bigint, now(), i
       from generate_series(1, 40) i`,
      [authors[0]],
    );
    // 용어 200
    await db.query(
      `insert into public.glossary_terms (term, definition, plain, section, source, visible)
       select case when i <= ${GLOSSARY.length} then (${lit(GLOSSARY)})[i] else (${lit(GLOSSARY)})[1 + i % ${GLOSSARY.length}] || ' (' || i || ')' end,
              (${lit(SENTENCES)})[1 + i % ${SENTENCES.length}], left((${lit(SENTENCES)})[1 + (i * 3) % ${SENTENCES.length}], 60),
              array[(array['tax', 'realestate', 'finance', 'local'])[1 + i % 4]], '${TAG}', true
       from generate_series(1, 200) i`,
    );
    // 동의어 30
    await db.query(
      `insert into public.search_synonyms (term, synonyms, updated_by)
       select case when i = 1 then '자동차매도' else '동의어시험' || i end, case when i = 1 then array['차를 팔았', '폐차'] else array['취득세', '지방세'] end, '${TAG}'
       from generate_series(1, 30) i`,
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  for (const t of ["articles", "amendments", "situations", "glossary_terms", "regions", "people", "search_synonyms"]) await db.query(`analyze public.${t}`);
}

async function rpc(args) {
  const res = await fetch(`${sb.url}/rest/v1/rpc/search_public`, {
    method: "POST",
    headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `${JSON.stringify(args)} → ${res.status}`);
  return body;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

before(async () => {
  sb = localSupabase();
  for (const u of [sb.url, sb.dbUrl]) assert.ok(["127.0.0.1", "localhost", "::1"].includes(new URL(u).hostname), "이 하네스는 로컬 Supabase에서만 돈다");
  db = new pg.Client({ connectionString: sb.dbUrl });
  await db.connect();
  await cleanup(); // 앞 실행이 남긴 자료 (중간에 멈춘 경우)
  Object.assign(before_counts, await counts());
});

after(async () => {
  if (!db) return;
  try {
    await cleanup();
    assert.deepEqual(await counts(), before_counts, "표 행 수가 시험 전과 같다");
  } finally {
    await db.end();
  }
});

test(`검색 응답 p95 ≤ ${P95_LIMIT_MS}ms — 기사 ${ARTICLES.toLocaleString()}건 + 트래커·상황·용어·지역·인물, 실제 API(anon 키)`, { timeout: 15 * 60_000 }, async () => {
  const t0 = Date.now();
  await seed();
  const seedMs = Date.now() - t0;
  const size = (await db.query("select count(*)::int n, round(avg(length(search_text)))::int avg_chars from public.articles where slug like $1", [`${TAG}-%`])).rows[0];
  assert.equal(size.n, ARTICLES);

  // 결과가 맞게 나오는지 먼저 (빠르기만 재지 않는다)
  const spaced = await rpc({ p_query: "취득 세", p_kinds: ["article"], p_limit: 50 });
  const joined = await rpc({ p_query: "취득세", p_kinds: ["article"], p_limit: 50 });
  assert.deepEqual(spaced.map((r) => r.ref), joined.map((r) => r.ref), "띄어쓰기 변형이 같은 결과");
  assert.ok(Number(joined[0].total_count) > ARTICLES / 4, `흔한 낱말 '취득세'가 기사 대부분에 나온다 (${joined[0].total_count}건)`);
  const car = await rpc({ p_query: "차 팔았", p_per_kind: 3 });
  assert.ok(car.some((r) => r.kind === "situation"), "'차 팔았' → 상황");
  const reform = await rpc({ p_query: "개편안", p_kinds: ["tracker"] });
  assert.ok(reform.length > 0 && reform.every((r) => r.title.includes("개편안")), "'개편안' → 트래커");

  const rows = [];
  const all = [];
  for (const [name, args] of CASES) {
    await rpc(args); // 데우기
    const ms = [];
    let total = 0;
    for (let i = 0; i < RUNS; i++) {
      const s = performance.now();
      const out = await rpc(args);
      ms.push(performance.now() - s);
      total = out[0] ? Number(out[0].total_count) : 0;
    }
    ms.sort((a, b) => a - b);
    all.push(...ms);
    rows.push({ name, total, p50: pct(ms, 50), p95: pct(ms, 95), max: ms.at(-1) });
  }
  all.sort((a, b) => a - b);
  const p50 = pct(all, 50);
  const p95 = pct(all, 95);
  const max = all.at(-1);

  const f = (x) => `${x.toFixed(0)}ms`.padStart(7);
  console.log(`\n통합 검색 성능 하네스 — 기사 ${ARTICLES.toLocaleString()}건(찾는 글 평균 ${size.avg_chars}자) · 넣기 ${(seedMs / 1000).toFixed(1)}초 · 검색어 ${CASES.length}개 × ${RUNS}회 = ${all.length}회`);
  console.log(`${"검색".padEnd(28)} ${"결과 수".padStart(7)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"최대".padStart(7)}`);
  for (const r of rows) console.log(`${r.name.padEnd(28)} ${String(r.total).padStart(7)} ${f(r.p50)} ${f(r.p95)} ${f(r.max)}`);
  console.log(`${"전체".padEnd(28)} ${"".padStart(7)} ${f(p50)} ${f(p95)} ${f(max)}  (기준 p95 ≤ ${P95_LIMIT_MS}ms)\n`);

  assert.ok(p95 <= P95_LIMIT_MS, `검색 응답 p95 ${p95.toFixed(0)}ms > ${P95_LIMIT_MS}ms`);
});
