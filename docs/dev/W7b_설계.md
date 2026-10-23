# W7b AI 도우미(안내·검색형) — 설계 약속 (개발 문서)

PRD-01C 4.1 W7b(위젯, `/api/assistant`, 읽기 전용 도구, 마스킹·예산, 검증기 A1~A6, 100문항 평가 틀 — CHAT-01~14 · CHAT-16)를 구현할 때 DB·서버·화면·시험이 같은 이름과 같은 규칙을 쓰기 위한 약속입니다. W5·W6 설계와 같은 모양으로 짧게 씁니다. CHAT-17(전문가 두 버튼의 연락 요청 쪽)은 W7c입니다 — 여기서는 단추 틀과 기능 키 뒤 숨김까지만 합니다.

**이 문서는 세무·법률 답변을 쓰지 않습니다.** 도우미는 이 사이트가 이미 발행한 글·트래커·바깥 연결에서 찾은 것만 인용해 안내하고, 그 밖의 질문은 PRD의 고정 안내 문구와 전문가 버튼으로 돌려보냅니다. 고정 안내 문구는 "계산하지 않습니다·판단하지 않습니다·갈 곳은 이곳입니다" 수준의 길 안내이며 세무·법률 내용이 아닙니다. 100문항 평가 문항은 PO가 씁니다 — 이 구현은 평가 틀(문항 표·실행·채점·게이트 계산)과 지어낸 견본 문항만 둡니다.

**MVP 방침(PO 2026-10-24 "MVP 먼저 … 빨리빨리")**: 질문 → 마스킹 → 의도 분류 → 검색/도구 → 답변 → 검증 → 기록이 끝까지 이어지게 만들고, 지켜야 할 선(원문 저장 0·service role 미사용·읽기 전용·기본 꺼짐·공개 게이트)은 그대로 둡니다. 공개 전에는 내부 계정(로그인한 편집국·관리자)에게만 보입니다.

## 1. 진행 순서

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 DB 기반 (CHAT-09·10·12·13·14) | 마이그레이션 `…70_w7b_assistant_core` — 세션·메시지(마스킹본만)·일일 사용량·속도 표·프롬프트 버전·평가 문항/실행/채점·설정 `assistant_notice`·`assistant_pricing`·읽기 전용 역할 `assistant_reader`·익명 호출 함수 6개·파기 함수 | DB 시험 `w7b-assistant` — 원문 칸 없음·숫자 9자리 이상/이메일 저장 거부 · 표 직접 읽기 거부(anon·assistant_reader) · 속도 n번째 허용/n+1 차단 · 예산 날짜(KST) 경계 · 30일째 보존/31일째 파기 · 평가 없이 프롬프트 활성 거부 · 게이트 기준 미달이면 통과 기록 거부 |
| 2 순수 규칙 (CHAT-04·05·08·10·11·12·16) | `lib/assistant/` — 설정 읽기(금지 모델 거부)·마스킹·규칙 의도 분류·'하지 않음' 안내표·검증기 A1~A6·예산·프롬프트 | vitest — 마스킹 우회 견본·예산 경계·인용 없는 주장 거부·URL 거르기·금지 모델 |
| 3 파이프라인 (CHAT-03·04·06·07·10·11) | `pipeline.ts`(마스킹 → 예산 → 의도 → 검색 → 답변 모델(`search_result` 인용, 도구 상한) → 검증 → 재생성 1회 → '검색 결과만') · `anthropic.ts`(fetch 클라이언트) | vitest(가짜 모델 주입) — 요청 본문 계약(웹 도구 0·구조화 출력 0·인용 켬)·장애 → 같은 모드·도구 상한+1 차단·'하지 않음'은 답변 모델 호출 0 |
| 4 서버·화면 (CHAT-01·02·06·08·16) | `/api/assistant`(POST)·`/api/assistant/feedback`·`/api/admin/assistant`(GET 현황)·위젯(지연 로드)·레이아웃에 내부 계정/공개 판정 | vitest(요청 스키마 400)·세션 쿠키 없이 동작 |
| 5 평가 틀 + 수용 E2E (CHAT-14) | `lib/assistant/eval.ts`(문항 → 가짜/실제 모델 실행 → 채점 → 게이트 계산) · `e2e/w7b-acceptance.test.mjs`(가짜 모델을 환경변수로 주입) · CI `db-e2e.sh` 마지막 W5 줄 뒤에 연결 | 게이트 계산 vitest · E2E는 작성만(이번 작업에서 돌리지 않음) |

