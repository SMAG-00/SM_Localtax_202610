# MVP 사용 시작 안내 (2026-10-24)

MVP로 만든 작업 단위(W1~W6·W7b·W7c)를 테스트 주소에서 써 보기 위한 순서입니다. 모든 기능은 지금 꺼져 있고, 아래 순서로 하나씩 켭니다.

- 테스트 주소: https://sm-localtax-202610.vercel.app
- 관리 화면: https://sm-localtax-202610.vercel.app/admin (관리자 계정 admin@sunmyung.kr로 로그인)

## 1. Vercel 환경변수 (AI 도우미용 — PO가 직접 넣습니다)

Vercel 프로젝트 `sm-localtax-202610` → Settings → Environment Variables → Production에 아래를 넣고 Redeploy를 누릅니다. 값은 `apps/web/.env.local`에 넣으신 것과 같습니다. 채팅에는 붙여 넣지 마세요.

| 이름 | 값 |
| --- | --- |
| `ANTHROPIC_API_KEY` | (.env.local과 같은 키) |
| `ANTHROPIC_WORKSPACE_ID` | (.env.local과 같은 `wrkspc_…`) |
| `ANTHROPIC_MODEL_ANSWER` | `claude-sonnet-5-5` |
| `ANTHROPIC_MODEL_ROUTER` | `claude-haiku-5-5` |
| `ASSISTANT_ENABLED` | `on` (도우미를 관리자·내부 계정에게 엽니다) |
| `ASSISTANT_PUBLIC` | 비워 둡니다 (100문항 평가와 고지 감수 뒤에 `on`) |

## 2. 운영 설정 (관리 화면 → 운영 설정)

### 2.1 금주 핫뉴스 (W6 — PO 결정 2026-10-24: 서울·부산)

`digest_sidos`

```json
["1100000000", "2600000000"]
```

`digest_sources`

```json
[
  { "id": "seoul-press", "name": "서울특별시 보도자료", "host": "mediahub.seoul.go.kr", "kind": "board", "basis": "서울시 저작권 정책 확인 — 보도자료 게시물 공공누리 제4유형(출처 표시·상업적 이용 금지·변경 금지). 편집국 자체 요약 + 원문 링크만 씁니다", "checked_on": "2026-10-24" },
  { "id": "busan-press", "name": "부산광역시 보도자료", "host": "www.busan.go.kr", "kind": "board", "basis": "부산시 저작권 정책 확인 — 보도사진 공공누리 제2유형(출처 표시·상업적 이용 금지). 편집국 자체 요약 + 원문 링크만, 사진은 쓰지 않습니다", "checked_on": "2026-10-24" }
]
```

### 2.2 기능 키 (`feature_flags`)

켜는 순서와 조건입니다. 조건이 없는 키를 켜려고 하면 화면이 이유를 알려 주고 저장되지 않습니다.

| 기능 키 | 켜면 보이는 것 | 켜는 조건 | MVP에서 |
| --- | --- | --- | --- |
| `region_hubs` | `/local` 지역 허브 | 없음 | 켭니다 |
| `weekly_digest` | 금주 핫뉴스 | 2.1 설정 | 켭니다 |
| `local_events` | 행사안내·달력 | 없음 | 켭니다 |
| `finance` | 개발금융 새 화면 | 법률 검토 기록 | PO 검토 뒤 |
| `dev_methods` | 개발방법 비교 | 7개 방법 서명 | 내용 입력 뒤 |
| `inheritance_gift` | 상속·증여 안내 | 감수된 입문 기사 1건 + 고지 | 기사 작성 뒤 |
| `experts` | SM 전문가 소개 | 고지문 승인 | 고지문 감수 뒤 |
| `expert_requests` | 전문가 연락 요청 | `experts` + 연락 안내 문구 승인 | 문구 감수 뒤 |

## 3. SM 전문가 프로필 (관리 화면 → 전문가 등재)

- 이준수 — 분류: 세무사·공인회계사, 소속: 선명회계법인 (PO 결정 2026-10-24)
- 내용은 https://cpa-js-lee-profile.vercel.app/ 의 경력·전문 분야를 옮깁니다. 개인 이메일·카카오톡 링크는 싣지 않고, '30년'처럼 증빙이 필요한 숫자는 넣지 않습니다
- 본인 동의 기록을 남긴 뒤 '공개'로 바꿉니다. 공개 화면은 `experts` 키를 켠 뒤에 보입니다

## 4. 써 보기

1. 관리 화면에서 기사 1건을 쓰고, 다른 편집자 계정으로 승인해 발행합니다 (작성자 ≠ 승인자)
2. 금주 핫뉴스 후보를 넣고 선정 → 요약 → 발행합니다
3. 행사 1건을 넣고 `/local`의 행사안내에서 확인합니다
4. 관리자로 로그인한 상태에서 오른쪽 아래 AI 도우미에 질문합니다

써 보면서 고칠 점은 채팅으로 말씀해 주시면 목록으로 모아 고칩니다.
