# W2-d 통합 검색·용어사전 v0·툴팁 — 설계 약속 (개발 문서)

PRD-01A 9장 W2-d(통합 검색·용어사전 v0·툴팁 — 증거: 검색 정규화 테스트 통과, p95 ≤ 800ms)를 구현할 때 DB(packages/db)·공개 데이터 함수(apps/web/lib/server/public)·검색 화면·AI 도우미(01C)가 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항 원문은 PRD-01A 4장(SRCH-01 · SRCH-02 · SRCH-03 · GLO-01 · GLO-02)·6장 데이터(`query_terms`)·6.4 읽기 API, PRD-01B REG-08 · REG1-11(지역 검색 분류)·LG-10(축제는 검색 결과 목록 0), PRD-01C CHAT-03 · CHAT-11 · TX-17(도우미 검색 도구), PRD-00 이식성 규칙 2(직접 설치판에도 있는 기능만 — PGroonga)다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다. W2-a·W2-b·W2-c에서 정한 것(값 목록·공개 읽기·캐시·기능 키)은 그 설계 문서를 그대로 따른다.

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 검색 기반·정규화·성능 하네스 | PGroonga 확장·표마다 찾는 글 칸·색인, 동의어 사전 `search_synonyms`, 상황 검색 별칭 칸, 검색 함수 `search_public` 하나, 서버 함수 `searchSite`(+순수 규칙), 성능 하네스 | DB 시험(띄어쓰기 변형 같은 결과 · 구어 별칭 · 비공개 0 · 거르개 · 2장 값 표) · RLS 검증 · 순수 함수 시험(같은 견본 표) · 통합 시험(anon 키) · 성능 하네스 p95 ≤ 800ms |
| 2 `/search` 화면 | 검색 화면(탭 전체·기사·트래커·지역·행사·용어·전문가 — 데이터 없는 탭 0) · 거르개(분야·기간·지역·기사 유형, URL 쿼리 — JS 꺼도 링크) · 결과 없음 화면(추천 검색어 3개·상황 카드·[AI 도우미에게 묻기]는 도우미 공개 전 0) · 결과 유형 표시 · 히어로 검색 폼(`search` 기능 키 — W2-b #18) · `GET /api/search`(6.4) · 상황 카드 CMS에 '검색 별칭' 칸 · 동의어 사전 편집 화면(사전 '검색 동의어' 탭 — 4단계에서 당겼다, 12장 #25) · `search_submitted` 이벤트(W2-c 2.2 — 검색어 원문 0) | `reported_news`만 고르면 다른 유형 0 · 0건이면 추천 검색어 3개와 상황 카드 · 탭은 URL 쿼리 · 도우미 답변 끼워 넣기 0 · 화면 규칙 R1~R3 · 360px · 접근성 95 |
| 3 용어사전 `/glossary`·저장 경고·툴팁 | 가나다 색인 · 용어 공개 상태 칸(W2-b #12) · 쉬운 풀이 61자·숫자+단위 저장 경고 · 관련 용어 · 4대 분야마다 1개 이상 · 본문 첫 등장 툴팁(GLO-02 — 한 기사 한 번·키보드 포커스·제목·링크 안 0·긴 용어 먼저) · 검색 결과의 용어 링크 열기 | GLO-01·GLO-02 수용 기준 · 툴팁 E2E(키보드) |
| 4 검색어 집계·가림 (SRCH-03) | `query_terms`(출처 `site_search`) — 서버가 가린 값만(전화·이메일·주민등록번호 형식 가림 — 견본 시험), 같은 정규형(4장)은 기간별 한 행 합산 · 많이 찾은 검색어 옆에서 동의어 더하기(편집 화면 자체는 2단계) | 가림 견본 시험 · 공개 이벤트에 검색어 원문 0 · 같은 정규형 한 행 |
| 5 수용 E2E | PRD-01A 9장 W2-d 증거 전부 | 정규화 시험 · p95 ≤ 800ms(수용 시험 안 기사 3,000건 실제 경로 + 2만 건 하네스) · SRCH-01~03·GLO-01·02 수용 기준 — `e2e/w2d-acceptance.test.mjs` |

단계마다 시험 통과 → 커밋 → push → CI 확인 → 보고 (작업 단위 규칙). 공개 화면(2~3단계)은 1단계의 서버 함수만 부른다 — 화면 코드가 DB를 직접 읽지 않는다.

## 2. 값 목록

### 2.1 검색 함수 값 (DB 함수·TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| search.kind (결과 종류 — 순서 = 같은 등급 안의 종류 순서) | `region` · `situation` · `tracker` · `glossary` · `category` · `article` · `person` |
| search.content_type (기사 유형 거르개 — 금주 핫뉴스 `digest`는 기사 결과에 없다) | `reported_news` · `explainer` · `guide` · `opinion` · `sponsored` |
| search.person_roles (인물 결과에 넣는 역할 — 전문가만인 인물은 01C 검증 전 0) | `reporter` · `editor` · `writer` · `reviewer` |
| search.tab (검색 화면 탭 — 2단계, 데이터 없는 탭 0) | `all` · `article` · `tracker` · `region` · `event` · `glossary` · `expert` |

- 종류 글자(결과 유형 표시 — SRCH-01 '결과마다 유형 표시'): `region` 지역 · `situation` 상황 · `tracker` 개정 트래커 · `glossary` 용어 · `category` 분야 · `article` 기사 유형 배지(`@ltr/ui ARTICLE_TYPE_BADGE_LABELS` — `보도`·`해설`·`가이드`·`오피니언`·`광고`, 공동 기획은 유형 배지 대신 `공동 기획 ○○` — W2-b #49, 유형 없는 이관 기사는 `기사`) · `person` 기자·필자. 뒤 작업이 더하는 종류: `project` 프로젝트(01B W4) · `event` **`행사안내`**(01B W6 — 정보 목록, 기사 유형 배지 글자 0, 축제 회차 0 — LG-10) · `expert` 전문가(01C — 공개·검증 프로필만). 결과 모양(7장)은 그대로 두고 함수 몸과 이 표에만 더한다.
- 탭 → 종류: `all` 모든 종류(종류별 묶음) · `article` 기사 · `tracker` 개정 트래커(+ 01B 프로젝트) · `region` 지역 · `event` 행사 · `glossary` 용어 · `expert` 전문가. 상황·분야·기자·필자는 `all`에만 [확인 필요 — 9장 #9].

### 2.2 정규화 견본 (DB 함수와 TypeScript가 같은 결과 — 시험이 이 표를 읽는다)

'찾는 낱말'은 검색어를 4장 규칙으로 정규화한 낱말(모두 들어 있어야 결과)이다. '다시 찾는 낱말'은 찾는 낱말로 0건일 때 띄어 쓴 그대로 다시 찾는 낱말이고, `—`는 다시 찾지 않는다(찾는 낱말과 같다)는 뜻이다.

| 입력 | 찾는 낱말 | 다시 찾는 낱말 |
|---|---|---|
| `취득세` | `취득세` | — |
| `취득 세` | `취득세` | `취득` · `세` |
| `재건축` | `재건축` | — |
| `재 건축` | `재건축` | `재` · `건축` |
| `재 건 축` | `재건축` | `재` · `건` · `축` |
| `차 팔았` | `차팔았` | `차` · `팔았` |
| `성동구 재개발` | `성동구` · `재개발` | — |
| `경주 취득세` | `경주` · `취득세` | — |
| `「2026년 지방세제 개편안」` | `2026년` · `지방세제` · `개편안` | — |
| `2026 년 개편안` | `2026년` · `개편안` | `2026` · `년` · `개편안` |
| `ＰＦ-ABS 대출` | `pf` · `abs` · `대출` | — |
| `pf 차` | `pf` · `차` | — |
| `세 감면` | `세감면` | `세` · `감면` |
| `취득세 취득세` | `취득세` | — |
| `지방교육세·교육세` | `지방교육세` · `교육세` | — |
| `차` | `차` | — |
| `가나 다라 마바 사아 자차 카타 파하 거너 더러` | `가나` · `다라` · `마바` · `사아` · `자차` · `카타` · `파하` · `거너` | — |
| `?!·` | (없음) | — |
| `   ` | (없음) | — |

### 2.3 한도 (DB 함수 · TypeScript 같은 값 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| query_chars (검색어 — 앞에서 이 글자 수까지만 읽는다) | `100` |
| max_terms (찾는 낱말 — 앞에서 이 개수까지) | `8` |
| page_size (한 쪽 결과 — 기본·최대) | `20` · `50` |
| max_offset (건너뛰기 최대 — 50개씩 21쪽) | `1000` |
| max_per_kind (종류별 묶음 — 종류마다 최대) | `10` |
| synonym_limits (동의어 사전 한 줄 — 낱말 글자·동의어 개수·동의어 글자) | `50` · `10` · `50` |
| alias_limits (상황 검색 별칭 — 개수·글자) | `20` · `50` |

### 2.4 검색 화면·API 값 (2단계 — TypeScript 상수가 같은 값을 쓴다, 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| screen.tab_labels (탭 글자 — 2.1 `search.tab` 차례, SRCH-02) | `전체` · `기사` · `트래커` · `지역` · `행사` · `용어` · `전문가` |
| screen.all_per_kind (전체 탭 — 종류마다 앞 몇 개) | `5` |
| screen.suggestions (결과 없음 — 추천 검색어 수, SRCH-02 '추천 검색어 3개') | `3` |
| api.params (`GET /api/search` 쿼리 칸 — 검색 화면 주소와 같은 이름) | `q` · `tab` · `section` · `type` · `region` · `from` · `to` · `page` |
| api.ip_per_minute (`GET /api/search` — IP별 1분 상한, 서버 메모리) | `120` |
| event.search_submitted (보내는 속성 — W2-c 2.2, 검색어 원문 0) | `query_length` · `result_count` · `result_type_count` · `region_classified` |
| admin.synonym_note_chars (동의어 사전 메모 글자 — 편집 화면만, DB 제한 없음) | `200` |

### 2.5 용어사전 값 (3단계 — DB·TypeScript 같은 값, 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| glossary.feature (기능 키 — 꺼지면 `/glossary`·`/glossary/[번호]` 404, 사이트 안 용어사전 링크 0) | `glossary` |
| glossary.visible_default (새 용어의 공개 상태 — DB 기본값. 이 칸이 생기기 전부터 있던 용어는 공개 그대로) | `false` |
| glossary.plain_guide (쉬운 풀이 — 이 글자 수를 넘으면 저장 경고, 공백 포함 글자 — GLO-01 '61자는 저장 경고') | `60` |
| glossary.plain_max (쉬운 풀이 — 이 글자 수를 넘으면 저장 거부, DB check) | `120` |
| glossary.number_units (숫자 바로 뒤(띄어쓰기 허용)에 오면 저장 경고인 단위 — `원`은 앞에 십·백·천·만·억·조가 붙어도) | `%` · `％` · `퍼센트` · `원` · `억` · `㎡` · `m²` · `m2` · `제곱미터` · `평` |
| glossary.number_fields (숫자 + 단위 경고를 보는 칸 — 쉬운 풀이 · 뜻) | `plain` · `definition` |
| glossary.initials (가나다 색인 묶음 — 차례. 된소리는 예사소리 묶음 ㄲ→ㄱ·ㄸ→ㄷ·ㅃ→ㅂ·ㅆ→ㅅ·ㅉ→ㅈ, 영문·숫자는 한 묶음, 그 밖의 첫 글자는 기타) | `ㄱ` · `ㄴ` · `ㄷ` · `ㄹ` · `ㅁ` · `ㅂ` · `ㅅ` · `ㅇ` · `ㅈ` · `ㅊ` · `ㅋ` · `ㅌ` · `ㅍ` · `ㅎ` · `A–Z·0–9` · `기타` |
| glossary.tip_blocks (툴팁을 붙이는 본문 블록 — 그 블록의 글만. 문단 안 링크·상자 제목·인용 발언자·제목·요약·표·FAQ·핵심 요약은 붙이지 않는다) | `paragraph` · `quote` · `callout` |

### 2.6 숫자 + 단위 저장 경고 견본 (TypeScript 시험이 이 표를 읽는다 — '찾은 글'이 `—`이면 경고 0)

| 풀이 | 찾은 글 |
|---|---|
| `세율은 3%입니다` | `3%` |
| `１００％ 감면` | `１００％` |
| `1~3% 사이` | `1~3%` |
| `4.6퍼센트 오른다` | `4.6퍼센트` |
| `1억 원 넘는 집` | `1억 원` |
| `3억원 이하` | `3억원` |
| `5천만 원까지` | `5천만 원` |
| `1,000원 단위` | `1,000원` |
| `만 원어치 2만원짜리` | `2만원` |
| `2억이 넘으면` | `2억` |
| `3조 원 규모` | `3조 원` |
| `85㎡ 이하` | `85㎡` |
| `85m² 넘는 집` | `85m²` |
| `전용 60m2` | `60m2` |
| `60제곱미터` | `60제곱미터` |
| `32평 아파트` | `32평` |
| `20평형 집` | `20평` |
| `2단계 절차` | — |
| `1세대 1주택` | — |
| `지방세법 제10조 원문` | — |
| `3원칙` | — |
| `2026년 개편` | — |
| `60일 안에 신고` | — |
| `평가액 기준` | — |
| `원금과 이자` | — |
| `100명` | — |
| `10만 명` | — |

### 2.7 검색어 집계 값 (4단계 — DB·TypeScript 같은 값, 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| query_terms.columns (칸 — PRD-01A 6.1 그대로, 차례까지) | `id` · `source` · `term_masked` · `normalized` · `period` · `count` · `cluster_id` · `first_seen` · `last_seen` |
| query_terms.source (출처 — PRD-01A 6.1. 4단계는 `site_search`만 넣는다) | `site_search` · `search_console` · `search_advisor` · `assistant_unresolved` · `inquiry` |
| query_terms.period (기간 단위 — 한국 날짜 하루, 화면은 고른 기간의 날 행을 더한다) | `day` |
| query_terms.mask_labels (가림 글자 — 이메일 · 주민등록번호 · 전화번호 · 그 밖의 긴 숫자) | `[이메일]` · `[주민등록번호]` · `[전화번호]` · `[번호]` |
| query_terms.digit_run (숫자가 이 개수 이상 이어지면 가림 — 숫자 사이에 띄어쓰기·하이픈·점·괄호 같은 기호만 끼어도 한 줄) | `9` |
| query_terms.term_chars (가린 검색어 저장 글자 수 — 가림 글자 중간에서 자르지 않는다) | `100` |
| query_terms.scan_chars (가림을 찾는 앞부분 글자 수 — 저장 글자 수 경계에 걸친 번호도 통째로 가린다) | `200` |
| query_terms.dedupe_minutes (같은 방문자(방문자 쿠키가 없으면 IP 해시)의 같은 정규형 — 이 시간 안 다시 찾기는 한 번만 센다, 서버 메모리) | `30` |
| query_terms.list_size (편집국 화면 — 많이 찾은 차례로 앞에서 몇 개) | `100` |
| query_terms.presets (편집국 화면 기간 — 오늘까지 최근 n일, 첫 값이 기본) | `7` · `30` · `90` |

설정 씨앗 (운영 설정 화면에서 고친다 — 결정 안건 12장 #43·#44):

#### `query_terms`

```json
{"version":"2026-10-19.1","retention_days":395,"display_min_count":2}
```

### 2.8 가림 견본 (TypeScript·DB 시험이 이 표를 읽는다 — 정규형이 `—`이면 남는 낱말이 없어 저장 0)

| 검색어 | 가린 값 (term_masked) | 정규형 (normalized) |
|---|---|---|
| `취득세 010-1234-5678 문의` | `취득세 [전화번호] 문의` | `취득세 문의` |
| `01012345678 재산세` | `[전화번호] 재산세` | `재산세` |
| `010.9876.5432 연락처` | `[전화번호] 연락처` | `연락처` |
| `+82 10-9876-5432 취득세` | `[전화번호] 취득세` | `취득세` |
| `(02)123-4567 구청 세무과` | `[전화번호] 구청 세무과` | `구청 세무과` |
| `ＰＦ 대출 ０１０－１２３４－５６７８` | `PF 대출 [전화번호]` | `pf 대출` |
| `hong.gildong@example.com 재산세` | `[이메일] 재산세` | `재산세` |
| `세무 상담 tax_help+1@mail.co.kr` | `세무 상담 [이메일]` | `세무 상담` |
| `hong @ example.com 취득세` | `[이메일] 취득세` | `취득세` |
| `900101-1234567 상속세` | `[주민등록번호] 상속세` | `상속세` |
| `9001011234567` | `[주민등록번호]` | — |
| `991332-1234567 증여세` | `[번호] 증여세` | `증여세` |
| `1234-5678-9012-3456 자동차세` | `[번호] 자동차세` | `자동차세` |
| `110-123-456789 환급 계좌` | `[번호] 환급 계좌` | `환급 계좌` |
| `123456789 사건` | `[번호] 사건` | `사건` |
| `12345678 사건` | `12345678 사건` | `12345678 사건` |
| `010-1234-5678` | `[전화번호]` | — |
| `2026-10-19 개편안` | `2026-10-19 개편안` | `2026 10 19 개편안` |
| `60일 안에 신고` | `60일 안에 신고` | `60일 안에 신고` |
| `지방세법 제111조` | `지방세법 제111조` | `지방세법 제111조` |
| `1588-1234 상담` | `1588-1234 상담` | `1588 1234 상담` |
| `@지방세 질문` | `@지방세 질문` | `지방세 질문` |
| `「취득세」 감면` | `「취득세」 감면` | `취득세 감면` |
| `  취득세   감면!! ` | `취득세 감면!!` | `취득세 감면` |

## 3. 검색 대상 (SRCH-01) — 지금과 뒤 작업

| 대상 | 표 | 찾는 글 (search_text) | 이름 (search_names — 순위 등급) | 공개 조건 (RLS + 함수 안 같은 조건) | 주소 (서버 함수가 만든다 — 닫힌 화면이면 링크 0) | 단계 |
|---|---|---|---|---|---|---|
| 기사 (칼럼 = `opinion` 포함) | `articles` | 제목 · 요약 · 본문 블록 글(문단 · 표 · 이미지 설명 · 인용과 발언자 · 콜아웃 · 인포그래픽 같은 내용 · 동영상 요약 · FAQ · 핵심 요약 · 카드뉴스 장). 블록 종류·media 번호·주소·근거 참조·핵심 주장(claims) 0, 문단 링크는 글만 | 제목 | 발행(`published`) · 대표 이미지 권리 확인(또는 없음) · 무료(`is_paid` 아님) · 금주 핫뉴스(`digest`) 아님. 유형 없는 이관 기사 포함 | `/news/[slug]` | 1 |
| 상황 페이지 | `situations` | 제목 · 한 줄 · **검색 별칭(새 칸 `aliases`)** · 자주 틀리는 점 · 먼저 확인할 것 · 체크리스트 항목 | 제목 · 검색 별칭 | `visible`(감수된 공개 상황) | `/situations/[slug]` | 1 |
| 개정 트래커 | `amendments` | 제목 · 요약 · 법령 이름 | 제목 | `status = public` | `/tax/amendments/[slug]` — 기능 키 `amendments`가 꺼지면 링크 0, 대신 현재 단계 원문 링크(홈 트래커 카드와 같다) | 1 |
| 용어 | `glossary_terms` | 용어 · 읽기 · 정의 · 쉬운 풀이 · 관련 용어 | 용어 · 읽기 | 공개 상태 `visible`(3단계 — 새 용어는 숨김, 칸이 생기기 전 용어는 공개 그대로 · 12장 #28) | `/glossary/[번호]`(용어 쪽 — 3단계) — 기능 키 `glossary`가 꺼지면 링크 0(용어와 쉬운 풀이만) | 1 · 3 |
| 지역 (시·도 · 시·군·구) | `regions` | 이름 · 별칭(옛 이름 — REG1-11 '별칭으로 검색하면 현재 지역') | 이름 · 별칭 | 오늘(한국 날짜) 유효 — 시작 전·폐지 0 | `/local/[sido](/[sigungu])` — 기능 키 `region_hubs`(01B W4)가 꺼지면 링크 0 | 1 |
| 하위 분야 | `categories` | 이름 · 소개 | 이름 | 공개 · 목록 기사 1건 이상 · 지자체뉴스 하위 분야 제외(경로 없음 — W2-b #27) | `/[section]/[slug]` | 1 |
| 기자·필자 | `people` | 이름 · 소속 · 담당 | 이름 | 공개 인물 + 역할 2.1 `search.person_roles` 하나 이상 | `/people/[slug]` | 1 |
| 프로젝트 | `projects` (01B) | 단계 원문·사업 이름 | 사업 이름 | 01B 공개 조건 | 01B 경로 | 01B W4 — 종류 `project` |
| 행사 (정보 목록) | `local_events` (01B) | 행사 이름·장소·회차 | 행사 이름 | 공개 회차 · 축제 분류 0(LG-10 — 지자체 허브 안에서만) | 01B 경로 | 01B W6 — 종류 `event`, 표시 `행사안내` |
| 공개·검증된 전문가 | `expert_profiles` (01C) | 이름·분야 | 이름 | 검증 기록 있고 재검증일 안(EXPL-03 — 다음 날 배치 뒤 0) | `/experts/...` | 01C — 종류 `expert` |
| 공식 자료·해석 원문 | `legal_docs` 등 (01B) | 원문 요지 | 문서 이름 | 공개·권리 확인(SRCH-01 '공개 전·권리 미확인 공식 자료 0') | 01B 경로 | 01B W3~W4 |
| 명소·맛집 | — | — | — | 만들지 않는다 (PRD-X) — 종류 값 0 | — | — |

- 검색 색인·결과에 넣지 않는 것: 취재 근거(`article_evidence`·`article_datasets`·`article_interviews` — PRD-01A 6.1 '검색 색인·도우미 도구 제외'), 승인·감수 기록, 기획, 문의함, 원본 스냅샷, 운영 설정(금지·공포 표현 사전·기준값), 측정 이벤트. 찾는 글 칸은 이미 공개된 칸에서만 만든다 — 인물의 이해관계 메모·약력 원문(증빙 없는 항목)·계정 칸은 읽지 않는다.
- 찾는 글·이름 칸은 생성 칸이다(`generated always … stored`) — 직접 쓸 수 없고, 원래 칸을 고치면 같은 문장 안에서 다시 계산된다(색인도 그때 바뀐다). 별도 색인 표·복사본이 없어 발행 취소·비공개가 바로 결과에서 빠진다.

## 4. 정규화와 맞추기 규칙 (SRCH-01 '띄어쓰기 변형 흡수')

1. **정규형** — NFKC(전각·반각·호환 글자 통일) → 소문자 → 숫자·영문 소문자·한글 음절(가~힣)·한글 자모(첫·가운데·끝소리 글자 ᄀ~ᇿ와 호환 자모 ㄱ~ㆎ — NFKC가 호환 자모를 첫소리 글자로 바꾼다)·한자(一~鿿) 밖의 글자를 지운다(띄어쓰기·줄바꿈·문장부호·기호 포함). DB 함수 `public.search_squash`와 검색 함수 몸, TypeScript `squash`가 같은 규칙이다(2.2 견본 표를 셋이 함께 지난다).
2. **찾는 글** — 표의 칸마다 정규형을 만들고 칸 사이는 줄바꿈으로 잇는다. 한 칸 안의 띄어쓰기는 없어지므로 "취득 세 감면"과 "취득세 감면"은 같은 글이다. 칸 경계는 넘지 않는다(제목 끝 글자와 요약 첫 글자가 이어져 찾히지 않는다).
3. **검색어** — 앞 100글자 · 같은 정규화를 하되 지운 글자 자리에서 낱말을 나눈다. **한 글자 한글 낱말은 옆 낱말에 붙인다** — 앞 낱말이 숫자로 끝나면 앞에("2026 년" → 2026년), 아니면 뒤 낱말이 한글·숫자로 시작하면 뒤에("재 건축" → 재건축), 아니면 앞 낱말이 한글로 끝날 때 앞에("취득 세" → 취득세). 영문 낱말에는 붙이지 않는다("pf 차"). 겹친 낱말은 하나로, 앞 8개까지.
4. **맞추기** — 결과 = 모든 찾는 낱말(또는 그 동의어 — 5장)이 찾는 글 안에 **부분 글자로** 들어 있는 행. 색인은 PGroonga 2글자 조각(`TokenBigramSplitSymbolAlphaDigit` · `NormalizerNFKC150`)이고 질의는 낱말마다 따옴표 구절 — "개편안"은 "2026년지방세제개편안" 안에서 찾힌다. 함수는 `pgroonga_condition(…, index_name)`으로 색인 설정을 넘겨 작은 표를 순서대로 읽을 때도 같은 규칙이다.
5. **다시 찾기** — 붙인 낱말이 띄어 쓴 낱말과 다르고, 붙인 낱말로 (종류 거르개·쪽과 상관없이 나머지 거르개 안에서) 0건이면 띄어 쓴 그대로 다시 찾는다. "차 팔았" → '차팔았' 0건 → '차' 그리고 '팔았' → "차를 팔았어요·폐차했어요" 상황. 쓴 낱말은 결과 행의 `query_terms`에 있다.
6. 그래서 "취득세"·"취득 세", "재건축"·"재 건축"은 같은 결과다(붙인 낱말이 같다 — 시험). 한계: "지방 교육세"는 '지방' 그리고 '교육세'로 찾아 "지방교육세"보다 넓다 — 두 글자 이상 낱말 사이 띄어쓰기는 낱말 경계로 본다(사전 없이 띄어쓰기 실수와 구별할 수 없다). 자주 틀리는 표기는 동의어 사전이 맡는다 [확인 필요 — 9장 #2].

## 5. 동의어·검색 별칭 (구어 검색 — "차 팔았", "개편안")

| 장치 | 어디에 | 맞추는 법 | 누가 고치나 |
|---|---|---|---|
| 상황 검색 별칭 | `situations.aliases` (20개·50자) | 찾는 글과 이름에 들어간다 — 검색어 낱말이 별칭 안에 있으면 '이름에 있음' 등급, 별칭과 검색어 전체가 같으면 '이름 같음' | 상황 카드 CMS '검색 별칭' 칸(2단계 — 한 줄에 하나, 감수 대상 칸이 아니라 공개 중에도 고친다·감수 기록 그대로) — 상황을 쓰는 사람(기자·편집 책임자·관리자) |
| 지역 별칭 | `regions.aliases` (W2-b) | 같음 — 옛 이름으로 찾으면 현재 지역 | 01B W4 전국 적재 |
| 동의어 사전 | `search_synonyms` (낱말 50자·동의어 10개·50자) | 검색어의 **낱말 하나**(4장 3의 붙인 낱말)가 `term_key`(정규형)와 같으면 그 낱말 자리에 동의어도 함께 찾는다(낱말 OR 동의어…) — 한쪽 방향. 여러 낱말 열쇠("자동차 매도")는 정규형 '자동차매도' 한 낱말로 쳤을 때만 맞는다 | 편집 책임자·관리자 — `/admin/dictionaries?tab=synonyms`(2단계 — 더하기·고치기·끄기·지우기, 감사 로그 `synonym.*`). 많이 찾은 검색어 옆 더하기는 4단계 |

- "개편안" → 「2026년 지방세제 개편안」 트래커는 별칭 없이 부분 글자로 찾힌다(4장 4). "차 팔았" → 상황은 다시 찾기(4장 5)로도, 별칭(`차 팔았어요`)으로도 찾힌다 — 별칭이 있으면 붙인 낱말 '차팔았'이 별칭 안에서 바로 찾혀 등급이 오른다.
- 동의어 사전은 공개 검색 어휘다 — anon은 사용 중(`enabled`)인 줄의 `term_key`·`synonym_keys`만 읽는다(메모·고친 사람 0). 금지·공포 표현 사전 같은 편집 규칙과 다르다(그것들은 그대로 비공개).
- 정규형 열쇠는 생성 칸이다 — "자동차 매도"와 "자동차매도"는 같은 열쇠라 두 번 넣을 수 없다(unique). 정규형이 빈 낱말("?!")·겹치거나 빈 동의어는 거부.
- 4단계 질의 지도(OPT-04)의 '같은 정규형'은 4장 3의 붙인 낱말 목록이다(같은 함수 규칙 — TypeScript `queryTerms`).

## 6. 순위 (결과 차례)

1. 등급 — `0` 이름 같음(검색어 전체 정규형 = 이름 하나 — 지역명만 쓴 검색어는 그 지역이 첫 결과, REG-08) → `1` 이름에 있음(모든 낱말이 이름 칸 안에 — 동의어 포함) → `2` 본문에만.
2. 같은 등급 안: 종류 순서(2.1 `search.kind` 차례 — 지역 · 상황 · 트래커 · 용어 · 분야 · 기사 · 인물) → 날짜 최신(기사 = 최초 발행, 트래커 = 현재 단계 날짜) → 편집 순서(상황·분야 `sort`, 지역은 시·도 먼저) → 이름 → 번호.
3. 종류별 묶음(`p_per_kind` — 전체 탭): 종류 순서대로 종류마다 위 차례의 앞 n개.
4. 관련도 점수(낱말이 몇 번 나오는지)는 쓰지 않는다 — 규칙으로 설명할 수 있는 차례만 [확인 필요 — 9장 #3].

## 7. 검색 함수 `public.search_public` (DB — 마이그레이션 `20261018000020_w2d_search.sql`)

| 인자 | 뜻 | 검사 (틀리면 22023 → PostgREST 400) |
|---|---|---|
| `p_query` | 검색어 | 없음 — 비거나 남는 글자가 없으면 0행 |
| `p_kinds` | 결과 종류 (없으면 모두) | 2.1 `search.kind` 안, 빈 배열 거부 |
| `p_section` | 분야 | 4대 분야 — 분야 없는 종류(인물)·다른 분야는 0. 트래커 = `tax`, 지역 = `local`, 용어 = 용어의 분야 배열 |
| `p_content_type` | 기사 유형 | 2.1 `search.content_type` — 고르면 기사만(다른 종류 0) |
| `p_region` | 지역 코드 (법정동코드 10자리) | 기사(그 지역 + 시·도면 그 아래 시·군·구 태그)와 지역(그 지역과 아래)만 |
| `p_from`·`p_to` | 기간 (한국 날짜, 그날 포함) | 끝 ≥ 시작 — 날짜 있는 종류(기사 최초 발행·트래커 현재 단계)만, 날짜 없는 종류 0 |
| `p_limit`·`p_offset` | 쪽 | 2.3 한도 |
| `p_per_kind` | 종류별 묶음 (전체 탭) | 1~10 — 주면 쪽 건너뛰기를 쓰지 않는다 |

- 돌려주는 행(결과 모양 — 종류가 늘어도 그대로): `kind` · `ref`(번호 — 지역은 코드) · `slug`(용어는 번호) · `title` · `snippet`(기사 요약, 없으면 첫 문단 160자 · 상황 한 줄 · 트래커 요약 · 용어 쉬운 풀이(없으면 정의) · 지역의 상위 지역 이름 · 분야 소개 · 인물 소속) · `section` · `content_type`(기사만) · `published_at`(기사 최초 발행 · 트래커 현재 단계 날짜) · `tier`(6장 등급) · `meta`(종류별 — 기사 `format`·`label`·`partner_badge_name`·`category_id`·`region_codes`·`subtype` / 상황 `pictogram` / 트래커 `stage`·`stage_on`·`source_url` / 용어 `reading`·`sections` / 지역 `level`·`parent_code`·`parent_slug`·`parent_name` / 인물 `roles`·`beat`) · `total_count`(종류 거르개 안의 전체 수) · `kind_counts`(종류 거르개와 상관없이 나머지 거르개 안의 종류별 수 — 탭 숫자) · `query_terms`(쓴 낱말).
- **최소 권한** — `security invoker`: 부르는 역할(anon)의 칸 권한·RLS가 그대로 걸린다. 함수 안에서도 같은 공개 조건(3장)을 다시 건다 — service_role로 불러도 초안·비공개 0(심층 방어, DB 시험). security definer + 공개 뷰를 고르지 않은 이유: 정의자 권한(소유자)은 RLS를 건너뛰어 뷰의 WHERE 하나에 공개 경계를 맡기게 되고, 상황·용어·지역은 공개 뷰가 없다.
- anon·authenticated·service_role 실행. **anon이 실행할 수 있는 public 함수는 `health_ping`과 이 함수뿐**(`verify-rls-remote.mjs ANON_EXECUTE_ALLOWED` · DB 시험). 정규화 도우미 함수(`search_squash`·`search_keys`·`search_doc`·`jsonb_strings`·`article_search_parts`·`text_items_short` — 생성 칸·제약용)는 service_role만 — 그래서 검색 함수는 같은 정규화를 몸 안에 직접 쓴다.
- `search_path = extensions, pg_temp` — PGroonga 연산자·조건 형식(`extensions` 스키마)을 찾고, 표·뷰는 모두 `public.`으로 적는다.
- **AI 도우미(01C CHAT-03)** — 검색 도구 `search_site`는 이 함수를 그대로 부른다(같은 결과·같은 공개 경계). 도우미가 anon 키가 아닌 전용 읽기 역할을 쓰면, 그 역할을 공개 읽기 정책·칸 권한과 이 함수 실행 권한에 더한다(invoker라 그 역할이 읽는 범위를 넘지 않는다). TX-17 'AI 색인 불허 칼럼 0'은 계약 칸이 생기는 01C가 도우미용 거르개를 함수에 더한다 [01C — 9장 #12].

## 8. 서버 함수 (apps/web/lib/server/public/search.ts — 서버 전용)

| 함수 | 하는 일 |
|---|---|
| `searchSite(options)` | anon 키로 `rpc("search_public")` — 검색어가 비면 DB를 부르지 않고 빈 결과. 행 → 결과 보기 값(순수 `search-logic.ts`). 읽지 못하면 `PublicDataError`(화면은 `readPublic`으로 닫힌 모습) |
| `parseSearchParams(params)` (순수) | URL 쿼리(`q`·`tab`·`section`·`type`·`region`·`from`·`to`·`page`) → 검색 옵션. 모르는 값은 닫힌 쪽(전체 탭·거르개 없음·1쪽) |
| `queryTerms(raw)` · `squash(text)` (순수) | 4장 규칙 — DB와 같은 결과(2.2 표 시험). 4단계 검색어 집계의 정규형 |
| `searchHitView(row, features)` (순수) | 종류별 보기 값 — 주소(3장, `isOpenPath`를 지난 것만 — 꺼진 기능·아직 없는 화면이면 `href: null`), 유형 표시 글자(2.1), 기사 배지(W2-b 표기 — 목록 카드와 같은 함수), 트래커 단계·원문 링크, 날짜(한국 날짜) |

- **캐시하지 않는다**(`cache: "no-store"` — `cache-policy.ts uncachedRequestInit`). 이유: ① 발행 취소·비공개·전문가 검증 만료가 다음 검색에 바로 빠져야 한다(SRCH-01 '비공개 0' — 30초 재검증 창도 두지 않는다) ② 검색어 조합이 끝이 없어 데이터 캐시에 쌓으면 저장소만 커지고 다시 쓰일 일이 적다 ③ DB 함수 하나로 p95 ≤ 800ms를 지킨다(9장). 기능 키 등 공개 설정은 지금처럼 30초 캐시(`readPublicSettings`).
- 응답 머리글(2단계 — E2E가 본다): `/search` `cache-control`에 `no-store`(요청마다 그리는 화면) · `<meta name="robots" content="noindex, nofollow">`(검색 결과 쪽은 색인하지 않는다 — 얇은 쪽) · `/api/search` `cache-control: no-store` · `x-robots-tag: noindex` [확인 필요 — 12장 #13].

### 8.1 2단계 — 검색 화면·API (2026-10-19)

| 무엇 | 어디 | 규칙 |
|---|---|---|
| 탭 숫자 다시 읽기 | `searchSite` · 순수 `countArgs`·`countsMissing`·`withCounts` | 고른 탭·쪽에 행이 0이면 탭 숫자(`kind_counts`)도 오지 않는다 → 같은 거르개로 종류 거르개 없이 한 행만 한 번 더(`p_limit` 1). 전체 탭 1쪽 0건은 정말 0건이라 다시 읽지 않는다. 남는 글자 없는 검색어·종류 없는 탭·건너뛰기 한도 밖은 1단계대로 DB 0 |
| 검색 화면 값 | `getSearchPage(options)`(서버) · `screenOptions`(순수) | 기능 키 `search`가 꺼지면 null → 화면 404. 종류 없는 탭(행사·전문가)은 전체 탭, 전체 탭은 1쪽. 전체 탭 = 종류별 묶음(2.4 `screen.all_per_kind` 5개), 종류 탭 = 20개씩 쪽. 결과가 0일 때만 상황 카드를 읽는다 |
| 화면 모양 | `lib/site/search-view.ts`(순수 — 시험 `search-view.test.ts`) · `components/site/SearchView.tsx` · `app/(site)/search/page.tsx` | 주소 ↔ 화면 상태(`searchHref` — 기본값은 주소에 쓰지 않는다) · 보이는 탭 = 전체 + 결과 있는 탭 + 지금 탭 · 거르개 글자 요약 · 결과 없음 모델 · 트래커 '확정 아님' · 지역 거르개 선택지(오늘 유효한 시·도와 그 아래 시·군·구) |
| JS 없이 | 서버 렌더링 | 탭·쪽·추천 검색어는 링크, 검색·거르개는 GET 폼(거르개는 `details`로 접는다). 새 검색어는 고른 거르개를 지키고(숨은 칸), 거르개 적용은 지금 탭을 지킨다. 빈 검색어를 보내면 입력창 아래 "검색어를 입력해 주세요."(`aria-invalid`) |
| 결과 표시 | `HitItem` | 기사 = 기사 유형 배지(목록 카드와 같은 `cardTypeBadge` — 광고·공동 기획·유형 없음 `기사`), 그 밖 = 종류 글자 칩. 제목은 열린 화면일 때만 링크(용어·트래커·지역 허브는 지금 링크 0, 트래커는 현재 단계 원문 새 창 + '확정 아님'). 결과 목록 위·안에 도우미 답변 요소 0 |
| 결과 없음 | `noResultView` | 추천 검색어 = 설정 `home_search_chips`에서 지금 검색어(정규형이 같은 것)를 빼고 앞 3개(설정이 비면 0 — 코드에 넣어 둔 검색어 0) · 상황 카드 = 공개 상황을 편집 순서(`sort`)대로, 분야 거르개를 골랐으면 그 분야, 상한은 `hub_situation_limit` · 거르개를 썼으면 '거르개를 지우고 다시 찾기' · [AI 도우미에게 묻기]는 도우미 공개(01C) 전 0 |
| 측정 | `MeasureSearch` · `MeasureSearchSituationCards`(`components/site/Measure.tsx`) · `lib/site/search-measure.ts` | 결과 화면을 열면 `search_submitted` 1건 — 속성은 2.4 `event.search_submitted` 4칸뿐(서버가 센 숫자 — 검색어 원문은 브라우저 컴포넌트에도 오지 않는다). 같은 검색(검색어·거르개)에서 탭·쪽만 바꾸면 0건(열쇠는 브라우저 메모리에만). 결과 없음의 상황 카드를 누르면 `situation_card_clicked`(위치 `search_empty`) |
| 읽기 API | `app/api/search/route.ts` · 순수 `lib/server/public/search-request.ts` | 칸 이름은 화면 주소와 같다(2.4 `api.params`). 틀리면 400 + 칸마다 사유(모르는 칸·같은 칸 두 번·검색어 없음·100자 넘음·값 목록 밖·날짜·기간 거꾸로·쪽 1~51 밖·전체 탭 2쪽 이상). 남는 글자 없는 검색어·행사·전문가 탭은 200 빈 결과. 기능 키 꺼짐 404 · 공개 데이터 못 읽음 503 · IP별 1분 120번(수집 API와 같은 서버 메모리 토큰 통, IP는 해시한 열쇠만) 넘으면 429 + `retry-after`. 응답: `query`·`terms`·`tab`·`page`·`pageSize`·`total`(고른 탭 종류의 합)·`hasMore`·`counts`·`regionClassified`·`items` |

### 8.2 3단계 — 용어사전·저장 경고·본문 용어 풀이 (2026-10-19)

| 무엇 | 어디 | 규칙 |
|---|---|---|
| 용어 공개 상태 | 마이그레이션 `20261019000021_w2d_glossary.sql` | `glossary_terms.visible` — 새 용어는 숨김(기본값 false, 2.5). 칸이 생기기 전부터 있던 용어는 W2-b #12(모든 용어 공개)대로 공개 그대로(칸을 true로 더한 뒤 기본값만 false로 — 기존 행·고친 시각 그대로). 공개 읽기 정책을 `using (visible)`로 좁혔다 — 용어사전 화면·허브·상황의 용어 칩·본문 풀이·검색이 모두 이 경계. `search_public`은 용어 결과에 `and gl.visible` 한 줄을 더했다(service_role·소유자가 불러도 숨긴 용어 0 — 심층 방어, 함수가 security invoker라 anon에 `visible` 칸 읽기를 열었다 — 공개 행에서는 늘 true). 기능 키 `glossary`(꺼짐) 씨앗 |
| 쉬운 풀이 한도 | 같은 마이그레이션 · `lib/admin/glossary-rules.ts` · `db-errors.ts` | W2-a의 60자 check(`glossary_terms_plain_check`)를 120자 check(`glossary_terms_plain_max`)로 바꿨다 — GLO-01 '61자는 저장 경고'. 60자 초과는 경고, 120자 초과만 거부(422) |
| 저장 경고 | `glossaryWarnings`·`numberUnitHits`(순수 — 시험이 2.5·2.6 표를 읽는다) | ① 쉬운 풀이 60자 초과(앞뒤 공백 빼고, 사이 공백은 센다) `glo01.plain-long` ② 쉬운 풀이·뜻에 숫자 + 단위(2.5 `glossary.number_units` — 숫자 뒤 띄어쓰기 허용, 범위 `1~3%`·천 단위 쉼표·소수·전각 숫자 포함. 단위 뒤에 한글이 붙어 다른 낱말이 되면(`3원칙`·`원문`·`평가`) 0, 조사·꼬리말(`원을`·`원짜리`·`억이`·`평형`)은 단위) `glo01.number-unit` — 칸마다 하나, 찾은 글 세 개까지 보이고 나머지는 '외 n개'. 날짜·기간·사람 수·단계(`2026년`·`60일`·`100명`·`2단계`)는 0 [확인 필요 — 12장 #30] |
| 사전 API | `POST /api/admin/glossary` · `PATCH/DELETE /api/admin/glossary/[id]` | 저장되면 201·200 + `warnings`(저장된 행 기준). 공개 상태는 `visible`(true/false) — 더할 때도 고를 수 있다(기본 숨김). 감사 로그: 내용 칸 `glossary.update`(바뀐 칸 전후), 공개 상태 `glossary.publish`·`glossary.unpublish`(전후 `visible` — 공개 상태만 바꾸면 내용 로그 0), 지우기 `glossary.delete`. 권한 `dictionary.edit`(편집 책임자·관리자 — 기자 403). 공개 데이터 캐시를 바로 만료 |
| 사전 화면 | `/admin/dictionaries?tab=glossary` · `components/admin/DictionaryControls.tsx` | 쉬운 풀이 칸 안내(60자 이하·120자까지 저장·숫자 넣지 않기), 입력 중 경고 상자(서버와 같은 규칙 — 칸 오류가 아니다), 저장 뒤 서버 경고 요약('저장했지만 확인할 문장이 있습니다'). 목록: 용어마다 공개/숨김 칩·남은 경고·[공개하기]/[숨기기] 단추, 제목에 '용어 n개 · 공개 m개'. 더하기 폼의 '바로 공개'는 비어 있는 채 시작(감수 전 공개 0) |
| 용어사전 화면 | `app/(site)/glossary/page.tsx` · `app/(site)/glossary/[id]/page.tsx` · `components/site/GlossaryView.tsx` · 서버 `lib/server/public/glossary.ts` · 순수 `glossary-logic.ts`(+ 시험) | 기능 키가 꺼지면 둘 다 404. **색인 `/glossary`** — 공개 용어 전부(한 번에 1,000개까지 — `GLOSSARY_READ_MAX`), 가나다 묶음(2.5 `glossary.initials` — 첫 글자(앞 문장부호 건너뜀)의 첫소리, 된소리는 예사소리 묶음, 영문·숫자 한 묶음, 그 밖 기타), 묶음 안은 한국어 정렬. 색인 줄 = 한글 14자(용어 없는 자음은 글자만) + 영문·숫자·기타(있을 때만) — 쪽 안 자리 `#glossary-group-n`. 분야 탭 `?section=`(전체 + 용어 있는 분야 + 지금 분야, 모르는 값은 전체 — JS 없이 링크). 용어 칸(자리 `#term-번호`) = 분야 칩 · 용어(용어 쪽 링크)·읽기 · 쉬운 풀이 · 뜻 · 관련 용어 칩(공개 용어와 정규형 이름이 같으면 — 같은 쪽에 있으면 `#term-번호`, 아니면 용어 쪽, 사전에 없거나 숨김이면 글자, 자기 자신 0) · 출처. **용어 쪽 `/glossary/[번호]`** — 숨김·없음·형식 밖(1 이상 정수, 앞 0 없음, 16자리까지) 404. 머리에 용어·읽기·쉬운 풀이, 아래에 분야·뜻·관련 용어(용어 쪽 링크)·출처·'용어사전 가나다 색인으로'(`/glossary#term-번호`). 공개 데이터를 읽지 못하면 색인은 머리 + 안내(200), 용어 쪽은 proxy가 503(`public-gate.ts` 상세 경로에 `glossary` — 이때 빠져 있던 `/partners/[id]`도 proxy 대상에 더했다). 검색 노출은 사이트 설정 그대로(루트 레이아웃) |
| 본문 용어 풀이 (GLO-02) | 순수 `lib/site/glossary-tips.ts`(+ 시험) · `components/site/GlossaryTip.tsx`(서버) · `GlossaryTips.tsx`(보조 스크립트) · `ArticleBlocks`·`ArticleView` · `app/globals.css` | 기사 상세 공개 데이터 `glossary`(쉬운 풀이가 있는 공개 용어 — 툴팁 '용어사전에서 보기'는 기능 키가 켜졌을 때만) → 화면이 그릴 때 계획한다(저장된 본문은 그대로 — 계획의 글을 이으면 원래 글). ① 한 기사에서 용어마다 첫 등장 한 번(블록 차례) ② 같은 자리에서 시작하는 용어 가운데 가장 긴 것("지방교육세"가 "교육세"보다 먼저), 맞은 자리 안의 짧은 용어는 그 자리에서 0 ③ 낱말 가운데 0 — 한글로 시작하는 용어는 바로 앞이 한글 음절이면 0("지방교육세"·"주택취득세" 안의 "교육세"·"취득세"), 영문·숫자로 시작·끝나는 용어는 앞·뒤가 영문·숫자이면 0("PFV" 안의 "PF"), 뒤에 붙는 조사는 그대로("취득세를"), 영문은 대소문자 무시, 용어 안 띄어쓰기는 본문의 여러 칸·줄바꿈과도 맞는다 ④ 붙이는 곳 = 문단·인용·상자 글(2.5 `glossary.tip_blocks`) — 문단 안 링크·글자로 남은 링크 표기·상자 제목·인용 발언자·기사 제목·요약·표·FAQ·핵심 요약은 0 ⑤ 그 블록에 쉬운 풀이가 이미 적혀 있으면 풀어 쓴 첫 등장으로 보고 0(발행 점검 UX-01 '풀이 없는 첫 등장'과 같은 판단 — 단위 안 어디든 풀이 글자가 있으면). 그리기: 용어 = 단추(`aria-describedby` = 쉬운 풀이, `aria-expanded`·`aria-controls`), 풀이 상자는 평소 `display: none`(첫 화면 글자·가로 스크롤 0). JS 없이 마우스 올리기·포커스로 열림(CSS). 보조 스크립트: Tab 포커스(포커스 표시가 보일 때)·누르기(터치·마우스 — 다시 누르면 닫힘)·마우스 올리기로 열고, Esc(포커스는 단추로)·바깥 누르기·포커스가 밖으로·마우스가 떠남(누르거나 포커스로 연 것은 그대로)으로 닫는다. 한 번에 하나, 열 때 화면 밖으로 나가지 않게 옆으로 옮긴다(16px 여백). 구조화 데이터와 대조하는 화면 값(제목·저자·날짜·대표 이미지)은 본문 밖이라 그대로(E2E가 JSON-LD 제목 = 화면 제목) |
| 용어사전 링크 열기 | `constants.ts`(`FEATURE_KEYS`·`FEATURE_PREFIXES`·`glossaryTermHref` 등) · `search-logic.ts` · `glossary-logic.ts termChip·tipTerms` | `/glossary`·`/glossary/…`는 기능 키 `glossary`로 여닫는다(아직 없는 화면 목록에서 뺐다). 켜지면 배포 없이 — 검색 결과의 용어 제목 · 허브·상황의 용어 칩 · 본문 풀이의 '용어사전에서 보기'가 용어 쪽 `/glossary/[번호]` 링크. 꺼지면 글자만(1단계 규칙 그대로) |
| 측정 | `GlossaryTips` · `Measure.tsx MeasureGlossaryTerm` | `glossary_opened`(W2-c 2.2 — 속성 `term_id`) — 본문 풀이를 누르거나 키보드로 연 용어마다 한 화면에서 한 번(마우스 올리기는 세지 않는다), 용어 쪽을 열면 1건(분야 = 그 용어의 첫 분야, 없으면 비움). 측정 거부·GPC면 0(track) |
| 발행 점검과의 관계 | `lib/server/articles/repository.ts`(바꾸지 않았다) | 발행 점검의 '풀이 없는 전문 용어 첫 등장'(UX-01)은 공개 상태와 상관없이 사전의 전문 용어 모두를 쓴다(편집국 판단 — service_role) [확인 필요 — 12장 #36] |

### 8.3 4단계 — 검색어 집계·가림 (SRCH-03, 2026-10-19)

| 무엇 | 어디 | 규칙 |
|---|---|---|
| 표 | 마이그레이션 `20261019000022_w2d_query_terms.sql` | `query_terms` — 칸은 PRD-01A 6.1 그대로 9개(2.7 `query_terms.columns`), `(normalized, source, period)` unique, 출처 5종 check(2.7). 기간 `period`는 한국 날짜 하루. `cluster_id`는 OPT-04 묶음 표(W7)가 생기면 외래 키. **DB도 막는다** — 가린 값·정규형에 9자리 이상 숫자 줄(숫자 사이에 띄어쓰기·기호만 — NFKC 뒤)·이메일 모양(`@` 앞뒤 글자)이 있으면 check 위반, 정규형은 남기는 글자 낱말 1~8개를 띄어쓰기 하나로 이은 꼴만. RLS 기본 거부(anon·authenticated 읽기·쓰기 0), service_role 전권. 설정 씨앗 `query_terms`(2.7) |
| DB 함수 (service_role만 실행) | 같은 마이그레이션 | `query_terms_add(출처, 가린 값, 정규형, 기간, 시각, 횟수=1)` — 같은 열쇠면 횟수를 더하고 처음·마지막 시각을 넓힌다(가린 값은 첫 값) · `query_terms_report(출처, 시작, 끝, 최소 횟수, 건수)` — 기간 안 날 행을 정규형마다 더해 `terms`(정규형 수)·`shown`(최소 횟수 이상)·`searches`(합계)·`rows`(많이 찾은 차례 → 마지막으로 찾은 차례 → 정규형, 가린 값은 가장 많이 찾은 날 행의 값) · `query_terms_purge(기준 날, 건수)` — 기준 날 앞 행. 틀린 인자 22023 |
| 가림·정규형 (순수) | `lib/analytics/query-terms.ts` `maskQuery`·`storable`(+ 시험 — 2.8 견본 표를 DB 시험과 함께 읽는다) | 주소의 검색어 그대로 앞 200자(2.7 `scan_chars`) → NFKC → 사용 영역 글자 지움 → ① 이메일(`@` 앞뒤 글자 덩어리, 띄어쓰기 허용) ② 숫자 줄 — 숫자 사이에 남기는 글자 밖(띄어쓰기·하이픈·점·괄호·슬래시 등)만 낀 숫자가 9개 이상이면 가림: 13자리 생년월일 + 성별 숫자 1~8 → `[주민등록번호]`, 0으로 시작하는 9~11자리(`+82`·`82`는 0으로) → `[전화번호]`, 그 밖 → `[번호]`(카드·계좌·사업자번호) → 띄어쓰기 하나로 → 앞 100자(가림 글자 중간에서 자르지 않는다). 정규형 = 가림 글자를 뺀 글의 검색 낱말(4장 3 `queryTerms`)을 띄어쓰기로 이음 — 번호만 다른 같은 질문은 한 행. 남는 낱말이 없거나 DB check와 같은 판정(`storable`)에 걸리면 세지 않는다 |
| 세는가 (순수 + 서버 메모리) | `skipReason`·`isPrefetch`·`isSameSearch`·`RecentSearches` | 사람이 새로 찾은 한 번만: 저장할 값 없음 · 2쪽 이상 · 미리 받기(`Sec-Purpose`·`Purpose`, API는 `next-router-prefetch`도 — Next는 화면 코드에서 이 머리글을 숨긴다) · 측정 거부 쿠키·GPC(설정이 켜면 DNT) · 봇(설정 `bot_user_agents` — 수집 API와 같은 60초 설정 캐시) · 편집국·관리자(로그인 쿠키·Bearer가 있을 때만 확인 — 측정 이벤트 `is_staff`와 같은 판정) · 같은 검색 안 이동(Referer가 같은 사이트 `/search`이고 정규형이 같음 — 탭·쪽·거르개 바꾸기, 같은 검색어 다시 보내기) · 30분 안 다시 찾기(방문자 쿠키 `ltr_vid`, 없으면 IP 해시 + 정규형 — 프로세스 전역 메모리 하나, 화면·API가 같이 쓴다) |
| 부르는 곳 | `app/(site)/search/page.tsx`(`countPageSearch`) · `app/api/search/route.ts`(`countApiSearch`) · 서버 `lib/server/analytics/query-terms.ts` | 검색을 마친 뒤(결과 0건도 센다 — 기획 공백 참고) 판정만 기다리고, 저장은 응답 뒤(`after`) `query_terms_add`. 실패해도 검색은 그대로, 기록에는 오류 이름·DB 오류 코드만(검색어·가린 값 0). 측정 이벤트 `search_submitted`는 그대로 4칸(검색어 칸 0) |
| 편집국 화면 | `/admin/query-terms` · `components/admin/QueryTermsView.tsx` · 보기 값 `lib/admin/query-terms-view.ts`(+ 시험) · 접근 `query_terms.read`(편집 책임자·관리자 — 메뉴 '검색어', 그 밖 403) | 기간 `?days=` 7·30·90(기본 7) 또는 `?from=&to=`(오늘까지·보존 일수 안 — 틀리면 최근 7일 + 이유). 표: 순위 · 검색어(가린 값) · 정규형 · 찾은 횟수 · 찾은 날 · 마지막으로 찾은 때 · 동의어 사전(같은 열쇠 줄이 있으면 '동의어 있음' → 그 줄, 없으면 **'동의어 더하기'** → `/admin/dictionaries?tab=synonyms&term=정규형` — 사전 더하기 폼을 낱말 채워 펼친다, 1장 4단계). 합계가 `display_min_count`(설정 — 씨앗 2)보다 적은 검색어는 목록 0, 수만 안내. 앞 100개(2.7 `list_size`). JS 없이 링크·GET 폼. 360px 표만 가로로 |
| 보존 기한 | `purgeQueryTerms` · 배치 `analytics-retention`(하루 한 번 — 결과 `detail.queryTerms`) | 오늘(한국 날짜) − `retention_days`(설정 — 씨앗 395)보다 앞선 날 행을 5,000건씩 지운다 |
| 설정 | `query_terms` (운영 설정 화면 — `checkQueryTermsSettings`) | `retention_days` 31~1825 · `display_min_count` 1~100 · 값을 바꾸면 `version`도 |

## 9. 성능 하네스 (SRCH-02 · REG1-11 'p95 ≤ 800ms')

- `e2e/search-perf.test.mjs` — 로컬 Supabase에 이관 규모 자료를 넣고(기사 20,000 · 트래커 300 · 상황 40 · 용어 200 · 시·군·구 250 · 인물 40 · 동의어 30 — **이관 기사 수 [확인 필요]**, PRD '이관 기사 전량'), **실제 API(PostgREST)에 anon 키로** 정해진 검색어 묶음(흔한 낱말·드문 낱말·없는 낱말·띄어쓰기 변형·다시 찾기·여러 낱말·지역 + 주제·거르개·종류별 묶음·쪽 넘김)을 차례로 부르고 p50·p95·최대를 찍는다. p95 ≤ 800ms가 아니면 실패. 넣은 자료는 끝나면 지우고(실패해도) 표 행 수가 시험 전과 같은지 본다.
- 기사 본문은 실제 기사 크기(문단 8~12개, 1,500~2,500자)를 흉내 낸 글 조각 조합이다 — 흔한 낱말("지방세"·"취득세")은 기사 대부분에 나온다(최악의 결과 수).
- 실행: `pnpm test:search-perf`(= `node --test --test-concurrency=1 e2e/search-perf.test.mjs`, 기사 수는 `SEARCH_PERF_ARTICLES`). 하네스는 로컬 주소가 아니면 멈춘다 — 원격 DB(staging·prod)에 시험 자료를 넣지 않는다. staging 측정(이관 기사 전량)은 2단계 `/api/search`를 배포 주소로 재는 읽기 전용 측정으로 한다 [확인 필요 — 12장 #14].
- **CI에 넣지 않는다** — 한 번에 2분 4초~3분 7초(자료 넣기 59~83초 + 지우기·VACUUM)로 `scripts/ci/db-e2e.sh`의 '2분 안' 기준을 넘는다. 따로 부르는 시험이고, 검색 함수·색인·정규화를 바꾸는 작업 단위마다 돌려 결과를 이 절에 적는다. 정확성(띄어쓰기 변형·구어·비공개 0)은 CI의 DB 시험·통합 시험이 지킨다.

| 측정 (로컬 Windows 11 · Supabase Postgres 17 Docker, 2026-10-19) | 결과 |
|---|---|
| 자료 | 기사 20,000(찾는 글 평균 1,333자) · 트래커 300 · 상황 40 · 용어 200 · 시·군·구 250 · 인물 40 · 동의어 30 |
| 검색어 24개 × 8회 = 192회 (데우기 1회씩 뺌) | p50 **118ms** · p95 **243ms** · 최대 291ms — 기준 p95 ≤ 800ms 통과 |
| 가장 느린 묶음 | 흔한 낱말(결과 1.9만 건) 전체·종류별 묶음 p95 276~291ms · 한 글자 '세' 252ms · 용어 탭 286ms(탭 숫자를 위해 모든 종류를 센다) |
| 빠른 묶음 | 결과 적은 검색(다시 찾기·지역 + 주제·드문 낱말·없는 낱말) 17~52ms |
| 같이 확인한 것 | '취득 세'·'취득세' 같은 결과 · '차 팔았' → 상황 · '개편안' → 트래커 · 끝난 뒤 표 행 수 시험 전과 같음 |

- 2단계는 검색 함수·색인·정규화를 바꾸지 않아 하네스를 다시 돌리지 않았다. 화면이 더한 DB 요청은 고른 탭·쪽이 비었을 때의 탭 숫자 한 번(8.1)뿐이다 — 최악(흔한 낱말인데 고른 탭만 0건)은 두 번 읽어 위 표 기준 약 0.6초 안. 탭 숫자 다시 읽기가 든 응답 시간은 staging `/api/search` 읽기 측정(12장 #14)에서 함께 잰다.
- **4단계 (2026-10-19)** — 검색 함수·색인·정규화를 바꾸지 않아 하네스(PostgREST를 직접 부른다)를 다시 돌리지 않았다. `/search`·`/api/search`에 더한 일은 판정(메모리·60초 설정 캐시 — 로그인 쿠키가 있을 때만 로그인 확인 한 번)뿐이고, DB 쓰기(`query_terms_add` 한 번)는 응답을 보낸 뒤(`after`)라 검색 응답 시간에 들지 않는다. staging `/api/search` 읽기 측정(12장 #14)에서 함께 본다.
- **3단계 다시 잼 (2026-10-19)** — 검색 함수 몸에 용어 공개 조건(`and gl.visible`) 한 줄을 더해 하네스를 다시 돌렸다(용어 200개는 공개로 넣는다). 같은 자료(기사 20,000 · 넣기 39초) · 검색어 24개 × 8회 = 192회: p50 **204ms** · p95 **305ms** · 최대 341ms — 기준 p95 ≤ 800ms 통과. 용어 탭 p95 249ms(1단계 286ms), 가장 느린 묶음은 한 글자 '세'·흔한 낱말 전체 321~341ms. 전체가 1단계보다 60~90ms 느린 것은 같은 PC에서 E2E를 잇달아 돌린 뒤의 측정 차이로 보인다(공개 조건은 용어 표 200행에만 걸린다) — staging 읽기 측정(12장 #14)에서 다시 본다. 끝난 뒤 표 행 수는 시험 전과 같았다.

## 10. 개인정보

- 검색 함수·서버 함수는 검색어를 저장하지 않는다(1단계). 서버 로그에도 검색어 원문을 남기지 않는다(오류는 오류 번호만).
- 4단계 집계(`query_terms`)는 서버가 가린 값(전화·이메일·주민등록번호 형식 → 가림)과 정규형만 저장한다. 공개 화면 이벤트(`search_submitted`)는 길이·결과 수·종류 수·지역 분류 여부뿐이다(W2-c 2.2 — 검색어 원문 칸 0).
- 4단계 — 가림은 저장 전 서버에서 한다(8.3 — 이메일 · 주민등록번호 · 전화번호 · 그 밖의 9자리 이상 숫자 줄). 표에는 방문자·세션·IP·User-Agent 칸이 없고, 30분 안 다시 찾기 열쇠(방문자 쿠키 또는 소금 친 IP 해시)는 서버 메모리에만 둔다. DB check가 같은 모양을 한 번 더 거부한다. 이름처럼 형식으로 가리지 못하는 말은 편집국 화면에서 최소 횟수(설정 — 씨앗 2)보다 적게 찾은 검색어를 목록에 보이지 않는 것으로 줄인다(12장 #44). 측정 거부·GPC면 세지도 않는다. 날 행은 보존 일수(씨앗 395일)가 지나면 지운다.
- 결과에 개인 연락처가 나오지 않는다 — 인물 결과는 공개 칸(이름·소속·담당)만, 평문 이메일 칸 없음(W2-a).
- 2단계 — `search_submitted` 속성은 4칸(길이·결과 수·결과 유형 수·지역 분류 여부)뿐이고 화면 컴포넌트도 검색어를 받지 않는다(E2E가 저장된 행 전체에 검색어 조각 0을 본다). 같은 검색인지 가리는 열쇠(주소 쿼리)는 브라우저 메모리에만 있다. 검색 API·화면은 검색어를 기록(로그)에 남기지 않는다(오류는 오류 이름·번호만). 다만 검색어는 주소(`/search?q=`)에 있으므로 브라우저 방문 기록과 호스팅의 접근 기록에는 주소가 남을 수 있다 [확인 필요 — 12장 #26].

## 11. 산출물

### 11.1 1단계 — 검색 기반·정규화·성능 하네스 (2026-10-18)

- 마이그레이션 `packages/db/supabase/migrations/20261018000020_w2d_search.sql` — PGroonga 확장(`extensions`), 정규화 도우미 6개, 표 7개에 찾는 글·이름 생성 칸 + PGroonga 색인, 상황 검색 별칭 칸, 동의어 사전 `search_synonyms`(RLS — 사용 중 줄의 열쇠 칸만 공개), 검색 함수 `search_public`.
- DB 시험 `packages/db/tests/w2d-values.test.mjs`(이 문서 2장 표 — 종류·기사 유형·역할·정규화 견본·한도) · `w2d-search.test.mjs`(띄어쓰기 변형 같은 결과 · 구어 검색 — 다시 찾기·별칭·동의어 · 개편안 트래커 · 비공개 0(anon·authenticated·service_role 모두) · 거르개 · 순위 등급 · 쪽 · 권한 · 동의어 사전·별칭 제약). `scripts/verify-rls.mjs` 허용 목록에 `search_synonyms`, `verify-rls-remote.mjs` anon 실행 허용에 `search_public`.
- 서버 `apps/web/lib/server/public/search.ts` · 순수 `search-logic.ts`(+ `search-logic.test.ts`) · `cache-policy.ts uncachedRequestInit` · 통합 시험 `search.itest.mjs`(로컬 Supabase anon 키 — 결과·주소·기능 키·캐시 없음).
- 성능 하네스 `e2e/search-perf.test.mjs`(9장 — 따로 부르는 시험 `pnpm test:search-perf`, CI 밖).
- 시험 결과 (2026-10-19): DB 시험 437개(새 49 — `w2d-values` 28 · `w2d-search` 21) · RLS 검증(표 38개) · 마이그레이션 검사(24개 파일) · 웹 단위 1,767개(새 `search-logic` 51 · `cache-policy` 2) · 통합 39개(새 `search.itest` 6) · 타입·린트 · 환경변수·의존성 검사 · E2E 회귀 `site-home` 13 · `site-article` 15 · `w2b-acceptance` 14 · `w2c-acceptance` 22(두 번) 모두 통과. 시험 자료는 모두 지웠다(로컬 DB 기사 0 · 시·도 씨앗 17 · 기능 키 모두 꺼짐).
- 기존 시험 바꿈: anon 실행 허용 목록이 둘(`health_ping`·`search_public`)이 됐다 — `verify-rls-remote.test.mjs`·`w2c-popular.test.mjs`가 목록을 `ANON_EXECUTE_ALLOWED`에서 읽는다.
- 2단계로 넘김: `/search` 화면·탭·거르개·결과 없음(1장 2단계) · `GET /api/search` · 상황 카드 CMS '검색 별칭' 칸 · `search` 기능 키 켜기와 히어로 검색 폼 · `search_submitted` 이벤트 · 결과 쪽 `noindex`·`no-store`.

### 11.2 2단계 — `/search` 화면·`GET /api/search`·검색 별칭·동의어 사전 편집 (2026-10-19)

- 화면 `app/(site)/search/page.tsx` · `components/site/SearchView.tsx`(검색 폼·탭·거르개·결과·결과 없음) · 측정 `components/site/Measure.tsx`(`MeasureSearch`·`MeasureSearchSituationCards`) — 8.1.
- 순수 규칙 `lib/site/search-view.ts`(+ 시험 22) · `lib/site/search-measure.ts`(+ 3) · `lib/server/public/search-request.ts`(+ 24) · `search-logic.ts`에 `countArgs`·`countsMissing`·`withCounts`·`screenOptions`·`SEARCH_SCREEN`(+ 3). 정규화는 `search-normalize.ts` 한 곳으로 옮겼다(`search-logic.ts`가 다시 내보낸다 — 상황 별칭·동의어 화면이 브라우저에서 같은 규칙을 쓴다).
- 서버 `search.ts` — `searchSite` 탭 숫자 다시 읽기, `getSearchPage`. API `app/api/search/route.ts`.
- 백오피스 — 상황 카드 '검색 별칭' 칸(`lib/admin/situation-rules.ts` 20개·50자·빈 별칭·기호만·띄어쓰기만 다른 같은 말 거부 — 화면은 몇째 줄인지 알린다, `SituationForm.tsx`, 목록에 별칭 수), 동의어 사전 `lib/admin/synonym-rules.ts`(+ 시험) · `lib/server/admin/synonyms.ts` · `app/api/admin/synonyms`(GET·POST) · `app/api/admin/synonyms/[id]`(PATCH·DELETE) · 사전 화면 4번째 탭 `검색 동의어`(`SynonymControls.tsx` — 찾는 열쇠 미리보기). 권한 `dictionary.edit`(편집 책임자·관리자), 감사 로그 `synonym.create`·`synonym.update`(바꾼 칸 전후)·`synonym.delete`(지운 줄 전체). 동의어는 캐시하지 않는 검색만 읽어 공개 캐시 만료가 필요 없다(상황 별칭은 상황 API가 하던 대로 만료). DB 제약 문장 `db-errors.ts`(별칭·동의어 4개).
- DB는 바꾸지 않았다(1단계 마이그레이션 그대로). 기능 키 `search` 기본값도 그대로 꺼짐(12장 #17).
- 시험 결과 (2026-10-19): 웹 단위 1,855개(새 88) · 통합 41개(새 2 — 탭 숫자 다시 읽기·검색 화면 값) · DB 시험 437 · RLS 검증 38표 · 마이그레이션 검사 24개 · 스크립트 121 · 타입·린트 · 디자인·환경변수·의존성 검사 · 새 E2E `site-search` 13(접근성 100·100, 360px R1 91~115자) · `admin-search-vocab` 8 · 회귀 `site-home` 13 · `admin-situations` 9 · `w2b-acceptance` 14 · `w2c-acceptance` 22 · `a11y` 7 · `screen-rules` 6 모두 통과. 시험 자료는 모두 지웠다(기사·상황·트래커·용어·동의어·측정 이벤트·감사 로그 0, 기능 키 모두 꺼짐, 추천 검색어 빈 목록).
- CI(`scripts/ci/db-e2e.sh`)에 `site-search`·`admin-search-vocab` 두 단계를 더했다.
- 3단계로 넘김: 용어사전 `/glossary`(가나다 색인 — 용어 결과 링크가 그때 열린다)·용어 공개 상태 칸·저장 경고·툴팁.

### 11.3 3단계 — 용어사전 `/glossary`·용어 공개 상태·저장 경고·본문 용어 풀이 (2026-10-19)

- 마이그레이션 `packages/db/supabase/migrations/20261019000021_w2d_glossary.sql` — `glossary_terms.visible`(새 용어 숨김·기존 용어 공개 그대로), 공개 읽기 정책 `using (visible)`, 쉬운 풀이 check 60자 → 120자(`glossary_terms_plain_max`), 기능 키 `glossary`(꺼짐) 씨앗, `search_public` 용어 결과에 `and gl.visible`. DB 시험 `packages/db/tests/w2d-glossary.test.mjs`(새 10 — 기본값 숨김·61자 저장·121자 거부·anon·authenticated는 공개 용어만·공개 상태 못 바꿈·service_role은 모두·검색 함수는 모든 역할에서 숨긴 용어 0·상황 칩·기능 키 씨앗). `scripts/verify-rls.mjs` 허용 이유 고침.
- 기존 시험 바꿈(규칙이 바뀐 곳만): `w2a-articles`(61자 거부 → 61자 저장·121자 거부 — GLO-01 '61자는 저장 경고') · `w2b-public-read`·`w2d-search`·`w2d-values`(시험 용어를 공개로) · 웹 `constants.test`(용어사전은 '아직 없는 화면'에서 기능 키 화면으로) · `search-logic.test`(용어 결과 링크 = `/glossary/[번호]`, 꺼지면 0) · `glossary-rules.test`(60자 거부 → 경고) · 통합 `search.itest`·`public-data.itest`(시험 용어 공개) · E2E `admin-settings-api`(61자 422 → 201 + 경고, 121자 422, 공개·숨김 감사 로그) · `site-search`·`w2b-acceptance`·`site-hubs`·`a11y`·`search-perf`(시험 용어 공개). W2-b 설계 2.3 기능 키 표에 `glossary`, 9장 #12·#41, W2-a 설계 4-2 쉬운 풀이 줄을 고쳤다.
- 백오피스 — 규칙 `lib/admin/glossary-rules.ts`(경고·숫자 + 단위·공개 상태 — 시험이 설계 2.5·2.6 표를 읽는다), API `app/api/admin/glossary`(POST)·`[id]`(PATCH·DELETE — `warnings`, `glossary.publish`·`glossary.unpublish`), 사전 화면 `components/admin/DictionaryControls.tsx`(입력 중 경고·저장 뒤 경고·바로 공개·[공개하기]/[숨기기])·`app/admin/(desk)/dictionaries/page.tsx`(공개/숨김 칩·남은 경고·공개 수), `db-errors.ts`(120자 문장).
- 공개 화면 — `app/(site)/glossary/page.tsx`·`[id]/page.tsx`, `components/site/GlossaryView.tsx`(색인·용어 쪽·용어 칩 목록), 서버 `lib/server/public/glossary.ts`, 순수 `glossary-logic.ts`(+ 시험 51), 툴팁 `lib/site/glossary-tips.ts`(+ 시험 24)·`components/site/GlossaryTip.tsx`·`GlossaryTips.tsx`·`ArticleBlocks.tsx`·`ArticleView.tsx`·`app/globals.css`, 칩 링크 `HubView.tsx`·`SituationView.tsx`, 링크 판정 `constants.ts`·`search-logic.ts`, 측정 `Measure.tsx MeasureGlossaryTerm`, 상세 확인 `lib/site/public-gate.ts`(+ 시험)·`proxy.ts`(matcher에 `/glossary/:id`·빠져 있던 `/partners/:id`).
- 통합 시험 `lib/server/public/glossary.itest.mjs`(새 8 — 꺼짐 404·툴팁 공개 용어만·링크 0 / 켜짐 색인·분야·용어 쪽·툴팁·검색 링크 / 공개로 바꾸면 다음 읽기부터).
- E2E `e2e/site-glossary.test.mjs`(새 13 — 8.2 전부, 기능 키 켜고 끈 뒤 되돌림) · `admin-settings-ui` c2(61자·숫자 + 단위 경고가 입력 중·저장 뒤 보이고 저장은 숨김으로 된다, [공개하기]·[숨기기] 감사 로그). CI `scripts/ci/db-e2e.sh`에 `site-glossary` 단계를 더했다(c2는 기존 `admin-settings-ui` 단계 안).
- 시험 결과 (2026-10-19): DB 시험 447개(새 10) · RLS 검증 38표 · 마이그레이션 검사 25개 · 웹 단위 1,974개(새 119 — `glossary-rules` 44 · `glossary-tips` 24 · `glossary-logic` 51 등) · 통합 49개(새 8) · 편집 점검 493 · 스크립트 121 · 타입·린트 · 디자인·환경변수·의존성 검사 · 새 E2E `site-glossary` 13(접근성 100·100·100, 360px R1 색인 86자·분야 쪽 79자·용어 쪽 78자·풀이 기사 51자) · `admin-settings-ui` 7(새 c2) · `admin-settings-api` 12 · 회귀 `site-search` 13 · `site-hubs` 10 · `site-article` 15 · `site-media` 12 · `w2b-acceptance` 14 · `w2c-acceptance` 22 · `a11y` 7 · `screen-rules` 6 · 성능 하네스 p95 305ms(9장) 모두 통과. 시험 자료는 모두 지웠다(용어·기사·측정 이벤트·감사 로그 0, 기능 키 모두 꺼짐).
- 4단계로 넘김: 검색어 집계·가림(SRCH-03 — 1장 4단계). 3단계에서 남긴 것: 용어 쪽의 '이 용어가 나오는 기사'(12장 #39) · 헤더·바닥글의 용어사전 메뉴(12장 #38) · 용어 200개 입력 뒤 '4대 분야마다 1개 이상'·'200개 모두 색인' 확인은 5단계 수용 E2E(12장 #37).

### 11.4 4단계 — 검색어 집계·가림 (SRCH-03, 2026-10-19)

- 마이그레이션 `packages/db/supabase/migrations/20261019000022_w2d_query_terms.sql` — `query_terms`(PRD-01A 6.1 칸 9개 · unique · 출처 check · 가림 모양 check 3개 · RLS), 함수 `query_terms_add`·`query_terms_report`·`query_terms_purge`(service_role만), 설정 씨앗 `query_terms`. DB 시험 `packages/db/tests/w2d-query-terms.test.mjs`(새 11 — 칸 = 2.7·PRD 6.1, 출처 값 집합, 2.8 견본의 가린 값은 들어가고 가림이 필요한 원문은 거부(전각 포함), 숫자 줄 8/9자리 경계, 이메일 모양, 정규형·가린 값 모양, 더하기 합산, 보고 합계·최소 횟수·차례·인자 검사, 정리, RLS·함수 권한, 설정 씨앗 = 2.7).
- 순수 규칙 `apps/web/lib/analytics/query-terms.ts`(+ 시험 82 — 2.7 값·2.8 견본·경계·자르기·합산 열쇠·무작위 2,000개·세는가·30분·기간·설정) · 보기 값 `lib/admin/query-terms-view.ts`(+ 시험 6) · 서버 `lib/server/analytics/query-terms.ts`(+ 통합 시험 `query-terms.itest.mjs` 5 — 더하기·가리지 않은 값 거부·보고·틀린 기간·정리) · `collect.ts`가 설정 캐시(`readCollectSettings`)·편집국 판정(`isStaffViewer`)을 내보낸다.
- 공개 — `/search`·`/api/search`가 검색 뒤 `countPageSearch`·`countApiSearch`. 백오피스 — `/admin/query-terms`(`QueryTermsView.tsx`), 접근 `query_terms.read`(접근 표 시험·메뉴 시험에 줄을 더했다), 메뉴 '검색어'(사전 뒤), 사전 화면 '검색 동의어' 탭이 `?term=`으로 더하기 폼을 채워 펼친다(줄마다 `#synonym-번호` 자리). 운영 설정 `query_terms` 편집 규칙. 배치 `analytics-retention`이 검색어 날 행도 정리(`@ltr/workflows` `purgeQueryTerms`).
- E2E `e2e/search-terms.test.mjs`(새 9 — 1장 4단계 증거: 가림·원문 0(DB·화면·서버 기록·측정 이벤트) · 같은 정규형 한 행 · 봇·편집국·측정 거부·GPC·2쪽·미리 받기·같은 검색 안 이동 0 · 실제 브라우저 · 편집국 화면 권한·최소 횟수·동의어 더하기·360px · 보존 기한). CI `scripts/ci/db-e2e.sh`에 단계를 더했다. E2E 공용 `e2e/lib/staff.mjs`가 시험 동안 생긴 검색어 행을 번호로 지운다.
- 기존 시험 바꿈(규칙이 바뀐 곳만): 편집 책임자 메뉴에 '검색어' — `menu.test.ts`·`admin-ui`·`admin-settings-ui`. W2-c 수용 E2E의 불안정 두 곳을 고쳤다(시험 7 — 받은 행을 시각 대신 번호로 고른다: 시험 프로세스와 웹 서버 프로세스의 시계가 1~2ms 어긋나 첫 요청이 t0보다 1ms 이르게 찍히는 것을 재현 · 시험 10c — 저장소 검사를 비동기로: `execFileSync`가 이벤트 루프를 14초 막는 동안 서버가 keep-alive로 닫은 소켓을 다음 시험 첫 요청이 다시 써 ECONNRESET).
- 시험 결과 (2026-10-19): DB 시험 458개(새 11) · RLS 검증 39표 · 마이그레이션 검사 26개 · 웹 단위 2,073개(새 99 — `query-terms` 82 · `query-terms-view` 6 · 접근 표·메뉴 11) · 통합 54개(새 5) · 스크립트 121 · 타입·린트 · 디자인·환경변수·의존성 검사 · 새 E2E `search-terms` 9 · 회귀 `site-search` 13 · `site-glossary` 13 · `admin-search-vocab` 8 · `admin-ui` 7 · `admin-settings-ui` 7 · `w2b-acceptance` 14 · `analytics-api` 16 · `analytics-popular` 12 · `w2c-acceptance` 22(세 번 잇달아) 모두 통과. 시험 자료는 모두 지웠다(검색어 행·기사·측정 이벤트·동의어 0, 기능 키 모두 꺼짐). 새 환경변수 없음.
- 5단계로 넘김: W2-d 수용 E2E(`e2e/w2d-acceptance.test.mjs`) — SRCH-03 증거(가림 견본·공개 이벤트 원문 0·같은 정규형 한 행)를 다른 증거와 한 서버·한 브라우저로 다시.

### 11.5 5단계 — 수용 E2E (2026-10-19)

- `e2e/w2d-acceptance.test.mjs` — PRD-01A 9장 W2-d 증거(검색 정규화 테스트 통과, p95 ≤ 800ms)와 4장 수용 기준 SRCH-01 · SRCH-02 · SRCH-03 · GLO-01 · GLO-02(+ REG-08/REG1-11 지역 검색·LG-10 중 W2-d 범위)를 한 시험 자료·한 서버·한 브라우저로 끝까지 본다(21개 시험). 기준 값(종류·탭 글자·정규화 견본 2.2·숫자+단위 견본 2.6·가림 견본 2.8·가나다 묶음)은 이 문서의 2장 표를 읽어 쓴다. 파일 머리 주석에 시나리오 번호와 증명하는 수용 기준 문장이 있다.
- 시나리오: 정규화 견본 전체(TypeScript 규칙 · 실제 API가 DB에서 받은 낱말 · 0건이면 띄어 쓴 낱말 — 낱말을 제목·요약·본문 칸에 나눠 담은 글로. 본문 블록끼리는 한 칸이라 이어지므로 블록으로 나누지 않는다) · 취득세=취득 세·재건축=재 건축(API·화면) · 차 팔았→상황(다시 찾기 → 편집국이 검색 별칭을 더하면 바로 별칭으로)·개편안→트래커 · 비공개 0(초안·유료·핫뉴스·권리 미확인 대표 이미지·감수 전 상황·비공개 트래커·숨긴 인물·숨긴 용어) · 명소·맛집·행사 종류 0 · 편집국 API로 쓴 기사 발행→검색→삭제 정정 즉시 0(410) · 지역명 첫 결과·옛 이름 별칭·지역 거르개 · 탭 URL·JS 꺼도 링크·거르개·쪽 · 결과 없음 · 가림 견본 실서버·같은 정규형 한 행·원문 0(DB·이벤트·편집국 화면·서버 기록)·동의어 더하기→검색 반영 · 쉬운 풀이 60/61/121자·숫자+단위·사전 화면 공개/숨김 · 용어 200개 색인·4대 분야 · 본문 풀이·키보드 · p95 · R1~R3·360px·접근성 · 기능 키 꺼짐 · 정리(표마다 시험 전 행 수).
- **p95 방법과 이유**: 실제 `GET /api/search`(132회)와 `/search` 화면(44회) 경로를 사람 User-Agent·요청마다 다른 IP로 재 p95 ≤ 800ms를 본다(11개 검색어 × 12회 + 화면 4회, 검색어마다 앞 1회는 데우기로 버린다). 자료는 시험용 기사 3,000건을 DB에 한 번에 넣는다(약 7~8초, 끝나면 지우고 VACUUM). 이유: CI 한 단계가 2분 안(9장)이어야 하고 2만 건 하네스는 3분이 넘는다 · 기사 3,000건이면 흔한 낱말의 결과가 수천 건이라(최악 결과 수 경로) 라우터·설정 읽기·PostgREST·화면 그리기 전 경로의 지연을 CI에서 매번 잡는다 · 규모 증명(기사 2만 건)은 9장 하네스가 맡는다. 측정 결과(로컬, 3회): API p95 56~85ms · 화면 p95 82~96ms.
- 시험이 찾은 시험 쪽 교훈: 본문 블록은 한 칸으로 이어진다(블록으로 낱말을 나누지 못한다) · 금주 핫뉴스 기사는 `digest_id`가 있어야 DB에 들어간다 · 합산 확인은 행이 생긴 직후가 아니라 횟수가 맞을 때까지 기다린다 · 시험이 지우는 자료는 유일한 이름 규칙으로만 골라 다른 시험 기사를 지우지 않는다.
- 범위 밖으로 남긴 것(01B·01C 뒤): 지역 + 주제 분류(`성동구 재개발` → 지역 1 + 주제 1)·결과 0건의 상위 지역·다른 표기 제안(12장 #11) · 행사 결과의 `행사안내` 표시와 축제 회차 0(`local_events`가 01B W6에 생긴다 — 지금은 행사 종류가 결과·탭에 없음과 DB가 모르는 종류를 거부함까지 본다) · 전문가 결과 · 이관 기사 전량 staging p95(12장 #14).
- 새 환경변수 없음. 새 앱 코드 변경 없음(결함 없음).

## 12. 결정·확인 필요

| # | 내용 | 지금 기본값 | 표시 |
|---|---|---|---|
| 1 | 검색 엔진 | PGroonga 3.2.5(Groonga 14) — 로컬 Supabase Postgres 17 이미지에 있음(`pg_available_extensions`), 직접 설치판도 같은 이미지(PRD-00 이식성 규칙 2). `extensions` 스키마 | [결정] |
| 2 | 띄어쓰기 규칙 (4장) | 정규형 부분 글자 맞추기 + 한 글자 한글 낱말 붙이기 + 0건이면 띄어 쓴 대로. 두 글자 이상 낱말 사이 띄어쓰기는 낱말 경계("지방 교육세"는 '지방교육세'보다 넓다) | [확인 필요] |
| 3 | 순위 (6장) | 이름 같음 → 이름에 있음 → 본문, 같은 등급은 종류 순서 → 최신. 관련도 점수 미사용 | [확인 필요] |
| 4 | 광고(`sponsored`) 기사 | 결과에 넣는다 — 유형 배지 `광고`(공동 기획은 `공동 기획 ○○`)로 구별(원칙 ⑥). 기사 유형 거르개로 고를 수 있다 | [확인 필요] |
| 5 | 금주 핫뉴스(`digest`) | 기사 결과 0 — 주간 페이지 경로(01B LG-01)가 생기면 01B가 종류를 더한다 | [01B W6] |
| 6 | 거르개와 날짜·지역이 없는 종류 | 기간을 고르면 날짜 없는 종류(상황·용어·지역·분야·인물) 0, 지역을 고르면 기사·지역만, 기사 유형을 고르면 기사만, 분야를 고르면 인물 0 | [확인 필요] |
| 7 | 인물 결과 | 공개 인물 중 기자·편집·필자·감수 역할 — 전문가만인 인물은 01C 검증(EXPL-03) 전 0 | [확인 필요] |
| 8 | 결과 링크가 닫힌 화면일 때 | 용어(기능 키 `glossary` 꺼짐 — 화면은 3단계에 만들었다, 켜면 `/glossary/[번호]`)·트래커(`amendments` 꺼짐)·지역 허브(`region_hubs` 꺼짐)는 결과를 보이되 링크 0(트래커는 현재 단계 원문 링크). 기능을 켜면 배포 없이 링크 | [확인 필요] |
| 9 | 탭에 없는 종류 | 상황·분야·기자·필자는 전체 탭에만 | [확인 필요 — SRCH-02 탭 목록에 없음] |
| 10 | 유형 없는 이관 기사 | 결과에 넣는다(이관 기사 전량 검색 — SRCH-02) — 배지 대신 `기사`, 기사 유형 거르개를 고르면 0 | [확인 필요] |
| 11 | 지역 + 주제 분류 (REG-08 · REG1-11) | 주제 사전(`settings` — 6개 주제와 별칭)·분류·상위 지역 제안은 01B W4. 지금 함수는 지역 결과(이름·별칭 — 지역명만 쓰면 첫 결과)와 지역 거르개까지 — "성동구 재개발"은 지금 '성동구' 그리고 '재개발'이 다 든 결과 | [01B W4] |
| 12 | 도우미 검색 도구 (CHAT-03 · TX-17) | 같은 함수를 anon 키(또는 01C 전용 읽기 역할 — 공개 읽기 정책에 더한다)로. AI 색인 불허 칼럼 거르개는 01C | [01C] |
| 13 | 검색 결과 쪽 색인 | `noindex, nofollow` · `no-store` — 2단계에 적용(화면·API, E2E 확인) | [확인 필요] |
| 14 | 이관 기사 수 · staging 측정 | 하네스는 기사 20,000건 가정(로컬). staging은 시험 자료를 넣지 않고 2단계 `/api/search` 읽기 측정 | [확인 필요: 이관 기사 수] |
| 15 | 정규형 글자 범위 | 숫자·영문 소문자·한글 음절·한글 자모·한자만 남긴다 — 악센트 붙은 라틴 글자·일본 글자는 지워진다 | [확인 필요] |
| 16 | 동의어 사전 공개 | 사용 중 줄의 열쇠·동의어만 anon 읽기(공개 검색 어휘), 낱말 단위·한쪽 방향 | [확인 필요] |
| 17 | `search` 기능 키 | 화면은 2단계에 만들었고 **기본값은 꺼짐 그대로** — 운영 설정 화면에서 켜면 배포 없이 헤더 '검색'·히어로 검색 폼·추천 검색어 칩·`/search`·`/api/search`가 함께 열린다(꺼지면 404·링크 0). 운영(prod) 기본값을 코드로 바꾸지 않았다 | [결정 필요 — 켤 때·추천 검색어 3~6개 입력] |
| 18 | 보이는 탭 | 전체 + 결과가 있는 탭 + 지금 탭(0건이어도). 행사·전문가 탭은 01B W6·01C 전 0(주소로 와도 전체 탭). 결과가 0이면 탭 0 | [확인 필요] |
| 19 | 전체 탭 묶음 수 | 종류마다 앞 5개(2.4) — 기사·트래커·지역·용어는 '○ N건 모두 보기'로 그 탭, 탭이 없는 상황·분야·기자·필자는 "앞 5개만 보입니다" 안내 | [확인 필요] |
| 20 | 결과 없음 상황 카드 | 공개 상황을 편집 순서(`sort`)대로, 분야 거르개를 따름, 상한 = 허브 상황 카드 상한 설정(`hub_situation_limit`, 4) | [확인 필요] |
| 21 | 추천 검색어 | 따로 설정 키를 두지 않고 홈 칩(`home_search_chips`)을 같이 쓴다 — 지금 검색어(정규형 같음)는 빼고 앞 3개. 설정이 비면 0개 | [확인 필요] |
| 22 | [AI 도우미에게 묻기] | 도우미 위젯·공개 플래그(01C CHAT-01·CHAT-14 — `ASSISTANT_*`)가 아직 없어 화면 요소 0. 결과 없음 모델의 `assistant` 칸(지금 늘 거짓)을 01C가 위젯과 함께 켠다 | [01C] |
| 23 | `search_submitted` | 검색어·거르개가 바뀐 결과 화면을 열 때 1건(탭·쪽만 바꾸면 0, 같은 검색을 폼으로 다시 보내면 1). `result_count` = 모든 종류 합(10,000에서 자름), `region_classified` = 지역 결과가 있는가(지역 + 주제 분류는 01B W4 — 대리값). 남는 글자 없는 검색어는 0건 | [확인 필요] |
| 24 | `/api/search` 검사 | 화면과 달리 엄격 — 모르는 칸·같은 칸 두 번·빈 거르개 값도 400, 전체 탭 2쪽 이상 400, 행사·전문가 탭은 200 빈 결과(탭 숫자도 0 — DB를 부르지 않는다). IP별 1분 120번 | [확인 필요] |
| 25 | 동의어 사전 편집 화면 | 작업 지시로 4단계에서 2단계로 당겼다(사전 화면 4번째 탭). 4단계는 많이 찾은 검색어 옆에서 더하기만 | [결정] |
| 26 | 검색어가 주소에 있다 | GET 폼이라 `/search?q=`가 브라우저 기록·호스팅 접근 기록(Vercel 요청 기록 등)에 남을 수 있다 — 앱은 저장·기록 0. 처리방침(W2-e)에 적을지 | [확인 필요] |
| 27 | 거르개 유지 | 새 검색어를 넣어도 고른 거르개를 지키고, 거르개 적용은 지금 탭을 지킨다 — 지우기 링크로 한 번에 푼다 | [확인 필요] |
| 28 | 용어 공개 상태 — 칸이 생기기 전 용어 | 공개 그대로(W2-b #12 '모든 용어 공개'를 이어받음 — 조용히 내리지 않는다). 새 용어는 숨김으로 저장되고 편집 책임자·관리자가 [공개하기]로 연다. 감수 전 용어가 운영 DB에 있으면 [숨기기]로 내린다 | [확인 필요] |
| 29 | 쉬운 풀이 글자 수 | 60자까지 경고 0, 61자부터 저장 경고(GLO-01), 120자 넘으면 저장 거부(뜻을 통째로 붙인 글 막기 — 2.5 `glossary.plain_max`). 공백 포함·앞뒤 공백 제외 | [확인 필요 — 120자] |
| 30 | 숫자 + 단위 경고 | 단위 = %·퍼센트·원(천·만·억·조 원 포함)·억·㎡·m²·제곱미터·평, 칸 = 쉬운 풀이와 뜻(PRD '풀이'를 둘 다로 읽었다). 날짜·기간(`60일`·`2년`)·사람 수·단계 숫자는 경고 0 — 요건 기간도 경고하려면 단위를 더한다 | [확인 필요] |
| 31 | 용어 쪽 주소 | `/glossary/[번호]`(PRD-01A 3장 `/glossary/[term]`) — 용어 이름을 고쳐도 주소가 바뀌지 않게 번호를 쓴다. 한글 이름 주소는 쓰지 않는다. 색인 화면의 자리는 `#term-번호` | [확인 필요] |
| 32 | 툴팁 붙이는 블록 | 문단·인용·상자 글(2.5 `glossary.tip_blocks`) — 핵심 요약·FAQ·표·카드뉴스·이미지 설명·제목·요약 0. 첫 등장이 핵심 요약에 있으면 툴팁은 다음 문단의 첫 등장에 붙는다 | [확인 필요] |
| 33 | 낱말 가운데 | 한글 용어는 바로 앞 글자가 한글이면 맞추지 않는다 — "지방교육세"가 사전에 없어도 그 안의 "교육세"에 붙지 않고, 붙여 쓴 "주택취득세"의 "취득세"에도 붙지 않는다(띄어 쓴 "주택 취득세"에는 붙는다) | [확인 필요] |
| 34 | 이미 풀어 쓴 블록 | 첫 등장 블록에 쉬운 풀이 글이 그대로 있으면("과세표준(세금을 매기는 기준 금액)") 툴팁 0 — 발행 점검 UX-01과 같은 판단. 뒤 블록에도 0 | [확인 필요] |
| 35 | 툴팁과 기능 키 | 본문 풀이(GLO-02 P1)는 기능 키 `glossary`와 상관없이 공개 용어면 나온다(용어 공개 = 감수 끝). '용어사전에서 보기' 링크만 기능 키를 따른다. 용어사전 화면 공개 전에 툴팁도 막으려면 기능 키를 하나 더 둔다 | [확인 필요] |
| 36 | 숨긴 용어와 발행 점검 | 발행 점검의 '풀이 없는 전문 용어 첫 등장'은 공개 상태와 상관없이 사전의 전문 용어 모두(편집국 내부 판단) | [확인 필요] |
| 37 | 용어 200개 (GLO-01) | 편집국이 쓰고 PO(세무사)가 감수한다 — 코드·마이그레이션·씨앗에 용어 풀이를 넣지 않았다(시험은 가짜 낱말만). '4대 분야마다 1개 이상'·'가나다 색인에서 200개 모두'는 입력 뒤 5단계 수용 E2E가 실제 자료로 본다(3단계 E2E는 DB의 공개 용어 전부가 색인에 있는지 본다). 「지방세 용어사전」 활용은 권리 확인 뒤 | [결정 필요 — 편집국·PO] |
| 38 | `glossary` 기능 키 | 화면은 만들었고 기본값은 꺼짐 — 운영 설정 화면에서 켜면 배포 없이 `/glossary`·용어 쪽·검색 결과·용어 칩·툴팁의 용어사전 링크가 함께 열린다(꺼지면 404·링크 0). 메뉴(헤더·바닥글) 링크는 아직 없다 — PRD-01A 3장 헤더 유틸 메뉴에 용어사전이 없다 | [결정 필요 — 켤 때] |
| 39 | 용어 쪽의 관련 기사 | PRD-01A 3장 '관련 용어(칩)·기사' 가운데 '이 용어가 나오는 기사'는 아직 0 — 검색 함수(기사 종류)로 붙일 수 있다(4·5단계 또는 뒤) | [확인 필요] |
| 40 | `glossary_opened` 세는 법 | 본문 풀이를 누르거나 키보드로 연 용어마다 한 화면에서 한 번 + 용어 쪽 열기 1건. 마우스 올리기는 세지 않는다(스쳐 지나감) | [확인 필요] |
| 41 | 한 번에 읽는 공개 용어 | 1,000개까지(색인·툴팁 — PostgREST 기본 최대 행). 넘으면 쪽 나눔이 필요하다 | [확인 필요] |
| 42 | 기간 단위 | 한국 날짜 하루(2.7 `query_terms.period`) — 화면이 고른 기간(최근 7·30·90일·직접)의 날 행을 더한다. 주·월 행은 따로 두지 않는다 | [확인 필요] |
| 43 | 날 행 보존 | 395일(설정 `query_terms.retention_days` — 측정 원본과 같은 13개월, 지난해 같은 달 비교). 가린 값·합계만이라 더 길게 둘 수도 있다 | [결정 필요] |
| 44 | 화면 최소 횟수 | 기간 합계 2회 이상만 목록에 보인다(설정 `display_min_count` 씨앗 2) — 한 번 찾은 말에 이름처럼 형식으로 가리지 못하는 정보가 있을 수 있어서. 1로 바꾸면 모두 보인다 | [결정 필요] |
| 45 | 가림 범위 | 이메일 · 주민등록번호 · 전화번호 · 그 밖의 9자리 이상 숫자 줄(카드·계좌·사업자번호). 8자리 이하(날짜 `2026-10-19`·대표번호 `1588-1234`·금액 `1,000,000`)는 그대로. 띄어 쓴 연도 셋(`2024 2025 2026`)·날짜 범위(`2026-10-19~2026-10-20`)·10억 원 이상 숫자 금액도 9자리 넘는 숫자 줄이라 `[번호]`로 가린다(지나치게 가리는 쪽). 이름·주소는 형식이 없어 가리지 않는다(#44) | [확인 필요] |
| 46 | 30분 안 다시 찾기 | 같은 방문자(쿠키 `ltr_vid`, 없으면 IP 해시) + 같은 정규형은 30분에 한 번(2.7 `dedupe_minutes`). 서버 프로세스 메모리 — 서버가 여러 대(Vercel 인스턴스)면 인스턴스마다 따로라 드물게 두 번 셀 수 있다. 사무실처럼 한 IP 뒤 여러 사람이 쿠키 없이 같은 말을 찾으면 한 번으로 셀 수 있다 | [확인 필요] |
| 47 | 세지 않는 검색 | 봇 · 편집국·관리자 · 측정 거부·GPC(DNT는 설정 `respect_dnt`를 따른다) · 2쪽 이상 · 미리 받기 · 같은 검색 안에서 탭·쪽·거르개만 바꾸기(Referer) · 30분 안 다시 찾기. 결과 0건 검색은 센다(기획 공백 참고 — 결과 수 칸은 PRD 6.1에 없어 저장하지 않는다) | [확인 필요] |
| 48 | 가린 값 | 같은 정규형 행의 첫 값을 둔다(보고는 기간 안 가장 많이 찾은 날 행의 값). 번호만 다른 같은 질문은 정규형이 같아 한 행 — "취득세 010-…"는 "취득세"와 합쳐진다 | [확인 필요] |
| 49 | 화면 권한 | 편집 책임자·관리자(`query_terms.read` — 동의어 사전을 고치는 사람과 같다). PRD-00 6장 표에 행이 없다. 기자도 기획 참고로 볼지 | [확인 필요] |
| 50 | 원격 DB | 마이그레이션 22는 로컬에만 적용했다 — staging·prod 적용은 PO 승인 뒤 | [결정 필요] |