## 2. 데이터 모델

| 표 | 핵심 칸 | 규칙 |
|---|---|---|
| `assistant_sessions` | id(uuid), started_at, retain_until, internal, resolved_at·handoff_at·unresolved_at, last_intent, turns | 질문 원문 칸 없음. 해결/사람 연결/미해결 시각은 측정(CHAT-13) 원본. 로그인 연결 칸 없음(CHAT-09) |
| `assistant_messages` | session_id, turn, question_masked, answer_masked, intent, mode(ai·search_only·fixed·rate_limited), fallback_reason, citation_urls[], tool_calls(요약), verifier, model, router_model, prompt_version_id(NOT NULL), tokens_in·out·cached, cost, retain_until | 원문 칸 0 — check가 숫자 9자리 이상·이메일 모양을 거부. 답변 본문도 마스킹본 |
| `assistant_usage_daily` | day(KST), tokens_in·out·cached, cost, turns, fallback_budget·error·rate·verify | 일일 예산 판정 원본(CHAT-10). 날짜는 DB가 한국 시간으로 정함 |
| `assistant_rate_hits` | key_hash(32 hex), window_start, count | 세션·IP 속도 제한. 키는 서버가 HMAC(`GUARD_SECRET`)으로 만든 해시뿐 |
| `prompt_versions` | role(router·answer·summary_draft), version, body_hash, body, eval_run_id, status | 평가 실행 없이 `active` 불가(CHAT-12). 서버가 시작 때 현재 지시문을 `draft`로 등록(같은 해시는 한 줄) |
| `assistant_eval_items` | category(8종), question, expected, forbidden_claims, item_version, source(written·conversation), 익명화 검토 | 대화에서 옮긴 문항은 익명화 검토 기록이 있어야 저장(CHAT-09). 운영 씨앗 0 |
| `assistant_eval_runs` | models, prompt_versions, item_set_version, report, gate_passed | 통과 표시는 리포트 숫자가 기준(하지 않음 30/30·금지 URL 0·지어낸 답 0·개인정보 0·주입 30/30·마스킹 우회 노출 0·채점자 2인 이상)을 채울 때만 DB가 허용 |
| `assistant_eval_grades` | run_id, item_id, grader, verdict, note, resolution | 문항·채점자마다 한 줄. 불일치는 resolution에 처리 기록 |

설정(공개 읽기 정책에 넣지 않습니다 — 공유 정책 목록을 건드리지 않으려고 함수 `assistant_runtime()`이 읽어 줍니다): `assistant_notice`(`{version, ai_notice, first_use[], approved, reviewed_by, reviewed_on}` — 씨앗은 초안·미승인) · `assistant_pricing`(`{answer:{in,out}, router:{in,out}}` — 100만 토큰당 원, 씨앗 0).

환경변수(서버): `ASSISTANT_ENABLED` · `ASSISTANT_PUBLIC`(게이트 통과 리포트 없으면 켜도 일반 방문자에게 안 열림) · `ASSISTANT_DAILY_TOKEN_BUDGET` · `ASSISTANT_RATE_LIMIT`(`횟수/초`) · `ASSISTANT_RETENTION_DAYS` · `ASSISTANT_MAX_TURNS` · `ASSISTANT_MAX_TOOL_CALLS` · `ASSISTANT_MAX_RESULTS` · `ANTHROPIC_MODEL_ANSWER`·`ANTHROPIC_MODEL_ROUTER`·`ANTHROPIC_API_KEY`. 모델 ID는 코드에 두지 않습니다 — 변수가 비었거나 금지 계열(Fable·Mythos)이면 도우미가 꺼집니다.

## 11. 기록

