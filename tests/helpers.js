/* 공통 헬퍼: index.html을 jsdom으로 띄운다.
 * 주의: 앱의 최상위 let/const/function은 window 속성이 아니므로 상태 접근은 반드시 win.eval(...)로. */
const {JSDOM} = require('jsdom');
const fs = require('fs'), path = require('path');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

/* ★ 배포 설정 중화 — index.html 에는 실제 운영값(API_BASE·FIREBASE_CONFIG)이 커밋되어 있다.
   예전에는 각 테스트가 "const API_BASE = '';" 를 리터럴로 치환했는데, 값이 채워지자
   그 치환이 조용한 no-op 이 되어 테스트가 운영 URL 을 겨냥하게 됐다.
   정규식으로 값과 무관하게 갈아끼워, 배포값이 있든 없든 결과가 같도록 한다. */
function neutralizeDeploy(html, {apiBase = '', firebase = 'null'} = {}){
  const out = html
    .replace(/const API_BASE = '[^']*';/, "const API_BASE = '" + apiBase + "';")
    .replace(/const FIREBASE_CONFIG = [^\r\n]*;/, 'const FIREBASE_CONFIG = ' + firebase + ';');
  if(out.indexOf("const API_BASE = '" + apiBase + "';") < 0)
    throw new Error('배포 설정 중화 실패 — index.html 의 API_BASE 선언 형태가 바뀌었습니다');
  if(out.indexOf('const FIREBASE_CONFIG = ' + firebase + ';') < 0)
    throw new Error('배포 설정 중화 실패 — index.html 의 FIREBASE_CONFIG 선언 형태가 바뀌었습니다');
  return out;
}

function loadHtml(patch, deploy){
  let html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace(/<script src="https:[^"]+"><\/script>/g, '');   // CDN(폰트·Firebase) 제거 — 오프라인 테스트
  html = neutralizeDeploy(html, deploy);
  return patch ? patch(html) : html;
}
function boot({patch, pre, deploy, url = 'https://localhost/'} = {}){
  const dom = new JSDOM(loadHtml(patch, deploy), {runScripts:'dangerously', url,
    beforeParse(w){
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.PointerEvent = w.MouseEvent;
      pre && pre(w);
    }});
  const win = dom.window;
  return {win, doc: win.document, E: code => win.eval(code)};
}
function makeT(){
  let pass = 0, fail = 0;
  const T = (name, cond, extra) => {
    if(cond){ pass++; console.log('  ok  ' + name); }
    else{ fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
  };
  const done = () => { console.log('결과: ' + pass + ' 통과 / ' + fail + ' 실패'); process.exit(fail ? 1 : 0); };
  return {T, done};
}
const wait = ms => new Promise(r => setTimeout(r, ms));
module.exports = {boot, loadHtml, neutralizeDeploy, makeT, wait, HTML_PATH};
