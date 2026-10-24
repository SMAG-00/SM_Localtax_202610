# W7c SM 전문가 소개 · SM 전문가 연락 요청 — 설계 약속 (개발 문서)

PRD-01C 4.2·4.3 W7c(SM(선명) 소속 전문가 소개 EXPL-01~10·12, SM 전문가 연락 요청 EXPL-13~21, CHAT-17의 연락 받기 쪽)를 구현할 때 DB·서버·화면·시험이 같은 이름과 같은 규칙을 쓰기 위한 약속입니다. W6·W7b 설계와 같은 모양으로 짧게 씁니다.

**이 문서와 구현은 실제 프로필·이름·자격·법률 고지문·동의 문구를 쓰지 않습니다.** 화면 틀·입력 방식·공개 조건·빈 내용일 때의 표시만 정합니다. 운영 DB의 씨앗은 분류 5개와 설정 기본값뿐이고 프로필·요청은 0행입니다. 고지문·동의 문구·안내 문단은 PO가 법률 검토본만 넣습니다(승인 전에는 기능 키를 켜지 못합니다). 시험 자료는 모두 지어낸 값(`*.example.test`, 가상 이름)입니다.

**MVP 방침(PO 2026-10-24 "MVP 먼저 … 빨리빨리")**: 관리자 등록 → 공개 → 이용자 연락 요청 → 관리자 처리 → 보관 기간 뒤 파기가 끝까지 이어지게 만들고, 지켜야 할 선(미검증·비 SM 노출 0, 동의 없는 전달 0, 개인정보 열람 통제·파기, 키 꺼짐 링크 0)은 그대로 둡니다.

## 1. 진행 순서

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 DB 소개 (EXPL-01·02·04·05·07·08) | 마이그레이션 `…65_w7c_expert_profiles` — 분류 5개 씨앗·프로필(분류 여러 개)·상태 기록(추가만)·설정 `expert_notice`·`expert_banned_terms`·고지문 승인 없이 `experts` 켜기 거부·공개 뷰 3개 | DB 시험 `w7c-experts` — 소속 형태 2값만 · 쓰면 안 되는 표현 거부 · 동의서 기록 없는 공개 거부 · 한 프로필이 두 분류에 함께 노출 · 초안/내림/철회/키 꺼짐/고지문 미승인 0행 · 1명뿐인 분류도 노출·0명 분류 없음 |
| 2 DB 연락 요청 (EXPL-13·15·17~21) | 마이그레이션 `…66_w7c_expert_requests` — 정책 `expert_request_policy`·`expert_requests`(service_role 전용)·이력(추가만)·긴 숫자 차단 함수·파기·철회 함수·양식 공개 뷰 2개·`expert_requests` 켜기 조건 | DB 시험 — 동의 버전·내용 확인·연락처·분야 없는 요청 거부 · 우회 숫자 10종 거부 · 상태 역행 거부 · 첫 연락은 수행 주체·안내 완료 필요 · 기한 당일 보존/다음 날 파기·멱등 · 철회 즉시 파기 · anon 접근 0 |
| 3 관리 화면·API | `lib/admin/expert-rules.ts`(입력 검사)·`lib/experts/logic.ts`(민감 입력·영업일·정렬·요청 검사)·`/api/admin/experts`(GET 보드·POST op)·`/api/admin/experts/requests/[id]`(상세·열람 감사)·`/admin/experts`(기존 메뉴 `전문가 등재`)·`/admin/experts/requests/[id]` · 설정 API의 켜기 사전 검사 · 기능 키 `expert_requests` | vitest(입력 규칙·민감 입력·영업일) · 메뉴 목록 변경 0 (기존 `experts` 메뉴 재사용) |
| 4 공개 화면·수용 E2E | `/experts`(목록·분류 필터)·`/experts/profile/[slug]`(`ProfilePage`)·`/experts/request`(양식·철회)·`POST /api/experts/requests`·`…/withdraw` · 도우미 [SM 전문가 보기]·[연락 받기] 연결 · `e2e/w7c-acceptance.test.mjs` | E2E 통과 · CI `db-e2e.sh` 마지막에 연결 |

