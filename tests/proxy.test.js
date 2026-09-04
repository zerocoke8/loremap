const {JSDOM}=require('jsdom');
const {neutralizeDeploy}=require('./helpers');
let html=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/<script src="https:[^"]+"><\/script>/g,'');
/* 실제 배포값이 무엇이든 테스트용 주소로 갈아끼운다(리터럴 치환은 값이 채워지면 조용히 no-op 이 된다) */
html=neutralizeDeploy(html,{apiBase:'https://api.test'});
let p=0,f=0;const T=(n,c,x)=>{c?p++:f++;console.log((c?'  ok  ':'FAIL  ')+n+(x!==undefined&&!c?' → '+JSON.stringify(x):''))};
const calls=[];
let fbTokenOut=null;        // Worker 가 Firebase 커스텀 토큰을 함께 주는 상황 재현
const J=(o,s)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
function boot(pre){const d=new JSDOM(html,{runScripts:'dangerously',url:'https://me.github.io/',beforeParse(w){
  w.fetch=async(url,init)=>{calls.push({url,init});const body=init&&init.body?JSON.parse(init.body):{};
    if(url.endsWith('/api/auth')) return body.code==='good'? J(fbTokenOut?{token:'TOK',exp:Date.now()+3600e3,fbToken:fbTokenOut}:{token:'TOK',exp:Date.now()+3600e3},200) : J({error:{message:'invalid code'}},401);
    if(url.endsWith('/api/fbtoken')) return fbTokenOut? J({fbToken:fbTokenOut},200) : J({error:{message:'FIREBASE_SERVICE_ACCOUNT 가 설정되지 않았습니다'}},503);
    if(url.endsWith('/api/claude')){ if((init.headers||{}).authorization!=='Bearer TOK') return J({error:{message:'unauthorized'}},401); return J({content:[{type:'text',text:'AI 답변'}]},200); }
    return J({},404);};
  pre&&pre(w);w.requestAnimationFrame=cb=>setTimeout(cb,16);w.PointerEvent=w.MouseEvent;}});return d.window;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const w=boot();const doc=w.document,E=c=>w.eval(c); await wait(300);
 doc.getElementById('btnSettings').click();
 T('설정에 API 키/마스터코드 입력란 없음', !doc.querySelector('#stK') && !doc.querySelector('#stGk') && !doc.querySelector('#stMn'));
 T('설정에 서버 주소 안내', doc.querySelector('.ov').textContent.includes('https://api.test')); doc.querySelector('.ov [data-a=c]').click();
 E("openPanel('chat')"); doc.getElementById('chatText').value='안녕'; doc.getElementById('chatSend').click(); await wait(60);
 T('토큰 없이 AI 호출 → 잠금 해제 안내, 서버 미호출', doc.querySelector('.toast.err')?.textContent.includes('잠금 해제') && !calls.some(c=>c.url.endsWith('/api/claude')));
 doc.getElementById('btnLock').click(); let ov=doc.querySelector('.ov');
 T('잠금 해제 모달', !!ov.querySelector('#ulCode'));
 ov.querySelector('#ulCode').value='bad'; ov.querySelector('[data-a=k]').click(); await wait(60);
 T('불일치 → 오류 토스트, 보기 모드 유지', !E('editMode') && [...doc.querySelectorAll('.toast')].some(t=>t.textContent.includes('일치하지')));
 ov.querySelector('#ulCode').value='good'; ov.querySelector('[data-a=k]').click(); await wait(60);
 T('일치 → 편집 모드 + 토큰 세션 저장', E('editMode') && w.sessionStorage.getItem('wm_tok')==='TOK' && !doc.querySelector('.ov'));
 T('코드는 브라우저에 저장 안 됨', !w.localStorage.getItem('wm_mh') && !Object.keys(w.localStorage).some(k=>/mh|code/.test(k)));
 doc.getElementById('chatText').value='세계관 알려줘'; doc.getElementById('chatSend').click(); await wait(80);
 const c=calls.find(c=>c.url.endsWith('/api/claude'));
 T('AI 호출이 프록시로 감 (모델·시스템·메시지, 키 없음)', !!c && c.url==='https://api.test/api/claude' && JSON.parse(c.init.body).model===E('AI_MODEL') && !!JSON.parse(c.init.body).system && !c.init.headers['x-api-key']);
 T('AI 답변 표시', E("tabs[0]._chat.some(m=>m.role==='assistant'&&m.content==='AI 답변')"));
 const w2=boot(x=>{x.sessionStorage.setItem('wm_tok','TOK');x.sessionStorage.setItem('wm_tok_exp',String(Date.now()+3600e3));}); await wait(300);
 T('새로고침 후 같은 세션이면 편집 모드 유지', w2.eval('editMode')===true && w2.document.body.classList.contains('edit'));
 w2.sessionStorage.setItem('wm_tok','STALE');
 w2.eval("openPanel('chat')"); w2.document.getElementById('chatText').value='x'; w2.document.getElementById('chatSend').click(); await wait(80);
 T('401 → 토큰 삭제 + 보기 모드 복귀 + 안내', w2.eval('editMode')===false && !w2.sessionStorage.getItem('wm_tok') && [...w2.document.querySelectorAll('.toast')].some(t=>t.textContent.includes('만료')));
 w2.eval('setEditMode(true)'); w2.sessionStorage.setItem('wm_tok','TOK'); w2.document.getElementById('btnLock').click();
 T('다시 잠그면 토큰 삭제', w2.eval('editMode')===false && !w2.sessionStorage.getItem('wm_tok'));
 const w3=boot(); await wait(300);
 T('만료 토큰은 자동 편집모드 아님', w3.eval('editMode')===false);
 /* ---- Firebase 편집 세션 (커스텀 토큰) ---- */
 const fakeAuth = x => {
   x.__si = []; x.__so = 0;
   x.firebase = {auth(){ return {
     signInWithCustomToken: t => { x.__si.push(t); return Promise.resolve(); },
     signOut: () => { x.__so++; return Promise.resolve(); }
   };}};
 };

 /* 서비스 계정 미설정 — fbToken 이 없어도 잠금 해제·편집이 그대로 된다 */
 fbTokenOut = null;
 const wA = boot(fakeAuth); await wait(300);
 wA.eval("fbApp = {auth: () => firebase.auth()};");
 wA.document.getElementById('btnLock').click();
 wA.document.querySelector('#ulCode').value='good';
 wA.document.querySelector('.ov [data-a=k]').click(); await wait(80);
 T('fbToken 없어도 편집 모드 진입', wA.eval('editMode') === true);
 T('fbToken 없으면 로그인 시도 안 함', wA.__si.length === 0 && wA.eval('fbAuthed') === false);

 /* 서비스 계정 설정 — 잠금 해제와 함께 Firebase 로그인 */
 fbTokenOut = 'FBTOK';
 const wB = boot(fakeAuth); await wait(300);
 wB.eval("fbApp = {auth: () => firebase.auth()};");
 wB.document.getElementById('btnLock').click();
 wB.document.querySelector('#ulCode').value='good';
 wB.document.querySelector('.ov [data-a=k]').click(); await wait(120);
 T('잠금 해제 시 커스텀 토큰으로 로그인', wB.__si.length === 1 && wB.__si[0] === 'FBTOK', wB.__si);
 T('편집 세션 표시', wB.eval('fbAuthed') === true);

 /* 다시 잠그면 Firebase 세션도 끊는다 */
 wB.document.getElementById('btnLock').click(); await wait(80);
 T('잠그면 signOut', wB.__so === 1 && wB.eval('fbAuthed') === false);
 T('잠그면 편집 토큰도 삭제', !wB.sessionStorage.getItem('wm_tok'));

 /* 새로고침 복원 — 편집 토큰이 살아 있으면 커스텀 토큰을 새로 받아 로그인 */
 const wC = boot(x => { fakeAuth(x); x.sessionStorage.setItem('wm_tok','TOK');
   x.sessionStorage.setItem('wm_tok_exp', String(Date.now()+3600e3)); });
 await wait(300);
 wC.eval("fbApp = {auth: () => firebase.auth()}; fbReady = true; fbRefreshSession();");
 await wait(120);
 T('새로고침 후 커스텀 토큰 재발급으로 로그인', wC.__si.length === 1 && wC.__si[0] === 'FBTOK');

 /* 503(서비스 계정 미설정)이면 조용히 넘어간다 */
 fbTokenOut = null;
 const wD = boot(x => { fakeAuth(x); x.sessionStorage.setItem('wm_tok','TOK');
   x.sessionStorage.setItem('wm_tok_exp', String(Date.now()+3600e3)); });
 await wait(300);
 wD.eval("fbApp = {auth: () => firebase.auth()}; fbReady = true; fbRefreshSession();");
 await wait(120);
 T('재발급 503 은 조용히 무시', wD.__si.length === 0 && wD.eval('fbAuthed') === false);

 console.log('결과: '+p+' 통과 / '+f+' 실패'); process.exit(f?1:0);
})();
