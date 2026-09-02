/* index.html 안의 <script> 본문 문법 검사 (npm run check)
 *
 * 예전에는 package.json 에 정규식을 인라인으로 박아 두었는데 두 가지가 깨져 있었다.
 *   · 정규식이 \n 만 인정해 CRLF 로 체크아웃한 윈도우에서는 매칭 자체가 실패
 *   · 임시 파일을 rm 으로 지워서 cmd.exe(윈도우 기본 셸)에서는 명령을 찾지 못함
 * vm.Script 는 컴파일만 하고 실행하지 않으므로 임시 파일 없이 문법만 검사할 수 있다. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/\r?\n<script>\r?\n([\s\S]*?)\r?\n<\/script>/);

if(!m){
  console.error('index.html 에서 <script> 본문을 찾지 못했습니다.');
  process.exit(1);
}

try{
  new vm.Script(m[1], {filename: 'index.html <script>'});   // 컴파일만 — 실행하지 않는다
  console.log('index.html 스크립트 문법 OK (' + m[1].split('\n').length + '줄)');
}catch(err){
  console.error('index.html 스크립트 문법 오류: ' + err.message);
  process.exit(1);
}