## 2. 데이터 모델

| 표 | 핵심 칸 | 규칙 |
|---|---|---|
| `expert_categories` | code, name, sort_order, active | 씨앗 5개(PO 결정): `tax-accountant` 세무사 · `cpa` 공인회계사 · `lawyer` 변호사 · `realtor` 공인중개사 · `judicial-scrivener` 법무사 (이 순서). 관리자가 더하거나 닫을 수 있음. 공개 화면은 공개 프로필이 1명 이상인 분류만 |
| `expert_profiles` | slug, name, category_codes[1~5], specialties[], office_name, regions[], contact_links, interests, intro, house_relation(employed·sm_corporation), photo_media_id, status(draft·published·withdrawn), consent_version·consent_on·consent_doc_ref, published_by, withdrawn_reason | 사람 한 명 = 한 행, 분류 하나 이상. 공개는 본인 동의서 기록(버전·받은 날·보관 위치)과 공개한 관리자가 있어야만. 쓰면 안 되는 표현·연락 링크 모양·권리 미확인 사진 거부. 자격 검증·등록번호·재검증 칸 없음. 별점·후기·순위·결제 칸 없음 |
| `expert_profile_events` | profile_id, from/to_status, actor, note | 추가만 — 공개·내림·철회와 행위자 |
| `expert_requests` | receipt_no, source(assistant·experts·article), category_code, summary, summary_confirmed, name, phone, email, preferred_time, deadline_urgent, consent_version·consented_at, performing_entity, scope_noted, status(received·contacted·closed), close_reason, first_contact_at, due_at, retention_until, purged_at | service_role 전용. 동의 버전은 승인된 현재 버전만. 상태는 앞으로만. 보관 기한(기본 365일, 접수 한국 날짜 기준) 다음 날 이름·연락처·요약 파기. 금액·결제 칸 없음. 공개 뷰·색인·평가셋·도우미 도구가 읽지 않음 |
| `expert_request_events` | request_id, from/to_status, actor, note | 추가만, 파기 뒤에도 상태·시각 통계로 남음 |

