# W2-a 기사 관리 CMS — 설계 약속 (개발 문서)

PRD-01A 9장 W2-a를 구현할 때 DB(packages/db)·발행 판정(packages/editorial)·서버 기능(apps/web)·편집 화면이 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항의 원문은 PRD-01A 4장(FND-04 · ART-01 · ART-05 · ART-10 · UX-01 · UX-03 · CAT-01 · CAT-04 · CAT-05 · ADM-01 · ACC-04 · NAV-02~06 · NAV-09~12)과 6장 데이터, PRD-01B CORE-01이다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다.

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 DB | 마이그레이션·RLS·트리거·씨앗 데이터 | DB 시험(로컬)과 원격 RLS 검증 통과 |
| 2 발행 판정 | `packages/editorial` — 순수 함수, 결정론 | 요구사항 경계 시험 통과 |
| 3 서버 기능 | 편집국 로그인·접근 판정 한 함수·기사 작업 API | 역할별 403·감사 로그 E2E |
| 4 편집 화면 | 백오피스 — 역할별 메뉴 | 정량형·정성형 기획→공개, 정정 시나리오 E2E |

## 2. 값 목록 (DB check 제약과 TypeScript 타입이 같은 값을 쓴다)

| 이름 | 값 |
|---|---|
| section (4대 분야) | `tax` · `realestate` · `finance` · `local` |
| content_type | `reported_news` · `explainer` · `guide` · `opinion` · `sponsored` · `digest` |
| reporting_method (reported_news만) | `quantitative` · `qualitative` · `mixed` |
| format | `general` · `cardnews` · `infographic` · `video` · `photo` |
| label (표기) | `none` · `co_planned`(공동 기획) · `ad`(광고) — 하나만 |
| subtype | `general` · `solved_case` |
| status (기사 게재 상태) | `draft` · `in_review` · `approved` · `scheduled` · `published` · `held` · `deleted` |
| update_kind (발행 뒤 수정) | `substantive`(실질 수정) · `typo`(오탈자) · `correction`(정정) |
| article_sources.kind | `official_doc` · `dataset` · `press_release` · `interview` · `field` · `photo` · `other` |
| article_evidence.evidence_type | `dataset` · `document` · `interview` · `field` · `photo` · `calculation` |
| editorial_reviews.kind | `desk_edit`(편집 승인) · `tax_review`(세무 감수) · `sponsor_check` |
| editorial_reviews.decision | `approve` · `reject` · `hold` |
| article_corrections.kind | `correction` · `rebuttal` · `follow_up` · `deletion` · `title_change` |
| story_assignments.status | `idea` · `assigned` · `reporting` · `fact_check` · `review` · `published` · `held` |
| staff_roles.role | `reporter` · `editor` · `reviewer` · `ad_ops` · `store_ops` · `brand_ops` · `expert_ops` |
| article_evidence.rights_status (근거 권리 상태) | `unconfirmed` · `confirmed` · `restricted` |
| media.rights_status (이미지 권리 상태) | `unconfirmed` · `confirmed` · `rejected` |
| article_evidence.verification_status (근거 검증 상태) | `pending` · `verified` · `rejected` |
| articles.editorial_status (편집 승인 상태) | `pending` · `approved` · `rejected` · `held` |
| articles.tax_review_status (세무 감수 상태) | `not_required` · `pending` · `approved` · `rejected` · `held` |
| 개정 단계 (amendment_events.stage, 01B TX-07) | `announced`(발표) · `pre_notice`(입법예고) · `submitted`(국회 제출) · `passed`(의결) · `promulgated`(공포) · `effective`(시행) |

발행 판정은 권리 상태가 `confirmed`인 것, 검증 상태가 `verified`인 것만 통과시킨다. 편집 승인 상태와 세무 감수 상태는 승인 기록(`editorial_reviews`)이 계산한다. 기록 없이 `approved`로 바꾸면 DB가 거부한다(3장).

## 3. DB가 직접 막는 것 (직접 SQL로도 깨지지 않아야 하는 규칙)

- 모든 표 RLS 기본 거부. 공개 읽기는 공개 상태·권리 확인 행만이다(발행된 기사, 공개 인물·분야·제휴사).
- 비공개 취재 근거는 anon·authenticated가 0행이다: `article_evidence`·`article_datasets`·`article_interviews`. 초안과 승인 기록도 같다.
- `staff_roles`
  - 값 7종 밖은 거부한다.
  - `editor`와 편집국 외 역할(`ad_ops`·`store_ops`·`brand_ops`·`expert_ops`)을 한 사람에게 함께 주면 거부한다.
  - 관리자도 예외가 없다(PO 결정 2026-10-17).
