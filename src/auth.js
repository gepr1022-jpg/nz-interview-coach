// 合い言葉(パスワード)による簡易認証。
// パスワード自体はCloudflareのSecretに保存し、ブラウザには署名付きの短いトークンだけを渡す。

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

// 一致比較のタイミング差から情報が漏れないよう、ハッシュ同士で比べる
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a || "")),
    crypto.subtle.digest("SHA-256", enc.encode(b || "")),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export const SESSION_DAYS = 30;

export async function createToken(secret) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(exp);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(secret, token) {
  if (!token || typeof token !== "string") return false;
  const idx = token.lastIndexOf(".");
  if (idx < 1) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(secret, payload);
  if (!(await safeEqual(sig, expected))) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `nzic_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return "nzic_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function checkPassword(env, given) {
  if (!env.APP_PASSWORD) return false;
  return safeEqual(given, env.APP_PASSWORD);
}

export async function isAuthed(request, env) {
  if (!env.SESSION_SECRET) return false;
  return verifyToken(env.SESSION_SECRET, readCookie(request, "nzic_session"));
}
