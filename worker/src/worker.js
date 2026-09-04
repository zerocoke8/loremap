/**
 * WorldMind API 프록시 — Cloudflare Worker
 *
 * 역할
 *  - POST /api/auth    : 마스터 코드 검증 → 12시간 서명 토큰 발급 (+ Firebase 커스텀 토큰)
 *  - POST /api/fbtoken : (토큰 필요) Firebase 커스텀 토큰 재발급 — Firebase 세션은 1시간이라 갱신이 필요하다
 *  - POST /api/claude  : (토큰 필요) Anthropic Messages API 대리 호출
 *  - POST /api/gemini  : (토큰 필요) Google Gemini generateContent 대리 호출
 *  - GET  /api/health  : 동작 확인
 *
 * 비밀 변수 (Settings → Variables and Secrets 에서 Secret 으로 등록)
 *  - ANTHROPIC_API_KEY  (필수)
 *  - MASTER_CODE        (필수) 사용자가 🔒 버튼에 입력하는 코드
 *  - GOOGLE_API_KEY     (선택) 이미지 생성을 쓸 때만
 *  - ANTHROPIC_WORKSPACE_ID (선택) 키가 여러 워크스페이스용(개인/서비스 계정 키)이면 필요. wrkspc_… 형식.
 *                       콘솔 Settings → Workspaces 의 ID 열. 단일 워크스페이스 키면 비워둠.
 *  - TOKEN_SECRET       (선택) 미설정 시 MASTER_CODE에서 파생 → 코드를 바꾸면 기존 토큰이 모두 만료됨
 *  - FIREBASE_SERVICE_ACCOUNT (선택) Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → '새 비공개 키 생성'
 *                       으로 받은 JSON 파일 내용 전체를 그대로 한 값으로 붙여넣는다.
 *                       설정하면 마스터 코드 검증에 성공한 사람에게만 Firebase 쓰기 권한을 준다.
 *                       미설정이면 fbToken 을 생략하고 지금까지처럼 동작한다(앱이 깨지지 않는다).
 *
 * 일반 변수 (Text)
 *  - ALLOWED_ORIGINS    허용할 사이트 주소(도메인까지만, 끝에 / 없이). 쉼표로 여러 개. 예) https://myname.github.io
 *                       로컬 파일(file://)로 테스트하려면 null 을 추가. 전부 허용은 *
 *                       브라우저 페이지에서 오는 요청(Origin 헤더 있음)만 검사하며, 주소창 직접 입력·curl은 통과
 */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;   // 12시간
const MAX_TOKENS_CAP = 8192;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if(request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
    if(!url.pathname.startsWith('/api/')) return json({error:{message:'not found'}}, 404, cors);
    if(!originAllowed(origin, env)) return json({error:{message:'origin not allowed: ' + origin}}, 403, cors);
    /* 마스터 코드 검증만은 브라우저 페이지에서 온 요청으로 한정한다 —
       originAllowed 는 Origin 없는 요청(curl 등)을 통과시키므로 무차별 대입 표면이 된다.
       허용 목록이 * 이면 이 제한도 두지 않는다(개발용). */
    if(url.pathname === '/api/auth' && !origin && !allowedList(env).includes('*')){
      return json({error:{message:'origin required'}}, 403, cors);
    }

    try{
      if(url.pathname === '/api/health') return json({ok:true, time:Date.now()}, 200, cors);
      if(url.pathname === '/api/auth' && request.method === 'POST') return handleAuth(request, env, cors);

      const ok = await verifyToken(bearer(request), env);
      if(!ok) return json({error:{message:'unauthorized'}}, 401, cors);

      if(url.pathname === '/api/fbtoken' && request.method === 'POST') return handleFbToken(env, cors);
      if(url.pathname === '/api/claude' && request.method === 'POST') return handleClaude(request, env, cors);
      if(url.pathname === '/api/gemini' && request.method === 'POST') return handleGemini(request, env, cors);
      return json({error:{message:'not found'}}, 404, cors);
    }catch(err){
      return json({error:{message:String(err && err.message || err)}}, 500, cors);
    }
  }
};

