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
| `POST roles` | 역할 부여·회수 (관리자만) | 200 · 403 · 409 |

- 거부 응답 403 가운데 승인·정렬·발행·정정 결정·역할 부여는 감사 로그에 남는다.
- DB 제약·트리거 오류는 409·422와 한국어 문장으로 바꾼다. 스택·SQL 원문은 응답에 넣지 않는다.
- 비공개 확인 목록(NAV-10 '인과 단정 없음' · NAV-11 인용별 확인)은 `articles.check_log.checklists`에 둔다. `body`는 공개 칸이라서다.
  - 근거 참조는 `src:<출처 번호>` · `ev:<근거 번호>`로 쓴다.
  - 이미지 권리는 본문이 아니라 `media` 표에서 읽는다.
- 쓰기 순서는 정해져 있다. PostgREST에는 트랜잭션이 없어서, 실패하면 앞 단계를 되돌린다.
- 아직 안 한 것
  - 분야·사전·설정 편집 API와 화면, 역할 관리 화면(ADM-02): 4-2단계
  - 예약 발행

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
- 4-2 분야·사전·설정 편집, 역할 관리 화면(ADM-02), 홈 배치
