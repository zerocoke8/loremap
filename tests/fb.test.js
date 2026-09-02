const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '')
  .replace('const ORPHAN_GRACE_MS = 15000;', 'const ORPHAN_GRACE_MS = 60;');   // 테스트에서는 고아 정리 유예를 짧게

let pass = 0, fail = 0;
const T = (name, cond, extra) => {
  if(cond){ pass++; console.log('  ok  ' + name); }
  else{ fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const cp = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

/* ---------- Firebase compat 인메모리 스텁 ---------- */
function makeFirebaseStub(initialDb, writeLog){
  let db = cp(initialDb) || {};
  const listeners = [];           // {path, evt, cb, lastVal, lastKids}
  const segs = p => p.split('/').filter(Boolean);
  function getPath(p){
    let cur = db;
    for(const s of segs(p)){
      if(cur == null || typeof cur !== 'object') return null;
      cur = cur[s];
      if(cur === undefined) return null;
    }
    return cur === undefined ? null : cur;
  }
  let silent = false;              // update 내부 적용은 개별 로그를 남기지 않는다
  function setPath(p, v){
    if(!silent) writeLog.push({path:p, del:v === undefined});
    const ss = segs(p);
    let cur = db;
    for(let i = 0; i < ss.length - 1; i++){
      if(cur[ss[i]] == null || typeof cur[ss[i]] !== 'object') cur[ss[i]] = {};
      cur = cur[ss[i]];
    }
    if(v === undefined) delete cur[ss[ss.length-1]];
    else cur[ss[ss.length-1]] = cp(v);
    scheduleProcess();
  }
  let failing = false;             // 규칙·권한으로 쓰기가 막힌 상황 주입용
  let failPath = null;             // 특정 경로만 거부 (반쪽 삭제 재현용)
  const denied = p => failing || (failPath && failPath(p));
  let scheduled = false;
  function scheduleProcess(){
    if(scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; process_(); }, 0);
  }
  function snap(key, val){ return {key, val: () => cp(val)}; }
  function process_(){
    for(const L of listeners.slice()){
      const cur = getPath(L.path);
      if(L.evt === 'value'){
        const j = JSON.stringify(cur ?? null);
        if(L.lastVal !== j){ L.lastVal = j; L.cb(snap(segs(L.path).pop() || null, cur)); }
      }else{
        const kids = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
        const nk = {};
        for(const [k, v] of Object.entries(kids)) nk[k] = JSON.stringify(v ?? null);
        const ok = L.lastKids || {};
        for(const k of Object.keys(nk)){
          if(!(k in ok)){ if(L.evt === 'child_added') L.cb(snap(k, kids[k])); }
          else if(ok[k] !== nk[k]){ if(L.evt === 'child_changed') L.cb(snap(k, kids[k])); }
        }
        for(const k of Object.keys(ok)){
          if(!(k in nk) && L.evt === 'child_removed') L.cb(snap(k, null));
        }
        L.lastKids = nk;
      }
    }
  }
  function mkRef(path){
    return {
      child: p2 => mkRef(path + '/' + p2),
      once: evt => Promise.resolve(snap(segs(path).pop() || null, getPath(path))),
      on: (evt, cb) => {
        const L = {path, evt, cb, lastVal: undefined, lastKids: (evt === 'value' ? undefined : {})};
        listeners.push(L);
        scheduleProcess();          // 초기 value / child_added 리플레이
        return cb;
      },
      off: (evt, cb) => {
        const i = listeners.findIndex(L => L.path === path && L.evt === evt && L.cb === cb);
        if(i >= 0) listeners.splice(i, 1);
      },
      set: v => { if(denied(path)) return Promise.reject(new Error('PERMISSION_DENIED')); setPath(path, v); return Promise.resolve(); },
      remove: () => { if(denied(path)) return Promise.reject(new Error('PERMISSION_DENIED')); setPath(path, undefined); return Promise.resolve(); },
      /* RTDB 다중 경로 update: 하나라도 거부되면 아무것도 적용하지 않는다(원자적) */
      update: obj => {
        const full = Object.keys(obj).map(k => (path ? path + '/' : '') + k);
        if(full.some(denied)) return Promise.reject(new Error('PERMISSION_DENIED'));
        writeLog.push({path:'UPDATE', keys:full});
        silent = true;
        try{ full.forEach((p, i) => { const v = obj[Object.keys(obj)[i]]; setPath(p, v === null ? undefined : v); }); }
        finally{ silent = false; }
        return Promise.resolve();
      }
    };
  }
  return {
    firebase: {
      initializeApp: () => ({ database: () => ({ ref: mkRef }), delete: async () => {} })
    },
    getPath, setPath,
    setFailing: v => { failing = v; },
    setFailPath: fn => { failPath = fn; },
    _db: () => db
  };
}

/* ---------- 시나리오 ---------- */
(async () => {
  const writeLog = [];
  /* 서버: 구 포맷 worldmind/{tabs:[...]} (§2-3) — 새 브라우저(로컬 비어 있음) */
  const oldTab = {
    id:'i500', title:'서버 세계관',
    nodes:[
      {id:'i501', type:'world', name:'중앙 세계', desc:'', x:2000, y:2000},
      {id:'i502', type:'char',  name:'용사',      desc:'', x:2300, y:2100}
    ],
    edges:[{id:'i503', from:'i501', to:'i502', label:'거주', desc:'', isParent:true}],
    events:[{id:'i504', time:'과거', body:'건국', order:10}]
  };
  const stub = makeFirebaseStub({
    'worldmind': {tabs: [oldTab]},
    '.info': {connected: true}
  }, writeLog);

  const dom = new JSDOM(html, {runScripts:'dangerously', url:'https://localhost/',
    beforeParse(win){
      win.localStorage.setItem('wm_fbcfg', '{"apiKey":"x","databaseURL":"https://t.firebasedatabase.app"}');
      win.firebase = stub.firebase;
      win.requestAnimationFrame = cb => setTimeout(() => cb(win.performance.now()), 16);
      win.PointerEvent = win.MouseEvent;
    }});
  const win = dom.window, doc = win.document;
  const E = code => win.eval(code);
  const errs = [];
  win.addEventListener('error', e => errs.push(String(e.error || e.message)));

  await wait(400);

  /* --- A. 마이그레이션 + 채택 --- */
  T('A1 구포맷 → 신규 구조 (tabList 생성)', Array.isArray(stub.getPath('worldmind/tabList')) &&
      stub.getPath('worldmind/tabList')[0].id === 'i500');
  T('A2 항목별 경로로 이전 (손실 없음)', stub.getPath('worldmind/tabs/i500/nodes/i501')?.name === '중앙 세계' &&
      stub.getPath('worldmind/tabs/i500/edges/i503')?.isParent === true &&
      stub.getPath('worldmind/tabs/i500/events/i504')?.body === '건국');
  T('A3 이전 항목에 _w 부여', typeof stub.getPath('worldmind/tabs/i500/nodes/i501')._w === 'string');
  T('A4 구 배열 제거', !Array.isArray(stub.getPath('worldmind/tabs')));
  T('A5 로컬이 서버 데이터 채택', E("tabs.length===1 && tabs[0].nodes.length===2 && tabs[0].nodes[1].name==='용사'"));
  T('A6 노드 렌더', doc.querySelectorAll('.node').length === 2);
  T('A7 동기화 상태 칩', doc.getElementById('syncTxt').textContent === '실시간 동기화');

  /* --- B. 개별 diff 쓰기 (§3) --- */
  E('setEditMode(true)');
  writeLog.length = 0;
  E("tabs[0].nodes[1].name = '개명된 용사'; commit();");
  await wait(60);
  T('B1 변경 노드만 기록', stub.getPath('worldmind/tabs/i500/nodes/i502').name === '개명된 용사');
  const dataWrites = writeLog.filter(w => !w.path.endsWith('tabList'));
  const itemWrites = dataWrites.filter(w => !w.path.endsWith('/meta'));
  T('B2 diff — 변경 항목 외 미기록', itemWrites.length === 1 && itemWrites[0].path === 'worldmind/tabs/i500/nodes/i502', writeLog);
  /* 구 데이터에는 meta.nodeTypes 가 없어 첫 동기화 때 한 번만 승급 기록된다 */
  const meta = stub.getPath('worldmind/tabs/i500/meta');
  T('B2-1 nodeTypes 승급 — meta 1회 기록', dataWrites.filter(w => w.path.endsWith('/meta')).length <= 1, writeLog);
  T('B2-2 서버 meta 에 기본 타입 7종 기록', Array.isArray(meta.nodeTypes) && meta.nodeTypes.length === 7 && meta.nodeTypes[0].key === 'world', meta.nodeTypes);
  T('B3 세션 _w 포함', stub.getPath('worldmind/tabs/i500/nodes/i502')._w === E('FB_SID'));

  /* --- C. 원격 수신 / 에코 / 원격 삭제 --- */
  stub.setPath('worldmind/tabs/i500/nodes/i501', {type:'world', name:'원격 갱신', desc:'', x:2000, y:2000, _w:'sOTHER'});
  await wait(120);
  T('C1 원격 변경 수신(50ms 디바운스)', E("tabs[0].nodes[0].name==='원격 갱신'"));
  stub.setPath('worldmind/tabs/i500/nodes/i501', {type:'world', name:'에코 무시 검증', desc:'', x:2000, y:2000, _w:E('FB_SID')});
  await wait(120);
  T('C2 자기 세션 _w 에코 무시', E("tabs[0].nodes[0].name==='원격 갱신'"));
  stub.setPath('worldmind/tabs/i500/nodes/i502', undefined);
  await wait(120);
  T('C3 원격 삭제 반영 + 연결 관계 정리', E("tabs[0].nodes.length===1 && tabs[0].edges.length===0"));
  T('C4 렌더 반영', doc.querySelectorAll('.node').length === 1 && doc.querySelectorAll('#edgeSvg path').length === 0);

  /* --- D. 복제 탭 전량 push (§5-1 ⚠ 스냅샷) --- */
  E("tabs[0].nodes.push({id:gid(), type:'item', name:'보물', desc:'', x:2400, y:2300, _exp:false}); commit();");
  await wait(60);
  E('duplicateTab(tabs[0])');
  await wait(200);
  const dupId = E('tabs[1].id');
  T('D1 복제 탭 서버 전량 기록', Object.keys(stub.getPath('worldmind/tabs/' + dupId + '/nodes') || {}).length === 2 &&
      stub.getPath('worldmind/tabs/' + dupId + '/meta')?.title === '복사_서버 세계관');
  T('D2 tabList 갱신', (stub.getPath('worldmind/tabList') || []).length === 2);

  /* --- E. 원격 탭 추가 --- */
  stub.setPath('worldmind/tabs/i900', {
    meta:{title:'원격 신규', worldPrompt:'', _w:'sOTHER'},
    nodes:{i901:{type:'space', name:'외딴 섬', desc:'', x:2000, y:2000, _w:'sOTHER'}},
    edges:{}, events:{}
  });
  stub.setPath('worldmind/tabList', [...stub.getPath('worldmind/tabList'), {id:'i900', title:'원격 신규'}]);
  await wait(250);
  T('E1 원격 탭 목록 수신', E("tabs.length===3 && tabs[2].title==='원격 신규'"));
  T('E2 원격 탭 내용 로드', E("tabs[2].nodes.length===1 && tabs[2].nodes[0].name==='외딴 섬'"));

  /* --- F. 보기 전용은 서버에 쓰지 않는다 (D·E에서 활성 탭이 바뀌었으므로 i500으로 되돌린다) --- */
  E('setEditMode(true)');
  E("switchTab('i500')");
  await wait(150);
  T('F0 활성 탭 복귀', E('activeTabId') === 'i500');
  E('setEditMode(false)');
  writeLog.length = 0;
  E("curTab().nodes.push({id:'iVIEW', type:'item', name:'보기모드 추가', desc:'', x:2500, y:2500}); commit();");
  await wait(60);
  T('F1 보기 모드에서는 서버 쓰기 없음', writeLog.length === 0, writeLog);
  T('F2 서버에 반영되지 않음', !stub.getPath('worldmind/tabs/i500/nodes/iVIEW'));

  /* --- G. 쓰기 실패: 알리고, 스냅샷을 롤백해 다음 commit에서 재시도 --- */
  E('setEditMode(true)');
  E('commit();');
  await wait(80);
  T('G0 편집 모드 복귀 후 밀린 변경이 서버에 반영', stub.getPath('worldmind/tabs/i500/nodes/iVIEW')?.name === '보기모드 추가');
  stub.setFailing(true);
  writeLog.length = 0;
  E("nodeById(curTab(),'iVIEW').name = '실패할 이름'; commit();");
  await wait(80);
  T('G1 실패를 토스트로 알림', [...doc.querySelectorAll('.toast.err')].some(t => t.textContent.includes('저장하지 못했습니다')));
  T('G2 상태 칩이 저장 실패로', doc.getElementById('syncTxt').textContent === '저장 실패');
  T('G3 서버에는 반영되지 않음', stub.getPath('worldmind/tabs/i500/nodes/iVIEW').name === '보기모드 추가');
  stub.setFailing(false);
  E('commit();');                                    // 데이터는 그대로 — 스냅샷 롤백 덕에 재전송돼야 한다
  await wait(80);
  T('G4 스냅샷 롤백 → 다음 commit에서 재시도 성공', stub.getPath('worldmind/tabs/i500/nodes/iVIEW').name === '실패할 이름');
  T('G5 복구되면 상태 칩도 돌아옴', doc.getElementById('syncTxt').textContent === '실시간 동기화');

  /* --- H. 탭 삭제는 원자적 — 반쪽 상태(목록에만 남는 고아)를 만들지 않는다 --- */
  E("tabs.push(sanitizeTab({id:'iDEL', title:'지울 탭', nodes:[{id:'iDELn', type:'item', name:'짐', desc:'', x:2100, y:2100}], edges:[], events:[]})); renderTabs(); commit();");
  stub.setPath('worldmind/tabs/iDEL', {meta:{title:'iDEL', worldPrompt:'', _w:'sOTHER'}, nodes:{iDELn:{type:'item', name:'짐', desc:'', x:2100, y:2100, _w:'sOTHER'}}, edges:{}, events:{}});
  await wait(80);
  T('H0 준비: 목록·내용이 서버에 모두 존재', (stub.getPath('worldmind/tabList') || []).some(x => x.id === 'iDEL') && !!stub.getPath('worldmind/tabs/iDEL'));
  writeLog.length = 0;
  E("askDeleteTab(tabs.find(t=>t.id==='iDEL'))");
  doc.querySelector('.ov [data-a=k], .ov .btn.danger, .ov [data-a=o]')?.click();
  await wait(120);
  const upd = writeLog.filter(w => w.path === 'UPDATE');
  T('H1 삭제가 원자적 update 1회', upd.length === 1 && upd[0].keys.includes('worldmind/tabs/iDEL') && upd[0].keys.includes('worldmind/tabList'), writeLog);
  T('H2 tabList 단독 set 없음', writeLog.filter(w => w.path === 'worldmind/tabList').length === 0, writeLog);
  T('H3 서버에서 목록·내용 모두 제거', !(stub.getPath('worldmind/tabList')||[]).some(x=>x.id==='iDEL') && !stub.getPath('worldmind/tabs/iDEL'));

  /* --- I. 삭제 실패 시 반쪽 상태 대신 통째로 되돌린다 --- */
  E("tabs.push(sanitizeTab({id:'iDEL2', title:'지울 탭2', nodes:[{id:'iDEL2n', type:'item', name:'짐2', desc:'', x:2200, y:2200}], edges:[], events:[]})); renderTabs(); commit();");
  stub.setPath('worldmind/tabs/iDEL2', {meta:{title:'iDEL2', worldPrompt:'', _w:'sOTHER'}, nodes:{iDEL2n:{type:'item', name:'짐', desc:'', x:2100, y:2100, _w:'sOTHER'}}, edges:{}, events:{}});
  await wait(80);
  T('I0 준비: 목록·내용이 서버에 모두 존재', (stub.getPath('worldmind/tabList') || []).some(x => x.id === 'iDEL2') && !!stub.getPath('worldmind/tabs/iDEL2'));
  stub.setFailPath(p => p === 'worldmind/tabList' || p === 'worldmind/tabs/iDEL2');
  E("askDeleteTab(tabs.find(t=>t.id==='iDEL2'))");
  doc.querySelector('.ov [data-a=k], .ov .btn.danger, .ov [data-a=o]')?.click();
  await wait(120);
  T('I1 실패하면 탭이 되살아남', E("tabs.some(t=>t.id==='iDEL2')"));
  T('I2 서버도 삭제 전 그대로', (stub.getPath('worldmind/tabList')||[]).some(x=>x.id==='iDEL2') && !!stub.getPath('worldmind/tabs/iDEL2'));
  T('I3 되돌림을 사용자에게 알림', [...doc.querySelectorAll('.toast.err')].some(t => t.textContent.includes('되돌렸습니다')));
  stub.setFailPath(null);
  E("askDeleteTab(tabs.find(t=>t.id==='iDEL2'))");
  doc.querySelector('.ov [data-a=k], .ov .btn.danger, .ov [data-a=o]')?.click();
  await wait(120);
  T('I4 재시도하면 정상 삭제', !E("tabs.some(t=>t.id==='iDEL2')") && !stub.getPath('worldmind/tabs/iDEL2'));

  /* --- J. 이미 생긴 고아 치유: tabList 에만 남은 탭이 빈 탭으로 되살아나지 않는다 --- */
  /*    (사용자 보고 증상 — 탭 삭제가 반쪽만 반영된 서버 상태로 새로 부팅) */
  const bootWith = (server, pre) => {
    const st = makeFirebaseStub(server, []);
    const d = new JSDOM(html, {runScripts:'dangerously', url:'https://localhost/', beforeParse(w){
      w.localStorage.setItem('wm_fbcfg', '{"apiKey":"x","databaseURL":"https://t.firebasedatabase.app"}');
      w.sessionStorage.setItem('wm_tok', 'TOK');
      w.sessionStorage.setItem('wm_tok_exp', String(Date.now() + 3600e3));   // 편집 모드로 복원 → 청소 대상
      w.firebase = st.firebase;
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.PointerEvent = w.MouseEvent;
      pre && pre(w, st);
    }});
    return {st, win: d.window, E: c => d.window.eval(c)};
  };
  const liveTab = {meta:{title:'살아있는 탭', worldPrompt:'', _w:'sOTHER'},
    nodes:{a1:{type:'world', name:'세계', desc:'', x:2000, y:2000, _w:'sOTHER'}}, edges:{}, events:{}};

  {
    const {st, E: EJ} = bootWith({
      'worldmind': {tabList:[{id:'tA', title:'살아있는 탭'}, {id:'tGHOST', title:'유령 탭'}], tabs:{tA: liveTab}},
      '.info': {connected: true}
    });
    await wait(400);
    T('J1 편집 모드 복원 확인', EJ('editMode') === true);
    T('J2 고아 탭이 정리됨', EJ("tabs.map(t=>t.id).join(',')") === 'tA', EJ("tabs.map(t=>t.id+':'+t.nodes.length).join(',')"));
    T('J3 서버 tabList 도 교정됨', (st.getPath('worldmind/tabList')||[]).map(x=>x.id).join(',') === 'tA');
    T('J4 살아있는 탭의 내용은 보존', EJ('tabs[0].nodes.length') === 1);
  }

  /* --- K. 오탐 방지: 다른 기기가 방금 만든 탭(내용이 늦게 도착)은 지우지 않는다 --- */
  {
    const {st, E: EK} = bootWith({
      'worldmind': {tabList:[{id:'tA', title:'살아있는 탭'}, {id:'tNEW', title:'막 만든 탭'}], tabs:{tA: liveTab}},
      '.info': {connected: true}
    });
    setTimeout(() => st.setPath('worldmind/tabs/tNEW', {meta:{title:'막 만든 탭', worldPrompt:'', _w:'sOTHER'},
      nodes:{n1:{type:'char', name:'늦게 온 노드', desc:'', x:2100, y:2100, _w:'sOTHER'}}, edges:{}, events:{}}), 20);
    await wait(400);
    T('K1 늦게 도착한 탭은 지우지 않음', EK("tabs.map(t=>t.id).sort().join(',')") === 'tA,tNEW', EK("tabs.map(t=>t.id).join(',')"));
    T('K2 늦게 온 내용이 채워짐', EK("(tabs.find(t=>t.id==='tNEW')||{nodes:[]}).nodes.length") === 1);
    T('K3 서버 tabList 는 건드리지 않음', (st.getPath('worldmind/tabList')||[]).map(x=>x.id).sort().join(',') === 'tA,tNEW');
  }

  T('전 과정 예외 없음', errs.length === 0, errs);
  console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('테스트 자체 오류:', e); process.exit(1); });
