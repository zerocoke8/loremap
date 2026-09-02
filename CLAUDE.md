# WorldMind — Claude Code 작업 가이드

AI 기반 창작 세계관 마인드맵 웹앱. 사용자는 GitHub Pages 주소를 열고 🔒 버튼에 마스터 코드를 넣으면 편집·AI 기능을 쓴다.
UI·주석·커밋 메시지는 **한국어**. 프레임워크 없이 Vanilla JS.

## 구조

```
index.html             앱 전체 (HTML+CSS+JS 단일 파일, 약 3,000줄) — 저장소 루트 = GitHub Pages 공개 대상
worker/src/worker.js   Cloudflare Worker: 마스터 코드 검증, 토큰 발급, Anthropic/Gemini 프록시
worker/wrangler.toml   CLI 배포용 (대시보드 붙여넣기 배포면 불필요)
tests/                 jsdom 기반 통합 테스트 + Worker 단위 테스트  →  npm test
docs/SPEC-요약.md      원본 스펙의 핵심 제약 요약 (원본 WorldMind-스펙.md가 있으면 docs/에 추가할 것)
README.md              배포 안내 (관리자용)
```

## 시작할 때

```bash
npm install        # jsdom 하나뿐
npm test           # 6개 파일 · 105개 검증. 작업 전후 반드시 실행
npm run check      # index.html 안의 스크립트 문법 검사
```

## 절대 바꾸면 안 되는 것 (기존 사용자 데이터 호환)

- **데이터 스키마**: Tab{id,title,nodes,edges,events,worldPrompt,refImages}, Node{id,type,name,desc,x,y}, Edge{id,from,to,label,desc,isParent}, Event{id,time,body,order}. `gid()`='i'+카운터. 런타임 전용 필드는 `_exp`, `_aiPreview`, `_chat`이며 절대 저장하지 않는다(`cleanTab` 화이트리스트).
- **타입 상수** `TL/TI/TC/TYPES` (world, group, space, char, item, trait, custom)의 키와 값.
- **localStorage 키**: `wm_tabs` = `JSON.stringify({tabs})` 형식 고정. `wm_fbcfg`(수동 Firebase 설정), `wm_theme`, `wm_edgecolor`, `wm_edgeshape`. 옛 키 `wm_k/wm_gk/wm_mh`는 더 이상 쓰지 않지만 지우지도 않는다.
- **Firebase 경로**: `worldmind/tabList[{id,title}]`, `worldmind/tabs/{tabId}/{meta{title,worldPrompt,_w}, nodes/{id}, edges/{id}, events/{id}}`. 모든 항목에 `_w`=세션 ID(`FB_SID`). 구 포맷 `worldmind/{tabs:[…]}`는 `migrateIfOld`가 자동 이전한다.
- `sanitizeTab`은 모든 로드 경로가 통과해야 한다.

## index.html 안의 지도 (주석 헤더로 검색)

| 검색어 | 내용 |
|---|---|
| `★ 배포 설정` | `API_BASE`, `FIREBASE_CONFIG` — 관리자가 채우는 두 값. 비어 있으면 AI 기능/자동 연결 비활성 |
| `§1 데이터 스키마 상수` | 상수·`sanitizeTab`·`AI_MODEL`·`IMG_MODEL` |
| `프록시 인증` | `getToken/setToken/clearToken`, `apiAuth`, `apiPost` (sessionStorage `wm_tok`) |
| `§6-3 AI JSON 파싱` | `parseAIJson` 3단 방어 (직접 파싱 → 브래킷 추출 → 복구 → 부분 수집) |
| `§2-1 localStorage` | `loadLocal/saveLocal/commit/cleanTab`, export/import |
| `§2-2 / §2-3 / §3 Firebase` | `initFB`, `migrateIfOld`, `attachTab`, `handleRemoteItem`, `fbSyncActive`(diff 전송), `pushAllToFB` |
| `캔버스 뷰포트` / `렌더 파이프라인` | 팬·줌, `renderAll = renderNodes + renderEdges` (각 1회 원칙) |
| `연결선 지오메트리` | `buildObstacles`, `edgePath`(2차 베지어), `chooseCurve`(노드 회피 굴곡 선택), `setEdgeGeom` |
| `§5-2 노드 상호작용` | 클릭 펼침, 다중 선택(`sel.nodeIds`, Ctrl/Shift+클릭·Ctrl+드래그 마퀴 — 수식키 없는 빈 캔버스 드래그는 팬), 그룹 드래그, Shift 정렬 스냅(`computeSnap`+가이드선), 3px 드래그, 0.5s 롱프레스, `_justDragged`, `cleanupFns` |
| `§5-4 노드 자동 정렬` | `computeRadialLayout`, `tweenTo` |
| `§6 AI 호출 헬퍼` | `callClaude/callGemini` → 모두 `apiPost`로 Worker 경유 |
| `§5-9 AI 노드 생성` / `§5-10 AI 추천` / `§5-8 주인공 방문` | AI 기능. 프롬프트는 `buildCtx/worldSystem` 재사용 |
| `§5-1 탭 관리` / `§5-11 편집 모드` / `테마` / `§5-13 설정` / `정적 UI 바인딩` / `main()` | 앱 셸 |