- `editorial_reviews`
  - 작성 기자와 같은 사람의 `desk_edit` 승인은 거부한다(NAV-12).
  - `desk_edit`와 `tax_review`는 서로를 대신하지 않는다.
- `article_sources`: kind가 `official_doc`·`dataset`인 행은 `source_url`·`source_name`(발표기관)·`last_verified_at`·`license_status`가 비면 거부한다(FND-04).
- 추가만 되는 표: `article_revisions`·`article_corrections`·`seo_checks`. 수정·삭제는 거부한다.
- `story_assignments`
  - 상태 7종 밖은 거부한다.
  - `fact_check`·`review`를 거치지 않은 `published`는 거부한다. `held`는 어느 상태에서나 갈 수 있다.
  - 담당 기자·편집자·이해관계·전문 분야 관련성이 비면 `assigned`로 바꿀 수 없다.
- 개정 단계 6종 밖은 거부한다.
- 근거 유형 6종 밖은 거부한다.

## 4. 발행 판정이 막는 것 (packages/editorial — 발행 API가 부른다)

| 근거 | 차단 (발행 불가) | 경고 (발행되고 기록) |
|---|---|---|
| NAV-02 | 출처가 보도자료뿐인 `reported_news` | — |
| NAV-03 | 편집 승인 없는 보도기사, 세무 감수 없는 세법 해설 (둘은 다른 상태) | — |
| NAV-04 | 자체 취재 근거 없는 `reported_news`, 사진 권리 미확인 | — |
| NAV-10 | 정량형 필수 7묶음 중 하나라도 빔, '인과 단정 없음' 미확인 | — |
| NAV-11 | 인용마다 인터뷰 기록 없음, 익명 사유 없음, 세금 쟁점의 법령 기준일·세무 감수 없음, 지역 정책 쟁점의 관점별 기록(또는 '접촉했으나 응답 없음') 없음, 상속·증여 사례의 동의·비식별 미확인 | — |
| NAV-12 | 작성자와 같은 계정의 편집 승인, 세금 계산·법률 주장에 감수 서명 없음 | — |
| CORE-01 | 대상 기사(부동산·개발금융·지자체뉴스 × 보도·해설·가이드·칼럼)에 감수된 박스도 생략 사유도 없음, 감수 안 된 박스 | — |
| CAT-04 | 개정 브리핑(지방세 > 개정)에 연결 트래커 없음 | — |
| CAT-05 | 해결 사례 4칸 중 빈 칸, 결과 근거 0, 개인정보 형식(주민등록번호·전화·이메일·지번 주소) | 실명으로 보이는 표현 |
| UX-01 | 금지 표현(위치 알려 줌) | 풀이 없는 전문 용어 첫 등장, 안내 문장 60자 초과, 한 상자 3문장 초과 |
| UX-03 | 공포 표현, '기한'·'가산세' 블록의 '할 일을 함께 썼다' 미확인 | — |
| ART-10 | 표기가 있는데 `sponsored`가 아님, 공동 기획과 광고를 함께 지정, 계약이 끝난 제휴사 지정 | — |
| OPT-03 | seo-lint 차단 항목 (결과를 입력으로 받는다) | seo-lint 경고 |

금지 표현·공포 표현 사전과 기준값은 `settings`에서 읽는다(배포 없이 바뀐다). 판정 함수는 사전을 입력으로 받는다.

## 5. 권한 판정 (서버 — 접근 판정은 한 함수로, PRD-00 6장)

- 관리자(`ADMIN_EMAILS` — 환경변수 화이트리스트)는 데이터·설정 전권이다: 역할 부여, 분야·사전·설정 편집, 모든 기록 조회, 감사 기록 PO 전용 수정·삭제.
- 편집 행위(기사 발행 승인·발행·정렬·HOT·홈 배치)는 `editor` 역할이 있어야 한다. 관리자도 같다 — 편집 신뢰 규칙은 관리자에게도 적용한다 (PO 결정 2026-10-17).
- 작성자와 승인자는 다른 사람이어야 한다. DB 트리거가 막고, 서버도 먼저 막는다.
- 세무 감수 서명은 `reviewer` 역할만 할 수 있다.
- 편집국 외 역할(`ad_ops`·`store_ops`·`brand_ops`·`expert_ops`)은 기사 승인·정렬 API를 부르면 403이고, 그 시도는 감사 로그에 남는다.
- 서버 쓰기는 권한 판정을 통과한 뒤 service_role로 한다. 브라우저 역할(anon·authenticated)에는 쓰기 정책이 없다.