/* ---------------- CORS ---------------- */
function allowedList(env){
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function originAllowed(origin, env){
  if(!origin) return true;   // 주소창 직접 입력·curl 등 Origin 없는 요청은 CORS 대상이 아님 (실제 보호는 토큰)
  const list = allowedList(env);
  if(list.includes('*')) return true;
  return list.includes(origin);
}
function corsHeaders(origin, env){
  const list = allowedList(env);
  const allow = list.includes('*') ? '*' : (list.includes(origin) ? origin : 'null');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-WM-Upstream',   // 브라우저가 표식을 읽을 수 있게
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status, cors){
  return new Response(JSON.stringify(obj), {
    status, headers: {...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}

/* ---------------- 인증 ---------------- */
async function handleAuth(request, env, cors){
  if(!env.MASTER_CODE) return json({error:{message:'MASTER_CODE 비밀 변수가 설정되지 않았습니다'}}, 500, cors);
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code : '';
  const match = code.length > 0 && await safeEqual(code, env.MASTER_CODE);
  if(!match){
    await sleep(700);                              // 무차별 대입 지연
    return json({error:{message:'invalid code'}}, 401, cors);
  }
  const exp = Date.now() + TOKEN_TTL_MS;
  const token = await signToken({exp, v:1}, env);
  /* Firebase 커스텀 토큰은 있으면 얹어 준다 — 서비스 계정이 없거나 서명에 실패해도
     200 과 token 은 그대로 내려야 AI 기능이 죽지 않는다 */
  const fbToken = await mintFbToken(env);
  return json(fbToken ? {token, exp, fbToken} : {token, exp}, 200, cors);
}

/* Firebase 세션(커스텀 토큰)은 1시간짜리라 12시간 편집 세션 도중 갱신이 필요하다.
   verifyToken 게이트 뒤에 있으므로 유효한 편집 토큰을 가진 사람만 재발급받는다. */
async function handleFbToken(env, cors){
  const fbToken = await mintFbToken(env);
  if(!fbToken) return json({error:{message:'FIREBASE_SERVICE_ACCOUNT 가 설정되지 않았습니다'}}, 503, cors);
  return json({fbToken}, 200, cors);
}

/* ---------------- Firebase 커스텀 토큰 (RS256) ---------------- */
/* 서비스 계정 개인키로 서명한 JWT. 클라이언트가 signInWithCustomToken 으로 교환하면
   규칙에서 auth.token.editor === true 로 편집자를 식별할 수 있다.
   uid 를 고정값으로 두는 이유: 이 앱은 세계관 하나를 여럿이 함께 보는 공용 데이터셋이라
   기기마다 다른 uid 를 주면 소유권 모델이 성립하지 않는다. */
const FB_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
let saCache = null;
function serviceAccount(env){
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw) return null;
  if(saCache && saCache.raw === raw) return saCache.sa;
  try{
    const sa = JSON.parse(raw);
    if(!sa.client_email || !sa.private_key) return null;
    saCache = {raw, sa};
    return sa;
  }catch(_){ return null; }
}
function pemToPkcs8(pem){
  const body = String(pem).replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function mintFbToken(env){
  const sa = serviceAccount(env);
  if(!sa) return null;
  try{
    const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key),
      {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign']);
    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(enc(JSON.stringify({alg:'RS256', typ:'JWT'})));
    /* iss/sub/aud/iat/exp/uid 는 예약어라 커스텀 클레임은 claims 안에 넣어야 한다 */
    const payload = b64url(enc(JSON.stringify({
      iss: sa.client_email, sub: sa.client_email, aud: FB_TOKEN_AUD,
      iat, exp: iat + 3600, uid: 'wm-editor', claims: {editor: true}
    })));
    const body = header + '.' + payload;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(body));
    return body + '.' + b64url(new Uint8Array(sig));
  }catch(err){
    console.error('Firebase 커스텀 토큰 발급 실패', err && err.message);
    return null;                       // AI 기능은 계속 되게 둔다
  }
}

function bearer(request){
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function hmacKey(env){
  const secret = env.TOKEN_SECRET || ('wm-token-v1:' + (env.MASTER_CODE || ''));
  return crypto.subtle.importKey('raw', enc(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify']);
}
async function signToken(payload, env){
  const p = b64url(enc(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc(p));
  return p + '.' + b64url(new Uint8Array(sig));
}
async function verifyToken(token, env){
  if(!token || !env.MASTER_CODE) return false;
  const i = token.indexOf('.');
  if(i < 0) return false;
  const p = token.slice(0, i), sig = token.slice(i + 1);
  let sigBytes;
  try{ sigBytes = b64urlDecode(sig); }catch(_){ return false; }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sigBytes, enc(p));
  if(!ok) return false;
  try{
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  }catch(_){ return false; }
}

/* 상수 시간 비교 (길이 차이도 노출하지 않도록 해시 후 비교) */
async function safeEqual(a, b){
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc(a)),
    crypto.subtle.digest('SHA-256', enc(b))
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for(let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------------- Anthropic 프록시 ---------------- */
async function handleClaude(request, env, cors){
  if(!env.ANTHROPIC_API_KEY) return json({error:{message:'ANTHROPIC_API_KEY 비밀 변수가 설정되지 않았습니다'}}, 500, cors);
  const b = await request.json().catch(() => null);
  if(!b || !Array.isArray(b.messages)) return json({error:{message:'bad request'}}, 400, cors);
  const model = typeof b.model === 'string' && /^claude-[\w.-]+$/.test(b.model) ? b.model : null;
  if(!model) return json({error:{message:'invalid model'}}, 400, cors);
  const payload = {
    model,
    max_tokens: Math.min(MAX_TOKENS_CAP, Math.max(1, Number(b.max_tokens) || 1024)),
    messages: b.messages
  };
  if(typeof b.system === 'string') payload.system = b.system;
  if(typeof b.temperature === 'number') payload.temperature = b.temperature;

  const headers = {
    'content-type':'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version':'2023-06-01'
  };
  const ws = String(env.ANTHROPIC_WORKSPACE_ID || '').trim();
  if(ws) headers['anthropic-workspace-id'] = ws;     // 다중 워크스페이스 키(개인/서비스 계정 키)용

  const r = await fetch(ANTHROPIC_URL, {method:'POST', headers, body: JSON.stringify(payload)});
  let text = await r.text();
  if(r.status === 400 && /anthropic-workspace-id/i.test(text)){
    text = JSON.stringify({error:{message:
      'Anthropic 키가 여러 워크스페이스용 키라서 워크스페이스 ID가 필요합니다. ' +
      'Worker 변수 ANTHROPIC_WORKSPACE_ID 에 콘솔(Settings → Workspaces)의 wrkspc_… ID를 넣고 Deploy 하거나, ' +
      '워크스페이스를 하나만 지정한 키를 새로 발급해 ANTHROPIC_API_KEY 를 교체하세요.'}});
  }
  return new Response(text, {
    status: r.status,
    /* X-WM-Upstream: 이 응답이 Anthropic 에서 그대로 넘어온 것이라는 표식.
       없으면 Worker 나 그 앞단(Cloudflare 등)이 만든 응답이다 — 오류 진단의 갈림길. */
    headers:{...cors, 'X-WM-Upstream':'anthropic',
             'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
  });
}

/* ---------------- Gemini 프록시 ---------------- */
async function handleGemini(request, env, cors){
  if(!env.GOOGLE_API_KEY) return json({error:{message:'이미지 생성이 설정되지 않았습니다 (GOOGLE_API_KEY 없음)'}}, 500, cors);
  const b = await request.json().catch(() => null);
  if(!b || !Array.isArray(b.contents)) return json({error:{message:'bad request'}}, 400, cors);
  const model = typeof b.model === 'string' && /^gemini-[\w.-]+$/.test(b.model) ? b.model : null;
  if(!model) return json({error:{message:'invalid model'}}, 400, cors);
  const payload = {contents: b.contents};
  if(b.generationConfig && typeof b.generationConfig === 'object') payload.generationConfig = b.generationConfig;

  const r = await fetch(GEMINI_BASE + encodeURIComponent(model) + ':generateContent', {
    method:'POST',
    headers:{'content-type':'application/json', 'x-goog-api-key': env.GOOGLE_API_KEY},
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers:{...cors, 'X-WM-Upstream':'gemini',
             'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
  });
}

/* ---------------- 유틸 ---------------- */
const enc = s => new TextEncoder().encode(s);
function b64url(bytes){
  let s = ''; for(const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(str){
  const s = str.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
