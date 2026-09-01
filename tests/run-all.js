/* 모든 테스트를 순서대로 실행. 하나라도 실패하면 종료 코드 1 */
const {spawnSync} = require('child_process');
const path = require('path');
const files = ['parse.test.js','layout.test.js','dom.test.js','fb.test.js','proxy.test.js','worker.test.mjs'];
let failed = [];
for(const f of files){
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {stdio:'inherit'});
  if(r.status !== 0) failed.push(f);
}
console.log('\n' + (failed.length ? '실패: ' + failed.join(', ') : '전체 통과 ✔'));
process.exit(failed.length ? 1 : 0);