## 6. 서버 기능 (3단계 — apps/web)

- 접근 판정: `apps/web/lib/access.ts`의 `check()` 하나다. 로그인 확인과 역할 읽기는 `lib/server/dal.ts`가 한다.
  - 세션은 쿠키 또는 `Authorization: Bearer`이다. 둘 다 Supabase Auth 서버에 확인한다.
  - 역할은 `staff_roles`에서만 읽고, 관리자는 `ADMIN_EMAILS`(이메일 확인된 계정)로만 정한다. 가입 메타데이터는 보지 않는다.
  - 쿠키 세션의 쓰기 요청은 같은 사이트에서 온 것만 받는다. 본문은 `application/json`이어야 한다.
- 편집국 API (`/api/admin/…`, 로그인 안 하면 401)

| 경로 | 하는 일 | 주요 응답 |
|---|---|---|
| `GET me` | 로그인한 사람·역할·허용 작업 (역할별 메뉴) | 200 |
| `POST articles` · `GET`·`PATCH articles/[id]` | 초안 작성 · 열람 · 수정 (발행 뒤 수정은 수정 종류·사유 필수, 버전으로 동시 수정 막음) | 201 · 200 · 403 · 409 · 422 |
| `POST articles/[id]/sources` · `evidence` · `evidence/[evidenceId]` | 출처 · 비공개 취재 근거 | 201 · 422 |
| `POST articles/[id]/submit` | 검토 요청 | 200 |
| `POST articles/[id]/reviews` | 편집 승인(desk_edit) · 세무 감수(tax_review) · 광고 표기 확인 | 201 · 403 · 409 |
| `GET articles/[id]/check` | 발행 판정 미리 보기 (저장하지 않음) | 200 |
| `POST articles/[id]/publish` | 발행 — 점검 결과를 `seo_checks`에 남긴다 | 200 · 409(이미 발행) · 422 `{ failed, findings }` |
| `POST articles/[id]/correction-requests` · `corrections` | 정정 요청 · 정정 결정(전후 버전·이유) | 201 · 403 · 422 |
| `POST articles/[id]/placement` | 정렬 · HOT · 홈 배치 | 200 · 403 |
| `POST assignments` · `PATCH assignments/[id]` | 기사 기획 등록 · 상태 변경 | 201 · 200 · 409 |
| `POST roles` | 역할 부여·회수 (관리자만) | 201 · 200 · 403 · 409 |
| `GET`·`POST categories` · `PATCH categories/[id]` · `POST categories/order` | 하위 분야 목록·더하기·고치기·순서 (편집 책임자·관리자, CAT-01) | 200 · 201 · 403 · 409 · 422 |
| `GET dictionaries` · `POST dictionaries/[forbidden·fear]` | 금지·공포 표현 사전 보기·표현 하나 더하기/빼기 (편집 책임자·관리자, UX-01·UX-03) | 200 · 403 · 404 · 409 · 422 |
| `POST glossary` · `PATCH`·`DELETE glossary/[id]` | 쉬운 말 사전 용어 (편집 책임자·관리자, UX-01) | 201 · 200 · 403 · 409 · 422 |
| `GET settings` · `PATCH settings/[key]` | 운영 설정 (관리자만 — 거부는 감사 로그) | 200 · 403 · 404 · 409 · 422 |
| `GET`·`POST partners` · `PATCH partners/[id]` | 제휴사 목록(편집 책임자 읽기)·등록·고치기(광고·협찬 담당·관리자, ART-10) | 200 · 201 · 403 · 422 |
| `GET members` · `POST members/[id]/suspension` | 편집국 계정 목록·이메일 검색 · 계정 정지/해제 (관리자만, ADM-02) | 200 · 403 · 404 · 409 · 422 |

