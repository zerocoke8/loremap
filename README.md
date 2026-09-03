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
| `FIREBASE_SERVICE_ACCOUNT` | **Secret** | (선택) Firebase 데이터베이스를 잠글 때 필요. 아래 "데이터베이스 잠그기" 참고 |
| `ANTHROPIC_WORKSPACE_ID` | Text | (선택) Anthropic 키가 **여러 워크스페이스용**(개인 키·서비스 계정 키)일 때만. 콘솔 Settings → Workspaces 의 ID 열에 있는 `wrkspc_…` 값. 키를 만들 때 워크스페이스를 하나만 지정했다면 필요 없음 |
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

## 데이터베이스 잠그기 (권장)

Firebase Realtime Database 는 기본 규칙이 열려 있으면 **누구나 주소만 알아도 전체 데이터를 지울 수 있습니다.**
마스터 코드는 AI 프록시만 지키고 Firebase 와는 접점이 없기 때문에, 규칙을 따로 걸어야 합니다.

시작 전에 반드시: 앱에서 ⚙ → 💾 파일로 저장, Firebase 콘솔 → 데이터 → ⋮ → JSON 내보내기,
그리고 **현재 규칙 원문을 텍스트로 복사**해 두세요(콘솔에 규칙 이력이 남지 않습니다).

### 1단계 — 한 방 파괴만 막기 (5분, 코드 변경 없음)

Firebase 콘솔 → Realtime Database → 규칙 탭에 붙여넣고 게시합니다.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "worldmind": {
      ".read": true,
      ".write": false,
      "tabList": { ".write": "newData.hasChildren()" },
      "tabs": {
        ".write": false,
        "$tabId": { ".write": true }
      }
    }
  }
}
```

`.write` 는 조상에서만 아래로 상속되므로, `worldmind` 와 `worldmind/tabs` 에 쓰기를 주지 않으면
`DELETE /worldmind.json` 한 번으로 전부 지우는 공격이 막힙니다. 앱 기능은 그대로입니다.
다만 **읽기는 열려 있어** 공격자가 탭 목록을 얻어 하나씩 지우는 것은 여전히 가능합니다 — 2단계까지 가세요.

적용 후 F12 콘솔을 열어 둔 채: 보기 전용 방문 · 노드 편집/삭제 · **탭 추가/삭제** · 탭 복제 ·
두 창 실시간 동기화 · 새로고침을 확인하세요. "저장 실패" 칩이나 "탭을 삭제하지 못했습니다" 가 뜨면
복사해 둔 원래 규칙으로 되돌리고 알려주세요.

공격을 당하는 중이라면 패닉 스위치: `{"rules":{"worldmind":{".read":true,".write":false}}}`
— 사이트는 그대로 보이고 편집자는 "저장 실패" 칩을 보며 로컬에서 계속 작업할 수 있습니다.

### 2단계 — 편집자만 쓰기 (마스터 코드와 연결)

**순서를 지켜야 합니다. 규칙을 먼저 조이면 편집이 막힙니다.**

1. Firebase 콘솔 → 프로젝트 설정 → **서비스 계정** → "새 비공개 키 생성" → 내려받은 JSON 파일을 엽니다.
2. 그 **내용 전체**를 Worker 의 `FIREBASE_SERVICE_ACCOUNT` **Secret** 으로 등록하고 Deploy 합니다.
   (`private_key` 안의 줄바꿈이 이미 `\n` 으로 되어 있어 한 줄 붙여넣기로 문제없습니다)
3. Firebase 콘솔 → **Authentication** → 시작하기를 눌러 활성화합니다(공급자는 켜지 않아도 됩니다 —
   커스텀 토큰 로그인은 별도 공급자가 필요 없습니다).
4. 앱을 열어 🔒 잠금 해제한 뒤 **노드를 하나 옮겨 저장이 되는지** 확인합니다. F12 콘솔에
   "Firebase 편집 세션 로그인 실패" 가 없어야 합니다.
5. 그다음에야 규칙의 `true` 를 조건으로 바꿉니다.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "worldmind": {
      ".read": true,
      ".write": false,
      "tabList": {
        ".write": "newData.hasChildren() && (auth.token.editor === true || auth.uid === 'wm-editor')"
      },
      "tabs": {
        ".write": false,
        "$tabId": { ".write": "auth.token.editor === true || auth.uid === 'wm-editor'" }
      }
    }
  }
}
```

`auth != null` 로 쓰면 안 됩니다 — 공개된 apiKey 로 누구나 익명 계정을 만들 수 있어 무의미해집니다.
반드시 `editor` 클레임이나 고정 uid 로 검사하세요. 잎(`tabList`·`tabs/$tabId`)에만 쓰기를 주는 1단계
골격을 유지하면, 토큰을 얻은 사람조차 루트를 한 번에 날릴 수 없습니다.

### 3단계 — 마스터 코드 무차별 대입 막기

`/api/auth` 는 브라우저 페이지에서 온 요청만 받도록 되어 있지만(Origin 없는 curl 은 403),
속도 제한은 없습니다. Cloudflare 대시보드 → **Security → WAF → Rate limiting rules** 에서
`/api/auth` POST 를 IP당 분당 5회로 제한하고, `MASTER_CODE` 를 24자 이상 난수로 바꾸세요.

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
| AI 호출 시 "anthropic-workspace-id is required…" 또는 "여러 워크스페이스용 키…" | 키가 다중 워크스페이스용. `ANTHROPIC_WORKSPACE_ID` 변수에 `wrkspc_…` 를 넣거나, 워크스페이스를 하나만 지정한 키로 교체 |
| 상태 칩이 계속 "연결 중…" | `FIREBASE_CONFIG` 의 `databaseURL` 확인, Firebase 규칙이 읽기/쓰기를 허용하는지 확인 |

## 개발 (Claude Code 등으로 이어서 작업할 때)

```bash
npm install     # jsdom 하나만 설치
npm test        # 앱·Firebase·프록시·Worker 테스트 105건
```

프로젝트 루트의 `CLAUDE.md`에 구조·불변 제약·주의점이 정리되어 있습니다. Claude Code는 이 파일을 세션마다 자동으로 읽습니다.
