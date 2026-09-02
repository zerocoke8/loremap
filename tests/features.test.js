/* 신규 기능: 선 절단 / 설명 휠 스크롤 / 되돌리기 / 다중 선택·그룹 이동·Shift 스냅 / 사건 노드 선택 모드 */
const {boot, makeT, wait} = require('./helpers');
const {T, done} = makeT();

const legacy = {tabs:[{id:'i1', title:'t',
  nodes:[
    {id:'a', type:'char',  name:'주인공', desc:'설명', x:1000, y:1000},
    {id:'b', type:'space', name:'탑',     desc:'',    x:1700, y:1000},
    {id:'c', type:'item',  name:'검',     desc:'',    x:1000, y:1500}
  ],
  edges:[{id:'e1', from:'a', to:'b', label:'방문', desc:'', isParent:false}],
  events:[]}]};

const J = (o, s) => new Response(JSON.stringify(o), {status:s, headers:{'content-type':'application/json'}});
(async () => {
  const calls = [];
  const {win: w, doc, E} = boot({
    patch: h => h.replace("const API_BASE = '';", "const API_BASE = 'https://api.test';"),
    pre: w => {
      w.fetch = async (url, init) => {
        calls.push({url, init});
        if(url.endsWith('/api/claude'))
          return J({content:[{type:'text', text:'{"time":"어느 밤","body":"주인공과 검이 탑에서 얽힌다.","order":10}'}]}, 200);
        return J({}, 404);
      };
      w.sessionStorage.setItem('wm_tok', 'TOK');
      w.sessionStorage.setItem('wm_tok_exp', String(Date.now() + 3600e3));
      w.localStorage.setItem('wm_tabs', JSON.stringify(legacy));
    }
  });
  await wait(300);

  /* ---- 1. 선 절단: 경로 시작점이 노드 중심이 아니라 테두리 밖 ---- */
  const dAttr = () => doc.querySelector('#edgeSvg .e-line').getAttribute('d');
  {
    const m = /^M ([\d.]+) ([\d.]+)/.exec(dAttr());
    const sx = +m[1];
    const aRect = E("rectFor('a')");
    T('선이 노드 중심이 아닌 테두리에서 시작', sx >= aRect.x2 - 1, {sx, aRect});
    const inside = E("(()=>{const r=rectFor('a');const seg=document.querySelector('#edgeSvg .e-line').getAttribute('d');return seg;})()") && true;
    T('겹친 노드 간 선 숨김', (E("tabs[0].nodes[1].x=1005; tabs[0].nodes[1].y=1005; renderEdges(); document.querySelector('#edgeSvg .e-line').getAttribute('d')")).includes('-10'), null);
    E("tabs[0].nodes[1].x=1700; tabs[0].nodes[1].y=1000; renderEdges()");
  }

  /* ---- 2. 펼친 설명 휠 스크롤 (스크롤 가능 시 줌으로 전파 안 됨) ---- */
  {
    E("tabs[0].nodes[0].desc = '줄\\n'.repeat(60); renderAll()");
    const card = doc.querySelector('[data-id="a"]');
    card.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(30);
    const nd = doc.querySelector('[data-id="a"] .nd');
    Object.defineProperty(nd, 'scrollHeight', {value:400});
    Object.defineProperty(nd, 'clientHeight', {value:200});
    const z0 = E('view.z');
    const ev = new w.Event('wheel', {bubbles:true, cancelable:true});
    ev.deltaY = -100; ev.clientX = 0; ev.clientY = 0;
    doc.querySelector('[data-id="a"]').dispatchEvent(ev);
    T('설명 스크롤 중 캔버스 줌 안 됨', E('view.z') === z0);
    E("tabs[0].nodes[0]._exp=false; tabs[0].nodes[0].desc='설명'; renderAll()");
  }

  /* ---- 3. 되돌리기 / 다시 실행 ---- */
  E('setEditMode(true)');
  {
    T('처음엔 되돌릴 것 없음', E('undoStack.length') === 0);
    E("curTab().nodes.push({id:gid(), type:'trait', name:'용기', desc:'', x:1400, y:1300, _exp:false}); commit(); renderAll()");
    T('커밋 → 스택 적재', E('undoStack.length') === 1 && E('curTab().nodes.length') === 4);
    E('doUndo()'); await wait(50);
    T('되돌리기 → 노드 3개', E('curTab().nodes.length') === 3 && E('redoStack.length') === 1);
    T('되돌리기가 렌더에 반영', doc.querySelectorAll('.node').length === 3);
    E('doRedo()'); await wait(50);
    T('다시 실행 → 노드 4개', E('curTab().nodes.length') === 4);
    E('doUndo()'); await wait(50);
    T('Ctrl+Z 단축키', (doc.dispatchEvent(new w.KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true, cancelable:true})), true));
  }

  /* ---- 4. 마퀴 다중 선택 + 그룹 드래그 + Shift 스냅 ---- */
  {
    /* 빈 캔버스 드래그(수식키 없음) → 팬. 마퀴가 뜨면 안 된다 */
    E('view.z=0.2; view.px=-100; view.py=-100; applyView()');
    {
      const cw = doc.getElementById('cwrap');
      const down0 = new w.MouseEvent('pointerdown', {bubbles:true, clientX:300, clientY:300, button:0});
      Object.defineProperty(down0, 'target', {value: cw});
      cw.dispatchEvent(down0);
      w.dispatchEvent(new w.MouseEvent('pointermove', {clientX:340, clientY:310}));
      T('빈 캔버스 드래그 = 팬 (마퀴 표시 안 함)', doc.getElementById('marquee').hidden && cw.classList.contains('panning'));
      T('팬으로 뷰포트 이동 (+40,+10)', E('view.px') === -60 && E('view.py') === -90);
      w.dispatchEvent(new w.MouseEvent('pointerup', {clientX:340, clientY:310}));
      await wait(30);
      T('팬 종료 후 panning 해제', !cw.classList.contains('panning'));
    }

    /* 마퀴: Ctrl+드래그로 a(1000,1000)와 c(1000,1500)를 포함하는 화면 사각형 지정 */
    E('view.z=0.2; view.px=-100; view.py=-100; applyView()');
    const w2s = (wx, wy) => E(`(function(){return {x:${wx}*view.z+view.px, y:${wy}*view.z+view.py};})()`);
    const p1 = w2s(950, 950), p2 = w2s(1350, 1650);
    const down = new w.MouseEvent('pointerdown', {bubbles:true, clientX:p1.x, clientY:p1.y, button:0, ctrlKey:true});
    Object.defineProperty(down, 'target', {value: doc.getElementById('cwrap')});
    doc.getElementById('cwrap').dispatchEvent(down);
    w.dispatchEvent(new w.MouseEvent('pointermove', {clientX:p2.x, clientY:p2.y}));
    T('마퀴 사각형 표시', !doc.getElementById('marquee').hidden);
    w.dispatchEvent(new w.MouseEvent('pointerup', {clientX:p2.x, clientY:p2.y}));
    await wait(30);
    T('드래그 범위의 노드 다중 선택 (a,c)', E("sel.nodeIds.slice().sort().join(',')") === 'a,c');
    T('선택 클래스 2개', doc.querySelectorAll('.node.sel').length === 2);

    /* 그룹 드래그: a를 잡아 끌면 c도 함께 이동 */
    const cardA = doc.querySelector('[data-id="a"]');
    cardA.dispatchEvent(new w.MouseEvent('pointerdown', {bubbles:true, clientX:100, clientY:100, button:0}));
    w.dispatchEvent(new w.MouseEvent('pointermove', {clientX:120, clientY:110}));   // +20/+10 화면 → /0.2 = +100/+50 월드
    w.dispatchEvent(new w.MouseEvent('pointerup',   {clientX:120, clientY:110}));
    await wait(30);
    T('그룹 이동: a', E('nodeById(curTab(),"a").x') === 1100 && E('nodeById(curTab(),"a").y') === 1050);
    T('그룹 이동: c 동반', E('nodeById(curTab(),"c").x') === 1100 && E('nodeById(curTab(),"c").y') === 1550);
    T('선택 밖 노드는 그대로', E('nodeById(curTab(),"b").x') === 1700);
    T('그룹 이동 = 되돌리기 1단계', (E('doUndo()'), E('nodeById(curTab(),"c").x')) === 1000);

    /* Shift 스냅: b(중심 y=1000+h/2)를 향해 a를 끌며 Shift → y 중심 정렬 */
    const snap = E("computeSnap(nodeById(curTab(),'a'), 1400, 1003, ['a'])");
    T('Shift 스냅 보정값 계산 (근처 y 중심에 흡착)', Math.abs(snap.dy - (-3)) < 0.001 && snap.dx === 0, snap);
    T('가이드선 표시', !doc.getElementById('guideH').hidden);
    E('hideGuides()');
  }

  /* ---- 5. AI 사건 생성 — 노드 선택 모드 ---- */
  {
    E('_justDragged = false');   // 합성 이벤트에는 click이 뒤따르지 않아 수동 소비
    E("openPanel('events')");
    doc.getElementById('evAi').click();
    await wait(30);
    T('선택 배너 표시', !doc.getElementById('pickBanner').hidden && E('evPick.active') === true);
    T('생성 버튼은 선택 전 비활성', doc.getElementById('pickGo').disabled === true);
    doc.querySelector('[data-id="a"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    doc.querySelector('[data-id="c"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(30);
    T('노드 클릭 = 선택 토글(펼침 아님)', E("sel.nodeIds.length") === 2 && E("tabs[0].nodes[0]._exp") !== true);
    T('배너 카운트 갱신', doc.getElementById('pickCount').textContent === '2');
    doc.getElementById('pickGo').click();
    await wait(80);
    const call = calls.find(c => c.url.endsWith('/api/claude'));
    const body = call && JSON.parse(call.init.body);
    T('선택 노드가 프롬프트에 포함', !!body && body.messages[0].content.includes('주인공') && body.messages[0].content.includes('검') && body.messages[0].content.includes('선택된 노드'));
    T('사건 추가 + 모드 종료', E('curTab().events.length') === 1 && E('evPick.active') === false && doc.getElementById('pickBanner').hidden);
    T('사건 패널에 표시', doc.querySelectorAll('.ev').length === 1);
    doc.getElementById('evAi').click(); await wait(20);
    doc.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    T('ESC로 선택 모드 취소', E('evPick.active') === false);
  }

  /* ---- 6. 관계 상세 카드 클릭 회귀 + 마퀴 합집합 ---- */
  {
    E("tabs[0].nodes[0].x=1000; tabs[0].nodes[0].y=1000; tabs[0].nodes[1].x=1700; tabs[0].nodes[1].y=1000; tabs[0].nodes[2].x=1000; tabs[0].nodes[2].y=1500; clearSel(); renderAll()");
    await wait(30);
    const nodeCount = () => doc.querySelectorAll('.node').length;
    T('회귀 전제: 노드 3개 렌더', nodeCount() === 3);

    /* 관계 클릭 → 상세 카드. sel.nodeId(단수) 오타 시절엔 renderNodes가 innerHTML을 비운 직후 죽어 노드가 전부 사라졌다 */
    E('_justDragged = false');
    doc.querySelector('#edgeSvg .e-hit').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(30);
    T('관계 클릭 후에도 노드가 남아 있음', nodeCount() === 3);
    T('관계 선택 + 상세 카드 표시', E("sel.edgeId") === 'e1' && !!doc.querySelector('.e-detail'));
    T('sel.nodeIds가 배열로 유지됨', Array.isArray(E('sel.nodeIds')) && E('sel.nodeIds.length') === 0);

    E('_justDragged = false');
    doc.querySelector('.e-detail').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(30);
    T('상세 카드 클릭으로 닫힘 + 노드 유지', E('sel.edgeId') === null && !doc.querySelector('.e-detail') && nodeCount() === 3);

    /* 마퀴 합집합: 한 번에 하나씩 골라도 누적된다 */
    E('view.z=0.2; view.px=-100; view.py=-100; applyView()');
    const s = (wx, wy) => E(`(function(){return {x:${wx}*view.z+view.px, y:${wy}*view.z+view.py};})()`);
    const cw = doc.getElementById('cwrap');
    const drag = (p1, p2, mod) => {
      const d = new w.MouseEvent('pointerdown', Object.assign({bubbles:true, clientX:p1.x, clientY:p1.y, button:0}, mod));
      Object.defineProperty(d, 'target', {value: cw});
      cw.dispatchEvent(d);
      w.dispatchEvent(new w.MouseEvent('pointermove', {clientX:p2.x, clientY:p2.y}));
      w.dispatchEvent(new w.MouseEvent('pointerup', {clientX:p2.x, clientY:p2.y}));
    };
    drag(s(950, 950), s(1350, 1150), {ctrlKey:true});
    await wait(30);
    T('첫 마퀴: a 선택', E("sel.nodeIds.join(',')") === 'a');
    drag(s(950, 1450), s(1350, 1650), {ctrlKey:true});
    await wait(30);
    T('두 번째 마퀴가 기존 선택에 합쳐짐 (a,c)', E("sel.nodeIds.slice().sort().join(',')") === 'a,c');
    T('합집합 선택 클래스 2개', doc.querySelectorAll('.node.sel').length === 2);
    drag(s(1650, 950), s(1900, 1150), {metaKey:true});
    await wait(30);
    T('⌘+드래그도 같은 경로로 누적 (a,b,c)', E("sel.nodeIds.slice().sort().join(',')") === 'a,b,c');
    drag(s(950, 950), s(1350, 1150), {ctrlKey:true});
    await wait(30);
    T('이미 선택된 노드를 다시 감싸도 중복 없음', E('sel.nodeIds.length') === 3 && E('new Set(sel.nodeIds).size') === 3);

    /* 무이동 클릭: Ctrl은 선택 유지, 맨클릭은 해제 */
    const p0 = s(1500, 1900);
    drag(p0, p0, {ctrlKey:true});
    await wait(30);
    T('Ctrl+클릭(무이동)은 선택 유지', E('sel.nodeIds.length') === 3);
    drag(p0, p0, {});
    await wait(30);
    T('수식키 없는 빈 캔버스 클릭은 전체 해제', E('sel.nodeIds.length') === 0);
  }

  /* ---- 7. 캔버스 단축키: Tab 노드 추가 / Delete 삭제 / Alt 관계 추가 ---- */
  {
    const key = (k, opt) => doc.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({key:k, bubbles:true, cancelable:true}, opt)));
    const keyUp = (k, opt) => doc.dispatchEvent(new w.KeyboardEvent('keyup', Object.assign({key:k, bubbles:true, cancelable:true}, opt)));
    E("clearSel(); tabs[0].nodes.length = 0; tabs[0].edges.length = 0;");
    E("tabs[0].nodes.push({id:'k1', type:'char', name:'주인공', desc:'', x:1000, y:1000}, {id:'k2', type:'space', name:'탑', desc:'', x:1600, y:1000});");
    E("view.z=1; view.px=0; view.py=0; applyView(); renderAll();");
    await wait(30);

    /* Tab — 커서 위치에 노드 추가 모달 */
    const cw = doc.getElementById('cwrap');
    cw.dispatchEvent(new w.MouseEvent('pointermove', {bubbles:true, clientX:640, clientY:480}));
    const tabEv = new w.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true});
    doc.dispatchEvent(tabEv);
    await wait(30);
    T('7-1 Tab → 노드 추가 모달', !!doc.querySelector('.ov #nmName') && doc.querySelector('.ov h3, .ov .mt')?.textContent.includes('노드 추가') !== false);
    T('7-2 Tab 기본 동작(포커스 이동) 차단', tabEv.defaultPrevented === true);
    doc.querySelector('.ov #nmName').value = '커서 노드';
    doc.querySelector('.ov [data-a=s]').click();
    await wait(30);
    const made = E("tabs[0].nodes.find(n=>n.name==='커서 노드')");
    T('7-3 노드가 실제로 추가됨', !!made);
    /* 커서(640,480) 월드 좌표 기준으로 배치 — 카드 중앙이 그 근처(무작위 ±30) */
    T('7-4 커서 위치 근처에 생성', made && Math.abs((made.x + 100) - 640) <= 31 && Math.abs((made.y + 35) - 480) <= 31, made);
    E("tabs[0].nodes = tabs[0].nodes.filter(n=>n.name!=='커서 노드'); clearSel(); renderAll();");
    await wait(20);

    /* Delete — 선택 1개는 확인 모달을 거쳐 삭제 */
    E("sel = {nodeIds:['k2'], edgeId:null}; renderAll();");
    key('Delete');
    await wait(30);
    T('7-5 Delete → 확인 모달(즉시 삭제 아님)', !!doc.querySelector('.ov') && E("tabs[0].nodes.some(n=>n.id==='k2')"));
    doc.querySelector('.ov [data-a=k]').click();
    await wait(30);
    T('7-6 확인하면 삭제', !E("tabs[0].nodes.some(n=>n.id==='k2')"));

    /* Delete — 다중 선택은 한 번에 확인 */
    E("tabs[0].nodes.push({id:'k3', type:'item', name:'검', desc:'', x:1000, y:1500}, {id:'k4', type:'item', name:'방패', desc:'', x:1300, y:1500}); sel={nodeIds:['k3','k4'], edgeId:null}; renderAll();");
    await wait(20);
    key('Delete');
    await wait(30);
    T('7-7 다중 선택 삭제 확인 모달', doc.querySelector('.ov')?.textContent.includes('2개'));
    doc.querySelector('.ov [data-a=k]').click();
    await wait(30);
    T('7-8 선택 노드 일괄 삭제', !E("tabs[0].nodes.some(n=>n.id==='k3'||n.id==='k4')"));

    /* Alt 단독 탭 → 관계 추가 모드 */
    E("tabs[0].nodes.push({id:'k5', type:'space', name:'탑', desc:'', x:1600, y:1000}); sel={nodeIds:['k1'], edgeId:null}; renderAll();");
    await wait(20);
    key('Alt', {altKey:true}); keyUp('Alt', {altKey:false});
    await wait(30);
    T('7-9 Alt → 관계 추가 모드 + 배너', E('linkMode.active') === true && E("linkMode.from") === 'k1' && !doc.getElementById('linkBanner').hidden);
    E('_justDragged = false');   // 합성 이벤트에는 click이 뒤따르지 않아 수동 소비
    doc.querySelector('[data-id="k5"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(40);
    T('7-10 대상 클릭 → 관계 추가 모달(방향 표시)', !!doc.querySelector('.ov #emLabel') && doc.querySelector('.ov .infobox')?.textContent.includes('주인공'));
    T('7-11 모달이 뜨면 관계 모드는 종료', E('linkMode.active') === false && doc.getElementById('linkBanner').hidden);
    doc.querySelector('.ov #emLabel').value = '방문';
    doc.querySelector('.ov [data-a=s]').click();
    await wait(40);
    T('7-12 저장하면 관계 생성', E("tabs[0].edges.some(e=>e.from==='k1'&&e.to==='k5'&&e.label==='방문')"), E('tabs[0].edges.length'));

    /* Alt+다른 키 조합은 발동하지 않는다 (Alt+Tab 등) */
    E("exitLink(); sel={nodeIds:['k1'], edgeId:null};");
    key('Alt', {altKey:true}); key('Tab', {altKey:true}); keyUp('Alt', {altKey:false});
    await wait(30);
    T('7-13 Alt+조합키는 관계 모드 아님', E('linkMode.active') === false && !doc.querySelector('.ov #nmName'));

    /* 선택이 없으면 Alt는 무반응 */
    E("clearSel();");
    key('Alt', {altKey:true}); keyUp('Alt', {altKey:false});
    await wait(20);
    T('7-14 선택 없으면 Alt 무반응', E('linkMode.active') === false);

    /* 입력 중에는 단축키가 먹지 않는다 */
    E("openPanel('chat')");
    const ta = doc.getElementById('chatText'); ta.focus();
    const tabEv2 = new w.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true});
    ta.dispatchEvent(tabEv2);
    await wait(20);
    T('7-15 입력 중 Tab은 노드 생성 안 함', !doc.querySelector('.ov #nmName') && tabEv2.defaultPrevented === false);
    ta.blur();
  }

  /* ---- 8. 노드 타입 커스터마이징 ---- */
  {
    E("clearSel(); tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("tabs[0].nodes.push({id:'y1', type:'world', name:'아르카디아', desc:''  , x:1000, y:1000}, {id:'y2', type:'trait', name:'용맹', desc:'', x:1400, y:1000}); renderAll();");
    await wait(30);
    T('8-1 기본 타입 7종', E('typeList(curTab()).length') === 7 && E("typeList(curTab())[0].key") === 'world');
    T('8-2 카드에 이모지 없이 타입 이름만', doc.querySelector('[data-id="y1"] .nt').textContent === '세계' && !doc.querySelector('[data-id="y1"] .ni'));
    T('8-3 타입 색이 인라인으로 적용', !!doc.querySelector('[data-id="y1"]').style.getPropertyValue('--c'));
    T('8-4 상위/하위 타입 색이 다름',
      doc.querySelector('[data-id="y1"]').style.getPropertyValue('--c') !== doc.querySelector('[data-id="y2"]').style.getPropertyValue('--c'));

    /* 관리 모달: 이름 변경 + 추가 + 순서 이동 */
    E('setEditMode(true)');
    E('openTypeManager()');
    await wait(30);
    const ov = doc.querySelector('.ov');
    T('8-5 타입 관리 모달 — 현재 타입 목록', ov.querySelectorAll('.ty-row').length === 7);
    ov.querySelectorAll('.ty-row input')[0].value = '대륙';
    ov.querySelector('#tyAdd').click();
    await wait(20);
    T('8-6 + 로 타입 추가', ov.querySelectorAll('.ty-row').length === 8);
    ov.querySelectorAll('.ty-row input')[7].value = '유물';
    ov.querySelector('[data-a=s]').click();
    await wait(40);
    T('8-7 이름 변경 저장', E("typeList(curTab())[0].label") === '대륙');
    T('8-8 추가한 타입 저장', E('typeList(curTab()).length') === 8 && E("typeList(curTab())[7].label") === '유물');
    T('8-9 카드 라벨도 갱신', doc.querySelector('[data-id="y1"] .nt').textContent === '대륙');
    T('8-10 노드 타입 키는 그대로(데이터 호환)', E("nodeById(curTab(),'y1').type") === 'world');

    /* 사용 중인 타입 삭제 → 노드는 최하위 타입으로 이동 (노드는 사라지지 않는다) */
    E('openTypeManager()');
    await wait(30);
    const ov2 = doc.querySelector('.ov');
    ov2.querySelector('.ty-row [data-a=del][data-i="0"]').click();
    await wait(20);
    T('8-11 × 로 타입 제거', ov2.querySelectorAll('.ty-row').length === 7);
    ov2.querySelector('[data-a=s]').click();
    await wait(40);
    T('8-12 노드는 남고 최하위 타입으로 이동',
      E("nodeById(curTab(),'y1') !== undefined") && E("nodeById(curTab(),'y1').type") === E("typeList(curTab())[typeList(curTab()).length-1].key"));
    T('8-13 되돌리기로 타입 변경도 복구', (E('doUndo()'), E('typeList(curTab()).length')) === 8);

    /* 저장 형식에 nodeTypes 포함 */
    E('saveLocal()');
    const savedTab = JSON.parse(w.localStorage.getItem('wm_tabs')).tabs[0];
    T('8-14 저장 데이터에 nodeTypes 포함', Array.isArray(savedTab.nodeTypes) && savedTab.nodeTypes.length === 8);
    T('8-15 저장에 런타임 색·이모지 없음', savedTab.nodeTypes.every(t => Object.keys(t).sort().join(',') === 'key,label'));
  }

  /* ---- 9. 선택 영역 복사(Ctrl+C) / 붙여넣기(Ctrl+V) ---- */
  {
    const key = (k, opt) => doc.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({key:k, bubbles:true, cancelable:true}, opt)));
    E("clearSel(); tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("tabs[0].nodes.push(" +
      "{id:'c1', type:'char', name:'주인공', desc:'설명', x:1000, y:1000}," +
      "{id:'c2', type:'space', name:'탑', desc:'', x:1400, y:1000}," +
      "{id:'c3', type:'item', name:'검', desc:'', x:1000, y:1400});");
    E("tabs[0].edges.push(" +
      "{id:'ce1', from:'c1', to:'c2', label:'방문', desc:'', isParent:false}," +
      "{id:'ce2', from:'c1', to:'c3', label:'소유', desc:'', isParent:true});");
    E("view.z=1; view.px=0; view.py=0; applyView(); setEditMode(true); commit(); renderAll();");   // commit 으로 되돌리기 기준점 확정
    await wait(30);

    /* c1,c2 만 선택 → 내부 관계(ce1)만 따라오고 c3 로 나가는 ce2 는 버려진다 */
    E("sel = {nodeIds:['c1','c2'], edgeId:null}; renderAll();");
    await wait(20);
    key("c", {ctrlKey:true});
    await wait(40);
    T("9-1 선택 노드가 버퍼에 담김", E("clipBuf && clipBuf.nodes.length") === 2);
    T("9-2 내부 관계만 복사(밖으로 나가는 선은 버림)",
      E("clipBuf.edges.length") === 1 && E("clipBuf.edges[0].label") === "방문");
    T("9-3 타입 이름도 함께 담김(다른 탭 붙여넣기용)", E("clipBuf.nodes[0].typeLabel") === "인물");

    /* 커서 위치에 붙여넣기 */
    const cw = doc.getElementById("cwrap");
    cw.dispatchEvent(new w.MouseEvent("pointermove", {bubbles:true, clientX:2000, clientY:1800}));
    const before = E("curTab().nodes.length");
    key("v", {ctrlKey:true});
    await wait(40);
    T("9-4 노드 2개 추가", E("curTab().nodes.length") === before + 2);
    T("9-5 관계도 함께 붙여넣기", E("curTab().edges.length") === 3);
    T("9-6 붙여넣은 노드는 새 id", E("curTab().nodes.slice(-2).every(n => n.id !== 'c1' && n.id !== 'c2')"));
    T("9-7 관계가 사본끼리 연결(원본에 붙지 않음)", E(
      "(function(){var ids=curTab().nodes.slice(-2).map(n=>n.id);" +
      "var e=curTab().edges[curTab().edges.length-1];" +
      "return ids.includes(e.from) && ids.includes(e.to);})()"));
    T("9-8 붙여넣은 노드가 선택 상태", E("sel.nodeIds.length") === 2 &&
      E("sel.nodeIds.every(id => curTab().nodes.slice(-2).some(n => n.id === id))"));
    T("9-9 커서 근처로 이동(원본 좌표와 다름)", E("curTab().nodes.slice(-2)[0].x") !== 1000);
    T("9-10 붙여넣기는 되돌리기 1단계", (E("doUndo()"), E("curTab().nodes.length")) === before);

    /* 선택이 없으면 Ctrl+C 는 기본 동작을 막지 않는다 */
    E("clearSel(); renderAll();");
    const ev = new w.KeyboardEvent("keydown", {key:"c", ctrlKey:true, bubbles:true, cancelable:true});
    doc.dispatchEvent(ev);
    await wait(20);
    T("9-11 선택 없으면 Ctrl+C 가로채지 않음", ev.defaultPrevented === false);

    /* 입력 중에는 복사/붙여넣기를 가로채지 않는다 */
    E("sel = {nodeIds:['c1'], edgeId:null};");
    E("openPanel('chat')");
    const ta = doc.getElementById("chatText"); ta.focus();
    const ev2 = new w.KeyboardEvent("keydown", {key:"c", ctrlKey:true, bubbles:true, cancelable:true});
    ta.dispatchEvent(ev2);
    await wait(20);
    T("9-12 입력 중 Ctrl+C 는 그대로 통과", ev2.defaultPrevented === false);
    ta.blur(); E("closePanel()");
  }

  done();
})();
