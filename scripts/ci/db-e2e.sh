#!/usr/bin/env bash
# CI 2단계 — 로컬 Supabase(Docker)를 띄워 DB 시험 · RLS 검증 · 웹 E2E · Docker 이미지 E2E (FND-03·04·07·10)
set -euo pipefail
cd "$(dirname "$0")/../.."

step() { printf '\n== %s\n' "$1"; }

step "의존성 설치 (lockfile 고정)"
pnpm install --frozen-lockfile

step "로컬 Supabase 시작 (마이그레이션 적용)"
(cd packages/db && supabase start -x vector,logflare,edge-runtime,imgproxy,realtime,studio)

step "DB 시험 (감사 로그·관리자 권한·RLS)"; pnpm --filter @ltr/db test
step "RLS 검증 (anon·authenticated 접근 0)"; node packages/db/scripts/verify-rls.mjs
step "공개 데이터 함수 통합 시험 (anon 키·RLS — 공개 행만)"; pnpm --filter @ltr/web test:integration
step "개발 서버 3001 고정 E2E";              node e2e/dev-port.mjs
step "웹 E2E (standalone 빌드)";            node --test --test-concurrency=1 e2e/api-health-jobs.test.mjs
step "편집국 API E2E (역할별 403·감사 로그·발행 판정)"; node --test --test-concurrency=1 e2e/admin-api.test.mjs
step "운영 API E2E (분야·사전·설정·제휴사·회원 정지 — 403·422·감사 로그)"; node --test --test-concurrency=1 e2e/admin-settings-api.test.mjs
step "홈 배치 API E2E (편집 책임자 201·편집국 외 403·7장째 409·끝난 카드 공개 0)"; node --test --test-concurrency=1 e2e/admin-home-api.test.mjs
step "브라우저 설치 (Playwright Chromium)";  pnpm exec playwright install --with-deps chromium
step "계정 기반 E2E (W2-e 1단계 — 로그인 5번 실패 후 6번째 429+retry-after·다른 IP/계정 영향 0·성공하면 짝/계정 횟수 초기화·없는 계정 같은 429·이메일/IP 한도와 설정 변경 즉시 적용·열쇠 없으면 503·표에 원문 0 / 비밀번호 바꾸기 401·403·틀린 현재 비밀번호 422→6번째 429·규칙 위반 422·바꾸면 다른 기기 세션 끊김·감사 로그 1건에 비밀번호 0 / 실제 브라우저 머리말 링크→칸 오류→완료→재로그인·로그인 전 next 유지·noindex)"; node --test --test-concurrency=1 e2e/account-security.test.mjs
step "가입·인증 E2E (W2-e 2-A — 메일 설정 없음/members 꺼짐이면 404·실제 브라우저 가입→로컬 수신함 메일→확인 버튼→/my·같은 주소 재가입 같은 문장+계정 추가 0·역할 값 무시·봇/Origin 거부·메일 서버 장애 시 로그인은 되고 가입은 503+임시 계정 0·서버 기록에 비밀번호/주소 0)"; node --test --test-concurrency=1 e2e/account-signup.test.mjs
step "계정 복구 E2E (W2-e 2-B — 비밀번호 찾기→수신함→확인 버튼→새 비밀번호·옛 비밀번호 거부·다른 세션 끊김·재사용 410·없는/미확인/확인 주소 같은 응답+메일은 확인 계정만·reset_email 4번째 429·미확인 재가입→확인 메일 다시 감·다시 받기 3번째까지·탈퇴 행 0·편집국 역할 탈퇴 거부·미확인 정리 함수 경계·서버 기록/감사 로그에 비밀번호/주소 0)"; node --test --test-concurrency=1 e2e/account-recovery.test.mjs
step "회원 /my E2E (W2-e 3-A — 가입 화면 분야·지역→/my 새 글 블록·선택 동의 행 0·signup_completed 1건 tier basic / 상한+1·없는 코드 거부·지역 저장만으로 consents 새 행 0 / 수신 동의 켜기·끄기 revoked_at / 두 계정 번갈아도 서로 블록 안 보임·홈 HTML 회원 블록 0 / noindex / 360px R2·R3·접근성 95)"; node --test --test-concurrency=1 e2e/account-my.test.mjs
step "백오피스 회원 탭·삭제 E2E (W2-e 3-B — 회원 탭에 역할 없는 계정만·칸 값=DB·검색·정지 표시 / 삭제: 사유 없음 422·편집 책임자 403+감사 로그·역할 계정 409·삭제 후 profiles·consents·Auth 0+감사 로그 1건 이메일 0 / 360px / proxy /my·/account)"; node --test --test-concurrency=1 e2e/admin-members.test.mjs
step "정책 페이지·바닥글 E2E (W2-e 4단계 — 게시본 없는 키 켜기 거부·게시 전 404+링크 0·승인 기록 없이 게시 거부·권한 밖 403+감사 로그·게시 후 바닥글 링크 전수 404 0·가입은 약관+처리방침 게시돼야 열림·개정 이력/이전 판 noindex·①㈜ 원문 유지+평문 이메일 0·/admin/pages 뼈대·360px)"; node --test --test-concurrency=1 e2e/policy-pages.test.mjs
step "고객센터·문의함·감사 403 E2E (W2-e 5단계 — 폼 5종·.exe/상한/숨은 칸/최소 시간/IP 빈도 거부·본문 가림·정정 완료 422·연락처 보기 감사·종류별 열람 403·PO 아닌 관리자 감사 수정/삭제 403+로그 1건)"; node --test --test-concurrency=1 e2e/help-inquiries.test.mjs
step "브리핑 사전 알림·보존 기한 배치 E2E (W2-e 6단계 — 동의 없이 제출 불가·확인 전 미확정·중복·철회·구독자/이벤트 이메일 0 · privacy-retention 경계 하루 전·당일)"; node --test --test-concurrency=1 e2e/brief-retention.test.mjs
step "측정 기반 E2E (W2-c — 수집 API 202·UA·IP 저장 0·세션 29/31분·봇 표시·측정 거부·GPC 204와 전송 0·4xx 저장 0·429·편집국 표시·칸 검사)"; node --test --test-concurrency=1 e2e/analytics-api.test.mjs
step "1시간 집계·많이 본 기사·상담 사례 HOT E2E (W2-c — 봇 100+사람 3 < 사람 5·30분 안 반복 1회·168/169시간 경계·편집국 제외·비공개 바로 제외·멱등·카드 3+HOT 5·고정 2건·가중치 변경 → 다음 집계·누름 이벤트·보존 기한 정리)"; node --test --test-concurrency=1 e2e/analytics-popular.test.mjs
step "측정 지표 대시보드 E2E (W2-c — 숫자 = 넣은 자료 손 계산: 유효 방문 29초 0·30초 1·재방문 30일째 포함·31일째 제외·측정 거부 분모 0·봇·편집국 0·깔때기 / 전환일 → 시험 기간·운영 / 새 브라우저 시나리오 깔때기 세 칸 +1 / 수집 전 / 관리자만·403 / 360px)"; node --test --test-concurrency=1 e2e/admin-metrics.test.mjs
step "기사 생산·제휴 준비 대시보드 E2E (W2-c 5단계 — 확정 버전 없으면 요건 미확정·공식 숫자 0 / 시작일 하루 전 제외·시작일 포함 / 확정 조건 422·담당자 확인 / 확정 뒤 공식·내부 정의 따로·심사 기간 비교·인력 보강 안내 / 확정 버전 고치기 409·새 버전·앞 버전 남음 / 기자·광고 담당 403 / '인정'·'예상 점수'·'예측'·'판정' 0 / 360px)"; node --test --test-concurrency=1 e2e/admin-news-partner.test.mjs
step "편집국 화면 E2E (정량형·정성형 기획→공개·정정·역할별 메뉴·403)"; node --test --test-concurrency=1 e2e/admin-ui.test.mjs
step "운영 화면 E2E (겸직 금지 화면 차단·사전→점검 패널·분야 순서·360px)"; node --test --test-concurrency=1 e2e/admin-settings-ui.test.mjs
step "공개 홈·공통 틀 E2E (섹션 순서·첫 화면 R1·R2·화면 전환·숨긴 메뉴 링크 0·1분 안 반영)"; node --test --test-concurrency=1 e2e/site-home.test.mjs
step "허브·하위 분야·뉴스 전체·상황 페이지 E2E (네 허브 같은 골격·빈 하위 분야 noindex·취재 기사만·먼저 확인할 것 3·화면 전환·R1~R3)"; node --test --test-concurrency=1 e2e/site-hubs.test.mjs
step "상황 카드 백오피스 E2E (2·4개 거부·감수 서명은 감수위원만·허브 5번째 409·저장 즉시 공개 반영)"; node --test --test-concurrency=1 e2e/admin-situations.test.mjs
step "통합 검색 화면·API E2E (W2-d 2단계 — 기능 키 꺼지면 404·링크 0 / 띄어쓰기 변형 같은 결과·차 팔았→상황·개편안→트래커 / JS 꺼도 탭·거르개·쪽 / reported_news만 → 다른 유형 0 / 결과 없음 추천 3·상황 카드·도우미 0 / 비공개 0 / search_submitted 검색어 원문 0 / API 400·500 0·429 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-search.test.mjs
step "검색 어휘 백오피스 E2E (W2-d 2단계 — 상황 카드 검색 별칭 21개·51자 422·공개 중 고쳐도 감수 그대로·저장 즉시 검색 / 동의어 사전 편집 책임자만·409·끄면 바로 빠짐·감사 로그 / 화면 칸 오류·360px)"; node --test --test-concurrency=1 e2e/admin-search-vocab.test.mjs
step "용어사전·본문 용어 풀이 E2E (W2-d 3단계 — 기능 키 꺼지면 /glossary 404·용어사전 링크 0 / 가나다 색인에서 공개 용어 모두·숨긴 용어 0·분야 거르개·용어 쪽 / 본문 풀이 용어마다 한 번·제목·링크 안 0·긴 용어 먼저·키보드 포커스로 열림·Esc 닫힘·누르기 / 검색 결과·용어 칩 링크 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-glossary.test.mjs
step "검색어 집계 E2E (W2-d 4단계 — 전화·이메일·주민등록번호·9자리 이상 숫자 가림·닮은꼴(날짜·60일·제111조) 그대로·원문 조각 DB·화면·기록·이벤트 0 / 같은 정규형 하루 한 행·30분 안 다시 찾기 1 / 봇·편집국·측정 거부·GPC·2쪽·미리 받기·같은 검색 안 이동 0 / 실제 브라우저 탭 바꾸기 0 / /admin/query-terms 편집 책임자·관리자만·403·최소 횟수 아래 수만·동의어 더하기·360px / 보존 기한 정리)"; node --test --test-concurrency=1 e2e/search-terms.test.mjs
step "기사 상세·카드뉴스·칼럼·인물 E2E (배지 글자·박스 자리·정정 블록 0/1·JSON-LD 불일치 0·삭제 410·카드뉴스 5~7장·자기 자신 0·버튼 2개 이하)"; node --test --test-concurrency=1 e2e/site-article.test.mjs
step "형식·제휴 콘텐츠 E2E (W2-c 4단계 — 인포그래픽 대체 텍스트·표 없으면 저장 422·표 접힘·키보드 펼침 / 동영상 nocookie만 저장·재생 전 유튜브 요청 0·video_played 1건·요약·자막·16:9 없으면 발행 422 / 포토 출처·이용 조건·대체 텍스트 없으면 발행 422·원본 비율 / 동영상·포토 목록 / 제휴사 프로필·같은 배지·partner_content_viewed 1건·비공개 404 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/site-media.test.mjs
step "공개 화면 — DB를 읽지 못할 때 (목록 200 + 안내 · 상세 503 · 500 0)"; node --test --test-concurrency=1 e2e/site-degraded.test.mjs
step "W2-b 수용 E2E (홈 섹션 순서 · 홈·허브·상황·기사 R1~R3 · 이어 걷기 새로고침 0 · 링크 전수: 숨긴 메뉴·v1.2 경로 0·깨진 링크 0·noindex·360px · 접근성 95)"; node --test --test-concurrency=1 e2e/w2b-acceptance.test.mjs
step "W2-c 수용 E2E (FND-06 칸 검사·events 0·health 503 / 인포그래픽·동영상·포토 저장·발행 조건·재생 전 유튜브 요청 0 / 제휴사 비공개 뒤 배지 그대로 / 수집 API 봇 100+사람 3 < 사람 5·반복 1회·168/169시간 경계·비공개 제외 / HOT 고정·가중치 → 다음 집계 / 실제 브라우저 29초 0·30초 1·깔때기·측정 거부·GPC·편집자·봇 0·재방문 30/31일 / 요건 미확정·규정 확정·확정 버전 그대로·기준 상수 0 / 권한 표·360px·접근성 95)"; node --test --test-concurrency=1 e2e/w2c-acceptance.test.mjs
step "W2-d 수용 E2E (정규화 견본 2.2 전체·취득세=취득 세·재건축=재 건축 / 차 팔았→상황(다시 찾기→별칭)·개편안→트래커 / 비공개 0(초안·유료·핫뉴스·권리 미확인·감수 전·숨긴 용어)·명소·맛집·행사 유형 0 / 편집국 발행→검색→삭제 정정 즉시 0 / 지역명 첫 결과·옛 이름 / 탭·거르개(reported_news만)·JS 꺼도 링크 / 결과 없음 추천 3·상황 카드·도우미 0 / 가림 견본 2.8·같은 정규형 한 행·원문 0·동의어 더하기→검색 반영 / 쉬운 풀이 60·61·121자·숫자+단위 2.6·용어 200개 가나다 색인·4대 분야·공개/숨김 / 본문 풀이 한 번·키보드 Tab·Esc / 기사 3,000건 p95 ≤ 800ms / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/w2d-acceptance.test.mjs
step "W2-e 수용 E2E (회원 E2E 가입→확인→/my→재설정→탈퇴 / 평문 이메일 0 여섯 면·감시 주소 추적 / 정책 링크 전수 404 0 / 회원 삭제·감사 403 정확히 1건 / 기능 키 꺼짐·켜짐 / 정적 정책 본문 0 / R1~R3·360px·접근성 95)"; node --test --test-concurrency=1 e2e/w2e-acceptance.test.mjs
step "개정 트래커 E2E (단계 기록 조건·정정·기능 키·확정 아님 칩·시행 예정·입법예고→국회 제출 연결 기사 3건 배너·dateModified 불변·실질 수정/연결 해제 뒤 배너 0·360px)"; node --test --test-concurrency=1 e2e/tax-tracker.test.mjs
step "바깥 연결 E2E (공개 주소 5장 카드·저장 주소 일치·점검 ok/broken·같은 실행 키 한 벌·수동 점검·7/8일 경고·broken 대체 안내)"; node --test --test-concurrency=1 e2e/tax-links.test.mjs
step "해석 해설 E2E (발행 검사 3종·공개 조건·해시 변경 검수 큐·원문 블록)"; node --test --test-concurrency=1 e2e/tax-interpretations.test.mjs
step "칼럼 필자 체계 E2E (필자 검증·계약·이해관계·고지 발행 검사·재검증 기한·정정 이력·화면)"; node --test --test-concurrency=1 e2e/tax-columns.test.mjs
step "브랜드 E2E (W3 7단계 — 증빙 승인·동의서·감수 표시 권한 403·감사 / 렌더 약력 수 = 승인 증빙 수·증빙 없는 줄 0(인물·필자 줄·JSON-LD·공유 미리보기)·JSON-LD = 화면 / 동의서 없음·철회 → 404·사이트맵 원본 0·필자 링크 0·칼럼 발행 거부 / 서명 없는 감수 표시 0·오탈자 유지·실질 수정 0 + 재감수 큐 / brand_copy 감수·경력 승인 전 거부·근거 철회 시 꺼짐·people_pages 역할별 블록)"; node --test --test-concurrency=1 e2e/w3-brand.test.mjs
step "시그니처 칼럼·편집 독립 E2E (W3 8단계 — 승인 전 '50년' 0(제목·메타·주소·JSON-LD·사이트맵 원본·검색)·연재 제목/회차 글/연재 이름 칸 422 칸별 오류 / 승인 뒤 연재 제목에만 근거 링크와 함께·근거 거두면 0 / 「그때와 지금」 출처·기준연도 422·항목 없이 발행 422 / 빈 홈 칼럼 영역 0·최신 회차 / brand_ops 승인·정렬·발행·연재 회차 403 + 감사 1건 / 필자 = 승인자 403·DB 거부)"; node --test --test-concurrency=1 e2e/w3-signature.test.mjs
step "국세 미산출·홈 핵심 메시지·허브 지방세 포인트 E2E (W3 9단계 — 국세 검사 통과·위반 파일 잡음·공개 HTML 국세 입력 칸 0·/calc/transfer 404 / 핵심 메시지 1개·'50년' 422+DB 거부·바로 반영 / 4대 분야 카드 4장·404 0·360/1280px 같은 크기 / 포인트 3줄 200·4줄 422+DB 거부·편집 화면 4번째 줄 요청 0 / 감수 전 블록 0·편집 책임자 서명 403+감사·서명 뒤 블록·홈 첫 줄 / 고치면 바로 0·다시 서명하면 새 문구·brand_ops 403 / /calc·상황 페이지 국세 배지·빈 주소 카드 0)"; node --test --test-concurrency=1 e2e/w3-home-points.test.mjs
step "검색·측정 연결 E2E (W3 10단계 — 트래커·해석 원문 검색 결과·열린 화면만 링크·꺼지면 원문 링크 / AI 색인 불허 칼럼 0(화면·API·탭 숫자·오피니언 거르개)·범위를 줄이면 다음 검색부터 0 / 카드 누름 1번 = calculator_card_clicked 1건(/calc·상황 페이지)·속성 = 카드 키·화면·차례·표식 값 0·나가는 요청 Referer 0 / amendment_viewed·interpretation_viewed 1건 / 서명 기록 기사만 JSON-LD reviewedBy = 화면 감수 표시·compareRendered 0)"; node --test --test-concurrency=1 e2e/w3-search-measure.test.mjs
step "W3 수용 E2E (2026 개편안(가짜) 트래커 단계별 재현·같은 기록 = 같은 화면·시행 예정/시행 / 입법예고→국회 제출 연결 기사 3건 배너·dateModified 불변·공포 뒤 칩 0 / /calc 카드 묶음·이동 주소 = 저장 주소·표식 값 0(쿼리·조각·Referer·iframe·fetch)·누름 1번 = 1건·빈 주소 카드 0 / 링크 점검 7일 0·8일 1(배치·관리 화면) / 해석 해설 원문 0·서명 없음 거부 / 칼럼 이해관계·검증·계약·고지 / 증빙 없는 약력 0·서명 없는 감수 0·오탈자 유지·실질 수정 0·동의 철회 404 / '50년' 승인 전 0·승인 뒤 근거 링크 / 국세 검사·홈 카드 4장·포인트 3/4줄 / 검색 트래커·해석·불허 칼럼 0 / 360·1280px·접근성 95 / 기능 키 꺼짐 / 정리 0행)"; node --test --test-concurrency=1 e2e/w3-acceptance.test.mjs
step "W4 지역 주소·옛 주소 301·빈 지역 E2E (3단계 — region_hubs 꺼짐 404·링크 0 / /local/seoul 200·없는 slug·다른 시·도 아래 slug·예약 이름 404 / 옛 slug 301 한 번·A→B→C 사슬도 C로 바로·후속 없는 폐지 404 / 이름만 바뀐 지역 200 / 기사 0건 시·군·구 200+noindex+상위 안내 / BreadcrumbList = 화면 이동 줄 / 링크 404 0·360·1280px·접근성 95 / DB 못 읽으면 503)"; node --test --test-concurrency=1 e2e/w4-region-routes.test.mjs
step "W4 지자체 허브 골격 E2E (4단계 — 360×740·1280×800 블록 DOM 순서·화면 위치 = ②③⑤·①④ 요소 0(켜도 W4는 0) / ② 지방세·지방재정·③ 부동산·도시정책 기사만·대응 설정 바꾸면 다음 요청부터·잘못된 대응 422·광고 담당 403+감사 / ?topic= 고른 분야만·목록 밖 값 전체·JS 꺼도 링크·0건 noindex / 시·군·구 0건 → 상위 시·도 기사+대체 문장·상위도 0 → 0건 문장 / 데이터 출처 줄 1개 / 360px·탭 1번·R1~R3·링크 200·접근성 95 / 서명 뒤에만 지방세 포인트)"; node --test --test-concurrency=1 e2e/w4-local-hub.test.mjs
step "W4 공식 자료 규칙 E2E (5단계 — 공식 자료 기준일·지역 단위 빔 → 발행 422(빈 칸 이름)·분석 문단을 고쳐도 원자료 그대로·원자료 고치기 = 새 버전 + 사유(빈 사유 422·옛 판·스냅샷 해시 그대로·감사 1건) / 공식 자료 원문 카드 ≠ 본문 해석 블록·공공누리 유형 글자·원문 새 창·옛 판 0·스냅샷 글자 0·자르기 불가 사진 원본 비율 / 차단 4종 출처·설정 422 + DB 거부·유형 없는 보도자료 422·제4유형·미표시 설정 422 / 제2·3유형 사진 발행 422·공개 렌더 0·설정을 열면 다음 요청부터 / 고시 해설 세무 감수 없이 422 + DB 거부 / 편집 화면 칸 오류·자료 종류 목록·고치기 사유 칸)"; node --test --test-concurrency=1 e2e/w4-official-sources.test.mjs
step "W4 원문 변경·시점 만료 검수 큐 E2E (6단계 — 다시 받은 원문 같은 해시 0·바뀌면 그 주소를 쓴 기사마다 1건 + 기사 화면 공식 자료 카드 '검토 중'(본문 블록 밖)·다른 주소 0·같은 새 원문 다시 0·404 → 502·공식 자료 아님 422 / 해결 → 표시 사라짐 + 감사 source_review.resolve·기자·광고 담당 403 + 거부 감사·이미 해결 409 / 만료 배치 364·365일째 0·366일째 1(00:30 KST)·같은 실행 키 한 벌·확인일 다시 적기 → 표시 0·확인일 오늘 / 만료 기준 설정 422 / 관리 화면 붙여 넣기 다시 받기·해결 버튼·기자 메뉴 0·403 / 큐 anon 0)"; node --test --test-concurrency=1 e2e/w4-source-review.test.mjs
step "W4 지역 기사 편집 게이트 E2E (7단계 — 지자체뉴스 지역 태그 0 → 새 발행 422 + DB 거부·이미 공개분 유지 / 지역 태그 기사 편집 분야·공익적 질문 422(칸 이름) + DB 거부 / 축제 + 관계 0 → 보류·관계 1 + 근거 0 → 보류·근거 + 승인 → 후보·발행 / 여행 후기·맛집 추천 판정 → 별도 상품·보도·해설 발행 422·공개 0·광고 담당·기자 판정 403 + 감사·1인 관리자 판정·공개 중 비보도 판정 409 + DB 거부 / 승인 3항목 빠지면 422 + DB 거부 / 광고 계약 사업자 원고 이해관계 표시 없이 승인 422 / 광고 담당 편집 분야 403 + 감사 / 편집 화면 지역 칸·판정 줄·칸 오류·승인 3항목)"; node --test --test-concurrency=1 e2e/w4-regional-gate.test.mjs
step "견본 페이지 브라우저 E2E (70종·가로 스크롤 0)"; node --test --test-concurrency=1 e2e/design-page.test.mjs
step "화면 규칙 측정 시험 (R1~R3 경계 견본)"; node --test --test-concurrency=1 e2e/screen-rules.test.mjs
step "화면 규칙 측정 (주요 화면 × 뷰포트 표)"; node e2e/run-screen-rules.mjs
step "접근성 점수 (Lighthouse, 95점 이상)"; node --test --test-concurrency=1 e2e/a11y.test.mjs
step "Docker 이미지 E2E";                   node e2e/run-docker.mjs
step "사내 서버 구성 E2E (web·scheduler·proxy)"; node --test --test-concurrency=1 e2e/compose.test.mjs
