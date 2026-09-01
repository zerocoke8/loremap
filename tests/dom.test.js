const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8')
  // CDN(폰트·Firebase)은 오프라인 환경이므로 외부 리소스 로드는 생략 (typeof firebase === 'undefined' 경로 검증)
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

let pass = 0, fail = 0;
const T = (name, cond, extra) => {
  if(cond){ pass++; console.log('  ok  ' + name); }
  else{ fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

(async () => {
  /* ---- 시나리오 1: 기존 사용자 — localStorage에 구버전 데이터가 이미 존재 (§10) ---- */
  const legacy = {tabs:[{
    id:'i1000', title:'옛 세계관',
    nodes:[
      {id:'i1001', type:'world', name:'아르카디아', desc:'오래된 세계', x:1900, y:1900},
      {id:'i1002', type:'char',  name:'레온',       desc:'기사',       x:2200, y:2100}
    ],
    edges:[{id:'i1003', from:'i1001', to:'i1002', label:'거주', desc:'', isParent:true}],
    events:[{id:'i1004', time:'10년 전', body:'대전쟁', order:10}]
    /* worldPrompt / refImages 누락 → sanitizeTab 경유 검증 */
  }]};

  const dom = new JSDOM(html, {runScripts:'dangerously', url:'https://localhost/',
    beforeParse(win){
      win.localStorage.setItem('wm_tabs', JSON.stringify(legacy));
      win.requestAnimationFrame = cb => setTimeout(() => cb(win.performance.now()), 16);
      win.PointerEvent = win.MouseEvent;
    }});
  const win = dom.window, doc = win.document;
  const E = code => win.eval(code);
  const errs = [];
  win.addEventListener('error', e => errs.push(String(e.error || e.message)));

  await new Promise(r => setTimeout(r, 250));

  T('초기화 중 예외 없음', errs.length === 0, errs);
  T('기존 탭 로드', E("tabs.length===1 && tabs[0].title==='옛 세계관'"));
  T('sanitizeTab 누락 필드 보정', E("Array.isArray(tabs[0].refImages) && tabs[0].worldPrompt===''"));
  T('기존 노드 2개 렌더', doc.querySelectorAll('.node').length === 2);
  T('기존 관계 렌더(부모=실선)', doc.querySelectorAll('#edgeSvg .e-line.parent').length === 1);
  T('노드 좌표 보존', E('tabs[0].nodes[0].x===1900 && tabs[0].nodes[1].y===2100'));
  T('id 카운터 충돌 방지', E("gid()!=='i1001' && /^i\\d+$/.test(gid())"));
  T('오프라인 상태 칩', doc.getElementById('syncTxt').textContent === '오프라인');
  T('보기 전용 기본', E('editMode')===false && !doc.body.classList.contains('edit'));

  /* ---- 노드 클릭 → 펼침 + 선택 ---- */
  doc.querySelectorAll('.node')[0].dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  await new Promise(r => setTimeout(r, 40));
  T('클릭 → 펼침+선택', E("tabs[0].nodes[0]._exp===true && sel.nodeIds.includes('i1001')"));
  T('펼침 클래스 반영', doc.querySelector('.node.exp.sel') !== null);

  /* ---- _justDragged 클릭 억제 (§5-2 ⚠) ---- */
  E('_justDragged = true');
  doc.querySelectorAll('.node')[1].dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  await new Promise(r => setTimeout(r, 40));
  T('드래그 직후 클릭 억제', E('tabs[0].nodes[1]._exp!==true && _justDragged===false'));

  /* ---- 편집 모드 전환 (마스터코드 미설정 → 설정 모달 경유는 UI라 직접 호출) ---- */
  E('setEditMode(true)');
  await new Promise(r => setTimeout(r, 30));
  T('편집 모드 UI', doc.body.classList.contains('edit') && doc.getElementById('btnLock').textContent.includes('편집 중'));

  /* ---- 노드 추가 모달 → 저장 ---- */
  doc.getElementById('btnAddNode').click();
  const ov = doc.querySelector('.ov');
  T('노드 모달 열림', !!ov);
  ov.querySelector('#nmName').value = '새 탑';
  ov.querySelector('#nmDesc').value = '설명';
  ov.querySelector('[data-a=s]').click();
  await new Promise(r => setTimeout(r, 40));
  T('노드 추가 반영', E('tabs[0].nodes.length===3') && doc.querySelectorAll('.node').length === 3);

  /* ---- 사건 패널 ---- */
  doc.getElementById('btnEvents').click();
  await new Promise(r => setTimeout(r, 30));
  T('사건 패널 표시', !doc.getElementById('rp').hidden && doc.querySelectorAll('.ev').length === 1);

  /* ---- 관계 추가 모드 + ESC 취소 (§9) ---- */
  E("startLink('i1001')");
  T('관계 배너 표시', !doc.getElementById('linkBanner').hidden && E('linkMode.active'));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  T('ESC로 관계 모드 취소', !E('linkMode.active') && doc.getElementById('linkBanner').hidden);

  /* ---- 자동 저장 형식 (§2-1: JSON.stringify({tabs})) ---- */
  await new Promise(r => setTimeout(r, 1500));
  const saved = JSON.parse(win.localStorage.getItem('wm_tabs'));
  T('저장 형식 {tabs:[...]}', saved && Array.isArray(saved.tabs) && !Array.isArray(saved));
  T('저장에 런타임 필드 없음', saved.tabs[0].nodes.every(n => !('_exp' in n) && !('_aiPreview' in n)));
  T('저장에 새 노드 포함', saved.tabs[0].nodes.length === 3);

  /* ---- 탭 복제 (§5-1 ID 재발급·리맵) ---- */
  E('duplicateTab(tabs[0])');
  await new Promise(r => setTimeout(r, 60));
  const dup = E('tabs[1]');
  T('복제 탭 생성·전환', E('tabs.length===2') && E('activeTabId')===dup.id && dup.title === '복사_옛 세계관');
  const origIds = new Set(E('tabs[0].nodes.map(n=>n.id)'));
  T('복제 노드 ID 재발급', dup.nodes.every(n => !origIds.has(n.id)));
  const dupIds = new Set(dup.nodes.map(n => n.id));
  T('복제 엣지 리맵', dup.edges.every(e => dupIds.has(e.from) && dupIds.has(e.to)));

  /* ---- 마지막 탭 삭제 금지 ---- */
  E('tabs=[tabs[0]]; activeTabId=tabs[0].id;');
  E('askDeleteTab(tabs[0])');
  T('마지막 탭 삭제 불가', E('tabs.length')===1);

  T('전 과정 예외 없음', errs.length === 0, errs);
  console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('테스트 자체 오류:', e); process.exit(1); });
