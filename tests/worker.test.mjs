const worker = (await import('../worker/src/worker.js')).default;
let pass = 0, fail = 0;
const T = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x !== undefined && !c ? ' → ' + JSON.stringify(x) : '')); };

const env = {ANTHROPIC_API_KEY:'sk-ant-TEST', GOOGLE_API_KEY:'g-TEST', MASTER_CODE:'my-secret-code-123', ALLOWED_ORIGINS:'https://me.github.io, null'};
const ORIGIN = 'https://me.github.io';
const call = (path, opts = {}, e = env) => worker.fetch(new Request('https://worker.test' + path, {
  method: opts.method || 'POST',
  headers: {'Origin': opts.origin ?? ORIGIN, 'content-type':'application/json', ...(opts.headers || {})},
  body: opts.body ? JSON.stringify(opts.body) : undefined
}), e);

/* 업스트림 fetch 목킹 */
let lastUpstream = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  lastUpstream = {url: String(url), init};
  if(String(url).includes('anthropic.com')) return new Response(JSON.stringify({content:[{type:'text', text:'응답'}]}), {status:200});
  if(String(url).includes('googleapis.com')) return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png', data:'AAAA'}}]}}]}), {status:200});
  return new Response('{}', {status:200});
};

/* CORS / 오리진 */
let r = await call('/api/health', {method:'OPTIONS'});
T('프리플라이트 204 + 허용 오리진 반영', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN);
r = await call('/api/health', {method:'GET', origin:'https://evil.example'});
T('허용되지 않은 오리진 403', r.status === 403);
r = await call('/api/health', {method:'GET', origin:'null'});
T('로컬 파일(null) 허용 시 통과', r.status === 200 && (await r.json()).ok === true);
r = await call('/api/health', {method:'GET'}, {...env, ALLOWED_ORIGINS:'*'});
T('와일드카드 허용', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');

/* 인증 */
const t0 = Date.now();
r = await call('/api/auth', {body:{code:'wrong'}});
T('코드 불일치 401 (+지연)', r.status === 401 && Date.now() - t0 >= 600);
r = await call('/api/auth', {body:{code:''}});
T('빈 코드 401', r.status === 401);
r = await call('/api/auth', {body:{code:'my-secret-code-123'}});
const auth = await r.json();
T('코드 일치 → 토큰·만료 발급', r.status === 200 && typeof auth.token === 'string' && auth.exp > Date.now() + 11*3600*1000);
r = await call('/api/auth', {body:{code:'x'}}, {...env, MASTER_CODE:undefined});
T('MASTER_CODE 미설정 시 500 안내', r.status === 500);

/* 토큰 검증 */
r = await call('/api/claude', {body:{model:'claude-opus-4-6', messages:[]}});
T('토큰 없으면 401', r.status === 401);
r = await call('/api/claude', {body:{model:'claude-opus-4-6', messages:[]}, headers:{Authorization:'Bearer ' + auth.token + 'x'}});
T('위조 토큰 401', r.status === 401);
r = await call('/api/claude', {body:{model:'claude-opus-4-6', messages:[]}, headers:{Authorization:'Bearer ' + auth.token}}, {...env, MASTER_CODE:'changed-code'});
T('마스터 코드 변경 시 기존 토큰 무효', r.status === 401);
{ // 만료 토큰: 같은 서명키로 exp 과거 페이로드 서명
  const enc = s => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey('raw', enc('wm-token-v1:' + env.MASTER_CODE), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const p = b64url(enc(JSON.stringify({exp: Date.now() - 1000, v:1})));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(p))));
  r = await call('/api/claude', {body:{model:'claude-opus-4-6', messages:[]}, headers:{Authorization:'Bearer ' + p + '.' + sig}});
  T('만료 토큰 401', r.status === 401);
}

/* Claude 프록시 */
const H = {Authorization:'Bearer ' + auth.token};
r = await call('/api/claude', {headers:H, body:{model:'claude-opus-4-6', max_tokens:99999, system:'sys', messages:[{role:'user', content:'hi'}], stream:true, extra:'x'}});
const cj = await r.json();
const sent = JSON.parse(lastUpstream.init.body);
T('Anthropic 업스트림 호출 + 응답 전달', r.status === 200 && cj.content[0].text === '응답' && lastUpstream.url.includes('api.anthropic.com'));
T('서버 키 사용 (클라이언트 키 불필요)', lastUpstream.init.headers['x-api-key'] === 'sk-ant-TEST' && lastUpstream.init.headers['anthropic-version'] === '2023-06-01');
T('필드 화이트리스트·max_tokens 상한', sent.max_tokens === 8192 && sent.system === 'sys' && !('stream' in sent) && !('extra' in sent));
r = await call('/api/claude', {headers:H, body:{model:'gpt-x', messages:[]}});
T('모델 ID 검증', r.status === 400);
r = await call('/api/claude', {headers:H, body:{model:'claude-opus-4-6'}});
T('messages 누락 400', r.status === 400);
T('응답 CORS 헤더', r.headers.get('Access-Control-Allow-Origin') === ORIGIN);

/* Gemini 프록시 */
r = await call('/api/gemini', {headers:H, body:{model:'gemini-3.1-flash-image-preview', contents:[{parts:[{text:'x'}]}], generationConfig:{responseModalities:['IMAGE','TEXT']}}});
const gj = await r.json();
T('Gemini 업스트림 호출 + 키 헤더', r.status === 200 && gj.candidates[0].content.parts[0].inlineData.data === 'AAAA' && lastUpstream.init.headers['x-goog-api-key'] === 'g-TEST' && lastUpstream.url.includes('gemini-3.1-flash-image-preview'));
r = await call('/api/gemini', {headers:H, body:{model:'../../evil', contents:[]}});
T('Gemini 모델 ID 검증', r.status === 400);
r = await call('/api/gemini', {headers:H, body:{model:'gemini-x', contents:[]}}, {...env, GOOGLE_API_KEY:undefined});
T('GOOGLE_API_KEY 없으면 친절한 500', r.status === 500 && (await r.json()).error.message.includes('GOOGLE_API_KEY'));

r = await call('/nope', {method:'GET'});
T('API 외 경로 404', r.status === 404);

globalThis.fetch = realFetch;
console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
