/**
 * WorldMind API 프록시 — Cloudflare Worker
 *
 * 역할
 *  - POST /api/auth    : 마스터 코드 검증 → 12시간 서명 토큰 발급
 *  - POST /api/claude  : (토큰 필요) Anthropic Messages API 대리 호출
 *  - POST /api/gemini  : (토큰 필요) Google Gemini generateContent 대리 호출
 *  - GET  /api/health  : 동작 확인
 *
 * 비밀 변수 (Settings → Variables and Secrets 에서 Secret 으로 등록)
 *  - ANTHROPIC_API_KEY  (필수)
 *  - MASTER_CODE        (필수) 사용자가 🔒 버튼에 입력하는 코드
 *  - GOOGLE_API_KEY     (선택) 이미지 생성을 쓸 때만
 *  - TOKEN_SECRET       (선택) 미설정 시 MASTER_CODE에서 파생 → 코드를 바꾸면 기존 토큰이 모두 만료됨
 *
 * 일반 변수 (Text)
 *  - ALLOWED_ORIGINS    허용할 사이트 주소. 쉼표로 여러 개. 예) https://myname.github.io
 *                       로컬 파일(file://)로 테스트하려면 null 을 추가. 전부 허용은 *
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

    try{
      if(url.pathname === '/api/health') return json({ok:true, time:Date.now()}, 200, cors);
      if(url.pathname === '/api/auth' && request.method === 'POST') return handleAuth(request, env, cors);

      const ok = await verifyToken(bearer(request), env);
      if(!ok) return json({error:{message:'unauthorized'}}, 401, cors);

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
  const list = allowedList(env);
  if(list.includes('*')) return true;
  if(!origin) return false;
  return list.includes(origin);
}
function corsHeaders(origin, env){
  const list = allowedList(env);
  const allow = list.includes('*') ? '*' : (list.includes(origin) ? origin : 'null');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  return json({token, exp}, 200, cors);
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

  const r = await fetch(ANTHROPIC_URL, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version':'2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers:{...cors, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
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
    headers:{...cors, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
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
