# WorldMind — Claude Code 작업 가이드

AI 기반 창작 세계관 마인드맵 웹앱. 사용자는 GitHub Pages 주소를 열고 🔒 버튼에 마스터 코드를 넣으면 편집·AI 기능을 쓴다.
UI·주석·커밋 메시지는 **한국어**. 프레임워크 없이 Vanilla JS.

## 구조

```
index.html             앱 전체 (HTML+CSS+JS 단일 파일, 약 3,000줄) — 저장소 루트 = GitHub Pages 공개 대상
worker/src/worker.js   Cloudflare Worker: 마스터 코드 검증, 토큰 발급, Anthropic/Gemini 프록시
worker/wrangler.toml   CLI 배포용 (대시보드 붙여넣기 배포면 불필요)
tests/                 jsdom 기반 통합 테스트 + Worker 단위 테스트  →  npm test
tests/check-syntax.js  index.html 안 <script> 문법 검사  →  npm run check (CRLF·cmd.exe 안전)
.gitignore/.gitattributes  node_modules 커밋 사고 방지 · 줄바꿈은 저장소에 LF 로 통일
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

- **데이터 스키마**: Tab{id,title,nodes,edges,events,worldPrompt,nodeTypes,refImages}, Node{id,type,name,desc,x,y}, Edge{id,from,to,label,desc,isParent}, Event{id,time,body,order}. `gid()`='i'+카운터. 런타임 전용 필드는 `_exp`, `_aiPreview`, `_chat`이며 절대 저장하지 않는다(`cleanTab` 화이트리스트).
- **노드 타입은 탭 데이터**다(`Tab.nodeTypes = [{key,label}]`, 배열 순서 = 상하위 단계, 색은 순서대로 자동 배정, 이모지 없음). 옛 상수 `TL/TI/TC/TYPES`는 없어졌고 `DEFAULT_TYPES`/`typeList/typeLabel/typeColors/typeKeyOr`가 대신한다. **`key`는 `node.type`에 저장되는 값이라 절대 바꾸지 않는다**(label만 변경). 기본 7종의 key(world…custom)는 기존 사용자 데이터 호환을 위해 유지한다.
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
| `§5-2 노드 상호작용` | 클릭 펼침, 다중 선택(`sel.nodeIds`, Ctrl/Shift+클릭·Ctrl+드래그 마퀴 — 기존 선택에 합집합 누적, 수식키 없는 빈 캔버스 드래그는 팬), 그룹 드래그, Shift 정렬 스냅(`computeSnap`+가이드선), 3px 드래그, 0.5s 롱프레스, `_justDragged`, `cleanupFns` |
| `§5-2 캔버스 단축키` | Tab(`pointerWorld`로 커서 위치 노드 추가) · Delete(`askDeleteSelection`) · Alt 단독 탭(`altSolo`→`startLink`). `shortcutBusy()`가 모달·배너·컨텍스트 메뉴 중 차단 |
| `§5-14 노드 타입 관리` | `openTypeManager`(탭별 타입 추가·이름변경·순서·삭제). 삭제된 타입의 노드는 최하위 타입으로 이동 |
| `§5-16 노드 가져오기` | `openImportModal`/`runImport`/`applyImportResult`. `parseDrawio`(mxCell 파싱+압축 해제), `layoutImported`+`freeOrigin`(추가분만 배치 — 기존 좌표 불변) |
| `§5-15 선택 영역 복사` | `copySelection`/`pasteClip`(내부 버퍼 `clipBuf`), `copySelectionImage`(캔버스에 직접 그려 투명 PNG). 연결선은 화면 SVG 의 `d`(M x y Q …)를 그대로 재현한다 |
| `§5-4 노드 자동 정렬` | `computeRadialLayout`, `tweenTo` |
| `§6 AI 호출 헬퍼` | `callClaude/callGemini` → 모두 `apiPost`로 Worker 경유 |
| `§5-9 AI 노드 생성` / `§5-10 AI 추천` / `§5-8 주인공 방문` | AI 기능. 프롬프트는 `buildCtx/worldSystem` 재사용 |
| `§5-1 탭 관리` / `§5-11 편집 모드` / `테마` / `§5-13 설정` / `정적 UI 바인딩` / `main()` | 앱 셸 |

## 동작 원리 요약

- **편집 모드**: 기본 보기 전용. 🔒 → `apiAuth(code)` → Worker가 `MASTER_CODE`와 비교 → 12h HMAC 토큰 → sessionStorage. AI 호출은 토큰 필수, 401이면 토큰 삭제 + 보기 모드 복귀. 마스터 코드를 바꾸면 모든 토큰 무효.
- **동기화**: 로컬은 1.2초 주기 `saveLocal`, Firebase는 `commit()` 시 즉시 항목 단위 diff(`fbSnap` 스냅샷과 비교). `attachTab`은 스냅샷을 항상 빈 상태에서 시작해 서버 once 읽기로 채운다 — 복제 탭이 전량 push되는 이유. 수신은 `_w===FB_SID`면 무시, 50ms 디바운스 렌더. `fbSyncActive`는 **편집 모드에서만** 쓴다(보기 전용은 읽기·실시간 수신만). 쓰기가 실패하면 `fbWriteFail`이 `fbSnap` 항목을 롤백해 다음 `commit()`에서 재시도하고 상태 칩을 '저장 실패'로 바꾼다.
- **설정**: 테마(`body.light` + CSS 변수), 연결선 색(`--ec` 변수, 선택/미리보기 규칙이 우선), 연결선 모양(곡선/직선). 즉시 미리보기 → 저장 시 유지, 취소 시 `onClose`로 복귀.

## 자주 걸리는 함정

- 되돌리기는 `commit()`마다 `recordUndo()`가 적재한다(새 데이터 변형 기능은 마지막에 `commit()`만 부르면 된다). **스택이 둘로 나뉘어 있다** — 탭 내용은 탭별 `undoMap/redoMap`(활성 탭만 되돌린다), 탭 집합 변화(추가·복제·삭제·가져오기)는 전역 `undoStack/redoStack`. 두 스택 항목에 붙은 전역 순번 `seq`를 비교해 **시간 역순**으로 소비한다.
- 되돌리기 적용은 `applyTabSnapshot`(활성 탭 하나만 교체 — 탭이 바뀌지 않는다)과 `applyStruct`(탭 집합만 맞추고 살아남은 탭 객체는 그대로 재사용)로 갈라진다. `applyStruct`는 현재 탭이 살아 있으면 그 탭에 머물고, 탭이 되살아나거나 사라진 복원이라 `pushAllToFB()` 후 `attachTab(id,false)`로 서버를 맞춘다. 가져오기처럼 tabs 전체가 교체되는 변경만 `recordFullUndo()`로 내용까지 되돌린다.
- 탭이 사라지는 경로(`askDeleteTab`, `applyRemoteTabList`)에서는 `dropTabUndo(id)`로 그 탭의 히스토리를 함께 버릴 것. 안 그러면 죽은 키가 세션 내내 남는다.
- 연결선은 노드 테두리에서 절단된다(`trimQuad`, 이분 탐색). 노드 크기·위치를 바꾸는 코드는 `renderEdges()` 또는 `updateEdgesFor()`를 다시 불러야 절단이 맞는다.
- AI 사건 생성은 노드 선택 모드(`evPick`, `#pickBanner`)로 동작한다. 선택 모드 중 노드 클릭은 펼침이 아니라 선택 토글이다.
- `sel`은 항상 `{nodeIds:배열, edgeId}` 형태여야 한다. `nodeId`(단수)로 잘못 쓰면 `isSel`이 `undefined.includes`로 죽고, `renderNodes`는 `nodesEl.innerHTML=''` 직후 예외로 중단되어 **노드가 화면에서 전부 사라진다**(새로고침 전까지). 선택 해제는 `clearSel()`을 쓸 것.
- 최상위 `let/const/function`은 `window` 속성이 아니다. 테스트에서 상태는 `win.eval('tabs')`처럼 접근한다 (`tests/helpers.js`의 `E`).
- `hidden` 속성이 있는 요소에 CSS `display:flex`를 주면 숨김이 깨진다. 전역 규칙 `[hidden]{display:none!important}`가 있으니 유지할 것.
- `renderNodes`가 `nodesEl.innerHTML`을 비우므로 노드 레이어에 넣는 요소(관계 상세 카드 `.e-detail`)는 `renderEdges`에서 다시 만든다.
- 연결선 색은 CSS에서 `stroke:var(--ec, 기본색)` 형태라야 선택 강조(esel)·미리보기(preview) 규칙보다 뒤로 밀리지 않는다. `!important`나 id 선택자로 덮지 말 것.
- 드래그 중에는 `updateEdgesFor`만, 트윈 중에는 `updateAllEdgeGeom`만 호출한다(전체 재렌더 금지).
- **정렬 애니메이션은 데이터를 건드리지 않는다.** `tweenTo`는 최종 좌표를 즉시 `commit()`으로 확정하고, 0.5초 동안은 표시 전용 좌표 `tweenPos`만 움직인다. 좌표를 읽는 쪽은 `dispOf(n)`을 거쳐야 화면과 어긋나지 않는다(`renderNodes`·`centerOf`·`rectFor`·`buildObstacles`·`zoomFit`). 데이터 좌표가 필요한 쪽(드래그 시작·마퀴 히트·Ctrl+C 복사)은 먼저 `endTweenNow()`로 확정할 것.
- 애니메이션을 중단시키는 경로에는 `cancelTween()`이 반드시 있어야 한다(`applyTabSnapshot`·`applyStruct`·`switchTab`·`askAutoLayout`). 빠뜨리면 좀비 프레임이 DOM 을 덮어써 **데이터는 되돌아갔는데 화면만 정렬된 채** 남는다.
- 🔀 정렬은 계산 전에 `_exp`를 모두 끄고 `renderAll()`로 크기를 다시 잰다. `nodeSizes`가 펼침 상태의 실측값이라, 펼친 카드가 섞이면 중심 환산이 틀어져 배치가 어긋난다.
- Firebase 스냅샷 로직을 손댈 때는 `tests/fb.test.js`(인메모리 Firebase 스텁)로 반드시 검증.
- Firebase 쓰기에 `.catch(()=>{})`를 쓰지 말 것. 실패가 조용히 묻히면 화면은 멀쩡한데 변경은 로컬에만 갇힌다(규칙·권한 문제에서 실제로 발생). `.then(fbWriteOk, err => fbWriteFail(err, 스냅샷롤백))` 형태를 쓸 것 — 롤백을 빠뜨리면 `fbSnap`이 "서버에 있다"고 착각해 영영 재전송하지 않는다.
- 탭 삭제·전면 교체는 `tabs/{id}` 제거와 `tabList` 갱신을 **한 번의 `fbRoot.update()`로 묶는다**(RTDB 다중 경로 update는 원자적). 두 번의 쓰기로 쪼개면 하나만 성공했을 때 목록에만 남은 고아가 되어 다음 로드에서 **내용 없는 빈 탭**으로 되살아난다.
- 목록에는 있는데 `tabs/{id}`가 없는 탭을 곧바로 지우면 안 된다. 다른 기기가 방금 만들어 내용이 아직 안 올라온 정상 케이스와 구분되지 않는다. `watchTabUntilFilled`로 지켜보다 채우고, 삭제는 `sweepOrphanTabs`가 유예(`ORPHAN_GRACE_MS`) 후 재확인한 뒤 **편집 모드에서만** 한다. 보기 모드에서 로컬만 줄이면 다음 `fbSyncActive`가 그 축소된 목록을 서버에 밀어넣어 남의 탭을 지운다.
- 타입 색은 CSS 클래스가 아니라 `renderNodes`가 노드마다 인라인 `--c`/`--c-bg`로 넣는다. 테마를 바꾸면 색을 다시 계산해야 하므로 `applyTheme`이 `renderAll()`을 부른다.
- Firebase meta 스냅샷 키는 반드시 `metaKey()`(=`metaFB` 직렬화)를 쓸 것. 필드가 하나라도 어긋나면 meta 를 무한 재전송한다.
- `worker.js`는 요청 필드를 화이트리스트로만 전달한다. 새 API 파라미터가 필요하면 Worker와 클라이언트 양쪽을 함께 수정.

## 배포

- 앱: 루트의 `index.html`을 GitHub Pages 저장소(main 브랜치)에 push → 1~2분 뒤 자동 반영.
- Worker: Cloudflare 대시보드에서 `worker/src/worker.js` 붙여넣기 → Deploy (또는 `npm run deploy:worker`). 비밀 변수는 README 참고.
- 배포 전: `npm test` 통과, `★ 배포 설정` 두 값이 채워져 있는지 확인.
