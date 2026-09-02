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

  done();
})();