- 거부 응답 403 가운데 승인·정렬·발행·정정 결정·역할 부여·계정 정지·운영 설정은 감사 로그에 남는다 (`<작업>.denied`).
- 4-2 운영 API (2026-10-18)
  - 분야: 허브(section)는 4개로 고정 — 고치기에서 section은 422. 발행 판정이 주소로 찾는 하위 분야(지방세 > `amendments`, CAT-04)는 주소 변경 409.
    이름·소개는 저장 때 화면 문구 검사(UX-01·UX-03 `checkScreenCopy`) — 금지·공포 표현은 422, 긴 문장·풀이 없는 용어는 경고(`checks`)만. 순서는 그 분야 전부를 받아 10 간격으로 고친다.
  - 사전: 발행 판정이 읽는 `settings` 키·모양 그대로(`forbidden_phrases`·`fear_phrases` = `{ version, phrases }`). 버전은 날짜.번호로 오른다.
    공백만 다른 표현은 같은 표현(409), 마지막 표현은 뺄 수 없다(422). 동시에 고치면 `updated_at`을 보고 다시 읽어 최대 3번 다시 한다.
    용어(`glossary_terms`)는 쉬운 풀이 60자 이하(공백 포함 — DB와 같은 셈), 전문 용어로 표시하면 풀이 필수. 바꾸면 배포 없이 다음 점검부터 적용된다.
  - 설정: 검사 규칙이 있는 키만 고친다(`lib/admin/settings-rules.ts` — 사전 2종·`similarity_internal`·`amendment_confirmed_stage`). 본문은 `{ valueJson }`(JSON 글) 또는 `{ value }`.
    틀리면 422 `{ errors: ["칸: 문장"] }`. 버전이 있는 값은 내용을 바꾸면 버전도 바꿔야 한다. `updatedAt`이 다르면 409. 감사 로그에 전후 값.
  - 제휴사: 계약 상태(계약 중·종료·시작 전)는 한국 날짜 기준 — 종료일 당일까지 유효(발행 판정과 같은 경계). 계약이 끝난 제휴사를 기사에 **새로** 지정하면 기사 저장 API가 422(`art10.partner-contract-expired`) — 이미 지정된 기사의 배지는 남는다. 제휴사를 비공개로 내려도 공개 화면의 배지는 '공동 기획 ○○' 그대로다(기사가 배지 이름 `articles.partner_badge_name`을 들고 있다 — W2-c 설계 9장 #52·#56).
  - 회원: 목록 = 서비스 역할 또는 인물이 있는 계정. `?q=`(이메일 일부)는 인증 서버의 관리 API로 모든 계정에서 찾는다(처음 역할을 받을 계정).
    정지는 Supabase Auth ban(해제할 때까지). 정지된 계정은 로그인이 막히고(인증 서버), 정지 전에 받은 토큰·쿠키 세션도 `getViewer`가 `banned_until`을 보고 거부한다(401 — 인증 서버도 403 user_banned로 거부하는 이중 확인). 자기 계정·관리자(ADMIN_EMAILS) 계정은 정지하지 않는다(409).
  - 광고·공동 기획 표기 글자(2026-10-18 정리): 광고 `광고`, 공동 기획 제휴 배지 `공동 기획 ○○`(ART-10, ○○ = 제휴사 이름). 제목·메타·JSON-LD headline은 `[배지] 제목`.
    packages/editorial `sponsorBadge` · packages/structured-data `sponsorLabelText` · packages/seo-lint 규칙 `common.sponsor-label`(`badgeFormats`, 규칙 파일 `2026.10-w2a`)이 같은 글자를 쓴다. 제휴사 이름이 없으면 셋 모두 막는다.
- DB 제약·트리거 오류는 409·422와 한국어 문장으로 바꾼다. 스택·SQL 원문은 응답에 넣지 않는다.
- 비공개 확인 목록(NAV-10 '인과 단정 없음' · NAV-11 인용별 확인)은 `articles.check_log.checklists`에 둔다. `body`는 공개 칸이라서다.
  - 근거 참조는 `src:<출처 번호>` · `ev:<근거 번호>`로 쓴다.
  - 이미지 권리는 본문이 아니라 `media` 표에서 읽는다.
- 쓰기 순서는 정해져 있다. PostgREST에는 트랜잭션이 없어서, 실패하면 앞 단계를 되돌린다.
- 아직 안 한 것
  - 예약 발행
  - 홈 배치(HOME-03 해설 스토리 카드·트래커 하이라이트 — 순서·노출 기간·6장 상한): 저장할 칸(표)이 정해지지 않았다 [결정 필요 — 4-2 보고]

## 7. 편집 화면 (4단계 — apps/web/app/admin)

- 4-1 로그인·화면 경로 막기·역할별 메뉴·기획·작성/편집·점검 패널·검토·발행·정정·배치
  - 로그인 `/admin/login` — `POST /api/auth/login`·`POST /api/auth/logout`. 세션은 httpOnly 쿠키(@supabase/ssr)
    - 실패 문장은 하나다("이메일 또는 비밀번호가 맞지 않습니다"). `next`는 같은 사이트 `/admin` 아래 상대 경로만 받는다
  - `proxy.ts` — `/admin/*`에 로그인 쿠키가 없으면 로그인 화면으로 보낸다(낙관적 확인). 만료된 토큰만 새로 받는다
    - 실제 판정은 서버 컴포넌트의 DAL(`getViewer`) + `check()`다. 쓸 수 없는 화면은 `forbidden()` → 403 화면
  - 화면
    - `/admin` 첫 화면 · `/admin/stories` 기획 캘린더 · `/admin/articles`·`/new`·`/[id]` 작성·편집
    - `/admin/reviews`·`/[id]` 검토·발행 · `/admin/placement` 배치 · `/admin/store`·`/brand`·`/experts` 편집국 외 역할 자리
  - 메뉴는 `lib/admin/menu.ts` — 허용 작업(`allowedActions`)에서만 나온다
  - 점검 패널의 점수 옆 문구는 seo-lint 고정 문구(`SCORE_DISCLAIMER`)만 쓴다 — 패널 금지어(순위·노출 예측·상위 노출) 규칙
  - 시험: `apps/web/lib/admin/*.test.ts`, `e2e/admin-ui.test.mjs`
- 4-2 분야·사전·설정·제휴사 편집, 회원·역할 화면(ADM-02)
  - 화면
    - `/admin/categories` 분야 — 4대 분야(허브)별 하위 분야. 위로·아래로(순서 저장)·고치기·더하기. 편집 책임자·관리자
    - `/admin/dictionaries?tab=forbidden|fear|glossary` 사전 — 금지 표현·공포 표현(표현 하나씩 더하기·빼기)·쉬운 말 사전(용어 더하기·고치기·지우기). 편집 책임자·관리자
    - `/admin/settings` 운영 설정 — 행마다 설명·지금 값·JSON 편집(화면과 서버가 같은 규칙으로 검사, 칸 오류). 관리자만
    - `/admin/partners` 제휴사 — 광고·협찬 담당·관리자는 등록·고치기, 편집 책임자는 읽기만(폼 0). 계약 상태 배지와 배지가 붙은 기사 수
    - `/admin/members` 회원·역할 — 편집국 계정 목록·이메일 검색·역할 주기/거두기·계정 정지/해제. 관리자만.
      겸직 금지 조합(편집 책임자 + 광고·스토어·브랜드·전문가 담당)은 고르는 즉시 사유를 보이고, [역할 주기]를 눌러도 역할 API를 부르지 않는다(`lib/admin/role-rules.ts`).
      화면이 본 역할이 낡았으면 서버 409 문장을 그대로 보인다
    - 기사 편집기·새 기사의 제휴사 고르기 — 계약이 끝난 제휴사는 선택지에서 빼고 이름을 알린다(지금 지정된 제휴사는 남긴다). 한국 날짜는 서버가 넘긴다
  - 메뉴 (`lib/admin/menu.ts`, 허용 작업에서만): 편집 책임자 + `분야`·`사전` · 광고·협찬 담당 + `제휴사` · 관리자 + `분야`·`사전`·`제휴사`·`설정`·`회원·역할`.
    편집 책임자에게 제휴사 메뉴는 없다 — 제휴사 관리는 광고 편집 메뉴로 친다(ADM-01 "편집자 화면에 광고 편집 메뉴 0"). 목록은 기사 편집기의 [제휴사 목록 보기]로 읽기만 한다
  - 접근 작업 더함 (`lib/access.ts`): `partner.read`(편집 책임자·광고 담당·관리자) · `member.read`·`member.suspend`(관리자)
  - 시험: `apps/web/lib/admin/{category,dictionary,glossary,settings,partner,member,role}-rules.test.ts`, `e2e/admin-settings-api.test.mjs`, `e2e/admin-settings-ui.test.mjs`
  - 홈 배치는 하지 않았다 — 위 6장 '아직 안 한 것' 
