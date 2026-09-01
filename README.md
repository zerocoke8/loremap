# WorldMind 배포 안내

구성은 두 조각입니다.

| 조각 | 위치 | 역할 |
|---|---|---|
| `index.html` (루트) | GitHub Pages | 앱 화면. 파일 상단의 값 2개만 채웁니다 |
| `worker/src/worker.js` | Cloudflare Worker (무료) | API 키·마스터 코드를 보관하고 Anthropic/Gemini를 대신 호출 |
| `tests/`, `CLAUDE.md`, `docs/` | 개발용 | 자동 테스트(`npm test`), Claude Code 작업 가이드, 스펙 요약 — 배포에는 필요 없음 |

사용자는 GitHub Pages 주소를 열고 🔒 버튼에 **마스터 코드**만 입력하면 편집과 AI 기능을 바로 쓸 수 있습니다. API 키는 사용자 브라우저로 내려가지 않습니다.

---

## 1. Worker 만들기 (대시보드, 설치 불필요 · 약 5분)

1. https://dash.cloudflare.com 에서 무료 계정을 만듭니다 (카드 등록 불필요).
2. 왼쪽 메뉴 **Workers & Pages → Create → Create Worker**.
3. 이름을 `worldmind-api` 로 정하고 **Deploy** 를 누릅니다. (일단 기본 코드로 배포됩니다)
4. **Edit code** 를 눌러 편집기를 열고, 내용을 전부 지운 뒤 `worker/src/worker.js` 의 내용을 통째로 붙여넣고 **Deploy**.
5. Worker 화면으로 돌아와 **Settings → Variables and Secrets → Add** 로 아래 값을 등록합니다.

| 이름 | 종류 | 값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | Anthropic 콘솔에서 발급한 키 (`sk-ant-…`) |
| `MASTER_CODE` | **Secret** | 사용자들에게 알려줄 마스터 코드. 길고 예측 어려운 문장 권장 |
| `GOOGLE_API_KEY` | **Secret** | (선택) 이미지 생성을 쓸 때만. 없으면 이미지 버튼에서 안내가 뜹니다 |
| `ALLOWED_ORIGINS` | Text | GitHub Pages 주소. 예: `https://myname.github.io` |

   `ALLOWED_ORIGINS` 메모
   - 저장소 주소에 경로가 붙어도(`https://myname.github.io/worldmind/`) **도메인까지만** 적습니다.
   - 여러 사이트는 쉼표로: `https://a.github.io,https://b.example.com`
   - 내 PC의 파일(file://)로 열어 테스트하려면 `,null` 을 덧붙입니다: `https://myname.github.io,null`

6. 변수 저장 후 **Deploy** 를 한 번 더 누릅니다.
7. 확인: 브라우저 주소창에 `https://worldmind-api.<계정명>.workers.dev/api/health` 를 입력해 열면 `{"ok":true,…}` 가 보여야 합니다. Worker 주소는 Worker 화면 상단(Preview / Visit)에 표시됩니다.

## 2. index.html 값 채우기

`index.html` 을 열어 스크립트 맨 위 **★ 배포 설정** 블록의 두 줄을 채웁니다.

```js
const API_BASE = 'https://worldmind-api.myname.workers.dev';   // 끝에 / 없이
const FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "….firebaseapp.com",
  databaseURL: "https://….firebasedatabase.app",
  projectId: "…",
  storageBucket: "…",
  messagingSenderId: "…",
  appId: "…"
};
```

- `FIREBASE_CONFIG` 는 Firebase 콘솔 → 프로젝트 설정 → 내 앱 → **SDK 설정 및 구성**에 있는 `firebaseConfig` 객체를 그대로 붙여넣으면 됩니다. 이 값은 비밀이 아니라 파일에 넣어도 괜찮습니다.
- GitHub 웹에서 파일 옆 연필(✏️) 아이콘으로 직접 편집해도 됩니다. 커밋하면 1~2분 뒤 Pages에 반영됩니다. 이후 앱을 수정할 때도 이 두 줄만 유지하면 됩니다.

## 3. 사용자에게 알려줄 것

주소 하나와 마스터 코드 하나입니다. 열자마자 동기화가 연결되고, 🔒 버튼 → 코드 입력 → 편집·AI 사용. 잠금 해제는 브라우저 탭을 닫을 때까지(최대 12시간) 유지됩니다.

## 4. 운영

- **키나 마스터 코드 변경**: Worker → Settings → Variables and Secrets 에서 값만 바꾸고 Deploy. 마스터 코드를 바꾸면 기존 사용자들의 잠금 해제가 모두 풀리고 새 코드를 다시 입력해야 합니다.
- **지출 상한**: Anthropic 콘솔(Settings → Limits)에서 월 사용 한도를 걸어두는 것을 권장합니다. 코드를 아는 사람이면 누구나 AI를 쓸 수 있으므로 코드는 신뢰하는 사람에게만 공유하세요.
- **로그 보기**: Worker → Logs 에서 실시간 요청을 볼 수 있습니다 (키·코드는 기록되지 않습니다).
- **Firebase 규칙**: 지금과 동일하게 Firebase 설정을 아는 사람은 DB를 읽고 쓸 수 있습니다. 더 조이고 싶으면 나중에 Firebase Authentication을 붙이는 단계가 필요합니다.

## (대안) CLI로 배포하기

터미널이 편하면 대시보드 대신 아래로도 됩니다. Node.js가 필요합니다.

```bash
cd worker
npx wrangler login
# wrangler.toml 의 ALLOWED_ORIGINS 를 본인 주소로 수정
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put MASTER_CODE
npx wrangler secret put GOOGLE_API_KEY      # 선택
npx wrangler deploy
```

## 문제가 생기면

| 증상 | 원인 / 조치 |
|---|---|
| 🔒 눌렀을 때 "API_BASE가 설정되지 않았습니다" | index.html 의 `API_BASE` 가 비어 있음 |
| "origin not allowed: https://…" | `ALLOWED_ORIGINS` 와 실제 사이트 주소가 다름. 도메인까지만(`https://myname.github.io`), 끝에 `/`나 경로 없이, https 철자 확인 |
| 코드가 맞는데 "일치하지 않습니다" | `MASTER_CODE` 앞뒤 공백, 또는 변수 저장 후 Deploy 를 안 누름 |
| AI 호출 시 "MASTER_CODE 비밀 변수가…" / "ANTHROPIC_API_KEY…" | 해당 Secret 미등록 |
| 상태 칩이 계속 "연결 중…" | `FIREBASE_CONFIG` 의 `databaseURL` 확인, Firebase 규칙이 읽기/쓰기를 허용하는지 확인 |

## 개발 (Claude Code 등으로 이어서 작업할 때)

```bash
npm install     # jsdom 하나만 설치
npm test        # 앱·Firebase·프록시·Worker 테스트 105건
```

프로젝트 루트의 `CLAUDE.md`에 구조·불변 제약·주의점이 정리되어 있습니다. Claude Code는 이 파일을 세션마다 자동으로 읽습니다.