## 동작 원리 요약

- **편집 모드**: 기본 보기 전용. 🔒 → `apiAuth(code)` → Worker가 `MASTER_CODE`와 비교 → 12h HMAC 토큰 → sessionStorage. AI 호출은 토큰 필수, 401이면 토큰 삭제 + 보기 모드 복귀. 마스터 코드를 바꾸면 모든 토큰 무효.
- **동기화**: 로컬은 1.2초 주기 `saveLocal`, Firebase는 `commit()` 시 즉시 항목 단위 diff(`fbSnap` 스냅샷과 비교). `attachTab`은 스냅샷을 항상 빈 상태에서 시작해 서버 once 읽기로 채운다 — 복제 탭이 전량 push되는 이유. 수신은 `_w===FB_SID`면 무시, 50ms 디바운스 렌더.
- **설정**: 테마(`body.light` + CSS 변수), 연결선 색(`--ec` 변수, 선택/미리보기 규칙이 우선), 연결선 모양(곡선/직선). 즉시 미리보기 → 저장 시 유지, 취소 시 `onClose`로 복귀.

## 자주 걸리는 함정

- 되돌리기는 `commit()`마다 `recordUndo()`가 직전 상태를 적재하는 구조다. 새 데이터 변형 기능은 반드시 마지막에 `commit()`을 부르면 자동으로 되돌리기 대상이 된다. 되돌리기 적용(`applySnapshot`)은 탭이 바뀌면 `attachTab(id, false)`(서버로 덮지 않음)를 쓴다.
- 연결선은 노드 테두리에서 절단된다(`trimQuad`, 이분 탐색). 노드 크기·위치를 바꾸는 코드는 `renderEdges()` 또는 `updateEdgesFor()`를 다시 불러야 절단이 맞는다.
- AI 사건 생성은 노드 선택 모드(`evPick`, `#pickBanner`)로 동작한다. 선택 모드 중 노드 클릭은 펼침이 아니라 선택 토글이다.
- 최상위 `let/const/function`은 `window` 속성이 아니다. 테스트에서 상태는 `win.eval('tabs')`처럼 접근한다 (`tests/helpers.js`의 `E`).
- `hidden` 속성이 있는 요소에 CSS `display:flex`를 주면 숨김이 깨진다. 전역 규칙 `[hidden]{display:none!important}`가 있으니 유지할 것.
- `renderNodes`가 `nodesEl.innerHTML`을 비우므로 노드 레이어에 넣는 요소(관계 상세 카드 `.e-detail`)는 `renderEdges`에서 다시 만든다.
- 연결선 색은 CSS에서 `stroke:var(--ec, 기본색)` 형태라야 선택 강조(esel)·미리보기(preview) 규칙보다 뒤로 밀리지 않는다. `!important`나 id 선택자로 덮지 말 것.
- 드래그 중에는 `updateEdgesFor`만, 트윈 중에는 `updateAllEdgeGeom`만 호출한다(전체 재렌더 금지).
- Firebase 스냅샷 로직을 손댈 때는 `tests/fb.test.js`(인메모리 Firebase 스텁)로 반드시 검증.
- `worker.js`는 요청 필드를 화이트리스트로만 전달한다. 새 API 파라미터가 필요하면 Worker와 클라이언트 양쪽을 함께 수정.

## 배포

- 앱: 루트의 `index.html`을 GitHub Pages 저장소(main 브랜치)에 push → 1~2분 뒤 자동 반영.
- Worker: Cloudflare 대시보드에서 `worker/src/worker.js` 붙여넣기 → Deploy (또는 `npm run deploy:worker`). 비밀 변수는 README 참고.
- 배포 전: `npm test` 통과, `★ 배포 설정` 두 값이 채워져 있는지 확인.