- 대화 기록은 마스킹본만 `assistant_messages`에 남고 `retain_until`(기본 30일)이 지나면 `assistant_purge_expired`가 지웁니다(멱등, 건수만 반환).
- 모든 응답 행에 모델 ID·프롬프트 버전 id가 남습니다. 실제 호출 토큰은 응답의 usage 값을 그대로 씁니다.
- 폴백(예산·장애·속도·검증 실패)은 메시지 행의 `mode`·`fallback_reason`과 일일 사용량의 사유별 건수로 남습니다(`assistant_fallback_shown` 이벤트 대신 — 질문 원문 없음).
- 공개 게이트: 평가 실행 `gate_passed` + 설정 `assistant_notice.approved`(법률 고지 감수 #24) + 환경변수 `ASSISTANT_PUBLIC`이 모두 있어야 일반 방문자에게 열립니다. 하나라도 없으면 내부 계정만.

## 12. 결정

| # | 안건 | 이 구현의 값 |
|---|---|---|
| 1 | 코드 위치 | `packages/assistant` 대신 `apps/web/lib/assistant/`(순수 규칙)와 `apps/web/lib/server/assistant/`(DB·도구). 새 작업 공간 패키지는 잠금 파일을 바꿔야 해서 MVP에서 미룹니다. 모듈 경계 시험(service role 키 참조 0·모델 ID 문자열 0)은 그대로 둡니다. 권고안으로 진행 (PO 위임 2026-10-22) |
| 2 | DB 접근 | 서버가 공개(anon) 키로만 읽고, 기록·예산·속도는 `security definer` 함수 6개(익명 호출 가능, 입력 모양 검사)로 합니다. 역할 `assistant_reader`는 같은 권한(공개 뷰 읽기 + 그 함수 실행)으로 만들어 두고 시험하지만, 별도 접속은 MVP 이후입니다. 권고안으로 진행 (PO 위임 2026-10-22) |
| 3 | 응답 방식 | SSE 대신 한 번에 JSON(검증기가 문단 단위로 통과시킨 뒤 내보내므로 MVP에서 체감 차이가 작음). SSE는 MVP 이후. 권고안으로 진행 (PO 위임 2026-10-22) |
| 4 | 의도 분류 | 라우터 모델은 JSON 글을 돌려주고 서버가 열거형으로 검증합니다(구조화 출력 기능 대신 — 모델·API 판에 덜 묶임). 규칙 사전이 '하지 않음' 범주를 먼저 잡으면 모델 결과보다 우선(단방향 — 규칙이 막는 것을 모델이 풀 수 없음). 권고안으로 진행 (PO 위임 2026-10-22) |
| 5 | 초기 한도 | 일일 200,000토큰 · 속도 10회/10분(세션 키 + IP 키 각각) · 세션당 10턴 · 질문당 도구 호출 3회 · 요청당 검색 결과 5건 · 질문 최대 500자. 내부 베타 실측 뒤 조정. 권고안으로 진행 (PO 위임 2026-10-22) |
| 6 | 전문가 두 버튼 | [SM 전문가 보기]는 기능 키 `expert_finder`가 켜져 있을 때만, [연락 받기]는 W7c가 기능 키를 더한 뒤(`expert_requests`)에만 나옵니다. 분야 코드는 W7c 코드표가 생기기 전까지 도우미 안내표의 임시 코드(`lib/assistant/decline.ts`)를 쓰고 W7c에서 교체합니다. 권고안으로 진행 (PO 위임 2026-10-22) |
| 7 | 단가 | `assistant_pricing` 씨앗 0원. PO가 실제 단가를 넣기 전에는 비용이 0으로 기록됩니다(토큰은 정확히 기록). 권고안으로 진행 (PO 위임 2026-10-22) |
| 8 | 관리 화면 | MVP는 `GET /api/admin/assistant`(오늘 사용량·해결률·최근 평가·게이트 상태)만. 화면은 MVP 이후. 권고안으로 진행 (PO 위임 2026-10-22) |

| 9 | 모델 키·워크스페이스 | 2026-10-24 실호출 확인: 지금 키는 워크스페이스에 묶여 있지 않아 `anthropic-workspace-id` 머리글이 필요하다는 400이 돌아옵니다. 코드는 환경변수 `ANTHROPIC_WORKSPACE_ID`가 있으면 그 머리글을 붙입니다(비밀 아님). 워크스페이스에 묶인 키를 쓰면 필요 없습니다. 운영·개발 키 분리는 PRD 그대로. 권고안으로 진행 (PO 위임 2026-10-22) |
| 10 | 수용 E2E의 모델 | `ANTHROPIC_BASE_URL`(비우면 공식 주소)을 가짜 모델 서버로 돌려 실제 API 호출 0으로 돌립니다. 권고안으로 진행 (PO 위임 2026-10-22) |

MVP 이후로 미루는 것: SSE 스트리밍, `packages/assistant` 분리, 별도 DB 접속(`assistant_reader` 로그인), 관리 화면(평가 문항 입력·채점·프롬프트 활성), 질의 지도 후보 연계(미해결 질문 → OPT-04), 봇 방지 도구, 4단계 지방세봇 모드, 요약 초안(EXPL-14, W7c).
