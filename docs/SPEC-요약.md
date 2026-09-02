# WorldMind 스펙 요약

> 원본 `WorldMind-스펙.md`의 핵심 제약을 요약한 문서입니다. 원본 파일이 있으면 이 폴더에 함께 두세요.
> 본 프로젝트는 원본 스펙 §0~§10을 기준으로 재구축되었고, 이후 요청으로 기능이 추가되었습니다(맨 아래 "추가된 기능").

## §0 기본
- 단일 HTML(`site/index.html`), Vanilla JS, CDN은 Google Fonts(Cinzel·Noto Sans KR)와 Firebase compat 10.12.2만.
- 연결선은 SVG. 한국어 UI.

## §1 데이터 스키마 (변경 금지)
- `tabs[]` + `activeTabId`. Tab `{id, title, nodes, edges, events, worldPrompt, refImages(base64 최대 3, 로컬 전용)}`
- Node `{id, type, name, desc, x, y, _exp(런타임), _aiPreview(런타임)}` — type: world|group|space|char|item|trait|custom
- Edge `{id, from, to, label, desc, isParent}` (isParent: from=부모 → to=자식), Event `{id, time, body, order}`
- `gid()='i'+(idC++)`, `idC=Date.now()`. `TL/TI/TC` 상수 고정. `sanitizeTab` 필수 통과.

## §2 저장소 (키·경로 변경 금지)
- localStorage `wm_tabs = JSON.stringify({tabs})`, `wm_fbcfg`(Firebase 설정 원문). (`wm_k/wm_gk/wm_mh`는 프록시 전환 후 미사용)
- Firebase `worldmind/tabList[{id,title}]`, `worldmind/tabs/{tabId}/{meta{title,worldPrompt,_w}, nodes/{id}{…,_w}, edges/{id}{…,_w}, events/{id}{…,_w}}`
- `_w` = 세션 ID `FB_SID='s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)` (자기 쓰기 에코 무시)
- §2-3 구 포맷 `worldmind/{tabs:[…]}`는 초기화 시 손실 없이 항목별 경로로 마이그레이션.

## §3 실시간 동기화
- 전체 덮어쓰기 금지, 변경 항목만 diff `set()`. `child_added/changed/removed` 리스너. `_w===FB_SID` 무시.
- 탭 전환 시 리스너 해제/재부착. tabList value 리스너. 원격 수신 50ms 디바운스 렌더.
- 상태 칩: 실시간 동기화 / 연결 중… / 연결 오류 / 오프라인.
- Firebase 설정 파서: 순수 JSON / JS 객체 리터럴 / `const firebaseConfig = {…};` 3형식.

## §4 레이아웃
탭바 / 탑바(＋노드 ✨AI노드 🔀정렬 [상태] 🔒 🌐 💬 📜 ⚙ 💾 📂) / 4000×4000 캔버스 팬·줌(0.15~3) / 우측 패널 320px.

## §5 기능
- 탭 추가·복제(딥카피+ID 재발급+엣지 리맵, 제목 `복사_원본`)·삭제(마지막 탭 불가).
- 노드: 클릭 펼침+선택(드래그 후 클릭 억제), 3px 드래그, 우클릭/0.5초 롱프레스 메뉴(10px 이동 시 취소, 발동 시 드래그 강제 해제).
  메뉴: 노드 편집 / 관계 추가 / 주인공 방문 / 현재 노드 추천 / 하위 노드 AI 추천 / 삭제(자식 처리 선택).
