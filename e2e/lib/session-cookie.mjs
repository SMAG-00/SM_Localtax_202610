// 화면 경로 시험용 세션 쿠키 - 브라우저 없이 비밀번호 로그인으로 받은 세션을 sb-<ref>-auth-token 쿠키로 만든다.
// (화면 경로는 쿠키로만 사용자를 안다. API는 Bearer도 받는다. 브라우저가 필요한 시험은 기존 login(page) 방식을 쓴다.)
const jars = new Map();

export async function pageAuth(sb, user) {
  const key = `${sb.url}|${user.id}`;
  if (!jars.has(key)) {
    const res = await fetch(`${sb.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: sb.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!res.ok) throw new Error(`세션 쿠키용 로그인 실패 (${res.status})`);
    const value = "base64-" + Buffer.from(JSON.stringify(await res.json())).toString("base64url");
    const name = `sb-${new URL(sb.url).hostname.split(".")[0]}-auth-token`;
    const parts = value.length <= 3180 ? [[name, value]] : value.match(/.{1,3180}/g).map((p, i) => [`${name}.${i}`, p]);
    jars.set(key, { cookie: parts.map(([k, v]) => `${k}=${v}`).join("; ") });
  }
  return jars.get(key);
}
