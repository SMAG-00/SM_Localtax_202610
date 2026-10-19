# W2-e 회원·고객센터·정책 페이지·문의함 — 설계 약속 (개발 문서)

PRD-01A 9장 W2-e(회원(관심 분야·지역)·`/my` 맞춤·고객센터·바닥글 정책 페이지·광고·제휴 안내·브리핑 사전 알림·백오피스 회원·문의함 — 증거: 회원 E2E 통과, 평문 이메일 0 검사 통과, 바닥글·기사 하단 정책 링크 전수 404 0)를 구현할 때 DB(packages/db)·서버 함수(apps/web/lib/server)·공개 화면·백오피스가 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항 원문은 PRD-01A 4장(ACC-01~03 · HOME-06 · HOME-07 · HELP-01~05 · ADM-02 · ADM-03 · ADM-04 끝 문장)·3장 화면 목록·6장 데이터(`profiles` · `consents` · `inquiries`), PRD-00 6장(역할과 권한)·이식성 규칙 2·5(직접 설치판에도 있는 기능만, 메일 발송은 한 모듈), PRD-01B LG-07(수신 동의 기준), PRD-02 HOME-09·BRIEF(사전 알림을 이어받는 쪽)다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다. W2-a(역할·정지·감사 로그)·W2-b(기능 키·공개 틀)·W2-c(측정 이벤트·개인정보 규칙)·W2-d(가림 규칙)에서 정한 것은 그 설계 문서를 그대로 따른다.

**이 문서는 약관·처리방침·윤리강령·편집 원칙·광고 정책·무단수집거부·정정 처리 원칙·회사 소개의 문구를 쓰지 않는다.** 화면 틀·편집 방식·게시 승인·빈 내용일 때의 표시만 정하고, 실제 문장은 PO·법률 검토가 쓰고 승인한다(12장). 코드·마이그레이션·씨앗 어디에도 그런 문장을 넣지 않는다(시험이 지킨다 — 1장 7단계).

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 계정 기반 (메일 없이) | 마이그레이션 `…23_w2e_accounts` — `request_throttles`(공용 시도 횟수 표)·함수 `throttle_check`·`throttle_hit`·`throttle_purge`, `profiles`, `consents`, 설정 씨앗(`member` · `auth_limits` · `privacy_retention`), 기능 키 씨앗(꺼짐). 서버: 해시 도우미(`GUARD_SECRET`), 시도 제한을 `/api/auth/login`에 연결(계정+IP·계정·IP 세 겹), 비밀번호 규칙(순수 함수), **로그인한 상태의 비밀번호 바꾸기 `/account/password`**(편집국·관리자·회원 모두 — 메일 필요 없음), 관리자 메뉴에 [비밀번호 바꾸기] 링크 | DB 시험(2장 값 표 · 시도 횟수 경계 n번째 허용·n+1번째 차단 · profiles 제약 · consents 제약 · anon·authenticated 직접 접근 0 · service_role 전권 — `admin-rights` 시험에 새 표 추가) · 순수 시험(2.6 비밀번호 견본) · 통합 시험(로그인 6번째 실패 429 · 다른 계정·다른 IP 영향 없음 · 성공하면 계정 횟수 초기화) · E2E(비밀번호 바꾸기: 현재 비밀번호 틀림 거부 · 새 비밀번호 규칙 · 바꾼 뒤 다른 기기 세션 끊김 · 감사 로그에 비밀번호 0) · RLS 검증 |
| 2 메일 모듈·가입·인증·재설정·탈퇴 | 메일 한 모듈 `lib/server/mail`(SMTP 하나로 Resend·사내 SMTP·로컬 수신함 모두 — 8장) · 인증 메일은 앱이 보낸다(`auth.admin.generateLink` → 앱 메일 → `/auth/confirm`, 4.3) · `/signup` · `/login` · `/auth/confirm`(버튼을 눌러야 확인 — 메일 보안 검사기의 링크 미리 열기 방지) · `/forgot-password` · `/reset-password` · `/my/withdraw` · 가입 열림 조건(처리방침·약관 게시본 + 메일 설정 — 6.3) · 확인 안 된 가입 정리(배치 함수만, 배치는 6단계) | 회원 E2E 일부(가입 → 로컬 수신함의 메일 → 확인 → 로그인 → 재설정 → 탈퇴 → 프로필·관심·동의 행 0 · Auth 계정 0) · ACC-01 수용 기준(재설정 메일 1분 안 · 메일 서버를 끊어도 기존 회원 로그인 됨 · 인증 링크가 요청한 사이트 주소로 돌아옴) · ACC-04 가입 메타데이터로 역할 위조 불가 · 가입·재설정 응답이 계정 유무와 상관없이 같은 문장 · 메일 본문·서버 기록에 이메일 주소 0 |
| 3 `/my`·맞춤·회원 관리 | `/my`(프로필 표시 이름·관심 분야·관심 지역·수신 동의 관리·"내 관심 분야 새 글") · 가입 폼의 관심 분야·지역 고르기 · DB 함수 `member_feed` · 측정 `tier`(로그인 회원 `basic`)·`signup_completed` · 백오피스 회원 탭(일반 회원 조회·정지·삭제) · `/admin/members` 확장 | ACC-02·HOME-07 수용 기준(상한+1번째 거부 · 없는 코드·폐지 코드 거부 · 관심 지역 저장만으로 `consents` 0행 · 두 계정 번갈아 들어와도 서로의 블록 안 보임 · 쿼리가 `analytics_events`를 읽지 않음 · 홈 HTML 회원 블록 0) · ADM-02(회원 조회·정지·삭제·감사 로그) · 360px R1~R3 · 접근성 95 |
| 4 정책 페이지·바닥글 | 마이그레이션 `…24_w2e_policy` — `policy_versions`(버전·승인 기록)·공개 뷰·설정 `company_info` 공개 읽기 · 공개 화면 `/about` · `/about/[정책]` · `/about/no-email-collection` · 이전 판 보기 · 개정 이력 · 백오피스 `/admin/pages`(편집·게시 승인) · 바닥글 정리(정책 7종 + 이용약관·이메일무단수집거부·측정 거부 + 회사 정보 줄) · 기사 하단 7종 + [광고·제휴 문의] · 이메일 가림 표기 컴포넌트 · 기능 키 의존 규칙 · `policy_page_viewed` 이벤트 | HELP-02·03·05 수용 기준 · 게시본 없는 정책 페이지는 404이고 링크 0 · 승인 기록 없이는 게시 거부 · 게시본 없는 기능 키는 켜기 거부 · 링크 전수 검사(바닥글·기사 하단 404 0) · 크롤링 서버 HTML 평문 이메일 0 · 마이그레이션 씨앗에 정책 본문 0행 |
| 5 고객센터·문의함·감사 403 | 마이그레이션 `…25_w2e_inquiries` — `inquiries` 칸 더하기(연락처·접수 번호·접수 메일 상태…)·비공개 첨부 저장소 · 공개 폼 `/help/report` · `/help/subscribe` · `/help/ad` · `/help/contribute` · `/about/corrections` · `/about/advertise` · 본문 가림 · 첨부 검사 · 봇 차단(숨은 칸·최소 작성 시간·IP 횟수) · 접수 확인 메일 · 백오피스 `/admin/inquiries`(종류·상태·담당·메모 · 연락처 보기 감사) · 접근 판정에 문의·정책·회원 삭제·감사 수정 작업 더하기 · **감사 기록 수정·삭제 API와 PO 아닌 관리자 403 + 감사 로그 1건**(ADM-04 끝 문장) | HELP-01·04 · ADM-03 · ADM-04 수용 기준(.exe·상한 초과 거부 · 숨은 칸 거부 · IP 빈도 거부 · 문의함 종류에 '전문가 연락 요청' 0 · 정정·반론은 처리 결과·사유 없이 완료 불가 · 상태·담당자 변경 감사 로그 · 종류 필터 · 도우미 항목 전화번호·주민등록번호 0 — W2-d 2.8 견본 · PO 아닌 관리자 403 + 감사 로그 정확히 1건) · 역할별 문의 열람 범위 시험 |
| 6 브리핑 사전 알림·보존 기한 배치 | `/brief` · `/brief/confirm` · `/brief/unsubscribe` · 확인 메일 · 마이그레이션 `…26_w2e_retention` — 보존 기한 지난 것 비우는 함수 · 배치 `privacy-retention`(하루 1회, `vercel.json` + 명령줄 같은 함수) · `brief_preregistered` 이벤트 | HOME-06 수용 기준(동의 없이 제출 불가 · 확인 메일 링크 전 미확정 · 같은 이메일 중복 저장 0 + "이미 신청하셨습니다" · 형식 오류 제출 불가 · 구독자 표에 자동 0 · 이벤트에 이메일 0 · 홈 HTML 신청 폼 0) · 보존 기한 시험(경계 하루 전·당일) |
| 7 수용 E2E | PRD-01A 9장 W2-e 증거 전부 + 위 수용 기준을 한 시험 자료·한 서버·한 브라우저로 | `e2e/w2e-acceptance.test.mjs` — 회원 E2E · 평문 이메일 0 검사(9.2 여섯 면) · 링크 전수 404 0 · 기능 키 꺼짐/켜짐 · 360px · 접근성 · 정책 문구 0 정적 검사 |