- 엣지: 부모=실선, 일반=점선, CJK 줄바꿈 라벨, 관계 추가=배너 → 대상 클릭, ESC 취소.
- 🔀 정렬: 부모-자식만 사용하는 방사형 트리(리프 가중 각도, 다중 트리 분할, 고립 노드 최외곽, 반발 최소 220px), 확인 모달 → 0.5s 애니 → 줌핏. 편집 모드 전용.
- 🌐 세계관 설정 + 참고 이미지 3장. 💬 멀티턴 대화(시스템에 설정+노드+관계 주입). 📜 사건(order 정렬, AI 생성 1개).
- 🧭 주인공 방문: 2~3문단, 타입별(방문/대화/획득/체험), 연결 노드 등장, 다시 추천/이미지 생성/사건 저장.
- ✨ AI 노드 생성: 프롬프트 → 로딩 오버레이 → 굵은 글씨+펄스 미리보기 → 우하단 패널(추가/다시 생성/닫기). 모든 주요 명사 노드화, 기존 노드 이름 매칭 연결.
- AI 추천 3종(노드/하위/관계): 카드 3개 + ↻.
- 편집 모드: 기본 보기 전용, 마스터 코드로 해제(현재는 Worker 검증), 모드 전환 시 노드 재렌더.
- 💾 `worldmind-export.json` 다운로드 / 📂 로드(확인 모달·개수 미리보기·덮어쓰기 경고 → 전체 교체 + Firebase 동기화 + 줌핏).

## §6 AI
- 텍스트: Anthropic Messages API, 모델 상수 `AI_MODEL='claude-opus-4-6'` 한 곳 관리. (현재 Worker 프록시 경유)
- 이미지: Gemini `IMG_MODEL='gemini-3.1-flash-image-preview'`, `generationConfig.responseModalities:['IMAGE','TEXT']`.
- §6-3 JSON 3단 방어: ①브래킷 카운팅 추출(문자열/이스케이프 인식) ②`JSON.parse` 직접 시도 우선 ③부분 복구(배열 내 개별 객체).
- §6-4 주인공 방문·사건 생성은 기존 노드 이름만 사용(시스템+유저 프롬프트 양쪽에 이름 목록 제약). 컨텍스트 빌더 재사용.

## §7 디자인
CSS 변수 토큰(`--bg:#0a0b0f` 등 + 타입별 `--c-*`, `--c-*-bg`), Cinzel(제목)/Noto Sans KR(본문), 다크 판타지 반투명+블러+절제된 글로우.

## §8 성능
① document/window 리스너 누수 금지(클린업 배열) ② 렌더 사이클당 연결선 1회 ③ 원격 50ms 디바운스 ④ 자동 저장은 localStorage만 주기 실행, Firebase는 변경 시 즉시 diff.

## §9 UX
토스트(하단 중앙 3초), 확인 모달, 줌 +/−/⤢, 휠 줌 커서 기준, ESC 관계 취소.

---

## 추가된 기능 (스펙 이후 요청)
- 관계(선/라벨) 클릭 시 상세 카드 토글, ESC/배경 클릭으로 닫기.
- 설정: 테마(다크/라이트 베이지), 연결선 색(단색/상위 노드 타입 색), 연결선 모양(곡선/직선). 즉시 미리보기·저장·취소 복귀.
- 노드 카드 2줄 구조(아이콘+타입 / 이름).
- 곡선 연결선: 다른 노드를 완만히 피하는 2차 베지어(`chooseCurve`).
- 📂 로드 버튼 상시 표시(보기 모드는 안내만).
- API 키·마스터 코드를 Cloudflare Worker로 이전(프록시). 사용자는 마스터 코드만 입력. Firebase 설정은 파일에 내장.
- 연결선을 노드 테두리에서 절단(반투명 카드 뒤 비침 제거), 겹친 노드 간 선 숨김.
- 펼친 설명 위 휠 = 내용 스크롤.
- ↩ 되돌리기/다시 실행 (Ctrl+Z / Ctrl+Shift+Z, 커밋 단위 30단계, Firebase에도 반영).
- 다중 선택: 빈 캔버스 Ctrl(⌘)+드래그(마퀴)·Ctrl/Shift+클릭, 묶음 드래그 이동, Shift 드래그 시 이웃 중심선 스냅+가이드선. 팬은 빈 캔버스 드래그(수식키 없음)/Space+드래그/휠클릭/터치.
- AI 사건 생성: 노드 선택 모드 — 고른 노드들이 주역/배경이 되는 사건을 생성.
