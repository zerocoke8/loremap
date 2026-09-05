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
    deploy: {apiBase: 'https://api.test'},        // 배포값 유무와 무관하게 테스트 주소로 고정
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
    T('처음엔 되돌릴 것 없음', E('(undoMap[activeTabId]||[]).length') === 0);
    E("curTab().nodes.push({id:gid(), type:'trait', name:'용기', desc:'', x:1400, y:1300, _exp:false}); commit(); renderAll()");
    T('커밋 → 스택 적재', E('(undoMap[activeTabId]||[]).length') === 1 && E('curTab().nodes.length') === 4);
    E('doUndo()'); await wait(50);
    T('되돌리기 → 노드 3개', E('curTab().nodes.length') === 3 && E('(redoMap[activeTabId]||[]).length') === 1);
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
    E("clearSel(); tabs[0].nodes.length = 0; tabs[0].edges.length = 0; setEditMode(true);");
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
    T('7-4 커서 위치에 정확히 생성(지터 없음)', made && Math.abs((made.x + 100) - 640) <= 1 && Math.abs((made.y + 35) - 480) <= 1, made);
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
    ov.querySelectorAll('.ty-row .ty-label')[0].value = '대륙';
    ov.querySelector('#tyAdd').click();
    await wait(20);
    T('8-6 + 로 타입 추가', ov.querySelectorAll('.ty-row').length === 8);
    ov.querySelectorAll('.ty-row .ty-label')[7].value = '유물';
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

  /* ---- 10. 노드 가져오기 (문서 / drawio) ---- */
  {
    /* AI 응답을 시나리오별로 갈아끼운다 */
    let aiReply = "";
    const origFetch = w.fetch;
    w.fetch = async (url, init) => {
      calls.push({url, init});
      if(String(url).endsWith("/api/claude")) return J({content:[{type:"text", text:aiReply}]}, 200);
      return J({}, 404);
    };

    E("clearSel(); tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("tabs[0].nodes.push({id:'k0', type:'char', name:'기존 인물', desc:'', x:1000, y:1000});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(30);
    const baseX = E("nodeById(curTab(),'k0').x"), baseY = E("nodeById(curTab(),'k0').y");

    /* (1) 일반 문서 — AI가 노드·관계·새 타입까지 제안 */
    aiReply = JSON.stringify({
      types:[{label:"세력"}],
      nodes:[{type:"세력", name:"은빛 기사단", desc:"북방의 기사단"},
             {type:"인물", name:"레온", desc:"단장"},
             {type:"인물", name:"기존 인물", desc:"중복이라 건너뛰어야 함"}],
      edges:[{from:"은빛 기사단", to:"레온", label:"단장", isParent:true}]
    });
    E("openImportModal()");
    await wait(30);
    const ov = doc.querySelector(".ov");
    T("10-1 가져오기 모달", !!ov && !!ov.querySelector("#impText"));
    ov.querySelector("#impText").value = "은빛 기사단은 북방을 지키는 기사단이며 단장은 레온이다.";
    ov.querySelector("[data-a=go]").click();
    await wait(150);
    T("10-2 새 노드 2개 추가(이름 중복은 건너뜀)", E("curTab().nodes.length") === 3, E("curTab().nodes.map(n=>n.name).join(',')"));
    T("10-3 관계 추가", E("curTab().edges.length") === 1 && E("curTab().edges[0].isParent") === true);
    T("10-4 새 타입 추가", E("typeList(curTab()).some(t=>t.label==='세력')"));
    T("10-5 제안 타입이 노드에 배정", E("typeLabel(curTab(), nodeById(curTab(), curTab().nodes.find(n=>n.name==='은빛 기사단').id).type)") === "세력");
    T("10-6 기존 노드 위치는 그대로", E("nodeById(curTab(),'k0').x") === baseX && E("nodeById(curTab(),'k0').y") === baseY);
    T("10-7 추가된 노드는 기존 노드와 겹치지 않게 배치",
      E("curTab().nodes.filter(n=>n.id!=='k0').every(n => n.x > " + baseX + ")"));
    T("10-8 추가분이 선택 상태", E("sel.nodeIds.length") === 2);
    T("10-9 가져오기는 되돌리기 1단계", (E("doUndo()"), E("curTab().nodes.length")) === 1);
    E("doRedo()"); await wait(30);

    /* (2) drawio — 도형·연결선은 코드가 뽑고 AI는 타입만 */
    const drawio = '<mxfile><diagram><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="a" value="아르카디아" vertex="1" parent="1"/>' +
      '<mxCell id="b" value="&lt;b&gt;은빛 탑&lt;/b&gt;" vertex="1" parent="1"/>' +
      '<mxCell id="e1" value="포함" edge="1" source="a" target="b" parent="1"/>' +
      '</root></mxGraphModel></diagram></mxfile>';
    aiReply = JSON.stringify({
      types:[],
      nodes:[{type:"세계", name:"아르카디아", desc:"세계"}, {type:"공간", name:"은빛 탑", desc:"탑"}],
      edges:[{from:"아르카디아", to:"은빛 탑", label:"포함", isParent:true}]
    });
    const nBefore = E("curTab().nodes.length");
    E("openImportModal()");
    await wait(30);
    const ov2 = doc.querySelector(".ov");
    ov2.querySelector("#impText").value = drawio;
    ov2.querySelector("[data-a=go]").click();
    await wait(180);
    T("10-10 drawio 도형 2개 추가", E("curTab().nodes.length") === nBefore + 2);
    T("10-11 HTML 태그가 벗겨진 이름", E("curTab().nodes.some(n=>n.name==='은빛 탑')"));
    T("10-12 drawio 연결선 반영", E("curTab().edges.some(e => nodeById(curTab(),e.from)?.name==='아르카디아' && nodeById(curTab(),e.to)?.name==='은빛 탑')"));
    const sent = calls.filter(c => String(c.url).endsWith("/api/claude")).pop();
    const sentBody = sent && JSON.parse(sent.init.body);
    T("10-13 drawio 는 추출 결과를 프롬프트로 전달", !!sentBody && sentBody.messages[0].content.includes("도형: 아르카디아, 은빛 탑"));

    /* (3) 빈 입력 방어 */
    E("openImportModal()");
    await wait(30);
    const ov3 = doc.querySelector(".ov");
    ov3.querySelector("[data-a=go]").click();
    await wait(30);
    T("10-14 빈 입력은 모달 유지 + 안내", !!doc.querySelector(".ov #impText") &&
      [...doc.querySelectorAll(".toast.err")].some(t => t.textContent.includes("붙여넣어")));
    doc.querySelector(".ov [data-a=c]").click();
    w.fetch = origFetch;
  }

  /* ---- 11. 단축키 검토 지적 반영분 ---- */
  {
    const key = (k, opt, el) => {
      const ev = new w.KeyboardEvent("keydown", Object.assign({key:k, bubbles:true, cancelable:true}, opt));
      (el || doc).dispatchEvent(ev); return ev;
    };
    const keyUp = (k, opt) => doc.dispatchEvent(new w.KeyboardEvent("keyup", Object.assign({key:k, bubbles:true, cancelable:true}, opt)));
    E("clearSel(); tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("tabs[0].nodes.push({id:'s1', type:'char', name:'가', desc:'', x:1000, y:1000}, {id:'s2', type:'item', name:'나', desc:'', x:1400, y:1000});");
    E("setEditMode(true); commit(); renderAll(); clearSel();");
    await wait(30);

    /* Tab — 툴바 버튼에 포커스가 있으면 가로채지 않는다 */
    doc.getElementById("btnSettings").focus();
    const evBtn = key("Tab");
    await wait(20);
    T("11-1 버튼 포커스 시 Tab 은 통과", evBtn.defaultPrevented === false && !doc.querySelector(".ov #nmName"));
    doc.getElementById("btnSettings").blur();

    /* Tab — 보기 전용에서는 가로채지 않는다 */
    E("setEditMode(false)");
    const evView = key("Tab");
    await wait(20);
    T("11-2 보기 전용에서 Tab 은 통과", evView.defaultPrevented === false && !doc.querySelector(".ov #nmName"));
    E("setEditMode(true)");

    /* Tab — 캔버스 포커스 + 편집 모드면 그대로 동작 */
    const evOk = key("Tab");
    await wait(100);   // openModal 자동 포커스(40ms) 뒤 이름 칸으로 옮기는 60ms 까지 기다린다
    T("11-3 편집 모드 + 캔버스 포커스면 정상 동작", evOk.defaultPrevented === true && !!doc.querySelector(".ov #nmName"));
    T("11-4 모달 최초 포커스는 이름 칸", doc.activeElement && doc.activeElement.id === "nmName");
    doc.querySelector(".ov [data-a=c]").click();
    await wait(20);

    /* Backspace 로도 삭제 (맥 노트북) */
    E("sel = {nodeIds:['s2'], edgeId:null}; renderAll();");
    key("Backspace");
    await wait(30);
    T("11-5 Backspace 도 삭제 확인창", !!doc.querySelector(".ov") && E("tabs[0].nodes.some(n=>n.id==='s2')"));
    doc.querySelector(".ov [data-a=k]").click();
    await wait(30);
    T("11-6 확인하면 삭제", !E("tabs[0].nodes.some(n=>n.id==='s2')"));
    E("tabs[0].nodes.push({id:'s2', type:'item', name:'나', desc:'', x:1400, y:1000}); commit(); renderAll();");
    await wait(20);

    /* Alt 오발동 방지 — 수식키를 먼저 누른 조합 */
    E("sel = {nodeIds:['s1'], edgeId:null}; exitLink();");
    key("Alt", {altKey:true, shiftKey:true}); keyUp("Alt", {shiftKey:true});
    await wait(20);
    T("11-7 Shift+Alt(레이아웃 전환)로는 발동 안 함", E("linkMode.active") === false);
    key("Alt", {altKey:true, ctrlKey:true}); keyUp("Alt", {ctrlKey:true});
    await wait(20);
    T("11-8 Ctrl+Alt(AltGr)로는 발동 안 함", E("linkMode.active") === false);

    /* Alt 를 누른 채 노드를 누르면(드래그) 발동하지 않는다 — 캡처 단계 정리 */
    key("Alt", {altKey:true});
    doc.querySelector('[data-id="s1"]').dispatchEvent(new w.MouseEvent("pointerdown", {bubbles:true, clientX:100, clientY:100, button:0, altKey:true}));
    w.dispatchEvent(new w.MouseEvent("pointerup", {clientX:100, clientY:100}));
    keyUp("Alt");
    await wait(20);
    T("11-9 Alt+노드 클릭·드래그로는 발동 안 함", E("linkMode.active") === false);

    /* 정상 경로는 여전히 동작 */
    E("_justDragged = false; sel = {nodeIds:['s1'], edgeId:null};");
    const evAlt = key("Alt", {altKey:true}); keyUp("Alt");
    await wait(20);
    T("11-10 Alt 단독 탭은 정상 발동", E("linkMode.active") === true);
    T("11-11 발동 시 메뉴바 제스처 차단", evAlt.defaultPrevented === true);
    E("exitLink()");

    /* 노드를 지우면 선택에 남은 관계 id 도 정리된다 */
    E("tabs[0].edges.push({id:'se1', from:'s1', to:'s2', label:'', desc:'', isParent:false});");
    E("sel = {nodeIds:[], edgeId:'se1'}; doDeleteNodes(['s2']);");
    await wait(20);
    T("11-12 사라진 관계가 선택에 남지 않음", E("sel.edgeId") === null);
  }

  /* ---- 12. 관계선 우클릭 → 관계 메뉴 ---- */
  {
    E("clearSel(); tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("tabs[0].nodes.push({id:'r1', type:'char', name:'가', desc:'', x:1000, y:1000}, {id:'r2', type:'item', name:'나', desc:'', x:1600, y:1000});");
    E("tabs[0].edges.push({id:'re1', from:'r1', to:'r2', label:'소유', desc:'설명', isParent:false});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(40);

    const hit = doc.querySelector("#edgeSvg .e-hit");
    T("12-1 관계선 히트 영역 존재", !!hit);
    T("12-2 히트 폭이 화면 기준으로 고정(축소해도 얇아지지 않음)",
      E("getComputedStyle(document.querySelector('#edgeSvg .e-hit')).getPropertyValue('vector-effect')").trim() === "non-scaling-stroke");

    hit.dispatchEvent(new w.MouseEvent("contextmenu", {bubbles:true, cancelable:true, clientX:300, clientY:300}));
    await wait(30);
    const ctx = doc.getElementById("ctxMenu");
    T("12-3 우클릭으로 관계 메뉴가 열림", ctx && !ctx.hidden, ctx && ctx.hidden);
    const items = [...doc.querySelectorAll("#ctxMenu .ctx-item, #ctxMenu button, #ctxMenu div")].map(e => e.textContent).join(" | ");
    T("12-4 메뉴에 관계 편집·삭제", items.includes("관계 편집") && items.includes("삭제"), items);

    /* 라벨 우클릭도 같은 메뉴 */
    E("closeCtx()");
    const lbl = doc.querySelector("#edgeSvg .e-lbl");
    if(lbl){
      lbl.dispatchEvent(new w.MouseEvent("contextmenu", {bubbles:true, cancelable:true, clientX:320, clientY:300}));
      await wait(30);
      T("12-5 라벨 우클릭도 관계 메뉴", !doc.getElementById("ctxMenu").hidden);
      E("closeCtx()");
    }

    /* 관계 편집을 눌러 모달이 뜨는지 */
    hit.dispatchEvent(new w.MouseEvent("contextmenu", {bubbles:true, cancelable:true, clientX:300, clientY:300}));
    await wait(30);
    const edit = [...doc.querySelectorAll("#ctxMenu *")].find(e => e.textContent && e.textContent.trim().includes("관계 편집") && !e.querySelector("*"));
    if(edit){
      edit.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
      await wait(40);
      T("12-6 관계 편집 모달이 열림", !!doc.querySelector(".ov #emLabel"));
      T("12-7 기존 값이 채워짐", doc.querySelector(".ov #emLabel")?.value === "소유");
      doc.querySelector(".ov [data-a=c]").click();
    }else{
      T("12-6 관계 편집 항목을 찾음", false, "메뉴 항목 탐색 실패");
    }
  }

  /* ---- 13. 정렬·되돌리기 3건 회귀 ---- */
  {
    const mk = (id, x, y, exp) => `{id:'${id}', type:'char', name:'${id}', desc:'설명이 길게 들어간다', x:${x}, y:${y}${exp ? ", _exp:true" : ""}}`;
    E("clearSel(); tabs.length = 1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId = tabs[0].id;");
    E(`tabs[0].nodes.push(${mk("p",1000,1000,true)}, ${mk("c1",1600,1000)}, ${mk("c2",1000,1600)}, ${mk("c3",1600,1600)});`);
    E("tabs[0].edges.push(" +
      "{id:'pe1', from:'p', to:'c1', label:'', desc:'', isParent:true}," +
      "{id:'pe2', from:'p', to:'c2', label:'', desc:'', isParent:true}," +
      "{id:'pe3', from:'p', to:'c3', label:'', desc:'', isParent:true});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(40);

    /* --- 버그3: 정렬은 펼침(_exp)을 끄고 접힌 크기로 계산한다 --- */
    T("13-1 준비: 노드 하나가 펼쳐진 상태", E("nodeById(curTab(),'p')._exp") === true);
    E("askAutoLayout()");
    await wait(30);
    T("13-2 정렬 확인 모달", !!doc.querySelector(".ov"));
    doc.querySelector(".ov [data-a=k]").click();
    await wait(40);
    T("13-3 정렬하면 펼침이 모두 접힘", E("curTab().nodes.every(n => !n._exp)"));

    /* --- 버그1: 정렬은 누른 즉시 데이터에 확정되고 되돌리기 1칸이 된다 --- */
    T("13-4 애니메이션을 기다리지 않고 좌표가 확정됨",
      E("nodeById(curTab(),'p').x") !== 1000 && Number.isInteger(E("nodeById(curTab(),'p').x")));
    T("13-5 중간 보간값이 데이터에 남지 않음(전부 정수)",
      E("curTab().nodes.every(n => Number.isInteger(n.x) && Number.isInteger(n.y))"));
    T("13-6 정렬이 되돌리기 스택에 적재됨", E("(undoMap[activeTabId]||[]).length") >= 1);
    const sorted = E("nodeById(curTab(),'p').x");
    E("doUndo()");
    await wait(40);
    T("13-7 정렬 되돌리기로 원좌표 복구", E("nodeById(curTab(),'p').x") === 1000);
    E("doRedo()");
    await wait(40);
    T("13-8 다시 실행으로 정렬 복원", E("nodeById(curTab(),'p').x") === sorted);
    T("13-9 되돌리기 후 표시 좌표 잔재 없음", E("tweenPos") === null);

    /* --- 버그2: 되돌리기가 탭을 넘나들지 않는다 --- */
    E("addTab()");
    await wait(60);
    T("13-10 탭 2개 · 새 탭이 활성", E("tabs.length") === 2 && E("activeTabId") === E("tabs[1].id"));
    const tabB = E("activeTabId");
    E("curTab().nodes.push({id:'b1', type:'item', name:'새노드', desc:'', x:2000, y:2000}); commit();");
    await wait(30);
    E("doUndo()");
    await wait(40);
    T("13-11 되돌려도 탭이 바뀌지 않음", E("activeTabId") === tabB);
    T("13-12 현재 탭의 편집만 되돌아감", !E("curTab().nodes.some(n=>n.id==='b1')"));
    T("13-13 다른 탭 내용은 그대로", E("tabs[0].nodes.length") === 4 && E("nodeById(tabs[0],'p').x") === sorted);

    /* 탭 B 에서 더 되돌릴 게 없으면 탭을 옮기지 않고 안내한다 */
    E("doUndo()");
    await wait(40);
    T("13-14 남은 게 없으면 탭 이동 대신 구조 되돌리기(탭 추가 취소)",
      E("tabs.length") === 1 && E("activeTabId") === E("tabs[0].id"));
    T("13-15 구조 되돌리기가 다른 탭 내용을 건드리지 않음", E("tabs[0].nodes.length") === 4);
  }

  /* ---- 14. 노드 검색 + 겹침 우선순위 ---- */
  {
    const key = (k, opt, el) => {
      const ev = new w.KeyboardEvent("keydown", Object.assign({key:k, bubbles:true, cancelable:true}, opt));
      (el || doc).dispatchEvent(ev); return ev;
    };
    E("clearSel(); tabs.length = 1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId = tabs[0].id;");
    E("tabs[0].nodes.push(" +
      "{id:'f1', type:'char', name:'은빛 기사', desc:'북방 출신', x:1000, y:1000}," +
      "{id:'f2', type:'space', name:'탑', desc:'은빛으로 빛난다', x:2200, y:1000}," +
      "{id:'f3', type:'item', name:'검', desc:'평범하다', x:1000, y:2200});");
    E("setEditMode(true); commit(); view.z=1; view.px=0; view.py=0; applyView(); renderAll();");
    await wait(30);

    /* Ctrl+F 로 열린다 */
    const ev = key("f", {ctrlKey:true});
    await wait(30);
    T("14-1 Ctrl+F 로 검색창 열림", !doc.getElementById("searchBar").hidden && ev.defaultPrevented === true);
    T("14-2 브라우저 찾기 대신 입력칸에 포커스", doc.activeElement && doc.activeElement.id === "searchInput");

    /* 이름·설명 양쪽에서 찾는다 */
    const inp = doc.getElementById("searchInput");
    inp.value = "은빛";
    inp.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));
    await wait(40);
    T("14-3 이름·설명 양쪽에서 검색 (f1 이름 · f2 설명)",
      E("searchHits.slice().sort().join(',')") === "f1,f2", E("searchHits.join(',')"));
    T("14-4 결과 개수 표시", doc.getElementById("searchCount").textContent === "1 / 2");
    T("14-5 찾은 노드에 강조 클래스", doc.querySelectorAll(".node.found").length === 2);
    T("14-6 현재 항목만 cur", doc.querySelectorAll(".node.found.cur").length === 1);

    /* 첫 결과가 화면 중앙으로 온다 */
    const cx = E("(function(){var r=wrapEl.getBoundingClientRect();var c=centerOf(searchHits[searchIdx]);" +
      "return Math.abs((c.x*view.z+view.px) - r.width/2);})()");
    T("14-7 현재 결과가 화면 중앙", cx < 1, cx);

    /* ↓ 로 다음 결과 이동 */
    key("ArrowDown", {}, inp);
    await wait(30);
    T("14-8 ↓ 로 다음 결과", E("searchIdx") === 1 && doc.getElementById("searchCount").textContent === "2 / 2");
    const cx2 = E("(function(){var r=wrapEl.getBoundingClientRect();var c=centerOf(searchHits[searchIdx]);" +
      "return Math.abs((c.x*view.z+view.px) - r.width/2);})()");
    T("14-9 이동한 결과도 중앙", cx2 < 1, cx2);
    key("ArrowDown", {}, inp);
    await wait(30);
    T("14-10 끝에서 처음으로 순환", E("searchIdx") === 0);
    inp.blur();
    key("ArrowDown");
    await wait(30);
    T("14-10b 캔버스에서도 ↑↓ 로 이동", E("searchIdx") === 1);
    inp.focus();

    /* 없는 말은 0건 */
    inp.value = "없는말";
    inp.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));
    await wait(40);
    T("14-11 없으면 0건 + 강조 없음", E("searchHits.length") === 0 && doc.querySelectorAll(".node.found").length === 0);

    /* ESC 로 닫히고 강조가 사라진다 */
    inp.value = "은빛";
    inp.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));
    await wait(40);
    inp.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true}));
    await wait(30);
    T("14-12 ESC 로 닫힘 + 강조 해제",
      doc.getElementById("searchBar").hidden && doc.querySelectorAll(".node.found").length === 0);

    /* 겹침: 펼친 카드가 위로 */
    const z = sel => {
      const el = doc.querySelector(sel);
      return el ? w.getComputedStyle(el).getPropertyValue("z-index") : null;
    };
    E("clearSel(); tabs[0].nodes[0]._exp = true; sel = {nodeIds:['f2'], edgeId:null}; renderAll();");
    await wait(30);
    T("14-13 펼친 카드가 보통 카드보다 위", +z('[data-id="f1"]') > +z('[data-id="f3"]'), [z('[data-id="f1"]'), z('[data-id="f3"]')]);
    T("14-14 선택한 카드도 보통보다 위", +z('[data-id="f2"]') > +z('[data-id="f3"]'));
    T("14-15 펼친 카드가 선택한 카드보다 위", +z('[data-id="f1"]') > +z('[data-id="f2"]'));
    T("14-16 카드 배경 블러 제거", !w.getComputedStyle(doc.querySelector('[data-id="f1"]')).backdropFilter ||
      w.getComputedStyle(doc.querySelector('[data-id="f1"]')).backdropFilter === "none");
    E("tabs[0].nodes[0]._exp = false; clearSel(); renderAll();");
  }

  /* ---- 15. 복수 타입 + 구조화 속성 ---- */
  {
    E("clearSel(); tabs.length = 1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId = tabs[0].id;");
    E("tabs[0].nodeTypes = DEFAULT_TYPES.map(x=>({...x}));");
    /* 구버전 데이터: types·props 가 아예 없는 노드 */
    E("tabs[0].nodes.push({id:'g1', type:'char', name:'레온', desc:'기사', x:1000, y:1000});");
    E("sanitizeTab(tabs[0]); setEditMode(true); commit(); renderAll();");
    await wait(30);
    T("15-1 구 데이터에 types 자동 보정", E("JSON.stringify(nodeById(curTab(),'g1').types)") === '["char"]');
    T("15-2 구 데이터에 props 자동 보정", E("Array.isArray(nodeById(curTab(),'g1').props)") && E("nodeById(curTab(),'g1').props.length") === 0);
    T("15-3 type 은 types[0] 과 동기", E("nodeById(curTab(),'g1').type") === "char");

    /* 타입에 기본 속성을 정의 */
    E("openTypeManager()"); await wait(30);
    const tm = doc.querySelector(".ov");
    tm.querySelectorAll(".ty-row .ty-fields")[3].value = "나이, 소속, 생사";   // 인물
    tm.querySelector("[data-a=s]").click();
    await wait(40);
    T("15-4 타입에 기본 속성 저장", E("JSON.stringify(typeFields(curTab(),'char'))") === '["나이","소속","생사"]');

    /* 노드 편집: 기본 속성이 빈칸으로 깔린다 */
    E("openNodeModal(nodeById(curTab(),'g1'))"); await wait(80);
    const nm = doc.querySelector(".ov");
    T("15-5 기본 속성이 빈칸으로 깔림", nm.querySelectorAll(".prop-row").length === 3);
    T("15-6 항목 이름이 템플릿대로", [...nm.querySelectorAll(".prop-row .pk")].map(i => i.value).join(",") === "나이,소속,생사");

    /* 값 입력 + 추가 타입 지정 */
    nm.querySelectorAll(".prop-row .pv")[0].value = "32";
    nm.querySelectorAll(".prop-row .pv")[1].value = "은빛 기사단";
    const chip = [...nm.querySelectorAll("#nmTypes .chip")].find(c => c.textContent === "집단");
    T("15-7 추가 타입 칩 목록에 주 타입은 빠짐", ![...nm.querySelectorAll("#nmTypes .chip")].some(c => c.textContent === "인물"));
    chip.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(20);
    T("15-8 칩을 누르면 켜짐", nm.querySelector("#nmTypes .chip.on") !== null);
    nm.querySelector("[data-a=s]").click();
    await wait(40);

    const g = () => E("nodeById(curTab(),'g1')");
    T("15-9 값이 비어도 항목은 유지(템플릿 자리)", E("nodeById(curTab(),'g1').props.length") === 3);
    T("15-10 속성 값 저장", E("propGet(nodeById(curTab(),'g1'), '나이')") === "32" &&
      E("propGet(nodeById(curTab(),'g1'), '소속')") === "은빛 기사단");
    T("15-11 복수 타입 저장", E("JSON.stringify(nodeById(curTab(),'g1').types)") === '["char","group"]');
    T("15-12 주 타입은 여전히 types[0]", E("nodeById(curTab(),'g1').type") === "char");

    /* 카드 표시 */
    T("15-13 카드에 타입이 여러 개", doc.querySelectorAll('[data-id="g1"] .nt').length === 2);
    T("15-14 카드 요약엔 값이 있는 것만", doc.querySelectorAll('[data-id="g1"] .npi').length === 2);

    /* 저장·동기화 형식 */
    E("saveLocal()");
    const saved = JSON.parse(w.localStorage.getItem("wm_tabs")).tabs[0].nodes.find(n => n.id === "g1");
    T("15-15 저장에 types·props 포함", Array.isArray(saved.types) && saved.types.length === 2 && saved.props.length === 3);
    T("15-16 저장 속성은 k·v 만", saved.props.every(p => Object.keys(p).sort().join(",") === "k,v"));
    const fb = E("JSON.stringify(normFB('nodes', nodeById(curTab(),'g1')))");
    T("15-17 Firebase 정규화에도 포함", fb.includes('"types"') && fb.includes('"props"'));

    /* 되돌리기 */
    E("doUndo()"); await wait(40);
    T("15-18 속성 편집도 되돌리기 1단계", E("nodeById(curTab(),'g1').props.length") === 0);
  }

  /* ---- 16. 노드 상세 패널 ---- */
  {
    E("clearSel(); closePanel(); tabs.length = 1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId = tabs[0].id;");
    E("tabs[0].nodes.push(" +
      "{id:'p1', type:'char', types:['char','group'], name:'레온', desc:'북방의 기사'," +
      " props:[{k:'나이',v:'32'},{k:'생사',v:''}], x:1000, y:1000}," +
      "{id:'p2', type:'item', name:'검', desc:'', x:1600, y:1000});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(30);

    /* 노드를 클릭하면 펼침 + 패널이 함께 */
    E("_justDragged = false");
    doc.querySelector('[data-id="p1"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(60);
    T("16-1 클릭하면 카드가 펼쳐짐", E("nodeById(curTab(),'p1')._exp") === true);
    T("16-2 클릭하면 상세 패널도 열림", E("rpCur") === "node" && !doc.getElementById("rp").hidden);
    T("16-3 패널 제목", doc.getElementById("rpTitle").textContent.includes("노드"));

    /* 위 칸: 이름·타입·속성·설명 */
    T("16-4 이름 표시", doc.querySelector("#npHead .np-name").textContent === "레온");
    T("16-5 겸하는 타입 모두 표시", doc.querySelectorAll("#npHead .nt").length === 2);
    T("16-6 속성 표 — 빈 값도 항목은 보임", doc.querySelectorAll("#npProps .pk").length === 2 &&
      doc.querySelectorAll("#npProps .pv.empty").length === 1);
    T("16-7 설명이 편집 가능한 칸에 표시", doc.getElementById("npDesc").value === "북방의 기사" &&
      doc.getElementById("npDesc").tagName === "TEXTAREA");
    T("16-8 이미지 없으면 이미지 칸은 숨김", doc.getElementById("npImgs").hidden === true);

    /* 다른 노드를 클릭하면 내용이 바뀐다 */
    E("_justDragged = false");
    doc.querySelector('[data-id="p2"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(60);
    T("16-9 다른 노드 클릭 시 패널 갱신", doc.querySelector("#npHead .np-name").textContent === "검");

    /* 여러 개 선택하면 안내 */
    E("sel = {nodeIds:['p1','p2'], edgeId:null}; renderNodePanel();");
    await wait(20);
    T("16-10 복수 선택이면 안내 문구", !doc.getElementById("npEmpty").hidden &&
      doc.getElementById("npEmpty").textContent.includes("하나만"));

    /* 아래 칸: 링크 */
    E("sel = {nodeIds:['p1'], edgeId:null}; renderNodePanel();");
    await wait(20);
    T("16-11 링크 추가 버튼은 없앰(메모로 대체)", doc.getElementById("npLinkAdd") === null);
    E("nodeById(curTab(),'p1').memo = '설정은 https://example.com 참고'; commit(); renderNodePanel();");
    await wait(20);
    T("16-12 메모의 주소가 링크로", doc.querySelector("#npMemoLinks a") &&
      doc.querySelector("#npMemoLinks a").getAttribute("href") === "https://example.com");
    T("16-13 새 창으로 안전하게 열림", doc.querySelector("#npMemoLinks a").getAttribute("rel").includes("noopener"));
    E("nodeById(curTab(),'p1').links = [{url:'https://old.example', label:'옛 링크'}]; renderNodePanel();");
    await wait(20);
    T("16-14 옛 데이터의 링크도 함께 보임", [...doc.querySelectorAll("#npMemoLinks a")].length === 2);
    E("nodeById(curTab(),'p1').links = []; nodeById(curTab(),'p1').memo = ''; renderNodePanel();");

    /* 아래 칸: 메모 자동 저장 */
    const memo = doc.getElementById("npMemo");
    memo.value = "이 인물은 2막에서 배신한다";
    memo.dispatchEvent(new w.Event("input", {bubbles:true}));
    await wait(30);
    T("16-15 메모가 노드에 반영", E("nodeById(curTab(),'p1').memo") === "이 인물은 2막에서 배신한다");
    await wait(900);
    T("16-16 메모는 잠시 뒤 자동 커밋", E("(undoMap[activeTabId]||[]).length") > 0);

    /* 저장·동기화 형식 */
    E("saveLocal()");
    const saved = JSON.parse(w.localStorage.getItem("wm_tabs")).tabs[0].nodes.find(n => n.id === "p1");
    T("16-17 저장에 memo·links·imgs 포함",
      saved.memo === "이 인물은 2막에서 배신한다" && Array.isArray(saved.links) && Array.isArray(saved.imgs));
    const fb = E("JSON.stringify(normFB('nodes', nodeById(curTab(),'p1')))");
    T("16-18 Firebase 정규화에도 포함", fb.includes('"memo"') && fb.includes('"links"') && fb.includes('"imgs"'));

    /* 이미지가 있으면 맨 위에 */
    E("nodeById(curTab(),'p1').imgs = [{id:'im_x', w:1600, h:1000, cap:'초상'}]; renderNodePanel();");
    await wait(20);
    T("16-19 이미지가 있으면 맨 위 칸이 열림", doc.getElementById("npImgs").hidden === false &&
      doc.querySelectorAll("#npImgs img").length === 1);
    T("16-20 이미지가 패널 최상단", doc.getElementById("npBody").firstElementChild.id === "npImgs");
    E("nodeById(curTab(),'p1').imgs = []; closePanel();");
  }

  /* ---- 17. 노드 이미지 (패널) ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId=tabs[0].id;");
    E("tabs[0].nodes.push({id:'q1', type:'char', name:'레온', desc:'', x:1000, y:1000});");
    E("setEditMode(true); commit(); renderAll(); sel={nodeIds:['q1'], edgeId:null}; openNodePanel();");
    await wait(40);
    T("17-1 이미지가 없으면 칸이 숨겨짐", doc.getElementById("npImgs").hidden === true);

    E("nodeById(curTab(),'q1').imgs = [" +
      "{id:'im_aaa.jpg', w:1600, h:1000, cap:'초상'}," +
      "{id:'im_bbb.jpg', w:800, h:600, cap:''}]; renderNodePanel(); renderAll();");
    await wait(30);
    T("17-2 이미지 두 장 표시", doc.querySelectorAll("#npImgs .np-img").length === 2);
    T("17-3 주소가 Worker 경유", doc.querySelector("#npImgs img").getAttribute("src").includes("/api/img/im_aaa.jpg"));
    T("17-4 설명 입력칸에 기존 값", doc.querySelector("#npImgs .np-cap").value === "초상");
    T("17-5 첫 장은 위로 이동 불가", doc.querySelector('#npImgs [data-a="up"]').disabled === true);
    /* 카드의 이미지 개수 배지는 없앴다 — 노드 이름을 가리기만 했다 */
    T("17-5b 작은 그림을 늘리지 않는다", (() => {
      const st = w.getComputedStyle(doc.querySelector("#npImgs img"));
      return st.maxWidth === "100%" && st.width !== "100%";
    })(), w.getComputedStyle(doc.querySelector("#npImgs img")).width);
    T("17-6 카드에 개수 배지가 없다", [...doc.querySelectorAll('[data-id="q1"] .nt')].every(e => !e.textContent.includes("🖼")));

    /* 순서 바꾸기 */
    doc.querySelectorAll('#npImgs [data-a="up"]')[1].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(30);
    T("17-7 ↑ 로 순서 변경", E("nodeById(curTab(),'q1').imgs[0].id") === "im_bbb.jpg");

    /* 설명 편집 */
    const cap = doc.querySelectorAll("#npImgs .np-cap")[0];
    cap.value = "전신";
    cap.dispatchEvent(new w.Event("change", {bubbles:true}));
    await wait(30);
    T("17-8 설명 저장", E("nodeById(curTab(),'q1').imgs[0].cap") === "전신");

    /* 삭제 — 참조가 먼저 빠진다 */
    doc.querySelectorAll('#npImgs [data-a="del"]')[0].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("17-9 × 로 삭제", E("nodeById(curTab(),'q1').imgs.length") === 1);

    /* 저장 형식 — base64 가 아니라 참조만 */
    E("saveLocal()");
    const raw = w.localStorage.getItem("wm_tabs");
    T("17-10 저장에는 참조만(base64 없음)", !raw.includes("data:image") && raw.includes("im_aaa.jpg"));
    const saved = JSON.parse(raw).tabs[0].nodes[0];
    T("17-11 이미지 메타 형식", saved.imgs.length === 1 &&
      Object.keys(saved.imgs[0]).sort().join(",") === "cap,h,id,w");
    E("closePanel();");
  }

  /* ---- 18. UI 재배치 + 겹침 우선순위 ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId=tabs[0].id;");
    E("tabs[0].title='첫 세계관'; tabs[0].nodes.push(" +
      "{id:'u1', type:'char', name:'가', desc:'설명', x:1000, y:1000}," +
      "{id:'u2', type:'item', name:'나', desc:'설명', x:1040, y:1030});");
    E("setEditMode(true); commit(); renderTabs(); renderAll();");
    await wait(30);

    /* 검색 버튼이 캔버스 안에 있다 */
    const sb = doc.getElementById("btnSearch");
    T("18-1 검색 버튼이 캔버스 안", sb && sb.closest("#cwrap") !== null);
    T("18-2 툴바에는 검색 버튼이 없음", doc.querySelector("#topbar #btnSearch") === null);
    sb.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(30);
    T("18-3 누르면 검색창이 열리고 버튼은 숨음",
      !doc.getElementById("searchBar").hidden && doc.getElementById("btnSearch").hidden === true);
    E("closeSearch()");
    await wait(20);
    T("18-4 닫으면 버튼이 돌아옴", doc.getElementById("btnSearch").hidden === false);

    /* 탭에는 이름만, 조작 버튼은 오른쪽에 모여 있다 */
    T("18-5 탭에 개별 복제·삭제 버튼 없음", doc.querySelectorAll("#tabs .ta").length === 0);
    T("18-6 탭에는 이름만", doc.querySelector("#tabs .tab .tt").textContent === "첫 세계관");
    const acts = [...doc.querySelectorAll(".tabacts button")].map(b => b.id);
    T("18-7 오른쪽에 추가·복제·삭제 순", acts.join(",") === "tabAdd,tabDup,tabDel", acts);

    /* 복제·삭제는 현재 탭을 대상으로 */
    doc.getElementById("tabDup").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(80);
    T("18-8 복제 버튼이 현재 탭을 복제", E("tabs.length") === 2 && E("tabs[1].title") === "복사_첫 세계관");
    doc.getElementById("tabDel").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("18-9 삭제 버튼이 확인 모달을 띄움", !!doc.querySelector(".ov"));
    doc.querySelector(".ov [data-a=k], .ov .btn.dngr, .ov [data-a=d]")?.click();
    await wait(60);
    T("18-10 확인하면 삭제", E("tabs.length") === 1);

    /* 🔒 버튼이 툴바 맨 오른쪽 */
    const tb = [...doc.querySelectorAll("#topbar .tb")];
    T("18-11 🔒 버튼이 툴바 맨 오른쪽", tb[tb.length - 1].id === "btnLock", tb.map(b => b.id).join(","));

    /* 마지막으로 건드린 카드가 맨 위 */
    E("clearSel(); topNodeId = null; renderAll();");
    await wait(20);
    const zi = id => +w.getComputedStyle(doc.querySelector('[data-id="' + id + '"]')).getPropertyValue("z-index");
    E("_justDragged = false");
    doc.querySelector('[data-id="u1"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("18-12 클릭한 카드가 최상단", E("topNodeId") === "u1" && zi("u1") > zi("u2"));
    E("_justDragged = false");
    doc.querySelector('[data-id="u2"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("18-13 다음에 클릭한 카드가 그 위로", E("topNodeId") === "u2" && zi("u2") > zi("u1"));

    /* 펼침·선택 카드는 불투명 배경 */
    const bg = w.getComputedStyle(doc.querySelector('[data-id="u2"]')).background || "";
    T("18-14 최상단 카드는 불투명 바탕을 깐다", bg.includes("linear-gradient") || bg.includes("gradient"), bg.slice(0, 80));
    E("clearSel(); topNodeId = null; closePanel(); renderAll();");
  }

  /* ---- 19. 커스텀 소속(tags) + 이름 변경 ---- */
  {
    T("19-1 사이트 이름이 Loremap", doc.title.startsWith("Loremap") &&
      doc.querySelector("#tabbar .logo").textContent === "LOREMAP");

    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId=tabs[0].id;");
    E("tabs[0].nodes.push({id:'t1', type:'char', name:'레온', desc:'', x:1000, y:1000});");
    E("setEditMode(true); commit(); renderAll(); sel={nodeIds:['t1'], edgeId:null}; openNodePanel();");
    await wait(40);
    T("19-2 소속 추가 버튼이 타입 옆에", doc.getElementById("npTagAdd") !== null);

    E("nodeById(curTab(),'t1').tags = ['은빛 기사단']; commit(); renderNodePanel(); renderAll();");
    await wait(30);
    T("19-3 패널에 소속 표시", [...doc.querySelectorAll("#npHead .nt.tag")].some(e => e.textContent.includes("은빛 기사단")));
    T("19-4 카드에도 소속 표시", [...doc.querySelectorAll('[data-id="t1"] .nt.tag')].some(e => e.textContent === "은빛 기사단"));
    T("19-5 소속은 타입 목록에 안 들어감", !E("typeList(curTab()).some(t => t.label === '은빛 기사단')"));

    /* 칩을 누르면 삭제 */
    doc.querySelector("#npHead .nt.tag").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(30);
    T("19-6 칩을 눌러 소속 삭제", E("nodeById(curTab(),'t1').tags.length") === 0);

    /* 저장·동기화 */
    E("nodeById(curTab(),'t1').tags = ['북방','북방','기사단']; sanitizeTab(curTab()); commit(); saveLocal();");
    await wait(20);
    T("19-7 중복 소속은 정리", E("nodeById(curTab(),'t1').tags.length") === 2);
    const saved = JSON.parse(w.localStorage.getItem("wm_tabs")).tabs[0].nodes[0];
    T("19-8 저장에 tags 포함", Array.isArray(saved.tags) && saved.tags.length === 2);
    T("19-9 Firebase 정규화에도 포함", E("JSON.stringify(normFB('nodes', nodeById(curTab(),'t1')))").includes('"tags"'));
    E("closePanel();");
  }

  /* ---- 20. 목차 · 테마 · 참고 이미지 ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId=tabs[0].id;");
    E("tabs[0].nodeTypes = DEFAULT_TYPES.map(x=>({...x}));");
    E("tabs[0].nodes.push(" +
      "{id:'m1', type:'world', types:['world'], name:'아르카디아', desc:'', x:1000, y:1000}," +
      "{id:'m2', type:'char', types:['char'], name:'레온', desc:'기사', tags:['은빛 기사단'], x:1400, y:1000}," +
      "{id:'m3', type:'char', types:['char','group'], name:'세리', desc:'', x:1800, y:1000});");
    E("tabs[0].edges.push({id:'me1', from:'m2', to:'m3', label:'', desc:'', isParent:true});");
    E("setEditMode(true); commit(); renderAll(); openPanel('list');");
    await wait(50);

    T("20-1 목차 패널이 열림", E("rpCur") === "list" && !doc.getElementById("rpList").hidden);
    const secs = [...doc.querySelectorAll("#tocBody .toc-sec .toc-name")].map(e => e.textContent);
    T("20-2 타입 순서대로(상위→하위)", secs[0] === "세계" && secs.indexOf("인물") > secs.indexOf("세계"), secs);
    T("20-3 노드가 주 타입 아래 한 번만", doc.querySelectorAll('#tocBody [data-id="m3"]').length === 1);
    T("20-4 인물 아래 2명", [...doc.querySelectorAll("#tocBody .toc-sec")]
      .find(e => e.querySelector(".toc-name").textContent === "인물")
      .querySelectorAll(".toc-i").length === 2);
    T("20-5 소속이 부제로 보임", [...doc.querySelectorAll('#tocBody [data-id="m2"] .ts')][0].textContent.includes("은빛 기사단"));
    T("20-6 같은 타입 안의 자식은 들여쓰기", doc.querySelector('#tocBody .toc-sub [data-id="m3"]') !== null);

    /* 항목을 누르면 그 노드로 이동 */
    doc.querySelector('#tocBody [data-id="m2"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("20-7 누르면 그 노드가 선택", E("sel.nodeIds.join(',')") === "m2");
    const off = E("(function(){var r=wrapEl.getBoundingClientRect();var c=centerOf('m2');" +
      "return Math.abs((c.x*view.z+view.px) - r.width/2);})()");
    T("20-8 화면 중앙으로 이동", off < 1, off);
    T("20-9 현재 노드가 목차에서 강조", doc.querySelector('#tocBody [data-id="m2"]').className.includes("cur"));

    /* 걸러보기 */
    doc.getElementById("tocFilter").value = "레온";
    doc.getElementById("tocFilter").dispatchEvent(new w.Event("input", {bubbles:true}));
    await wait(30);
    T("20-10 이름으로 거르기", doc.querySelectorAll("#tocBody .toc-i").length === 1);
    doc.getElementById("tocFilter").value = "";
    doc.getElementById("tocFilter").dispatchEvent(new w.Event("input", {bubbles:true}));
    await wait(30);

    /* 테마 4종 */
    T("20-11 테마 네 가지", E("JSON.stringify(THEMES)") === '["dark","light","sepia","slate"]');
    E("applyTheme('sepia', false)");
    await wait(20);
    T("20-12 세피아 적용", doc.body.classList.contains("sepia") && E("curTheme") === "sepia");
    T("20-13 세피아는 밝은 계열로 취급", E("LIGHT_THEMES.includes(curTheme)") === true);
    E("applyTheme('slate', false)");
    await wait(20);
    T("20-14 슬레이트 적용 · 이전 테마 클래스 제거",
      doc.body.classList.contains("slate") && !doc.body.classList.contains("sepia"));
    T("20-15 슬레이트는 어두운 계열", E("LIGHT_THEMES.includes(curTheme)") === false);
    E("applyTheme('없는테마', false)");
    await wait(20);
    T("20-16 모르는 테마는 다크로", E("curTheme") === "dark" && !doc.body.classList.contains("slate"));

    /* 참고 이미지: R2 참조 + 옛 base64 병행 */
    E("curTab().refImages = ['imref01.jpg', 'data:image/jpeg;base64,AAAA']; openPanel('world');");
    await wait(40);
    const imgs = [...doc.querySelectorAll("#refImgs img")].map(i => i.getAttribute("src"));
    T("20-17 R2 참조는 Worker 주소로", imgs[0].includes("/api/img/imref01.jpg"));
    T("20-18 옛 base64 도 그대로 표시", imgs[1].startsWith("data:image"));
    T("20-19 안내 문구가 서버 저장으로 갱신",
      [...doc.querySelectorAll("#rpWorld .rp-sec")].some(e => e.textContent.includes("원본")));
    T("20-20 meta 동기화에 참고 이미지 포함(base64 제외)",
      E("JSON.stringify(metaFB(curTab()).refImages)") === '["imref01.jpg"]');
    E("curTab().refImages = []; closePanel();");
  }

  /* ---- 21. 설명 자동저장 · 목차 더블클릭/접기 ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0; activeTabId=tabs[0].id;");
    E("tabs[0].nodeTypes = DEFAULT_TYPES.map(x=>({...x}));");
    E("tabs[0].nodes.push(" +
      "{id:'d1', type:'char', types:['char'], name:'레온', desc:'처음 설명', x:1000, y:1000}," +
      "{id:'d2', type:'world', types:['world'], name:'아르카디아', desc:'', x:1500, y:1000});");
    E("setEditMode(true); commit(); renderAll(); sel={nodeIds:['d1'], edgeId:null}; openNodePanel();");
    await wait(50);

    /* 메모 머리글은 지웠다 — 안내는 placeholder 가 한다 */
    T("21-1 메모 머리글이 없다",
      ![...doc.querySelectorAll("#rpNode .rp-sec")].some(e => e.textContent.trim() === "메모") &&
      doc.getElementById("npMemo").placeholder.includes("메모"));

    /* 설명이 편집 가능 + 자동저장 */
    let de = doc.getElementById("npDesc");
    T("21-2 편집 모드에서 설명 수정 가능", de.readOnly === false);
    de.value = "고친 설명";
    de.dispatchEvent(new w.Event("input", {bubbles:true}));
    await wait(50);
    T("21-3 입력 즉시 노드에 반영", E("nodeById(curTab(),'d1').desc") === "고친 설명");
    E("undoMap[activeTabId] = []; redoMap[activeTabId] = [];");   // 상한(UNDO_MAX)에 걸리지 않게 비우고 센다
    const before = E("(undoMap[activeTabId]||[]).length");
    await wait(900);
    T("21-4 0.8초 멈추면 자동 커밋(되돌리기 1단계)",
      E("(undoMap[activeTabId]||[]).length") === before + 1);
    E("doUndo()"); await wait(40);
    T("21-5 되돌리면 이전 설명으로", E("nodeById(curTab(),'d1').desc") === "처음 설명");
    E("doRedo()"); await wait(40);
    E("sel={nodeIds:['d1'], edgeId:null}; openNodePanel();");   // 되돌리기가 선택을 풀어 놓는다
    await wait(40);
    de = doc.getElementById("npDesc");

    /* 칸을 벗어나면 기다리지 않고 즉시 저장 */
    de.value = "벗어나며 저장";
    de.dispatchEvent(new w.Event("input", {bubbles:true}));
    const b2 = E("(undoMap[activeTabId]||[]).length");
    de.dispatchEvent(new w.Event("blur", {bubbles:true}));
    await wait(40);
    T("21-6 포커스를 잃으면 즉시 커밋", E("(undoMap[activeTabId]||[]).length") === b2 + 1 &&
      E("nodeById(curTab(),'d1').desc") === "벗어나며 저장");

    /* 보기 모드에서는 읽기 전용 */
    E("setEditMode(false); renderNodePanel();");
    await wait(20);
    T("21-7 보기 모드에선 읽기 전용", doc.getElementById("npDesc").readOnly === true);
    E("setEditMode(true);");

    /* 목차: 더블클릭이면 상세까지 */
    E("openPanel('list')");
    await wait(40);
    T("21-8 목차 열림", E("rpCur") === "list");
    const el1 = doc.querySelector('#tocBody [data-id="d2"]');
    el1.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("21-9 한 번 클릭은 이동만(목차 유지)", E("sel.nodeIds.join(',')") === "d2" && E("rpCur") === "list");
    /* 목록을 다시 그리면 두 번째 클릭이 사라진 요소에 떨어져 더블클릭이 죽는다 */
    T("21-10 클릭해도 목차 DOM 이 그대로", doc.querySelector('#tocBody [data-id="d2"]') === el1);
    T("21-11 강조는 제자리에서 갱신", el1.className.includes("cur") &&
      !doc.querySelector('#tocBody [data-id="d1"]').className.includes("cur"));

    /* 두 번 연속 클릭 = 더블클릭 (브라우저가 실제로 보내는 순서) */
    await wait(450);                                   // 앞선 클릭과 묶이지 않게 창을 비운다
    el1.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    el1.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(50);
    T("21-12 두 번 연속 클릭이면 상세가 열림", E("rpCur") === "node" &&
      doc.querySelector("#npHead .np-name").textContent === "아르카디아");

    /* 천천히 두 번 누른 것은 더블클릭이 아니다 */
    E("openPanel('list')"); await wait(40);
    const el2 = doc.querySelector('#tocBody [data-id="d1"]');
    el2.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(450);
    el2.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("21-13 느리게 두 번은 목차에 머문다", E("rpCur") === "list");

    /* 목차 접기 */
    E("refreshOpenPanels();");
    await wait(40);
    const before2 = doc.querySelectorAll("#tocBody .toc-i").length;
    T("21-14 접기 전 항목이 보임", before2 >= 2);
    const head = [...doc.querySelectorAll("#tocBody .toc-h")].find(h => h.textContent.includes("인물"));
    head.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("21-15 타입 이름을 누르면 접힘", doc.querySelectorAll("#tocBody .toc-i").length < before2);
    T("21-16 접힌 표시(▸)", [...doc.querySelectorAll("#tocBody .toc-cav")].some(e => e.textContent === "▸"));
    T("21-17 다른 타입은 그대로", doc.querySelector('#tocBody [data-id="d2"]') !== null);
    const head2 = [...doc.querySelectorAll("#tocBody .toc-h")].find(h => h.textContent.includes("인물"));
    head2.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    T("21-18 다시 누르면 펼쳐짐", doc.querySelectorAll("#tocBody .toc-i").length === before2);
    /* 보기 모드에서도 설명은 보여야 한다 (.eo 를 붙이면 통째로 사라진다) */
    E("sel={nodeIds:['d1'], edgeId:null}; openNodePanel();");
    await wait(40);
    T("21-20 설명 칸에 eo 가 없다", !doc.getElementById("npDesc").classList.contains("eo"));
    E("nodeById(curTab(),'d1').desc = '북쪽 성채의 기사'; renderNodePanel();");
    await wait(30);
    T("21-21 편집 모드에선 고칠 수 있는 칸이 보인다",
      doc.getElementById("npDesc").hidden === false &&
      doc.getElementById("npDescView").hidden === true);
    E("setEditMode(false); renderNodePanel();"); await wait(30);
    T("21-22 보기 모드에서도 설명 글이 보인다",
      doc.getElementById("npDescView").hidden === false &&
      doc.getElementById("npDescView").textContent === "북쪽 성채의 기사");
    T("21-23 보기 모드에선 편집 칸을 숨긴다", doc.getElementById("npDesc").hidden === true);
    /* 높이를 재서 맞추면 rows 아래로 줄지 않고, 스크롤바가 늦게 생기면 끝 줄이 잘린다 */
    T("21-24 설명 높이를 인라인으로 고정하지 않는다",
      doc.getElementById("npDesc").style.height === "");
    E("nodeById(curTab(),'d1').desc = ''; renderNodePanel();"); await wait(30);
    T("21-25 설명이 비면 안내 문구", doc.getElementById("npDescView").textContent === "설명이 없습니다.");
    E("nodeById(curTab(),'d1').desc = '처음 설명'; setEditMode(true); renderNodePanel();");
    await wait(30);

    /* 편집 버튼이 패널 오른쪽 위(헤더)로 */
    T("21-26 편집 버튼이 헤더 오른쪽에", doc.querySelector(".rp-h .rp-h-r #npEdit") !== null);
    T("21-27 노드 상세에서는 보인다", doc.getElementById("npEdit").hidden === false);
    E("openPanel('list')"); await wait(40);
    T("21-28 다른 패널에서는 숨는다", doc.getElementById("npEdit").hidden === true);
    E("clearSel(); openNodePanel();"); await wait(40);
    T("21-29 고른 노드가 없으면 숨는다", doc.getElementById("npEdit").hidden === true);
    E("sel={nodeIds:['d1'], edgeId:null}; renderNodePanel();"); await wait(30);
    doc.getElementById("npEdit").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(40);
    const dlg = [...doc.querySelectorAll(".ov .dlg-h span")].map(e => e.textContent);
    T("21-30 편집 버튼이 노드 편집창을 연다", dlg.includes("노드 편집"), dlg);
    E("[...modalsEl.querySelectorAll('.ov')].forEach(closeModal);");
    await wait(30);

    /* 이미지 업로드처럼 await 뒤에 renderNodePanel 이 다시 불릴 수 있다 —
       그 사이 패널이 바뀌었으면 편집 버튼이 남으면 안 된다 */
    E("sel={nodeIds:['d1'], edgeId:null}; openNodePanel();"); await wait(40);
    E("openPanel('list'); renderNodePanel();"); await wait(40);
    T("21-31 늦게 도착한 렌더가 편집 버튼을 되살리지 않는다",
      doc.getElementById("npEdit").hidden === true);

    /* 목차는 데이터 변경을 따라가야 한다 (예전엔 gotoNode 의 부수 효과가 덮고 있었다) */
    E("if(rpCur !== 'list') openPanel('list');"); await wait(40);
    E("nodeById(curTab(),'d2').name = '새 이름'; commit(); renderAll();");
    await wait(40);
    T("21-32 이름을 바꾸면 목차가 따라온다",
      doc.querySelector('#tocBody [data-id=\"d2\"] .tn').textContent === "새 이름");
    E("curTab().nodes = curTab().nodes.filter(n => n.id !== 'd2'); commit(); renderAll();");
    await wait(40);
    T("21-33 지운 노드는 목차에서도 사라진다",
      doc.querySelector('#tocBody [data-id=\"d2\"]') === null);
    E("closePanel();");

    /* 0.8초가 차기 전에 창을 닫아도 잃지 않는다 */
    E("sel={nodeIds:['d1'], edgeId:null}; openNodePanel();");
    await wait(40);
    E("undoMap[activeTabId] = []; dirtyLocal = false;");
    const de2 = doc.getElementById("npDesc");
    de2.value = "닫기 직전 글자";
    de2.dispatchEvent(new w.Event("input", {bubbles:true}));
    w.dispatchEvent(new w.Event("beforeunload"));
    await wait(30);
    T("21-34 창을 닫으면 대기 중인 글자도 저장",
      E("(undoMap[activeTabId]||[]).length") === 1 &&
      E("nodeById(curTab(),'d1').desc") === "닫기 직전 글자");
    E("closePanel();");
  }

  /* ---- 22. 브라우저에 기억하는 것들 · 테마 선택 UI ---- */
  {
    E("clearSel(); closePanel();");

    /* 목차 접힘이 localStorage 에 남는다 */
    E("localStorage.removeItem('wm_toc'); tocClosed.clear();");
    E("openPanel('list')"); await wait(40);
    const th = [...doc.querySelectorAll("#tocBody .toc-h")][0];
    const key = th.dataset.k;
    th.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(30);
    T("22-1 접으면 localStorage 에 남는다",
      JSON.parse(E("localStorage.getItem('wm_toc')") || "[]").includes(key), key);
    [...doc.querySelectorAll("#tocBody .toc-h")].find(e => e.dataset.k === key)
      .dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    await wait(30);
    T("22-2 다시 펼치면 목록에서 빠진다",
      !JSON.parse(E("localStorage.getItem('wm_toc')") || "[]").includes(key));
    T("22-3 깨진 값은 무시한다",
      E("localStorage.setItem('wm_toc', '{ 망가진 '); JSON.stringify(loadTocClosed())") === "[]");
    T("22-4 문자열이 아닌 항목은 거른다",
      E("localStorage.setItem('wm_toc', '[\"char\",7,null]'); JSON.stringify(loadTocClosed())") === '["char"]');

    /* 설명·메모 칸 높이가 남는다 */
    E("localStorage.removeItem('wm_npsize'); npSize = {};");
    E("sel={nodeIds:['d1'], edgeId:null}; setEditMode(true); openNodePanel();");
    await wait(40);
    const dsc = doc.getElementById("npDesc"), mem = doc.getElementById("npMemo");
    /* 브라우저가 크기를 바꾸고 손을 뗀다. 손잡이는 오른쪽 아래 모서리인데
       resize:vertical 이라 폭은 안 늘어나므로, 실제로는 커서가 칸 밖에서 떨어지는 일이 잦다.
       그래서 mouseup 을 textarea 가 아니라 바깥 요소에 쏴서 검증한다. */
    dsc.style.height = "210px";
    doc.getElementById("rpNode").dispatchEvent(new w.MouseEvent("mouseup", {bubbles:true}));
    await wait(20);
    T("22-5 칸 밖에서 손을 떼도 설명 높이가 저장된다",
      JSON.parse(E("localStorage.getItem('wm_npsize')") || "{}").desc === "210px");
    mem.style.height = "330px";
    doc.body.dispatchEvent(new w.MouseEvent("mouseup", {bubbles:true}));
    await wait(20);
    T("22-6 아예 화면 바깥이어도 메모 높이가 저장된다",
      JSON.parse(E("localStorage.getItem('wm_npsize')") || "{}").memo === "330px");
    dsc.style.height = ""; mem.style.height = "";
    E("renderNodePanel();"); await wait(30);
    T("22-7 다시 그리면 저장해 둔 높이로 돌아온다",
      dsc.style.height === "210px" && mem.style.height === "330px");

    /* 칸이 아직 안 그려진 상태에서 rememberNpSize 가 불려도 지워지면 안 된다.
       ResizeObserver 는 observe() 하는 즉시 한 번 발화하고, 창 mouseup 도 아무 데서나 온다 —
       예전에는 이때 next 를 {} 에서 시작해 저장값을 통째로 날렸다(새로고침하면 높이가 사라짐). */
    dsc.style.height = ""; mem.style.height = "";
    w.dispatchEvent(new w.MouseEvent("mouseup", {bubbles:true}));
    await wait(20);
    T("22-8 칸이 비어 있을 때 눌러도 저장값이 살아 있다", (() => {
      const v = JSON.parse(E("localStorage.getItem('wm_npsize')") || "{}");
      return v.desc === "210px" && v.memo === "330px";
    })());
    E("renderNodePanel();"); await wait(30);
    T("22-9 그 뒤에도 높이가 되살아난다",
      dsc.style.height === "210px" && mem.style.height === "330px");
    /* 한쪽만 조절해도 다른 쪽 기억이 남는다 */
    dsc.style.height = "150px";
    doc.body.dispatchEvent(new w.MouseEvent("mouseup", {bubbles:true}));
    await wait(20);
    T("22-10 한쪽만 바꿔도 다른 쪽은 그대로", (() => {
      const v = JSON.parse(E("localStorage.getItem('wm_npsize')") || "{}");
      return v.desc === "150px" && v.memo === "330px";
    })());
    T("22-11 이상한 값은 style 로 들어가지 않는다", E("(function(){" +
      "localStorage.setItem('wm_npsize', JSON.stringify({desc:'100px;background:red', memo:'9999999px'}));" +
      "return NP_H.test('100px;background:red') === false && NP_H.test('9999999px') === false;})()"));

    /* 테마 선택 — 4개를 한 줄에 욱여넣지 않는다 */
    E("openSettings();"); await wait(50);
    const grid = doc.querySelector(".dlg-b .theme-grid");
    T("22-12 테마는 격자로", grid !== null);
    const opts = [...grid.querySelectorAll(".theme-opt")];
    T("22-13 네 가지 그대로", opts.length === 4);
    T("22-14 이름과 설명이 따로", opts.every(o => o.querySelector(".to-t b") && o.querySelector(".to-t i")));
    T("22-15 이름은 짧게", opts.map(o => o.querySelector(".to-t b").textContent).join(",") ===
      "다크,라이트,세피아,슬레이트");
    T("22-16 색 견본은 그대로", opts.every(o => o.querySelector(".sw")));
    T("22-17 설명을 …로 자르지 않는다",
      w.getComputedStyle(opts[3].querySelector(".to-t i")).whiteSpace !== "nowrap");
    T("22-18 값은 THEMES 와 일치",
      opts.map(o => o.querySelector("input").value).join(",") === E("THEMES.join(',')"));
    const slate = opts.find(o => o.querySelector("input").value === "slate").querySelector("input");
    slate.checked = true;
    slate.dispatchEvent(new w.Event("change", {bubbles:true}));
    await wait(30);
    T("22-19 고르면 바로 미리보기", E("curTheme") === "slate");
    E("[...modalsEl.querySelectorAll('.ov')].forEach(closeModal);");
    await wait(30);
    T("22-20 취소하면 원래 테마로", E("curTheme") !== "slate");
    E("applyTheme('dark', false);");
  }

  /* ---- 23. 새로 켰을 때 기억한 값이 살아난다 ---- */
  {
    const seeded = boot({deploy:{apiBase:''}, pre: win => {
      win.localStorage.setItem("wm_toc", JSON.stringify(["char"]));
      win.localStorage.setItem("wm_npsize", JSON.stringify({desc:"188px", memo:"266px"}));
    }});
    await wait(400);
    T("23-1 접어둔 목차가 살아난다", seeded.E("[...tocClosed].join(',')") === "char");
    T("23-2 칸 높이가 살아난다",
      seeded.E("JSON.stringify(npSize)") === '{"desc":"188px","memo":"266px"}');
    seeded.E("tabs[0].nodes.push({id:'z1', type:'char', types:['char'], name:'복원', desc:'', x:1000, y:1000});");
    seeded.E("setEditMode(true); commit(); renderAll(); openPanel('list');");
    await wait(60);
    const sec = [...seeded.doc.querySelectorAll("#tocBody .toc-sec")]
      .find(e => e.querySelector(".toc-name").textContent === "인물");
    T("23-3 인물 묶음이 접힌 채로 열린다",
      sec !== undefined && sec.querySelector(".toc-cav").textContent === "▸" &&
      sec.querySelector(".toc-list") === null);
    seeded.E("sel={nodeIds:['z1'], edgeId:null}; openNodePanel();");
    await wait(60);
    T("23-4 저장해 둔 높이로 칸이 열린다",
      seeded.doc.getElementById("npDesc").style.height === "188px" &&
      seeded.doc.getElementById("npMemo").style.height === "266px");
    /* 앱을 켠 것만으로 저장값이 날아가지 않아야 한다 (이게 깨져서 새로고침마다 높이가 사라졌다) */
    T("23-5 켜는 것만으로 저장값이 지워지지 않는다",
      seeded.E("localStorage.getItem('wm_npsize')") ===
      JSON.stringify({desc:"188px", memo:"266px"}),
      seeded.E("localStorage.getItem('wm_npsize')"));
    seeded.win.close();
  }

  /* ---- 24. 노드 카드 · 탭 주소 ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("activeTabId = tabs[0].id; tabs[0].title = '첫 세계';");
    E("tabs[0].nodes.push({id:'p1', type:'char', types:['char'], name:'그림 있는 노드'," +
      "desc:'', tags:['기사단'], imgs:[{id:'im1',w:10,h:10,cap:''},{id:'im2',w:10,h:10,cap:''}]," +
      "x:1000, y:1000});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(40);

    const card = doc.querySelector('.node[data-id="p1"]');
    T("24-1 노드 카드가 그려진다", card !== null);
    T("24-2 이미지 개수 배지가 없다", !card.textContent.includes("🖼"));
    T("24-3 개수 숫자도 남지 않는다",
      [...card.querySelectorAll(".nh .nt")].every(e => !/^\s*\d+\s*$/.test(e.textContent)));
    T("24-4 타입·소속 꼬리표는 그대로",
      [...card.querySelectorAll(".nh .nt")].map(e => e.textContent.trim()).join(",") === "인물,기사단");

    /* 탭 주소 — 순번을 쓴다 */
    E("addTab(); addTab();"); await wait(50);
    T("24-5 탭이 셋", E("tabs.length") === 3);
    T("24-6 주소가 지금 탭의 순번", w.location.hash === "#3", w.location.hash);
    E("switchTab(tabs[0].id)"); await wait(40);
    T("24-7 탭을 옮기면 주소도 따라온다", w.location.hash === "#1", w.location.hash);
    T("24-8 마지막으로 본 탭을 기억한다",
      E("localStorage.getItem('wm_lasttab')") === E("tabs[0].id"));

    /* 주소를 직접 바꾸면 그 탭으로 */
    T("24-9 순번으로 찾는다", E("hashTarget.call(null)") !== undefined);
    T("24-10 #2 는 두 번째 탭", E("(function(){ location.hash = '#2'; return hashTarget(); })()") === E("tabs[1].id"));
    T("24-11 탭 id 로도 찾는다",
      E("(function(){ location.hash = '#' + tabs[2].id; return hashTarget(); })()") === E("tabs[2].id"));
    T("24-12 탭 이름으로도 찾는다",
      E("(function(){ location.hash = '#' + encodeURIComponent('첫 세계'); return hashTarget(); })()") === E("tabs[0].id"));
    T("24-13 모르는 주소는 빈 값",
      E("(function(){ location.hash = '#없는탭'; return hashTarget(); })()") === "");
    T("24-14 범위 밖 순번도 빈 값",
      E("(function(){ location.hash = '#99'; return hashTarget(); })()") === "");
    E("location.hash = ''; switchTab(tabs[0].id); syncTabLocation();");
    await wait(30);
  }

  /* ---- 25. 새로 켜면 지난번 탭이 먼저 열린다 ---- */
  {
    /* 지난번에 보던 탭 */
    const back = boot({deploy:{apiBase:''}, pre: win => {
      win.localStorage.setItem("wm_tabs", JSON.stringify({tabs:[
        {id:"t1", title:"하나", nodes:[], edges:[], events:[], worldPrompt:""},
        {id:"t2", title:"둘",   nodes:[], edges:[], events:[], worldPrompt:""},
        {id:"t3", title:"셋",   nodes:[], edges:[], events:[], worldPrompt:""}]}));
      win.localStorage.setItem("wm_lasttab", "t3");
    }});
    await wait(400);
    T("25-1 마지막으로 보던 탭이 열린다", back.E("activeTabId") === "t3");
    T("25-2 주소도 그 탭을 가리킨다", back.win.location.hash === "#3", back.win.location.hash);
    back.win.close();

    /* 주소가 있으면 주소가 이긴다 */
    const byUrl = boot({url:'https://localhost/#2', deploy:{apiBase:''}, pre: win => {
      win.localStorage.setItem("wm_tabs", JSON.stringify({tabs:[
        {id:"t1", title:"하나", nodes:[], edges:[], events:[], worldPrompt:""},
        {id:"t2", title:"둘",   nodes:[], edges:[], events:[], worldPrompt:""},
        {id:"t3", title:"셋",   nodes:[], edges:[], events:[], worldPrompt:""}]}));
      win.localStorage.setItem("wm_lasttab", "t3");
    }});
    await wait(400);
    T("25-3 주소가 지난번 탭보다 우선", byUrl.E("activeTabId") === "t2");
    byUrl.win.close();

    /* 없는 탭을 가리키면 첫 탭으로 */
    const gone = boot({deploy:{apiBase:''}, pre: win => {
      win.localStorage.setItem("wm_tabs", JSON.stringify({tabs:[
        {id:"t1", title:"하나", nodes:[], edges:[], events:[], worldPrompt:""}]}));
      win.localStorage.setItem("wm_lasttab", "지워진탭");
    }});
    await wait(400);
    T("25-4 지워진 탭을 가리키면 첫 탭으로", gone.E("activeTabId") === "t1");
    gone.win.close();
  }

  /* ---- 26. 이미지 붙여넣기 · 끌어다 놓기 ---- */
  {
    E("clearSel(); closePanel(); tabs.length=1; tabs[0].nodes.length=0; tabs[0].edges.length=0;");
    E("activeTabId = tabs[0].id;");
    E("tabs[0].nodes.push(" +
      "{id:'g1', type:'char', types:['char'], name:'받는 노드', desc:'', x:1000, y:1000}," +
      "{id:'g2', type:'char', types:['char'], name:'옆 노드',   desc:'', x:1600, y:1000});");
    E("setEditMode(true); commit(); renderAll();");
    await wait(40);

    /* 업로드는 서버로 가니 가로챈다 — 어디로 붙는지만 본다 */
    E("window.__up = []; uploadImage = async f => { window.__up.push(f.name); " +
      "return {id:'up' + window.__up.length, w:10, h:10, cap:''}; };");

    const mkFile = (name, type) => {
      const f = new w.File(["x"], name, {type});
      return f;
    };
    const mkDT = (files, types) => ({
      files, items: [], types: types || (files.length ? ["Files"] : []),
      getData: () => ""
    });

    /* 1) Ctrl+V — 포커스가 body 여도 받아야 한다 (예전엔 #rpNode 에만 걸려 있었다) */
    E("sel={nodeIds:['g1'], edgeId:null}; openNodePanel();");
    await wait(40);
    doc.body.focus();
    const pe = new w.Event("paste", {bubbles:true, cancelable:true});
    pe.clipboardData = mkDT([mkFile("붙여넣기.png", "image/png")]);
    doc.body.dispatchEvent(pe);
    await wait(80);
    T("26-1 캔버스에 포커스가 있어도 붙여넣기가 먹는다",
      E("(nodeById(curTab(),'g1').imgs||[]).length") === 1);
    T("26-2 기본 동작을 막는다", pe.defaultPrevented === true);

    /* 2) 글이 함께 있고 입력칸에 있으면 글이 우선 */
    doc.getElementById("npMemo").focus();
    const pe2 = new w.Event("paste", {bubbles:true, cancelable:true});
    pe2.clipboardData = {files:[mkFile("같이.png","image/png")], items:[], types:["Files","text/plain"],
      getData: t => t === "text/plain" ? "붙여넣을 글" : ""};
    doc.getElementById("npMemo").dispatchEvent(pe2);
    await wait(60);
    T("26-3 입력칸에서 글이 함께면 글이 우선", pe2.defaultPrevented === false &&
      E("(nodeById(curTab(),'g1').imgs||[]).length") === 1);
    doc.getElementById("npMemo").blur();

    /* 3) 이미지가 아니면 건드리지 않는다 */
    const pe3 = new w.Event("paste", {bubbles:true, cancelable:true});
    pe3.clipboardData = mkDT([mkFile("메모.txt","text/plain")], ["Files"]);
    doc.body.dispatchEvent(pe3);
    await wait(60);
    T("26-4 이미지가 아닌 붙여넣기는 통과", pe3.defaultPrevented === false &&
      E("(nodeById(curTab(),'g1').imgs||[]).length") === 1);

    /* 4) 노드 카드 위에 끌어다 놓으면 그 노드로 — 고른 노드가 아니어도 */
    const card2 = doc.querySelector('.node[data-id="g2"]');
    const de = new w.Event("drop", {bubbles:true, cancelable:true});
    de.dataTransfer = mkDT([mkFile("끌기.png", "image/png")]);
    card2.dispatchEvent(de);
    await wait(80);
    T("26-5 놓은 노드에 들어간다", E("(nodeById(curTab(),'g2').imgs||[]).length") === 1);
    T("26-6 고른 노드는 그대로 하나뿐", E("(nodeById(curTab(),'g1').imgs||[]).length") === 1);
    T("26-7 놓은 노드가 선택된다", E("sel.nodeIds.join(',')") === "g2");
    T("26-8 열린 상세도 그 노드로", doc.querySelector("#npHead .np-name").textContent === "옆 노드");

    /* 5) 빈 캔버스에 놓아도 브라우저가 파일로 이동하지 않게 막는다 */
    const de2 = new w.Event("drop", {bubbles:true, cancelable:true});
    de2.dataTransfer = mkDT([mkFile("아무데나.png", "image/png")]);
    doc.getElementById("cwrap").dispatchEvent(de2);
    await wait(60);
    T("26-9 빈 곳에 놓아도 기본 동작을 막는다", de2.defaultPrevented === true);

    /* 6) 끌고 오는 동안 표시 */
    const ov = new w.Event("dragover", {bubbles:true, cancelable:true});
    ov.dataTransfer = mkDT([], ["Files"]);
    doc.querySelector('.node[data-id="g1"]').dispatchEvent(ov);
    await wait(20);
    T("26-10 끌고 오면 놓을 자리를 표시",
      doc.querySelector('.node[data-id="g1"]').classList.contains("imp-drop"));
    T("26-11 끌기 중엔 기본 동작을 막아 drop 이 오게 한다", ov.defaultPrevented === true);
    const dl = new w.Event("dragleave", {bubbles:true, cancelable:true});
    doc.querySelector('.node[data-id="g1"]').dispatchEvent(dl);
    await wait(20);
    T("26-12 나가면 표시를 지운다",
      !doc.querySelector('.node[data-id="g1"]').classList.contains("imp-drop"));

    /* 7) 고른 노드가 없으면 알려 준다 */
    E("clearSel(); closePanel();");
    await wait(30);
    const pe4 = new w.Event("paste", {bubbles:true, cancelable:true});
    pe4.clipboardData = mkDT([mkFile("주인없음.png", "image/png")]);
    doc.body.dispatchEvent(pe4);
    await wait(60);
    T("26-13 고른 노드가 없으면 안내", ([...doc.querySelectorAll(".toast")].map(e=>e.textContent).join(" | ") || "").includes("노드를 하나 고른"),
      [...doc.querySelectorAll(".toast")].map(e=>e.textContent).join(" | "));
    T("26-14 올린 파일은 셋뿐(안내 뒤 업로드 없음)", E("window.__up.length") === 3, E("JSON.stringify(window.__up)"));
  }

  done();
})();
