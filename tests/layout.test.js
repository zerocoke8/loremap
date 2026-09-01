/* §5-4 방사형 정렬 + §5-8 곡선 연결선 선택 + FB 정규화/cleanTab */
const {boot, makeT, wait} = require('./helpers');
const {T, done} = makeT();
(async () => {
  const {E} = boot(); await wait(200);
  const tab = {id:'i1', title:'t', nodes:[], edges:[], events:[]};
  ['A','B','C','D','E','F','G','H','X','Y'].forEach(k => tab.nodes.push({id:k, type:'char', name:k, desc:'', x:0, y:0}));
  [['A','B'],['A','C'],['B','D'],['B','E'],['B','F'],['G','H']].forEach(([f,t]) => tab.edges.push({id:'e'+f+t, from:f, to:t, isParent:true}));
  tab.edges.push({id:'rXY', from:'X', to:'Y', label:'x', isParent:false});
  const pos = E(`computeRadialLayout(${JSON.stringify(tab)})`);
  T('모든 노드 배치', tab.nodes.every(n => pos[n.id] && Number.isFinite(pos[n.id].x)));
  const cs = tab.nodes.map(n => ({id:n.id, x:pos[n.id].x + 100, y:pos[n.id].y + 35}));
  let minD = Infinity;
  for(let i = 0; i < cs.length; i++) for(let j = i+1; j < cs.length; j++) minD = Math.min(minD, Math.hypot(cs[i].x-cs[j].x, cs[i].y-cs[j].y));
  T('최소 간격 219px 이상(반발)', minD >= 219, Math.round(minD));
  T('캔버스 경계 내', cs.every(c => c.x > 100 && c.x < 3900 && c.y > 100 && c.y < 3900));
  const t2 = {id:'i2', nodes:[{id:'A',type:'char',name:'A',x:0,y:0},{id:'B',type:'char',name:'B',x:0,y:0}], edges:[{id:'e1',from:'A',to:'B',isParent:true}], events:[]};
  const p2 = E(`computeRadialLayout(${JSON.stringify(t2)})`);
  T('단일 트리 루트 ≈ 중심', Math.hypot(p2.A.x + 100 - 2000, p2.A.y + 35 - 2000) < 120);

  const A = {x:0,y:0}, B = {x:800,y:0};
  const K = obs => E(`chooseCurve(${JSON.stringify(A)},${JSON.stringify(B)},{from:'a',to:'b'},${JSON.stringify(obs)})`);
  const minDist = (k,o) => { let m = Infinity; for(let s = 1; s < 40; s++){ const t = s/40, w = 2*t*(1-t); m = Math.min(m, Math.hypot(800*t - o.x, w*k - o.y) - o.r); } return m; };
  let k = K([]); T('장애물 없음 → 완만한 기본 굴곡', Math.abs(k) > 0 && Math.abs(k)/2 <= 20, k);
  const o = {id:'x', x:400, y:0, r:110}; k = K([o]); T('경로 위 노드 회피(여유 ≥ 20px)', minDist(k,o) >= 20 && Math.abs(k) <= 400, [k, minDist(k,o)]);
  const o2 = {id:'y', x:400, y:60, r:90}; k = K([o2]); T('치우친 노드 → 반대쪽으로', k < 0 && minDist(k,o2) >= 20, k);
  T('양끝 노드 제외', Math.abs(K([{id:'a',x:0,y:0,r:100},{id:'b',x:800,y:0,r:100}]))/2 <= 20);
  T('아주 짧은 선은 직선', E(`chooseCurve({x:0,y:0},{x:20,y:0},{from:'a',to:'b'},[])`) === 0);

  T('normFB 키 순서/반올림 안정', E(`JSON.stringify(normFB('nodes',{x:10.4,name:'a',y:20,type:'char',desc:'d'}))===JSON.stringify(normFB('nodes',{type:'char',name:'a',desc:'d',x:10,y:20}))`));
  const ct = E(`cleanTab({id:'i9',title:'t',worldPrompt:'w',refImages:[],nodes:[{id:'n1',type:'char',name:'a',desc:'',x:1.6,y:2,_exp:true,_w:'s1'},{id:'n2',type:'char',name:'p',desc:'',x:0,y:0,_aiPreview:true}],edges:[{id:'e1',from:'n1',to:'n2',isParent:true,_aiPreview:true}],events:[{id:'v1',time:'',body:'b',order:5,_w:'s2'}]})`);
  T('cleanTab: 미리보기·런타임 필드 제거, 좌표 반올림', ct.nodes.length === 1 && ct.edges.length === 0 && !('_exp' in ct.nodes[0]) && !('_w' in ct.events[0]) && ct.nodes[0].x === 2);
  done();
})();