설정(공개 읽기 정책에 넣지 않고 공개 뷰가 승인분만 내보냅니다): `expert_notice`(`{version,text,approved,reviewed_by,reviewed_on}`, 씨앗 비어 있고 미승인) · `expert_banned_terms`(오인 광고 금지 표현 사전) · `expert_request_policy`(보관 일수·목표 영업일·요약 상한·동의 버전·안내 문단·동의 항목·검토자·검토일·실사(#12)·감수(#20) 기록 번호·승인, 씨앗 비어 있고 미승인). 기능 키 `experts`(켜기 = 고지문 승인)·`expert_requests`(켜기 = `experts`와 함께 + 연락 요청 정책 승인) 모두 꺼짐이 기본입니다. 두 규칙은 DB 트리거가 정본이고 설정 API가 같은 조건을 먼저 보고 422로 알립니다.

## 11. 기록

- 프로필: 공개·내림·철회 때마다 행위자와 본인 동의서 버전이 `expert_profile_events`에 남고, 관리 쓰기는 모두 감사 로그(`expert.profile.*`)에 남습니다.
- 요청: 상태 이력은 `expert_request_events`, 관리자가 상세를 열 때마다 감사 로그 `expert.request.view` 1행(누가·언제·어느 요청). 목록 응답에는 이름·연락처·요약이 없습니다.
- 파기: 배치 `privacy-retention`(기존 하루 1회)이 `expert_requests_purge`를 부르고 지운 건수만 실행 기록에 남깁니다. 철회는 접수 번호 + 요청 때 적은 이메일/전화로 본인 확인 뒤 즉시 파기하고 `이용자 철회`로 종결합니다.
- 목표 시간 안 연락률 = 마감 전 첫 연락 ÷ 접수 (관리 화면에 분모·분자 표시). 목표 시간을 넘긴 접수는 목록에 `목표 시간 경과`로 표시됩니다.

## 12. 결정

| # | 안건 | 이 구현의 값 |
|---|---|---|
| 1 | 소개 범위 | **PO 결정 2026-10-24**: SM(선명) 소속(고용 또는 SM 법인 소속)만, 관리자(PO)가 등록, 외부 신청·유료 등재·매칭·지역 필터/정렬·"여러 명 함께 노출/1명 단독 노출 금지" 규칙 없음 |
| 2 | 켜기 조건 | 고지문(법률 검토본) 승인 없이는 `experts`, 연락 요청 정책(실사 #12·감수 #20 기록 번호 포함) 승인 없이는 `expert_requests`를 켤 수 없음. 권고안으로 진행 (PO 위임 2026-10-22) |
| 3 | 분류 | **PO 결정 2026-10-24**: 세무사, 공인회계사, 변호사, 공인중개사, 법무사 5개(이 순서)를 씨앗으로 두고 `expert_categories`에서 설정. 공개 화면은 공개 프로필이 1명 이상인 분류만. 코드는 URL에 쓰므로 하이픈 소문자(`tax-accountant`…). 분야 코드표(`?field=`)는 두지 않음 — 전문 분야는 프로필의 자유 문구 |
| 4 | 자격 검증 | **PO 결정 2026-10-24**: 자격 검증 기록·재검증 기한·등록번호를 두지 않음 (PRD EXPL-02·03 검증 부분 대체). 관리자가 공개한 프로필 + 본인 동의서 기록이 유일한 공개 조건. 한 프로필이 분류를 여러 개 가질 수 있음 |
| 5 | 담당·알림 | **PO 결정 2026-10-24**: 요청 담당·열람·알림 대상은 기존 사이트 관리자 계정(환경변수 `ADMIN_EMAILS`, 코드·시드·시험에 이메일을 두지 않음). 당번표·순번 배정·전문가 담당 열람은 두지 않음. 알림 메일은 접수 번호·분야 이름·보안 화면 주소만(개인정보 0), 메일 설정이 없으면 알림 없이 저장만 |
| 6 | 프로필 주소 | `/people/[slug]` 대신 `/experts/profile/[slug]` (people 연동은 MVP 이후). 분류 필터는 `/experts?category=` 쿼리(분류별 경로 `/experts/[category]`는 이후). 예약 이름 `profile`·`request`·`report`는 분류 코드로 쓸 수 없음. 권고안으로 진행 (PO 위임 2026-10-22) |
| 7 | 정렬 | 분류 순서(프로필의 첫 분류) → 이름 가나다. 결제·광고·조회수·지역은 입력에 없음 (확인일이 없어 PRD의 "확인일 최신" 단계는 뺌). 권고안으로 진행 (PO 위임 2026-10-22) |
| 8 | 영업일 | 평일만 셈(공휴일 달력은 MVP 이후), 한국 시간. 접수 시각 + N영업일이 목표 시간. 권고안으로 진행 (PO 위임 2026-10-22) |
| 9 | 요약 초안(EXPL-14) | AI 초안 없이 이용자가 직접 씀(`summary_origin` 칸만 예약). 연락처·요약은 AI 호출 경로에 닿지 않음 |
| 10 | 도우미 연결 | [SM 전문가 보기] 문구로 통일, [연락 받기]는 `expert_requests`가 열릴 때만 `/experts/request?source=assistant`로. 분야 코드 교체(도우미 안내표 → 분류)는 이후 |

MVP 이후로 미루는 것: 분석 이벤트 `expert_profile_viewed`·`expert_contact_clicked`(EXPL-09), 정보 오류 신고 화면·표(EXPL-10), 분류별 경로 `/experts/[category]`와 사이트맵·검색 색인 연결, `/about/experts` 정렬 기준 페이지, 당번표·순번 배정 화면(EXPL-16 확장), 접수 확인 메일·목표 시간 경과 경보·지연 안내 메일, 영업일 공휴일 달력, 요약 AI 초안(EXPL-14), 도우미 안내표의 분야 코드 교체, 기사·칼럼 하단 진입 링크(출처 `article` 값은 받을 수 있음), 내보내기(사유 입력).