단계마다 시험 통과 → 커밋 → push → CI 확인 → 보고 (작업 단위 규칙). 공개 화면은 서버 함수만 부른다 — 화면 코드가 DB를 직접 읽지 않는다. **메일 계정(Resend)이 없어도 1~7단계를 모두 끝낼 수 있다** — 메일 시험은 로컬 Supabase의 메일 수신함으로 한다(8장). 실제 Resend 발송 확인은 계정이 생긴 뒤 PO와 함께 한 번 한다(12장 #3).

### 1.1 이미 있는 것과 이어지는 곳

| 이미 있는 것 | W2-e가 이어받는 방법 |
|---|---|
| `inquiries`(W2-a `…07`) — 종류 7개·상태 3개·정정 완료 제약·`service_role`만 | 칸을 **더한다**(연락처·접수 번호·접수 메일 상태 등 — 3.5). 기존 칸·제약·값은 바꾸지 않는다 |
| `staff_roles`·`people.staff_user_id`·`ADMIN_EMAILS`·`getViewer`(`lib/server/dal.ts`) | 회원은 **같은 Supabase Auth 계정 풀**에서 역할이 없는 로그인 사용자다. 역할은 계속 `staff_roles`에서만 읽고 가입 메타데이터를 보지 않는다(ACC-04). 회원 쪽은 `profiles`가 따로 있다 |
| `/api/auth/login`(편집국 로그인 겸용) · `/admin/login` | 로그인 제한(4.1)을 이 라우트에 붙인다. 회원 로그인 화면 `/login`도 같은 라우트를 쓴다. 실패 문장은 지금처럼 하나 |
| `/api/admin/members`·`lib/server/admin/members.ts`·`member-rules.ts`(편집국 계정 목록·정지, 200명 한도) | **일반 회원 탭**을 더한다(5.3). 정지 규칙(`isSuspended`·`suspendBlocked`)과 `banned_until` 방식은 그대로 |
| `check()`·`ACTIONS`·`AUDITED_DENIALS`·`forbid()`(`lib/access.ts`·`dal.ts`) | 작업을 더하고(10.1) 거부 감사 대상에 넣는다. `Viewer`에 `isAuditAdmin`을 더한다 |
| `audit_logs`·`audit_log_amend`·`audit_log_delete`(W1-a) | DB 함수는 이미 있다. W2-e는 **관리자 화면 쪽 API와 403**을 더한다(10.2). `AUDIT_ADMIN_EMAILS` 이름·읽는 곳은 구현 첫머리에 `env.ts`에서 확인한다 |
| 기능 키 `page_about` 등 7개·`POLICY_LINKS` 7종·`isOpenPath`(`lib/server/public/constants.ts`) · `UNBUILT_PREFIXES`에 `/my`·`/brief` | 새 키를 더하고(2.3) `/my`·`/brief`를 '아직 없는 화면'에서 빼 기능 키로 판정한다. `/help/*`는 `page_help`로 판정한다(지금은 정책 주소 하나만 열린다) |
| `Footer`(`@ltr/ui`)의 `info` 줄(매체 정보, 빈 값 숨김) — 공개 레이아웃은 아직 넘기지 않는다 | `settings.company_info`를 넘긴다(6.4) |
| `/about/measurement`(W2-c) · 바닥글 [측정 거부] 링크는 W2-e가 단다 | 바닥글에 링크를 단다. 거부 기능은 기능 키로 숨기지 않는다 — 링크는 항상 보인다(12장 #34) |
| 이벤트 `signup_completed` · `brief_preregistered` · `inquiry_submitted` · `policy_page_viewed`(W2-c 2.2, 수집 API가 이미 받는다) · `tier` 값 `guest`·`basic`·`premium`·`institution` | 화면에서 보내기만 한다. 로그인 회원은 `basic`(W2-c #12 확정, 12장 #31) |
| W2-d 가림 규칙(`lib/analytics/query-terms.ts`, 2.8 견본) | 문의 본문 가림에 같은 함수를 쓴다(7.4). 새 규칙을 만들지 않는다 |
| 이벤트 수집의 IP 읽기·해시 속도 제한(메모리) | 로그인·가입처럼 **서버가 여러 대일 때 우회되면 안 되는 곳**은 DB 표(`request_throttles`)로 센다(4.1) |

## 2. 값 목록

### 2.1 DB 값 (DB check·TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| profile.tier (회원 등급 — 비로그인 `guest`는 저장하지 않는다) | `basic` · `premium` · `institution` |
| profile.mode_pref (모드 — PRD-00 13장) | `general` · `expert` |
| consent.kind (동의 종류 — PRD-01A 6.1. 01B LG-07 `local_weekly`·01C 종류는 그 작업이 더한다) | `signup` · `receive` · `marketing` · `brief_prereg` |
| consent.channel (받은 곳) | `web_signup` · `web_my` · `web_brief` |
| inquiry.kind (문의 종류 — W2-a 그대로 7개. 01C가 '전문가 정보 신고'·'기관 견적'을 더한다) | `tip` · `subscription` · `advertising` · `reader_submission` · `correction` · `product` · `assistant_report` |
| inquiry.status (상태 — W2-a 그대로) | `received` · `in_progress` · `done` |
| inquiry.request_type (정정·반론 요청 구분 — `correction` 종류에서만) | `correction` · `rebuttal` |
| inquiry.mail_status (접수 확인 메일) | `none`(연락 이메일 없음) · `queued` · `sent` · `failed` · `skipped`(메일 설정 없음) |
| policy.doc_key (정책 문서 9종) | `about` · `editorial-policy` · `ethics` · `corrections` · `ad-policy` · `privacy` · `terms` · `no-email-collection` · `advertise` |
| policy.status (버전 상태) | `draft` · `published` · `superseded` |
| policy.block_types (본문 조각 — HTML 직접 입력 0) | `paragraph` · `list` · `callout` (+ 절 제목 `heading`) |
| throttle.scope (시도 횟수 범위) | `login_pair` · `login_account` · `login_ip` · `password_change` · `signup_ip` · `signup_email` · `reset_ip` · `reset_email` · `form_ip` · `brief_ip` · `brief_email` · `confirm_resend` |
| mail.template (메일 종류 — 발송은 이 5종뿐) | `signup_confirm` · `signup_exists_notice` · `password_reset` · `inquiry_receipt` · `brief_confirm` |
| member.interest_values (관심 분야 값 모양) | `tax` · `realestate` · `finance` · `local` 또는 `section:하위분야slug`(`local`은 하위 분야 없음 — W2-b #27) |

### 2.2 한도와 설정 씨앗 (`settings` — 운영 설정 화면이 같은 규칙으로 검사한다, 시험이 이 블록을 읽어 DB 씨앗과 대조한다)

#### `member`

```json
{"version":"2026-10-20.1","interest_region_limit":3,"interest_max":20,"display_name_chars":30,"signup_confirm_hours":24,"password_min_chars":10,"password_max_bytes":72}
```

#### `auth_limits` (창 = 초, 한도 = 그 창에서 허용하는 횟수 — n번째 허용·n+1번째 차단)

```json
{"version":"2026-10-20.1","login_pair":{"window":900,"limit":5},"login_account":{"window":900,"limit":20},"login_ip":{"window":900,"limit":30},"password_change":{"window":900,"limit":5},"signup_ip":{"window":3600,"limit":5},"signup_email":{"window":3600,"limit":3},"reset_ip":{"window":3600,"limit":10},"reset_email":{"window":3600,"limit":3},"form_ip":{"window":3600,"limit":10},"brief_ip":{"window":3600,"limit":10},"brief_email":{"window":3600,"limit":3},"confirm_resend":{"window":3600,"limit":3}}
```

#### `help` (고객센터 폼 — PRD HELP-01 '상한과 허용 형식은 settings')

```json
{"version":"2026-10-20.1","attachments":{"max_files":3,"max_total_bytes":4000000,"allowed_extensions":["pdf","jpg","jpeg","png","docx","xlsx","hwp","hwpx"]},"body_chars":{"min":10,"max":5000},"min_fill_seconds":3,"fill_token_hours":2}
```

`max_total_bytes` 4,000,000은 Vercel 함수 요청 본문 한도 4.5MB에 맞춘 값이다(사내 서버로 옮기면 올릴 수 있다 — 12장 #20).

#### `privacy_retention` (보존 기한 — 12장 #4·#5 PO 결정 대상, 씨앗은 기본값)

```json
{"version":"2026-10-20.1","unconfirmed_signup_days":7,"unconfirmed_consent_days":7,"revoked_consent_days":30,"inquiry_contact_days":365,"inquiry_attachment_days":365,"throttle_hours":24}
```

#### `company_info` (바닥글·회사 소개 — 전부 빈 값으로 시작, 빈 칸은 그 줄을 숨긴다 — HELP-05. 익명 읽기 허용 키에 더한다)

```json
{"version":"2026-10-20.1","company_name":"","representative":"","publisher":"","editor":"","media_registration_no":"","business_address":"","phone":"","directions":"","privacy_officer_name":""}
```

실사(W0)로 확인되지 않은 칸은 비워 둔다 — 임의 등록번호 0(HELP-02). 개인정보 보호책임자의 연락 수단은 이메일 주소가 아니라 문의 폼 링크로 안내한다(9.2).

#### `privacy_processors` (처리 위탁·국외 처리 대상 — 처리방침 게시 점검의 입력, 공개 아님)

```json
{"version":"2026-10-20.1","processors":[{"name":"Supabase","purpose":"데이터베이스·인증·저장소","overseas":true},{"name":"Vercel","purpose":"웹 서비스 실행","overseas":true},{"name":"Resend","purpose":"메일 발송","overseas":true},{"name":"Anthropic","purpose":"AI 도우미(공개 뒤)","overseas":true,"active_when":"assistant"}]}
```

위 표는 **사실 목록**이다(법률 문구 아님). 처리방침 본문에 각 이름이 들어 있는지 게시 점검이 경고한다(6.2).

### 2.3 기능 키 (settings.feature_flags — 모두 꺼짐으로 시작, 이미 값이 있으면 건드리지 않는다)

| 키 | 여는 것 | 이미 있나 | 켜기 전에 필요한 것 (의존) |
|---|---|---|---|
| `page_about` · `page_editorial_policy` · `page_ethics` · `page_corrections` · `page_ad_policy` · `page_privacy` | 정책 페이지와 바닥글·기사 하단 링크 | 있음 | 그 문서의 게시본 |
| `page_help` | `/help/report` · `/help/subscribe` · `/help/ad` · `/help/contribute` | 있음 | `page_privacy` 게시본 (연락처를 받는 화면) |
| `page_terms` | `/about/terms` + 바닥글 링크 | **새로** | 이용약관 게시본 |
| `page_no_email` | `/about/no-email-collection` + 바닥글 링크 | **새로** | 게시본 |
| `page_advertise` | `/about/advertise` + 기사 하단 [광고·제휴 문의] | **새로** | 게시본 + `page_privacy` + `page_ad_policy` |
| `members` | `/signup` · `/login` · `/forgot-password` · `/reset-password` · `/auth/confirm` · `/my` · `/my/withdraw` + 바닥글 [내 정보] | **새로** | `page_terms` · `page_privacy` 게시본 + 메일 설정 있음 |
| `brief` | `/brief` · `/brief/confirm` · `/brief/unsubscribe` + 기사 하단·바닥글 신청 링크 | **새로** | `page_privacy` 게시본 + 메일 설정 있음 |

- 켜기 검사는 운영 설정 화면(`settings-rules` + 서버)이 한다 — 의존을 채우지 못하면 거부하고 사유를 보인다("게시본이 없는 정책 페이지는 켤 수 없습니다"). 켜진 뒤 게시본이 없어지는 일(DB 직접 수정)은 요청 때 한 번 더 막는다 — 화면은 404, 링크는 0.
- **`/account/password`(로그인한 상태의 비밀번호 바꾸기)는 기능 키에 묶지 않는다** — 편집국·관리자도 쓰고, 공개 메뉴에 없고, 로그인이 필요하다.
- 기능 키가 꺼지면 해당 경로 404, 사이트 안 링크 0(빈 링크 금지 — HOME-02·HELP-05). `isOpenPath`가 한 곳에서 판정한다(`/signup`·`/login`·`/forgot-password`·`/reset-password`·`/my` → `members`, `/brief` → `brief`, `/help/*` → `page_help`, `/about/terms` → `page_terms` …).

### 2.4 주소 (공개 화면 · API · 백오피스 · 배치)

| 종류 | 주소 | 비고 |
|---|---|---|
| 회원 | `/signup` · `/login` · `/forgot-password` · `/reset-password` · `/auth/confirm` · `/my` · `/my/withdraw` | `/my*`는 `no-store`·`noindex`. `/login`에서 이미 로그인했으면 `/my`로 |
| 계정 (기능 키 없음) | `/account/password` | 로그인 필요 |
| 고객센터 | `/help/report`(기사 제보) · `/help/subscribe`(구독 문의) · `/help/ad`(광고 문의) · `/help/contribute`(독자 투고) | 네 쪽 위에 서로 가는 탭 링크 |
| 정책 | `/about` · `/about/editorial-policy` · `/about/ethics` · `/about/corrections` · `/about/ad-policy` · `/about/advertise` · `/about/privacy` · `/about/terms` · `/about/no-email-collection` · (기존) `/about/measurement` | 이전 판 `?v=번호`(`noindex`) |
| 브리핑 | `/brief` · `/brief/confirm` · `/brief/unsubscribe` | 홈에는 폼 0 |
| 공개 API | `POST /api/auth/signup` · `/api/auth/forgot` · `/api/auth/reset` · `/api/auth/confirm` · `/api/auth/password` · `POST /api/help/[kind]` · `POST /api/brief` · `/api/brief/confirm` · `/api/brief/unsubscribe` | 같은 사이트 + Origin 필수(4.5) |
| 회원 API | `PATCH /api/my/profile` · `PUT /api/my/consents` · `POST /api/my/withdraw` | 로그인 필요, 본인 것만 |
| 백오피스 | `/admin/inquiries` · `/admin/pages` · `/admin/members`(확장) | API `GET·PATCH /api/admin/inquiries(/[id])` · `POST …/[id]/contact` · `GET …/[id]/attachments/[번호]` · `GET·PUT /api/admin/policies(/[doc_key])` · `POST …/publish` · `DELETE /api/admin/members/[id]` · `PATCH·DELETE /api/admin/audit/[id]` |
| 배치 | `/api/jobs/privacy-retention` | 하루 1회, 같은 함수를 명령줄로도 |

### 2.5 정책 문서 표 (시험이 이 표를 읽는다)

| doc_key | 주소 | 기능 키 | 바닥글 | 기사 하단 7종 | 고치는 사람 | 게시 승인 |
|---|---|---|---|---|---|---|
| `about` | `/about` | `page_about` | 회사 소개 | 예 | 편집 책임자·관리자 | 관리자 |
| `editorial-policy` | `/about/editorial-policy` | `page_editorial_policy` | 편집 원칙 | 예 | 편집 책임자·관리자 | 관리자 |
| `ethics` | `/about/ethics` | `page_ethics` | 윤리강령 | 예 | 편집 책임자·관리자 | 관리자 |
| `corrections` | `/about/corrections` | `page_corrections` | 정정·반론 창구 | 예 | 편집 책임자·관리자 | 관리자 |
| `ad-policy` | `/about/ad-policy` | `page_ad_policy` | 광고 정책 | 예 | 편집 책임자·관리자 | 관리자 |
| `privacy` | `/about/privacy` | `page_privacy` | 개인정보처리방침(굵게) | 예 | 관리자 | 관리자 |
| `terms` | `/about/terms` | `page_terms` | 이용약관 | 아니오 | 관리자 | 관리자 |
| `no-email-collection` | `/about/no-email-collection` | `page_no_email` | 이메일무단수집거부 | 아니오 | 관리자 | 관리자 |
| `advertise` | `/about/advertise` | `page_advertise` | 아니오(기사 하단 [광고·제휴 문의]) | 아니오 | 광고·협찬 담당·관리자 | 관리자 |

기사 하단 7종은 PRD ART-02 그대로 — 회사 소개 · 편집 원칙 · 윤리강령 · 정정·반론 창구 · 광고 정책 · 개인정보처리방침 · 고객센터(`/help/report`). 바닥글은 여기에 이용약관 · 이메일무단수집거부 · 측정 거부(+ 전문가 소개는 01C 공개 승인 후)가 더해진다. 광고 정책을 고치는 사람에서 광고·협찬 담당을 뺀 것은 광고 분리 원칙(NAV-06) 때문이다.

### 2.6 비밀번호 규칙 견본 (TypeScript 시험이 이 표를 읽는다 — 글자 수는 사람이 보는 글자 기준, 길이 한도는 UTF-8 바이트)

| 입력 (계정 이메일) | 결과 |
|---|---|
| `Tn7!kQ2m9z` (a@example.test) | 통과 |
| `푸른하늘은행나무길가에서` (a@example.test) | 통과 — 12글자·36바이트 |
| `짧은암호1` (a@example.test) | 거부 — 10글자 미만 |
| `          ` (공백 10칸) | 거부 — 공백뿐 |
| `aaaaaaaaaaaa` (a@example.test) | 거부 — 한 글자 반복 |
| `1234567890` (a@example.test) | 거부 — 흔한 값 |
| `password1234` (a@example.test) | 거부 — 흔한 값 |
| `qwertyuiop` (a@example.test) | 거부 — 흔한 값 |
| `myuser-2026-secret` (myuser-2026@example.test) | 거부 — 이메일 앞부분(4글자 이상)을 포함 |
| `myuser-2026@example.test` (myuser-2026@example.test) | 거부 — 이메일과 같음 |
| 73바이트 이상 영문 | 거부 — 72바이트 초과 |
| 72바이트 영문·숫자 혼합 | 통과 |

구성 규칙(대문자·기호 필수)은 두지 않는다 — 길이와 흔한 값 거르기를 본다. 흔한 값 목록은 코드 상수(30개 안팎, 시험 견본이 읽는다).

### 2.7 이메일 모양 판정·표기 견본 (공개 화면 표기와 크롤링 검사가 같은 정규식을 쓴다)

이메일 모양 = `[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}` (전각 `＠`·`.`은 NFKC로 먼저 바꾼 뒤 본다).

| 원문 | 화면 표기 (가림) | 크롤링 검사에서 0이어야 하는 것 |
|---|---|---|
| `hong@example.com` | `hong [at] example [dot] com` | 원문 모양 |
| `HONG.GIL-dong+x@Mail.Example.co.kr` | `HONG.GIL-dong+x [at] Mail [dot] Example [dot] co [dot] kr` | 원문 모양 |
| `문의: a@b.kr 로 보내세요` | `문의: a [at] b [dot] kr 로 보내세요` | 원문 모양 |
| `＠`(전각)로 쓴 `hong＠example.com` | `hong [at] example [dot] com` | NFKC 뒤 원문 모양 |
| `hong&#64;example.com`(HTML 엔티티) | `hong [at] example [dot] com` | 엔티티를 푼 뒤 원문 모양 |
| `x@y`(도메인 점 없음) | 그대로 | — (이메일 모양 아님) |

표기 한 곳(`ObfuscatedEmail` 컴포넌트 + 순수 함수 `maskEmailForDisplay`)을 기사 본문·기자 소개·전문가 프로필·정책 페이지·설정 값·오류 문구가 모두 지난다. `mailto:` 링크는 만들지 않는다.

### 2.8 문의 본문 가림 견본

W2-d 설계 2.8 견본 표를 **그대로 읽는다**(가림 글자 `[이메일]` · `[주민등록번호]` · `[전화번호]` · `[번호]`, 9자리 이상 숫자 줄). 본문 전용으로 더하는 견본:

| 본문 | 저장되는 본문 |
|---|---|
| `답장은 hong@example.com 으로 주세요` | `답장은 [이메일] 으로 주세요` |
| `제 번호는 010-1234-5678 입니다` | `제 번호는 [전화번호] 입니다` |
| `계좌 110-123-456789` | `계좌 [번호]` |
| `2026-10-19 기사 오류` | 그대로 (8자리 이하) |
| `지방세법 제111조` | 그대로 |

연락 수단은 본문이 아니라 연락처 칸에 쓰게 안내한다(7.4).

## 3. 데이터 (마이그레이션 23~26 — 모든 표는 RLS 기본 거부로 시작)

### 3.1 접근 원칙 (RLS와 관리자 전권)

- **새 표 모두 `anon`·`authenticated`에 직접 권한 0, `service_role`에 select·insert·update·delete** — W2-a 표와 같은 방식이다. 회원 본인 것만 보게 하는 일은 **서버 코드가 `viewer.userId` 열쇠로만 읽어서** 지킨다(브라우저가 공개 키로 표를 직접 부를 길이 없다). 이유: 직접 권한을 열면 브라우저가 서버 검사(관심 지역 상한·가림·본문 검사)를 건너뛸 수 있다.
- 그래서 "회원이 남의 것을 본다"는 위험은 서버 코드의 문제다 → **두 계정 격리 시험**이 지킨다(E2E 두 계정 · 통합 시험).
- **관리자 전권**(PRD-00 6장, 2026-10-17 PO 지시): 관리자는 서버의 `service_role` 경로로 이 표들을 모두 읽고·고치고·지운다. `packages/db/tests/admin-rights.test.mjs`의 표 목록에 `profiles` · `consents` · `request_throttles` · `policy_versions`를 더한다. "잠근다"는 외부(비회원·회원·편집국의 다른 역할)에만 해당한다. 예외는 감사 기록 하나(ADM-04)이고 PO만 고친다.
- 익명 읽기는 **공개 뷰와 공개 설정 키 하나**뿐: `public_policy_versions`(게시본의 공개 칸만 — 3.4), 설정 `company_info`. 허용 목록 검사 `scripts/verify-rls.mjs`(표 허용 목록)·`verify-rls-remote.mjs`(익명 실행 함수 목록)에 뷰를 더하고, 새 함수는 모두 `service_role`만 실행한다(익명 실행 허용 목록은 늘리지 않는다).

### 3.2 `profiles` (PRD-01A 6.1)

| 칸 | 값 |
|---|---|
| `id` | uuid PK, `auth.users(id)` 참조, 계정이 지워지면 함께 지워진다 |
| `display_name` | 선택, 30글자 이하 — 이메일 모양이면 거부(DB check + 서버 가림) |
| `tier` | 2.1, 기본 `basic` |
| `interests` | `text[]`, 값 모양 2.1. 트리거가 하나씩 검사 — 4분야 값이거나 `categories`에서 공개이고 분야가 맞는 `section:slug`. 중복·상한(`member.interest_max`) 넘으면 거부 |
| `interest_region_codes` | `text[]`. 트리거가 `regions`의 오늘 유효한 코드인지 검사(없는 코드·폐지·시작 전 거부)하고 `member.interest_region_limit`을 넘으면 거부(상한+1번째). 시·도 또는 시·군·구 |
| `mode_pref` | 2.1, 기본 `general` |
| `created_at` · `updated_at` | 자동 |

- 관리자 권한 칸을 두지 않는다. 이메일·전화·주소 칸이 없다(이메일은 Auth 계정에만 있다 — 9.1).
- 행은 가입 때 서비스가 만든다. 없으면 `/my` 첫 방문에서 만든다(비어 있는 행).
- 관심 지역 코드의 유효 기준(오늘 한국 날짜)은 검색(W2-d)이 지역을 거르는 것과 같은 기준을 쓴다 — `regions` 칸 이름은 구현 첫머리에 확인.

### 3.3 `consents` (동의 이력 — PRD-01A 6.1)

| 칸 | 값 |
|---|---|
| `id` | bigint identity |
| `user_id` | uuid, 회원이면 채움(Auth 계정이 지워지면 탈퇴 처리가 행도 지운다 — 9.3) |
| `email` | 비회원 사전 알림 신청일 때만. **평문이 허용된 칸 둘 중 하나**(9.2). 소문자·앞뒤 공백 정리 |
| `kind` · `channel` | 2.1 |
| `version_ref` | 동의한 문서 버전 — `policy_versions` 번호 목록(예: 가입 = 약관 N + 처리방침 M). 동의 문구가 바뀌어도 그때 무엇에 동의했는지 남는다 |
| `agreed_at` | 동의 시각 |
| `confirmed_at` | 확인 메일을 눌러야 채움(이중 확인 — 사전 알림은 필수, 가입 `signup`은 이메일 인증이 채움) |
| `revoked_at` | 철회 시각 |
| `confirm_token_hash` · `revoke_token_hash` | 메일 링크 토큰의 해시(원문 저장 0). 확인 토큰은 한 번 쓰면 비우고 `signup_confirm_hours`(24시간)가 지나면 무효, 철회 토큰은 철회 때까지 |
| `created_at` | 자동 |

- 제약: `user_id`와 `email` 중 **정확히 하나**만 있다. 같은 `(kind, user_id 또는 email)`의 철회되지 않은 행은 하나(부분 unique) → 같은 이메일 재신청 시 중복 저장 0.
- **관심 분야·지역 저장은 이 표에 행을 만들지 않는다**(ACC-02 '0행'). 가입(`signup`) 동의는 필수 동의라 가입 때 행이 생기고, `receive`·`marketing`·`brief_prereg`는 사용자가 따로 체크했을 때만 생긴다(선택 동의는 기본 해제).
- 2단계 `subscribers`(구독자) 표에는 자동으로 들어가지 않는다 — 이 표만 있고 `subscribers`는 만들지 않는다(HOME-06 · PRD-02 HOME-09).

### 3.4 `policy_versions` (정책 문서 버전 — HELP-02·05)

| 칸 | 값 |
|---|---|
| `id` · `doc_key` · `version` | 문서마다 1, 2, 3… (unique `(doc_key, version)`) |
| `status` | 2.1. 문서마다 `published`는 하나뿐(부분 unique) |
| `body` | jsonb — 절 목록 `[{heading, blocks:[{type, text 또는 items[]}]}]`, 조각 종류 2.1. HTML 직접 입력 0 |
| `change_summary` | 개정 사유 — 개정 이력에 보인다 (버전 2부터 필수) |
| `effective_on` | 시행일(한국 날짜) — 화면 표시용. 효력 날짜 판단은 법률 검토 몫(12장 #9) |
| `published_at` | 게시 시각 (게시일로 표시) |
| `approved_by` · `approved_on` · `approval_note` | **법률 검토·게시 승인 기록** — 검토한 사람/기관 이름·검토일·근거 메모. 게시하려면 셋 다 필수(HELP-05 '법률 검토 승인 기록이 없는 정책 페이지는 공개 0') |
| `updated_by` | 마지막으로 고친 사람 (`user:<uuid>` · `admin:<이메일>` — 직원 기록이라 감사 로그와 같은 모양) |
| `created_at` · `updated_at` | 자동 |

- 게시된 버전의 본문은 고치지 않는다(DB 트리거) — 고치려면 새 버전(draft)을 만들고 게시하면 이전 게시본이 `superseded`가 된다(PRD 6장 '덮어쓰지 않는다'). `draft`만 고칠 수 있고 지울 수 있다.
- **마이그레이션 씨앗은 0행이다** — 시험이 `policy_versions` 삽입 문장이 마이그레이션에 0개인지 본다.
- 공개 뷰 `public_policy_versions`: `status in ('published','superseded')`의 `doc_key · version · status · body · change_summary · effective_on · published_at`만(승인 기록·고친 사람 칸 제외). 기능 키·게시본 판정은 서버가 한다.

### 3.5 `inquiries` 더하는 칸 (기존 칸·제약은 그대로)

| 칸 | 값 |
|---|---|
| `ref_code` | 접수 번호 — 무작위 8글자(혼동 글자 뺀 영숫자), unique. 사용자에게 보이는 번호(순번 id는 노출하지 않는다) |
| `title` | 선택, 100글자 이하 (독자 투고 제목 · 광고 문의 제목) |
| `contact_name` · `organization` | 선택, 각 100글자 이하 (광고 문의의 회사 이름 등) |
| `contact_email` | **평문이 허용된 칸 둘 중 하나**. 이메일 모양 검사. `tip`만 선택, 나머지 종류는 필수(접수 확인 메일) |
| `request_type` | 2.1, `kind = correction`일 때만 필수 |
| `submitted_by` | 로그인 회원이 낸 문의일 때 uuid(계정이 지워지면 비움) |
| `privacy_version_id` | 동의한 처리방침 버전 번호 — 연락처를 받는 폼은 필수 |
| `mail_status` | 2.1 |
| `contact_cleared_at` · `attachments_cleared_at` | 보존 기한이 지나 비웠을 때 시각 |

- 본문 `body`는 저장 전에 가린다(2.8). 도우미에서 넘어온 항목(`assistant_report`)은 01C가 마스킹 요약을 넣는다 — 같은 DB check(전화·주민등록번호·이메일 모양 거부)가 한 번 더 막는다. 본문 check는 `body`에 이메일·전화·주민등록번호 모양이 있으면 거부하는 쪽이다(W2-d `query_terms`와 같은 방식).
- 첨부: `attachments` 칸(jsonb 배열 — `{path, name, bytes, ext}`)에 비공개 저장소 경로를 둔다. 저장소 버킷 `inquiry-attachments`는 **비공개**(공개 URL 0, `anon`·`authenticated` 정책 0)이고, 백오피스가 5분짜리 서명 주소로만 내려받게 한다(항상 내려받기 형태 — 화면 안에서 열지 않는다). 버킷은 마이그레이션이 만든다(Supabase 직접 설치판에도 있는 저장소 기능).
- 종류별 제약 추가: `request_type`은 `correction`에서만 허용, `ref_code` 형식 check.

### 3.6 `request_throttles`와 함수 (4.1)

| 칸 | 값 |
|---|---|
| `scope` · `key_hash` · `window_start` | 복합 PK. `key_hash`는 HMAC 해시(원문 이메일·IP 저장 0) |
| `count` | 이 창에서 센 횟수 |

| 함수 (모두 `service_role`만 실행) | 하는 일 |
|---|---|
| `throttle_check(scope, key_hash, window_seconds, limit)` | 올리지 않고 지금 막힌 상태인지 반환 `{blocked, retry_after_seconds}` |
| `throttle_hit(scope, key_hash, window_seconds, limit)` | 이 창의 횟수를 1 올리고 `{allowed, count, retry_after_seconds}` — n번째 허용·n+1번째 차단 |
| `throttle_clear(scope, key_hash)` | 로그인 성공 때 계정 횟수 초기화 |
| `throttle_purge(older_than_hours)` | 오래된 창 삭제 |
| `member_feed(p_interests, p_region_codes, p_days, p_limit)` | 5.2 |
| `privacy_purge(…)` | 9.3 보존 기한이 지난 것 비우기 |

### 3.7 이번에 더하지 않는 것

`subscribers`·`orders`·`expert_requests`(01C)·알림(NOTI)·이메일 변경·소셜 로그인 표. 전문가 연락 요청은 문의함이 아니다(01C EXPL — 개인정보 분리).

## 4. 계정 — 로그인 제한·비밀번호·인증 흐름

### 4.1 로그인 시도 제한 (지금은 Supabase 기본 제한만 있다 — W2-e 보안 과제)

- **DB 표로 센다** — 서버 메모리 제한(W2-c 수집 API 방식)은 Vercel 인스턴스마다 따로라 로그인처럼 막아야 하는 곳에서는 우회된다. Postgres만 쓰므로 사내 서버로 옮겨도 그대로다.
- 해시 열쇠 `HMAC-SHA256(GUARD_SECRET, scope + ":" + 값)` 앞 32글자. 값 = 소문자 이메일 / IP / `이메일|IP`. **계정이 실제로 있는지와 상관없이** 보낸 이메일 글자로 센다(계정 유무가 드러나지 않는다).
- `/api/auth/login` 순서: ① 같은 사이트 확인 ② `throttle_check` 세 겹 — `login_pair`(이메일+IP, 5회/15분) · `login_account`(이메일 20회/15분) · `login_ip`(IP 30회/15분) ③ 막혔으면 **429 + `retry-after`**, 문장은 하나("시도가 너무 많습니다. 잠시 뒤 다시 시도하세요") ④ 비밀번호 확인 ⑤ 실패하면 세 겹 모두 `throttle_hit`, 성공하면 `login_pair`·`login_account` `throttle_clear`. 실패 문장은 지금처럼 하나("이메일 또는 비밀번호가 맞지 않습니다").
- 설계 이유: 이메일 하나만 세면 누구나 남의 계정(예: 관리자)을 15분마다 잠글 수 있다 → 잠금 범위를 '이메일+IP' 짝(5회)과 '이메일 전체'(20회, 느슨)로 나눴다. 단일 IP 폭주는 IP 30회가 막는다. 한도 값은 설정(`auth_limits`)이고 운영하며 조정한다.
- 같은 방식을 `password_change`(현재 비밀번호 확인 실패 5회/15분) · 가입 · 재설정 · 폼 · 사전 알림 · 확인 메일 다시 받기에 쓴다(2.2). 폼의 IP 읽기는 W2-c 수집 API의 함수를 공용으로 뺀다.
- 기록 보존: `request_throttles`는 해시와 횟수뿐이고 `privacy_retention.throttle_hours`(24시간) 뒤 지운다(처리방침에 기재 — 9.4).
- Supabase 기본 제한(IP별 로그인·가입 횟수)은 그대로 둔다 — 우리 제한은 그 앞단이다.

### 4.2 비밀번호 바꾸기·재설정

- **바꾸기** `/account/password`(로그인 필요, 메일 필요 없음): 현재 비밀번호 + 새 비밀번호 두 번. 현재 비밀번호를 `signInWithPassword`로 확인(실패는 `password_change` 횟수에 합산) → 규칙(2.6) → `auth.updateUser` → **다른 기기 세션을 끊는다**(`signOut({scope:"others"})`) → 감사 로그 `account.password_changed`(대상 `user:<uuid>`, 비밀번호·이메일 0). 편집국·관리자도 쓴다 — 관리자 메뉴 머리말에 링크를 둔다.
- **재설정(분실)** `/forgot-password` → 메일 → `/auth/confirm?type=recovery`(버튼 확인) → `/reset-password`에서 새 비밀번호. 응답은 계정 유무와 상관없이 같은 문장("가입된 주소라면 메일을 보냈습니다"). 메일은 가입된 확인 계정에만 실제로 간다. 재설정 뒤 모든 세션을 끊는다.
- 메일이 없는 기간(Resend 개설 전)의 관리자 비밀번호 분실: 재설정 화면은 `members` 기능 키와 메일 설정이 있어야 열린다(2.3). 그 전에는 **로그인한 상태에서 바꾸기만** 가능하다. 관리자 계정의 분실 복구 방법은 12장 #24.
- 이메일 변경은 만들지 않는다(12장 #29).

### 4.3 가입·인증 메일 (Supabase 기본 메일을 쓰지 않는다)

- 이유: Supabase 기본 메일은 새 프로젝트에서 팀 구성원 주소로만 보낼 수 있거나 횟수가 매우 적다. 공개 가입에는 맞지 않는다. 또 메일이 두 갈래(Supabase 메일 + 앱 메일)가 되면 이식성 규칙 5('메일 발송은 한 모듈')와 맞지 않는다. 그래서 **앱이 `auth.admin.generateLink`로 일회용 토큰을 받아 자기 메일 모듈로 보낸다.**
- 가입: `POST /api/auth/signup` — 입력 검사(이메일 형식·비밀번호 2.6·필수 동의 체크·관심 분야/지역 값 검사·숨은 칸·최소 작성 시간·`signup_ip`/`signup_email` 횟수) → `generateLink({type:"signup", email, password})`(계정은 이메일 미확인 상태로 생기고, 가입 요청의 역할·메타데이터 값은 **버리고** 쓰지 않는다 — ACC-04) → `profiles` 행(선택한 관심 분야·지역 포함)과 `consents`(`signup`, 확인 전) 만들기 → 메일 `signup_confirm`(링크 `${사이트주소}/auth/confirm?token_hash=…&type=signup`).
- 이미 가입된 확인 계정이면 계정을 만들지 않고 `signup_exists_notice` 메일(로그인·재설정 링크)을 보낸다. **화면 응답은 두 경우 모두 같은 문장**("확인 메일을 보냈습니다 — 메일함을 확인해 주세요").
- 확인: `GET /auth/confirm`은 [가입 확인하기] 버튼만 그리고(메일 보안 검사기가 링크를 미리 열어도 토큰이 소모되지 않는다), `POST /api/auth/confirm`이 `verifyOtp({token_hash, type})`로 확인한다. 가입 확인이면 이메일 확인 + `consents.signup.confirmed_at` + 세션 쿠키 + `/my?welcome=1`로 보낸다(여기서 `signup_completed` 이벤트 1건 — 분야 수·지역 수만). 만료·사용 완료는 "링크가 만료되었습니다" + [확인 메일 다시 받기](`confirm_resend` 횟수).
- **사이트 주소**는 요청의 호스트(또는 사내 서버에서는 `NEXT_PUBLIC_SITE_URL`)로 만든다 — 로컬 `localhost:3001`·미리보기 주소·테스트 주소 모두 자기 주소로 돌아온다(ACC-01). 허용 호스트가 아니면 환경변수 사이트 주소로 대체한다.
- 확인 안 된 가입은 `unconfirmed_signup_days`(7일) 뒤 계정·프로필·동의 행을 함께 지운다(6단계 배치).
- 메일 장애: 가입·재설정은 "지금 메일을 보낼 수 없습니다 — 잠시 뒤 다시 시도해 주세요"(503 계열) + 만든 임시 계정은 정리. **로그인은 메일과 무관하게 된다**(ACC-01 '메일 장애 중에도 기존 회원 로그인').

### 4.4 로그인·세션

- `/login` 화면은 일반 HTML 폼(JS 없이도 동작) → `POST /api/auth/login`(JSON도 계속 받는다) → 성공하면 `next`(사이트 안 경로만 — `/my…`·`/help…`·기사 경로 허용 목록, 그 밖은 `/my`)로 303. 같은 쿠키라 편집국 계정이 `/login`으로 들어와도 `/admin` 권한은 역할로만 정해진다.
- `proxy.ts` 매처에 `/my`·`/my/:path*`·`/account/:path*`를 더해 백오피스와 같은 낙관적 세션 갱신을 한다(세션이 없으면 `/login?next=` — 백오피스 `/admin`은 지금처럼 `/admin/login`). 판정은 서버 컴포넌트·API의 `getViewer`가 한다.
- 정지된 계정은 `getViewer`가 이미 로그인 아님으로 본다(W2-a).

### 4.5 공개 폼 공통 규칙

- 폼은 일반 HTML POST → 서버가 처리 → 303으로 완료/오류 화면에 돌아온다(W2-c `/api/measurement` 방식 — JS 없이 동작, 스크린 리더 사용자도 쓴다).
- **Origin 머리글이 반드시 있고 같은 사이트여야 한다**(지금의 `isSameSiteRequest`는 Origin이 없으면 통과시키지만 폼 라우트는 더 엄격하게). 쿠키는 `SameSite=Lax`.
- 봇 차단(HELP-01): ① 숨은 입력 칸이 채워지면 거부 ② 폼 열 때 서버가 서명한 토큰(`GUARD_SECRET`)을 심고 `help.min_fill_seconds`(3초) 안 제출·`fill_token_hours`(2시간) 지난 제출은 거부 ③ `form_ip` 횟수. 거부 문장은 하나로 통일하고 어느 검사에서 걸렸는지 알리지 않는다. CAPTCHA·Vercel 전용 봇 방지는 쓰지 않는다(12장 #19).
- 오류 화면에도 사용자가 입력한 이메일을 다시 찍을 때는 가림 표기를 지난다(2.7).

## 5. 회원 화면과 백오피스 회원

### 5.1 화면

| 화면 | 내용 |
|---|---|
| `/signup` | 이메일 · 비밀번호(2.6 안내) · 표시 이름(선택) · 관심 분야(4분야+하위 분야 체크, 선택) · 관심 지역(최대 상한 개, 선택) · 필수 동의 체크(이용약관·개인정보 수집·이용 — 각 게시본 링크, 기본 해제) · 선택 동의(수신·마케팅 — **따로**, 기본 해제). 가입 동의와 수신 동의는 분리(ACC-02) |
| `/login` · `/forgot-password` · `/reset-password` · `/auth/confirm` | 4.2~4.4 |
| `/my` | ① "내 관심 분야 새 글" 블록(5.2) ② 프로필(표시 이름) ③ 관심 분야·관심 지역 편집 ④ 수신 동의 관리(3개: `receive` · `marketing` · `brief_prereg` — 켜면 행 생성·끄면 `revoked_at`) ⑤ [비밀번호 바꾸기] ⑥ [회원 탈퇴]. 관심 분야·지역 저장은 동의를 만들지 않는다. 수신 동의를 켜도 **지금은 보내는 메일이 없다**(브리핑 발행은 2단계, 관심 지자체 메일은 01B LG-07) — 화면에 사실대로 적는다("발행이 시작되면 보내 드립니다") |
| `/my/withdraw` | 비밀번호 확인 + 확인 체크 → 즉시 삭제(9.3). 편집국 역할이 있거나 관리자 목록(`ADMIN_EMAILS`) 계정은 탈퇴할 수 없다("먼저 역할/관리자 목록에서 빠져야 합니다") |
| `/account/password` | 4.2 |

모든 회원 화면은 `no-store` · `noindex`, 공용 캐시에 섞이지 않는다. 헤더에 로그인 버튼은 두지 않는다 — 유틸 메뉴는 5개 이하(HOME-02)이고 PRD 헤더 구성에 로그인이 없다. 바닥글에 **[내 정보]**(→ `/my`, 로그아웃 상태면 `/login`으로 보낸다)와 [브리핑 알림 받기]를 둔다. 바닥글이 로그인 상태에 따라 달라지지 않아 화면 틀이 공용 캐시에 섞일 일이 없다(12장 #21).

### 5.2 "내 관심 분야 새 글" (HOME-07)

- DB 함수 `member_feed(p_interests, p_region_codes, p_days = 14, p_limit = 6)`: 공개(발행·대표 이미지 권리 확인·무료) 기사 중 `first_published_at`이 최근 14일 안인 것. 조건: 관심 분야 값에 해당(4분야 값 = `section`, `section:slug` = 그 하위 분야) **또는** 관심 지역이 시·도면 그 시·도와 아래 시·군·구의 지역 태그 기사 / 시·군·구면 그 지역 태그 기사. 최신순 6건. **`sponsored`(광고)와 `digest`(금주 핫뉴스)는 넣지 않는다**(맞춤 블록에 광고 0 — 12장 #26). `analytics_events`를 읽지 않는다(쿼리 검사 시험 — 행동 추적 개인화 0).
- 관심 분야·지역이 하나도 없으면 블록 대신 [관심 분야 고르기] 링크, 14일 안에 새 글이 없으면 블록을 숨긴다.
- 서버 함수 `getMemberFeed(viewer)`는 **캐시하지 않는다**(`uncachedRequestInit`) — 사용자별 인자라 공용 캐시 열쇠에 섞이면 안 된다. 홈 HTML에는 회원 블록이 없다(HOME-07 [결정 안건 홈 노출 여부] 기본값 — 12장 #22).

### 5.3 백오피스 회원 (ADM-02 확장)

`/admin/members`에 탭을 둔다: `편집국 계정`(지금 것 그대로) · `회원`(새로).

- `회원` 탭: 역할 없는 계정 목록(`auth.admin.listUsers` 쪽수 넘김 50명) · 이메일 일부 검색(지금 `memberSearchQuery` 규칙 그대로) · 칸 = 이메일 · 가입일 · 마지막 로그인 · 이메일 확인 여부 · 정지 · 관심 분야 수 · 관심 지역 수 · 수신 동의 요약. 정지·해제는 지금 API(`POST members/[id]/suspension`, 사유 필수)를 그대로 쓴다.
- **삭제** `DELETE /api/admin/members/[id]`(관리자만, 사유 필수) — 탈퇴와 같은 지움 함수(9.3)를 쓴다. 관리자 목록 계정·역할이 있는 계정은 거부한다(역할을 먼저 회수). 감사 로그 `member.delete`(대상 `user:<uuid>`, 이메일 0).
- 관리자는 회원의 이메일을 화면에서 본다(관리자 전권). 이메일을 복사하는 기능·내보내기는 만들지 않는다.
- 역할 부여·겸직 금지는 W2-a에서 끝났고 그대로다(ADM-02 수용 기준의 앞 두 문장은 W2-a 시험이 지킨다).

## 6. 정책 페이지·바닥글

### 6.1 화면 틀

- 정책 페이지 공통 틀 `PolicyPage`: 아이브로 · 제목 · (게시본 본문 절들) · 맨 아래 **게시일·시행일·개정 이력**(고정폭) · `/about/privacy`는 개정 이력 목록에서 이전 판 보기(`?v=번호`, `noindex`).
- 본문 렌더는 `policy_versions.body` 조각만 그린다 — 절 제목은 `h2`, `paragraph`·`list`·`callout`(강조 문단). 문장 속 링크는 `[글](주소)` 표기를 쓰고 `isOpenPath`를 지난 사이트 안 주소만 링크가 된다(닫힌 화면은 글자만). 이메일 모양은 모두 가림 표기를 지난다(2.7).
- **빈 내용일 때**: 공개 화면에는 '준비 중' 페이지가 없다. 게시본이 없거나 기능 키가 꺼져 있으면 **404이고 사이트 안 링크 0**이다(`준비 중`·빈 정책 쪽 0 — HOME-01의 '빈 섹션 숨김' 원칙과 같다). 백오피스 `/admin/pages`에서는 빈 문서에 PRD 3장이 적은 **항목 이름만** 뼈대로 보이고(예: 편집 원칙 — 편집 독립 · 취재 기준 · 기사 유형 구분 · 정정/반론 원칙 · 광고 분리 · AI 사용 원칙), 문장은 한 줄도 채워 두지 않는다.
- `/about/corrections`는 정책 글(처리 원칙) + 정정·반론 요청 폼(7.2) 한 쪽이다. 글이 게시되기 전에는 폼도 열리지 않는다(처리 원칙을 보여 주지 않은 채 요청만 받지 않는다). `/about/advertise`는 소개 글 + [광고·제휴 문의하기] 버튼(→ `/help/ad`) + 광고 정책 링크이고, 상품 카드 목록은 01C BIZ-08이 만든다(없으면 그 절을 숨긴다).

### 6.2 백오피스 `/admin/pages`

- 목록: 문서 9종 · 게시 버전 · 게시일 · 시행일 · 초안 있음 · 기능 키 상태(켜짐/꺼짐) · "공개 가능"(게시본 있음).
- 편집: 본문 입력은 간단한 줄 표기 — `## 절 제목` · `- 항목` · `> 강조 문단` · 빈 줄 = 문단 나눔. 서버가 조각 jsonb로 바꿔 저장(순수 함수 `parsePolicyBody`, 시험 포함) — HTML 직접 입력 0. 저장은 `draft`로, 편집 책임자·관리자(문서 표 2.5)가 한다.
- 게시: 관리자만. 승인 기록 3칸(검토자·검토일·메모) + 개정 사유(버전 2부터) 필수 → 새 `published`, 이전 게시본 `superseded`. 감사 로그 `policy.publish`(문서·버전만, 본문 0). 승인 기록이 없으면 거부하고 사유를 보인다.
- 게시 점검(경고, 차단 아님 — 12장 #10): ① 본문이 비어 있지 않은가 ② 금지 표현 사전(`forbidden_phrases`)에 걸리는 말 ③ `privacy`면 `privacy_processors`의 활성 업체 이름이 본문에 있는가 ④ 이메일 모양 문자열이 있는가(있으면 가림 표기로 나간다는 안내). 점검은 문장을 고쳐 주지 않는다.
- 개인정보 처리방침이 새로 게시되면 `/my` 상단에 안내 한 줄("개인정보처리방침이 개정되었습니다")을 보인다. 재동의를 요구할지는 12장 #8.

### 6.3 기능 키 의존 판정

2.3 표를 한 함수 `featureOpen(key)`가 판정한다 — 키 값 · 의존하는 게시본 · 메일 설정 유무. 공개 틀(`getSiteChrome`)의 정책 링크·바닥글 링크·기사 하단 링크·`isOpenPath`가 모두 이 함수를 지난다 → "링크가 있는데 404" 불일치가 구조적으로 생기지 않는다(링크 전수 검사가 확인).

### 6.4 바닥글·기사 하단 구성

- 바닥글(PRD-01A 3장 그림): 면책 줄 · 회사 정보 줄(`company_info` 중 값이 있는 칸 — 상호 · 대표 · 발행인 · 편집인 · 등록번호 · 주소 · 대표전화 · 오시는 길, 빈 칸 줄 숨김) · 정책 줄(회사 소개 · 편집 원칙 · 윤리강령 · 정정·반론 창구 · 광고 정책 · 고객센터 · (전문가 소개 — 01C)) · 약관 줄(이용약관 · **개인정보처리방침(굵게)** · 이메일무단수집거부 · 측정 거부) · 계정 줄([내 정보] · [브리핑 알림 받기] — 각 기능 키).
- 기사 하단: 정책 링크 7종(2.5) + [광고·제휴 문의](`page_advertise`) + [브리핑 알림 받기](`brief`). 모두 `featureOpen`이 닫으면 요소 0.
- [측정 거부]는 항상 보인다(거부 권리 — W2-c). 문구·위치는 법률 검토 안건(W2-c #7, 12장 #34).

## 7. 고객센터·문의함·브리핑 사전 알림

### 7.1 폼 5종과 칸

| 화면 | 문의 종류 | 칸 (필수 `*`) |
|---|---|---|
| `/help/report` 기사 제보 | `tip` | 내용* · 관련 기사 주소(선택) · 연락 이메일(선택 — 익명 제보 가능) · 첨부(선택) · 개인정보 동의*(이메일을 적은 경우) |
| `/help/subscribe` 구독 문의 | `subscription` | 내용* · 이름(선택) · 연락 이메일* · 개인정보 동의* |
| `/help/ad` 광고 문의 | `advertising` | 내용* · 회사 이름(선택) · 담당자 이름(선택) · 연락 이메일* · 첨부(선택) · 개인정보 동의* |
| `/help/contribute` 독자 투고 | `reader_submission` | 제목* · 내용* · 필명(선택) · 연락 이메일* · 첨부(선택) · 개인정보 동의* |
| `/about/corrections` 정정·반론 | `correction` | 구분*(정정 요청/반론 요청) · 기사 주소* · 내용* · 연락 이메일* · 개인정보 동의* |

- 로그인한 회원이 내면 `submitted_by`가 채워진다(탈퇴 때 비워진다). 비회원도 낼 수 있다.
- 기사 주소는 사이트 안 `/news/[slug]` 주소면 `related_article_id`를 채운다. 모르는 주소는 본문에 남기고 연결은 비운다.
- 완료 화면: 접수 번호(`ref_code`)와 "접수 확인 메일을 보냈습니다"(이메일이 있을 때). 메일이 실패해도 접수는 유지되고 `mail_status = failed`로 문의함에 보인다(재발송 버튼은 만들지 않는다 — 12장 #18).
- 접수 확인 메일 `inquiry_receipt`은 접수 번호와 종류만 담고 문의 본문·연락처를 되풀이하지 않는다.

### 7.2 공개 이벤트

제출 완료 시 `inquiry_submitted`(종류만), 정책 페이지 보기 `policy_page_viewed`(정책 종류 — 2.1 `editorial_policy · ethics · corrections · ad_policy · privacy`), 사전 알림 `brief_preregistered`(`from_path`만, 경로의 쿼리·이메일 0). W2-c 수집 API가 이미 받는다.

### 7.3 백오피스 `/admin/inquiries` (ADM-03)

- 목록: 접수 번호 · 종류 · 상태 · 담당자 · 접수일 · 접수 메일 상태. 거르개 = 종류(2.1 7개 — '전문가 연락 요청' 0) · 상태 · 담당자 · "내 담당". 정렬 = 접수 최신순.
- 상세: 본문(가려진 값) · 관련 기사 · 첨부(서명 주소 5분, 내려받기 형태) · 연락처는 **[연락처 보기]를 눌러야 보이고** 누를 때마다 감사 로그 `inquiry.contact_view`(번호만 — 연락처 값 0)가 1건 생긴다 · 상태 · 담당자(그 종류를 다룰 역할이 있는 직원만 고를 수 있다) · 메모.
- 상태·담당자·메모 변경은 감사 로그 `inquiry.update`(이전·이후 상태/담당자 uuid, 메모 길이 — 본문·연락처 0)에 남는다.
- `correction` 종류는 처리 결과(정정 게재·반론 게재·기각)와 사유가 없으면 완료로 바꿀 수 없다 — DB 제약(W2-a)과 화면이 같은 규칙이다. [정정 결정으로 이동]은 W2-a 기사 정정 화면으로 가는 링크이고 결정 권한은 지금처럼 편집 책임자다(`correction.decide`).
- 종류별 열람 역할(10.1): 기사 제보·독자 투고 = 기자·편집 책임자·관리자 / 정정·반론 · 도우미 정정·제보 = 편집 책임자·관리자 / 광고 문의 = 광고·협찬 담당·관리자 / 구독 문의 · 상품 문의 = 스토어·구독 담당·관리자. 메뉴도 역할별로 보인다(ADM-01 역할별 메뉴).
- 답변 메일 기능은 만들지 않는다 — 접수 확인만 자동이고 답변은 담당자가 회사 메일로 직접 한다(12장 #17).

### 7.4 본문 가림·첨부 검사

- 본문: W2-d 가림 함수를 서버가 저장 전에 지난다(2.8). 폼 안내에 "연락처는 아래 연락 이메일 칸에 적어 주세요"를 둔다. 길이 `help.body_chars`.
- 첨부 검사(서버): 개수 · 합계 크기 · 허용 확장자(`help.attachments`) + 파일 앞부분 시그니처가 확장자와 맞는지(`.exe`를 이름만 바꿔 올려도 거부) · 이름은 서버가 새로 짓고(원래 이름은 `name` 칸에 글자 정리 후 보관) 경로 문자를 지운다. 바이러스 검사는 하지 않는다 — 그래서 첨부는 직원만 내려받고 화면 안에서 열지 않는다(12장 #20).

### 7.5 브리핑 사전 알림 (HOME-06)

- `/brief`: 소개(발행은 2단계라는 사실) · 이메일 · 수신 동의 체크(기본 해제, 동의 문구는 법률 검토본) · [알림 받기]. 로그인 회원도 같은 폼으로(이메일은 계정 것을 채움).
- 처리: 형식 검사 → `brief_ip`·`brief_email` 횟수 → `consents(kind=brief_prereg, channel=web_brief, email, confirmed_at=null, 확인 토큰 해시)` → 메일 `brief_confirm`(링크 `/brief/confirm?token=…` — 가입 확인처럼 버튼 확인). 확인하면 `confirmed_at` 채움 → "신청이 확정되었습니다".
- 같은 이메일: 확정된 신청이 있으면 저장하지 않고 "이미 신청하셨습니다"(PRD가 정한 안내 — 계정 유무와 달리 신청 여부가 드러나는 것을 PRD가 받아들였다, 12장 #27). 확인 전 신청이면 확인 메일을 다시 보낸다(횟수 제한).
- `/brief/unsubscribe?token=`: 철회 토큰으로 `revoked_at`. 모든 사전 알림 메일에는 이 링크가 있다(2단계 안내 메일 HOME-09가 이어 쓴다).
- 구독자(`subscribers`)에는 자동으로 들어가지 않는다. 이 표에는 이메일과 동의 이력만 있고, 2단계 1호 발행 안내(HOME-09)는 `confirmed_at`이 있고 `revoked_at`이 없는 행에만 보낸다.

## 8. 이메일 발송 — 필요한가, 무엇이 필요한가

**필요하다.** 브리핑 사전 알림 확인 메일(HOME-06 '확인 메일의 링크를 눌러야 확정')·문의 접수 확인 메일(HELP-01·NAV-03)·가입 인증과 비밀번호 재설정(ACC-01)은 PRD가 메일을 요구한다. 보내는 메일은 `mail.template` 5종뿐이다(2.1) — 광고성 메일·뉴스레터 발송은 W2-e에 없다.

### 8.1 메일 모듈 (이식성 규칙 5)

- `apps/web/lib/server/mail/` 한 모듈. 바깥에서는 `sendMail({ to, template, vars })` 하나만 부른다. 내부 전송은 **SMTP 하나**다 — Resend도(`smtp.resend.com`) 사내 SMTP도 로컬 수신함도 같은 코드이고 환경변수만 다르다 → 사내 서버로 옮길 때 코드를 고치지 않는다.
- 환경변수: `MAIL_FROM`(인프라 요청서 7장에 이미 있음) · `MAIL_SMTP_HOST` · `MAIL_SMTP_PORT` · `MAIL_SMTP_USER` · `MAIL_SMTP_PASSWORD`(서버 전용 — Resend이면 그 키를 쓴다) · `MAIL_SMTP_SECURE`. `RESEND_API_KEY`라는 이름을 코드가 직접 쓰지 않는다(Resend 전용 API를 부르지 않는다). 새 이름은 `scripts/env-scopes.json`·인프라 요청서 7장에 더한다(`check-env`가 확인).
- 새 의존 패키지: SMTP 클라이언트 하나(예: nodemailer — 정확한 버전은 `check-pins`·`check-deps` 규칙에 맞춰 고정). 구현 첫머리에 확정한다.
- **메일 설정이 없으면** `mailConfigured() = false`: 가입·재설정·사전 알림은 열리지 않고(2.3), 문의 접수는 열리며 접수 메일만 건너뛴다(`mail_status = skipped`).
- 기록: 발송 결과(템플릿 이름 · 성공/실패 · 걸린 시간)만 서버 기록에 남기고 **받는 주소·본문은 남기지 않는다.**
- 메일 본문은 개발이 쓰는 짧은 안내문이다(링크와 "요청하지 않았다면 무시하세요" 수준). 약관·동의 문구를 되풀이하지 않는다. 광고성이 아니어서 '(광고)' 표기 대상이 아니다. 보내는 쪽 정보는 `company_info`에서 읽고 비어 있으면 줄을 뺀다.

### 8.2 새 계정이 필요한가

| 필요한 것 | 왜 | 막히는 일 | 그것 없이 할 수 있는 것 |
|---|---|---|---|
| **Resend 새 계정 + 발신 하위 도메인 인증**(인프라 요청서 2-6, 체크리스트 16 — SM 부동산 세금 플랫폼 계정·키 사용 금지) | 테스트 주소/운영에서 실제 가입 인증·재설정·접수 확인·사전 알림 메일을 보내려면 | **실제 발송 확인과 `members`·`brief` 기능 키를 운영에서 켜는 일** | 1~7단계 코드·시험 전부(로컬 Supabase의 메일 수신함으로 메일 내용·링크·1분 이내 도착까지 확인). 비밀번호 바꾸기·정책 페이지·문의 폼(접수 메일 제외)·백오피스는 메일 없이 운영 가능 |
| `GUARD_SECRET`(서버 전용 무작위 값) | 시도 횟수 해시·폼 토큰 | 없으면 시도 제한·폼이 닫힌다(안전한 쪽) | 로컬은 `.env.local` |
| 원격 Supabase Auth 설정 확인(이메일 확인 필수 · 최소 비밀번호 길이 10) | 가입 안전 | 원격 설정 변경은 PO 승인 필요 | 로컬 `config.toml` 맞추기 |
| 원격 DB 적용(마이그레이션 23~26 — 저장소 버킷 포함) | 운영 반영 | PO 승인 + 일반 모드 허가 창(진행 현황 3장 방법) | 로컬 시험 전부 |

로컬 시험의 메일 수신함: 로컬 Supabase가 띄우는 수신함(Inbucket 또는 Mailpit — 구현 첫머리에 `supabase status`와 `config.toml`로 주소·포트 확인)의 SMTP로 앱 메일을 보내고, 시험이 그 HTTP API로 메일을 읽어 링크를 따라간다. 실제 서비스 메일은 가짜 수신함으로만 보내므로 외부로 나가는 것이 없다.

## 9. 개인정보

### 9.1 저장하는 것과 저장하지 않는 것

| 무엇 | 어디에 | 비고 |
|---|---|---|
| 회원 이메일 · 비밀번호(해시) | Supabase Auth 계정 **한 곳** | 앱의 공개 스키마 표에는 회원 이메일 칸이 없다 |
| 표시 이름 · 관심 분야 · 관심 지역 · 등급 · 모드 | `profiles` | 이메일·전화·주소 0 |
| 동의 이력 | `consents` | 회원은 `user_id`, 비회원 사전 알림만 `email`(평문 허용 칸 ①) |
| 문의 연락 이메일 | `inquiries.contact_email`(평문 허용 칸 ②) | 보존 기한 뒤 비운다(9.3) |
| 시도 횟수 | `request_throttles` | 이메일·IP의 HMAC 해시만, 24시간 |
| 직원 행위 기록 | `audit_logs` | 직원은 `admin:<이메일>`·`user:<uuid>`로 남는다(직원 기록 — 9.2). **회원은 항상 `user:<uuid>`**, 이메일 0 |
| **저장하지 않는다** | — | 평문 비밀번호 · IP 주소 · User-Agent 원문 · 로그인 실패한 이메일 원문 · 문의 본문 속 이메일·전화·주민등록번호 · 메일 본문/받는 주소 기록 · 주민등록번호·계좌·카드 · 위치 · 행동 이력으로 만든 개인 프로필 |

### 9.2 "평문 이메일 0 검사" — 무엇으로 어떻게 증명하나

PRD 증거는 두 문장이다 — HELP-03 '전 페이지를 크롤링한 서버 HTML에 평문 이메일 주소 형식 0건'과 각 요구사항의 '이벤트·기자 소개·인물 페이지 평문 이메일 0'. 이 문서는 이를 **여섯 면**으로 넓혀 같은 정규식(2.7)으로 본다. 허용되는 평문 이메일은 **칸 두 개**(`consents.email`, `inquiries.contact_email`)와 인증 계정(`auth.users`)뿐이다.

| 면 | 검사 방법 | 기대 |
|---|---|---|
| ① 공개 화면 서버 HTML | 홈에서 시작해 바닥글·메뉴·기사 하단·허브·검색 결과·정책 페이지·고객센터·`/brief`·로그인/가입/오류 화면의 사이트 안 링크를 따라 **전수 크롤링**(공개 기사·인물·제휴사·용어 상세 포함). 원문 HTML(스크립트 속 Next 데이터와 JSON-LD 포함)과 "엔티티 풀기 + NFKC + 태그 제거" 본문 둘 다 정규식 | 0건 |
| ② 공개 API 응답 | `/api/search` · `/api/events` 응답 등 공개 JSON | 0건 |
| ③ DB 전수 스캔 | 공개 스키마의 모든 text·varchar·jsonb·text[] 칸을 정규식으로 센다 — 허용 칸 둘과 `audit_logs.actor`(직원)·`settings.company_info`·`policy_versions.body`(가림 표기로 나가므로 원문이 있어도 화면은 0 — 이 칸은 경고 건수만 보고)를 빼고 | 0건 |
| ④ 감시 주소 추적 | 시험이 무작위 감시 주소(`w2e-<무작위>@example.test`)로 가입·로그인·관심 저장·문의·사전 알림·비밀번호 재설정·탈퇴를 한 뒤 위 ①~③과 ⑤⑥에서 그 주소 문자열 검색 | 탈퇴 전: 허용 칸 밖 0 · **탈퇴 뒤: 어디에도 0**(Auth 계정·`consents`·`inquiries.contact_email`·직원 감사 로그 포함 — 회원 이메일은 감사 로그에 애초에 없다) |
| ⑤ 서버 기록 | 시험 동안 웹 서버 프로세스의 표준 출력·오류를 모아 정규식(W2-d의 '서버 기록 원문 0' 방식) | 0건 — 메일 모듈·오류 기록 포함 |
| ⑥ 측정 이벤트 | `analytics_events` 전 행의 모든 칸 | 0건 (`from_path`에 이메일 모양이면 수집 API가 400 — W2-c) |

- 허용 칸 밖에서 이메일이 나타나는 것을 **막는 구조**: 화면 쪽은 가림 표기 컴포넌트 한 곳(2.7), 기록 쪽은 감사 로그 대상에 회원 이메일을 넣지 않는 규칙(`target = user:<uuid>`)과 서버 기록에 주소를 찍지 않는 규칙, 문의 본문은 저장 전 가림(2.8), 측정은 W2-c 규칙.
- 감사 로그의 `actor`가 `admin:<이메일>`인 것은 W2-a 기존 방식이다(직원 행위 기록 — 비공개, 보존 의무). 회원의 이메일은 아니므로 ③에서 `actor` 칸만 예외로 두고, ④(감시 주소)가 회원 이메일이 새지 않는 것을 직접 증명한다.
- 사용자 연락 수단은 이메일을 노출하는 대신 문의 폼으로 안내한다 — 개인정보 보호책임자 연락처도 폼 링크(HELP-03 '이메일 대신 문의 폼으로 가는 링크').

### 9.3 탈퇴·삭제·보존 기간

| 대상 | 규칙 | 값 |
|---|---|---|
| 회원 탈퇴 (ACC-03) | 즉시: `profiles` 삭제 · `consents`(그 회원 `user_id`) 삭제 · `inquiries.submitted_by` 비움 + 그 회원 문의의 `contact_email`·`contact_name`·`organization` 비움 · Auth 계정 삭제(세션 모두 끊김). 문의 본문(가려진 값)·첨부는 문의 보존 기한 규칙 그대로(탈퇴가 기간을 늘리지도 줄이지도 않는다). 감사 로그 `member.withdraw`(`user:<uuid>`만 — 이메일 0) | 즉시 |
| 보존 의무 항목 | W2-e는 결제·주문이 없어 보존 의무 항목이 없다고 본다(전자상거래·결제 기록은 01C W8/PRD-02). 동의 이력을 탈퇴 뒤에도 보존해야 하는지는 법률 확인 | 12장 #6 |
| 확인 안 된 가입 | 계정·프로필·동의 행 삭제 | 7일 |
| 확인 안 된 사전 알림 신청 | 행 삭제 | 7일 |
| 철회된 사전 알림 동의 | 행 삭제 | 철회 후 30일 |
| 문의 연락처 (`contact_*`, `organization`) | 완료 후 비움 (`contact_cleared_at`) | 365일 |
| 문의 첨부 | 완료 후 파일 삭제 (`attachments_cleared_at`) | 365일 |
| 문의 본문 | 가려진 값이라 보존(정정 이력의 근거 — `article_corrections.inquiry_id`가 가리키므로 행은 지우지 않고 칸만 비운다) | 기한 없음 — 12장 #5 |
| 시도 횟수 해시 | 삭제 | 24시간 |
| 직원 감사 로그 | PO만 고치거나 지움(ADM-04) | 해당 없음 |

- 기한 계산은 한국 날짜 기준 "경계 하루 전·당일" 시험으로 지킨다. 배치 `privacy-retention`이 하루 한 번 `privacy_purge`를 부른다(Vercel Cron 일정 하나 추가 + 명령줄 같은 함수 — 이식성 규칙 3). 값은 `privacy_retention`(2.2).
- 관리자는 필요하면 한 건씩 화면에서 비울 수도 있다(관리자 전권) — 비운 사실은 감사 로그.

### 9.4 처리방침에 들어가야 할 **사실 목록** (법률 검토에 넘기는 입력 자료 — 확정 문구 아님)

개발이 구현에서 확인한 사실이며, 문장은 PO·법률 검토가 쓴다. 구현이 바뀌면 이 목록과 `privacy_processors`를 함께 고친다.

1. 수집 항목과 목적: 회원(이메일·비밀번호·표시 이름·관심 분야·관심 지역·동의 이력) · 문의(본문·연락 이메일·이름·회사 이름·첨부) · 브리핑 사전 알림(이메일·동의 이력) · 로그인 시도 횟수(이메일·IP의 해시, 24시간)
2. 수집하지 않는 것(9.1 마지막 줄)
3. 쿠키: 로그인 세션 쿠키 · 무작위 방문자 ID `ltr_vid`(365일) · 세션 `ltr_sid`(30분) · 측정 거부 `ltr_optout`(400일) — W2-c 2.4
4. 측정: 거부 방법(`/about/measurement`·GPC)과 원본 보존 기한(395일 초안, W2-c)
5. 검색어가 주소(`/search?q=`)에 있어 브라우저 기록·호스팅 접근 기록에 남을 수 있음(앱은 저장·기록 0, 집계는 가린 값, 395일 — W2-d #26·#43)
6. 처리 위탁·국외 처리: Supabase(데이터베이스·인증·저장소) · Vercel(웹 실행) · Resend(메일 발송) · (공개 뒤) Anthropic(AI 도우미 마스킹본)
7. 보존·파기: 9.3 표
8. 이용자 권리 행사 방법(탈퇴 `/my/withdraw`·문의 폼) · 개인정보 보호책임자(사람 지정은 PO — 12장 #12)
9. 유튜브 임베드(동영상 형식이 열릴 때) · 1단계에는 지도 없음

## 10. 접근 판정·감사

### 10.1 `ACTIONS`에 더하는 작업 (한 함수 `check()`)

| 작업 | 허용 | 거부 감사 대상 |
|---|---|---|
| `inquiry.read` · `inquiry.update` | 문의 종류별 — 7.3 (`InquiryResource {kind:"inquiry", inquiryKind}`을 `Resource`에 더한다). 관리자는 전 종류 | 아니오(읽기) · 예(`inquiry.update`) |
| `inquiry.contact_view` | `inquiry.read`가 되는 사람 | 예 |
| `policy.edit` | 2.5 '고치는 사람' + 관리자 | 아니오 |
| `policy.publish` | 관리자만 | 예 |
| `member.delete` | 관리자만 | 예 |
| `audit.amend` | **감사 기록 관리자(PO)만** — 관리자 목록에 있어도 `AUDIT_ADMIN_EMAILS`에 없으면 거부. `Viewer.isAuditAdmin`을 더한다 | 예 |

- 편집국 외 역할이 문의를 다루는 것은 기사 승인·정렬 권한을 주지 않는다(ACC-04 그대로).
- `member.read`·`member.suspend`·`role.grant`·`role.revoke`는 W2-a 그대로 관리자만.

### 10.2 ADM-04 끝 문장 — 관리자 화면에서 PO가 아닌 관리자가 수정·삭제를 시도하면

- API: `PATCH /api/admin/audit/[id]`(고치기 — 이유 필수) · `DELETE /api/admin/audit/[id]`(지우기 — 이유 필수). 내부에서 DB 함수 `audit_log_amend`·`audit_log_delete`(service_role만, 이미 있음)를 부른다. 함수 인자의 "누가"는 `viewer`에서 채운다.
- PO가 아닌 사람(관리자 포함)이 부르면 `authorize()`가 **403 + 감사 로그 `audit.amend.denied` 정확히 1건**을 남긴다(`forbid()`가 이미 하는 방식 — `AUDITED_DENIALS`에 `audit.amend`를 더한다). 시험은 그 한 번의 호출 뒤 새 로그가 1건인지 센다.
- 화면: 감사 기록 화면의 [고치기]·[지우기] 버튼은 PO에게만 보인다. 버튼이 없어도 API가 막는다는 것을 시험이 직접 호출로 확인한다. 감사 기록 조회 화면의 현재 모양과 `AUDIT_ADMIN_EMAILS` 읽는 곳은 구현 첫머리에 코드에서 확인한다.
- PO 본인이 고치거나 지우면 DB 함수가 `audit_log_changes`에 1건을 남긴다(W1-a).

### 10.3 감사 로그 목록 (W2-e가 더하는 `action`)

`account.password_changed` · `member.withdraw` · `member.delete` · `member.signup`(대상 `user:<uuid>`만) · `inquiry.update` · `inquiry.contact_view` · `policy.save` · `policy.publish` · `audit.amend.denied` · `policy.publish.denied` · `member.delete.denied` · `inquiry.update.denied` — 어느 것도 이메일·본문·비밀번호·토큰을 담지 않는다.

## 11. 산출물

(구현하면서 채운다 — 단계마다 끝날 때 이 장에 적는다.)

### 11.1 1단계 — 계정 기반 (2026-10-20)

- 마이그레이션 `packages/db/supabase/migrations/20261019000023_w2e_accounts.sql` — `request_throttles`(키는 HMAC 해시 32글자뿐 — check) + 함수 `throttle_check`·`throttle_hit`·`throttle_clear`·`throttle_purge`(첫 시도 기준 창), `profiles`(이메일·전화·주소·권한 칸 없음, 관심 분야·지역·상한 트리거), `consents`(user_id·email 중 정확히 하나). 새 표 모두 RLS 기본 거부·service_role 전권. settings 씨앗 `member`·`auth_limits`·`privacy_retention`(2.2), 기능 키 씨앗 `page_terms`·`page_no_email`·`page_advertise`·`members`·`brief` — 모두 꺼짐(2.3, W2-b 설계 기능 키 표에도 더함).
- DB 시험 `packages/db/tests/w2e-values.test.mjs`(2장 표 = DB 씨앗) · `w2e-throttles.test.mjs`(n번째 허용·n+1번째 차단 경계·창 끝·초기화·해시 아닌 키 거부) · `w2e-profiles-consents.test.mjs`(상한+1 거부·없는 코드 거부·동의 주체 하나) · `w2e-access.test.mjs`(anon·authenticated 직접 접근 0), `admin-rights.test.mjs`에 새 표 3개.
- 서버 `apps/web/lib/server/auth-guard.ts`(설정·열쇠·DB를 못 쓰면 503으로 닫힘 — 제한 없이 열지 않는다) · 순수 `lib/auth/password.ts`(2.6 견본)·`settings.ts`(설정 모양 검사 — 운영 설정 화면 `settings-rules.ts`가 같은 검사)·`throttle-key.ts`(이메일 정규화·HMAC — IP는 W2-c `clientIp`). 로그인 `POST /api/auth/login`에 세 겹 제한(이메일+IP·이메일·IP) + 429 `retry-after`.
- 비밀번호 바꾸기 `/account/password`(화면 `app/account/`·`components/account/`) · `POST /api/auth/password` — 쿠키 세션만, 현재 비밀번호 확인(틀리면 횟수 합산), 2.6 규칙, 바꾸면 다른 기기 세션 끊기(`signOut({ scope: "others" })`), 감사 로그 `account.password_changed`(비밀번호·이메일 0). 편집국 머리말에 [비밀번호 바꾸기] 링크, 로그인 안 했으면 로그인 → 돌아오기(`next-path`·`proxy-rules`).
- 새 환경변수 `GUARD_SECRET`(서버 전용 비밀 — `scripts/env-scopes.json`·`.env.example`·인프라 요청서). **없으면 로그인이 닫힌다(503)** — 시험 서버는 `e2e/lib/local.mjs startServer`가 실행마다 무작위 값을 준다. 로컬 Supabase `config.toml`: `minimum_password_length` 10, `sign_in_sign_ups` 600(시험 서버가 로그인을 많이 하므로 — 실제 제한은 앱이 한다).
- E2E `e2e/account-security.test.mjs` 17개(`scripts/ci/db-e2e.sh`에 추가) — 로그인 A1~A9(6번째 429·짝 단위 잠금·다른 계정 영향 0·성공 시 초기화·없는 계정 같은 429·한도 설정 즉시 반영·열쇠 없으면 503·표에 원문 0) · 비밀번호 B1~B6(쿠키 없음·Bearer만·다른 사이트 거부·현재 비밀번호 5번 틀리면 429·규칙 422·다른 기기 끊김·편집국 역할만 있는 계정도 가능·서버 기록에 비밀번호·이메일 0) · 화면 C1·C2.
- 시험 결과 (2026-10-20): DB 시험 523개 · RLS 검증 · 웹 단위 2,150개 · 통합 54개 · 타입·린트 · 새 E2E `account-security` 17개 모두 통과.
- **배포 순서(중요)**: 이 단계를 main에 올리면 Vercel Production이 바로 새 코드로 바뀐다. 그 전에 ① 마이그레이션 23을 staging·prod에 적용(`auth_limits` 설정 씨앗) ② Vercel Production·Preview에 `GUARD_SECRET` 값을 넣어야 테스트 주소 로그인이 닫히지 않는다.
- 남긴 것: 원격 Auth 설정(12장 #37 — 최소 비밀번호 길이 10 등)은 가입을 여는 2단계 전에 한다(지금 비밀번호 바꾸기는 앱이 2.6 규칙을 먼저 검사한다). 12장 #40의 나머지 확인은 2단계 첫머리에 한다.

### 11.2 2단계 — 메일 모듈·가입·인증·재설정·탈퇴
### 11.3 3단계 — `/my`·맞춤·회원 관리
### 11.4 4단계 — 정책 페이지·바닥글
### 11.5 5단계 — 고객센터·문의함·감사 403
### 11.6 6단계 — 브리핑 사전 알림·보존 기한 배치
### 11.7 7단계 — 수용 E2E

수용 E2E `e2e/w2e-acceptance.test.mjs`에서 볼 시나리오(7단계 기준):

1. 회원 E2E — 가입(관심 분야 2·지역 1) → 로컬 수신함 메일 → 확인 버튼 → `/my` 새 글 블록 → 비밀번호 바꾸기 → 재설정 → 탈퇴 → 프로필·관심·동의 행 0·Auth 계정 0
2. 메일 서버를 끊고 기존 회원 로그인 성공 · 가입은 안내 문장 · 재설정 메일 1분 안 도착 · 인증 링크 호스트 = 요청 호스트
3. 가입 요청에 역할 값을 넣어도 회원(역할 0) · 가입/재설정 응답 계정 유무와 같은 문장
4. 로그인 제한 경계(5번째 허용·6번째 429)·다른 계정/IP 영향 없음·성공 시 초기화
5. 관심 지역 상한+1번째 거부 · 없는 코드·폐지 코드 거부 · 지역 저장만으로 `consents` 0행 · 두 계정 번갈아 들어와도 블록 격리 · 홈 HTML 회원 블록 0 · `analytics_events` 읽기 없음(쿼리 검사)
6. 정책 페이지 — 게시 전 404·링크 0 · 승인 기록 없이 게시 거부 · 게시본 없는 키 켜기 거부 · 게시 후 바닥글·기사 하단 링크 **전수 404 0** · 개정 이력·이전 판 · 개인정보처리방침 링크 굵게 · 헤더 정책 링크 0
7. 평문 이메일 0 — 9.2 여섯 면 + 감시 주소 추적
8. 고객센터 5종 제출 → 문의함 종류 · 접수 확인 메일 · `.exe`·상한 초과 거부 · 숨은 칸·최소 시간·IP 빈도 거부 · '전문가 연락 요청' 종류 0
9. 문의함 — 종류 필터 · 상태·담당자 변경 감사 로그 · 정정 문의 결과·사유 없이 완료 거부 · 종류별 열람 역할 · [연락처 보기] 감사 로그 · 도우미 항목 전화/주민번호 0(W2-d 2.8 견본)
10. 브리핑 사전 알림 — 동의 없이 제출 불가 · 확인 전 미확정 · 중복 0 + 안내 · 형식 오류 · 철회 · `subscribers` 없음 · 이벤트 이메일 0 · 홈 폼 0
11. ADM-02 회원 탭·삭제 감사 · ADM-04 PO 아닌 관리자 403 + 감사 로그 정확히 1건
12. 기능 키 — 새 키 전부 꺼진 채 새 경로 404·링크 0, 켜면 배포 없이 열림, 의존(처리방침 미게시 → 가입·폼 404)
13. 보존 기한 — 경계 하루 전·당일(확인 안 된 가입 7일 · 문의 연락처 365일 · 철회 동의 30일)
14. 정적 검사 — 마이그레이션·코드·씨앗에 정책 본문/약관 문구 0, `policy_versions` 씨앗 0행
15. 360px R1~R3 · 접근성 95 이상(새 화면 전부) · 크롬/모바일 폼 흐름

## 12. 결정·확인 필요

표시: `PO 결정 필요` = 법률·비용·운영 판단이라 PO가 정해야 한다 / `기본값으로 진행` = 권고 기본값으로 만들고 나중에 바꿀 수 있다(대부분 설정값이라 배포 없이 바뀐다).

| # | 내용 | 지금 기본값 (이유) | 표시 |
|---|---|---|---|
| 1 | 정책 페이지 문구 — 이용약관 · 개인정보처리방침 · 윤리강령 · 편집 원칙 · 광고 정책 · 이메일 무단수집거부 고지(근거 조항 표기) · 정정·반론 처리 원칙 · 회사 소개 · 광고·제휴 안내 소개 글 | AI가 문구를 짓지 않는다. 화면 틀·편집·게시 승인 기능만 만들고 본문은 빈 채 **기능 키 꺼짐**으로 둔다. PO가 법률 검토를 거쳐 `/admin/pages`에 쓰고 승인 기록과 함께 게시한다. 처리방침 입력용 사실 목록은 9.4에 있다 (법률 문장은 법률가·PO 책임) | PO 결정 필요 |
| 2 | 회원 가입 방식·공개 시점 | 이메일 + 비밀번호 + 이메일 인증(PRD ACC-01). 소셜 로그인 없음. `members` 키를 **꺼 둔 채** 출하하고, 처리방침·약관 게시 + 메일 계정 연결 뒤 PO가 켠다. 가입 동의 대상 문서가 없으면 가입 화면이 열리지 않게 해 두었다 | PO 결정 필요 (켤 때) |
| 3 | 이메일 발송 계정 — Resend 새 계정 + 발신 하위 도메인 (인프라 2-6, 체크리스트 16) | 회사 명의로 새로 개설(SM 부동산 세금 플랫폼 계정·키 금지). 코드는 SMTP 하나라 Resend·사내 SMTP 어느 쪽이든 환경변수만 바꾼다. 계정 없이 1~7단계를 끝내고 실제 발송 확인만 계정 뒤로 미룬다 | PO 결정 필요 |
| 4 | 개인정보 보존 기간 — 확인 안 된 가입 7일 · 철회 동의 30일 · 시도 해시 24시간 | 개인정보 최소화 쪽(짧게). 값은 설정 `privacy_retention`이라 배포 없이 바뀐다 | PO 결정 필요 (법률 확인) |
| 5 | 문의 보존 기간 — 연락처·첨부 완료 후 365일 비움, 본문(가린 값)은 보존 | 정정 이력이 문의를 가리켜 행은 못 지우므로 칸만 비운다. 기간은 법령상 보존 의무(분쟁 처리 기록 등) 확인 필요 — 확인 전까지 짧게 비우지 않고 365일 | PO 결정 필요 (법률 확인) |
| 6 | 탈퇴 시 동의 이력(`consents`) | 즉시 삭제(ACC-03 '즉시 삭제'). 동의 증빙 보존 의무가 있다는 법률 판단이 나오면 이름을 가린 채(user_id 비움) 일정 기간 보존으로 바꾼다 | PO 결정 필요 (법률 확인) |
| 7 | 가입·수신·마케팅·사전 알림 동의 문구와 '(광고)' 표기 | 문구는 법률 검토본 — 화면에 동의 체크 칸과 문서 링크 틀만 있다. 선택 동의는 모두 기본 해제, 필수 동의와 분리 (PRD ACC-02) | PO 결정 필요 |
| 8 | 약관·처리방침 개정 시 기존 회원 처리 | 새 판 게시 시 `/my` 상단에 안내 한 줄만(재동의 요구 없음). 중요 개정의 메일 통지·재동의는 법률 판단 | PO 결정 필요 (법률 확인) |
| 9 | 시행일 vs 게시일 | `effective_on`은 표시용이고 게시하면 바로 보인다. 시행 전 고지 기간·예고 표시는 법률 판단 후 필요하면 더한다 | 기본값으로 진행 |
| 10 | 정책 게시 점검의 성격 | 경고만(금지 표현·처리 위탁 업체 이름 누락·이메일 모양). 차단은 법률 승인 기록 3칸이 맡는다 — 점검이 문장을 판단하지 않는다 | 기본값으로 진행 |
| 11 | 회사·매체 정보(운영 주체 · 등록번호 · 발행인 · 편집인 · 대표전화 · 주소 · 오시는 길) | W0 실사로 확인된 값만 `company_info`에 넣는다. 지금은 모두 빈 값 → 바닥글 줄·회사 소개 항목 숨김. 임의 등록번호 0 | PO 결정 필요 (자료 제공) |
| 12 | 개인정보 보호책임자 지정 | 처리방침 필수 항목이라 사람을 정해야 한다. 연락 수단은 이메일 주소가 아니라 문의 폼 링크로 안내(평문 이메일 0) | PO 결정 필요 |
| 13 | 관심 지역 상한 (PRD 13장 3곳/5곳) | 3곳 (설정 `member.interest_region_limit` — 배포 없이 5로 바뀜) | 기본값으로 진행 |
| 14 | 맞춤 블록 위치 (PRD 13장) | `/my`만, 홈 구성 유지(HOME-07 초안) | 기본값으로 진행 |
| 15 | 로그인·가입·재설정 시도 제한 값 (2.2 `auth_limits`) | 로그인: 이메일+IP 5회/15분, 이메일 20회/15분, IP 30회/15분. 잠금 범위를 짝으로 나눠 남이 관리자 계정을 잠그기 어렵게 함. 운영 뒤 조정 | 기본값으로 진행 |
| 16 | 비밀번호 규칙 | 10글자 이상·72바이트 이하·흔한 값/이메일 포함 거부, 구성 규칙 없음 (2.6). 원격 Supabase Auth 최소 길이도 10으로 맞춘다 | 기본값으로 진행 |
| 17 | 문의 답변 메일 기능 | 만들지 않는다 — 접수 확인 메일만 자동, 답변은 담당자가 회사 메일로 직접(상태·메모는 문의함에). 스팸 발송 통로를 만들지 않는 쪽 | 기본값으로 진행 |
| 18 | 접수 확인 메일 실패 | 접수는 유지, 문의함에 `failed` 표시. 자동 재시도·재발송 버튼은 만들지 않는다 | 기본값으로 진행 |
| 19 | 봇 방지 도구(CAPTCHA 등) | 도입하지 않음 — 숨은 칸·최소 작성 시간·DB 기반 횟수 제한만. 남용이 보이면 이식 가능한 도구(Vercel 전용 제외)를 고른다 (인프라 2-15와 같은 원칙) | 기본값으로 진행 |
| 20 | 첨부 제한 | 3개·합계 4MB(Vercel 요청 본문 4.5MB 한도 반영)·pdf/jpg/png/docx/xlsx/hwp/hwpx. 바이러스 검사 없음 → 직원만 내려받기, 화면 안 열기 없음. 사내 서버로 옮기면 상한을 올릴 수 있음 | 기본값으로 진행 |
| 21 | 로그인 진입점 | 헤더에 두지 않고 바닥글 [내 정보]·[브리핑 알림 받기]. 헤더에 두려면 PRD HOME-02 변경이 필요 | 기본값으로 진행 |
| 22 | 맞춤 새 글에 넣는 기사 | 광고(`sponsored`)와 금주 핫뉴스(`digest`) 제외. 최근 14일·최대 6건·최신순 | 기본값으로 진행 |
| 23 | 편집국·관리자 계정의 `/my` | 같은 계정 풀이라 열린다(PRD-00 6장 표는 '–'). 측정에서는 직원 제외 그대로 | 기본값으로 진행 |
| 24 | 관리자 계정 분실 복구 | 메일 계정 연결 뒤 재설정 화면으로. 그 전에는 로그인한 상태의 비밀번호 바꾸기만. 잠겼다면 Supabase 관리 화면에서 PO가 승인한 방법으로 복구 | 기본값으로 진행 |
| 25 | 메일 쓰는 방식 | Supabase 기본 메일 대신 앱이 `generateLink` 토큰을 자기 메일 모듈로 보냄 (기본 메일은 일반 가입자에게 못 보내고, 메일이 두 갈래가 되기 때문) | 기본값으로 진행 |
| 26 | 문의 상세 연락처 보기 | [연락처 보기]를 눌러야 보이고 누를 때마다 감사 로그 1건 (접속 기록 취지 — 법률 확인 시 조정) | 기본값으로 진행 |
| 27 | 사전 알림 "이미 신청하셨습니다" | PRD가 정한 안내라 따른다. 이메일 신청 여부가 드러나는 것은 받아들임 (가입·재설정은 계정 유무를 감춘다) | 기본값으로 진행 |
| 28 | 이전 판 보기 | 개정 이력 목록 + `?v=번호`로 이전 판 열람(`noindex`) | 기본값으로 진행 |
| 29 | 이메일 변경·계정 병합 | 만들지 않는다 (PRD에 없음). 이메일을 바꾸려면 새로 가입 | 기본값으로 진행 |
| 30 | 문의 본문 가림 | 이메일·전화·주민등록번호 형식은 저장 전 가림(W2-d 규칙) — 연락 수단은 별도 칸에 쓰게 안내 | 기본값으로 진행 |
| 31 | 회원 등급 값 (W2-c #12) | `guest`(비로그인, 저장 안 함)·`basic`(로그인 회원)·`premium`·`institution`. 1단계 로그인 회원은 모두 `basic` | 기본값으로 진행 |
| 32 | 개인정보처리방침 링크 굵게 (PRD '표시 기준') | 굵게 (이미 공용 바닥글이 그렇게 그린다) | 기본값으로 진행 |
| 33 | 이메일 가림 표기 | `이름 [at] 도메인 [dot] 최상위` 글자 표기, `mailto:` 없음, 문의 폼 링크 병기 (스크립트 없이도 읽힘·화면 읽기 도구 친화) | 기본값으로 진행 |
| 34 | [측정 거부] 링크·문구 (W2-c #7) | 링크는 항상 보인다. 안내 문구는 법률 검토 | PO 결정 필요 (법률 확인) |
| 35 | 검색어가 주소에 남는 사실 (W2-d #26) | 처리방침 사실 목록에 넣는다 (9.4) | 기본값으로 진행 |
| 36 | 원격 DB 적용 — 마이그레이션 23~26 + 저장소 버킷 | 로컬 시험 끝난 뒤 staging → prod. 자동 모드 안전장치 때문에 PO가 일반 모드 허가 창에서 승인 (진행 현황 3장 방법) | PO 결정 필요 |
| 37 | 원격 Auth 설정 — 이메일 확인 필수 · 최소 비밀번호 길이 10 · 인증 링크 유효 시간(1시간) | 원격 설정 변경이라 PO 승인 필요 | PO 결정 필요 |
| 38 | 신규 환경변수 — `GUARD_SECRET` · `MAIL_SMTP_*` | `check-env`·인프라 요청서 7장에 이름 추가, 값은 PO 비밀 보관소 → Vercel 환경변수(승인 뒤) | PO 결정 필요 (값 넣기) |
| 39 | 새 의존 패키지(SMTP 클라이언트) | 하나만 추가, 버전 고정(`check-pins`) | 기본값으로 진행 |
| 40 | 구현 첫머리에 코드로 확인할 것 | `AUDIT_ADMIN_EMAILS` 읽는 곳·감사 기록 화면의 현재 모양 · `regions` 유효 기간 칸 이름 · 로컬 메일 수신함 주소/포트 · `vercel.json` 일정 수(하루 1회 배치 추가 가능한지) · W2-c 수집 API의 IP 읽기 함수 이름 | 기본값으로 진행 |
