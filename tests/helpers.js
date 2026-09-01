/* 공통 헬퍼: index.html을 jsdom으로 띄운다.
 * 주의: 앱의 최상위 let/const/function은 window 속성이 아니므로 상태 접근은 반드시 win.eval(...)로. */
const {JSDOM} = require('jsdom');
const fs = require('fs'), path = require('path');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

function loadHtml(patch){
  let html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace(/<script src="https:[^"]+"><\/script>/g, '');   // CDN(폰트·Firebase) 제거 — 오프라인 테스트
  return patch ? patch(html) : html;
}
function boot({patch, pre, url = 'https://localhost/'} = {}){
  const dom = new JSDOM(loadHtml(patch), {runScripts:'dangerously', url,
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
module.exports = {boot, loadHtml, makeT, wait, HTML_PATH};
