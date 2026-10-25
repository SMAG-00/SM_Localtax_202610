// 가짜 PG 서버 (W10-f) — 토스페이먼츠 HTTP API 모양(승인 · 주문번호 조회 · 빌링키 발급 · 빌링 결제 · 취소)을 흉내 내는 로컬 서버.
// 시험 전용이다 (제품 코드는 이 파일을 불러오지 않는다). 실제 카드·실제 돈은 없다.
//  · 인증: Authorization: Basic base64(키:) 가 있어야 한다 (키 값은 보지 않는다).
//  · 시험 조작 경로(/__test/*): 결제 의도 등록, 상태 강제, 빌링키 실패 지정, 받은 호출 목록.
//  · 카드 인증은 브라우저와 PG 사이에서 끝난다는 가정 — 여기서는 "등록된 paymentKey/authKey"로 대신한다.
import http from "node:http";
import { createHmac } from "node:crypto";

export function signWebhookBody(secret, rawBody, transmissionTime) {
  return `v1:${createHmac("sha256", secret).update(`${rawBody}:${transmissionTime}`).digest("base64")}`;
}

export async function startFakePg({ port = 0 } = {}) {
  const payments = new Map(); // orderId -> payment
  const intents = new Map(); // paymentKey -> { orderId, amount }
  const authKeys = new Map(); // authKey -> customerKey
  const billing = new Map(); // billingKey -> { customerKey, fail }
  const calls = [];
  let seq = 0;

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });
  const view = (p) => ({ paymentKey: p.paymentKey, orderId: p.orderId, status: p.status, totalAmount: p.amount, method: "카드", approvedAt: p.approvedAt ?? null });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = req.method === "POST" ? await readBody(req) : {};
    const test = url.pathname.startsWith("/__test/");
    if (!test && !/^Basic\s+\S+/.test(req.headers.authorization ?? "")) return send(res, 401, { code: "UNAUTHORIZED_KEY", message: "인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다." });
    calls.push({ method: req.method, path: url.pathname.startsWith("/v1/billing/") && !url.pathname.includes("authorizations") ? "/v1/billing/{billingKey}" : url.pathname });

    if (test) {
      if (url.pathname === "/__test/intent") {
        intents.set(body.paymentKey, { orderId: body.orderId, amount: body.amount });
        return send(res, 200, {});
      }
      if (url.pathname === "/__test/auth-key") {
        authKeys.set(body.authKey, body.customerKey);
        return send(res, 200, {});
      }
      if (url.pathname === "/__test/status") {
        const p = payments.get(body.orderId);
        if (!p) return send(res, 404, { code: "NOT_FOUND_PAYMENT" });
        p.status = body.status;
        return send(res, 200, view(p));
      }
      if (url.pathname === "/__test/fail-billing") {
        const b = billing.get(body.billingKey);
        if (b) b.fail = body.fail !== false;
        return send(res, 200, {});
      }
      if (url.pathname === "/__test/calls") return send(res, 200, { calls });
      return send(res, 404, {});
    }

    if (req.method === "POST" && url.pathname === "/v1/payments/confirm") {
      const intent = intents.get(body.paymentKey);
      if (!intent || intent.orderId !== body.orderId) return send(res, 404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
      if (intent.amount !== body.amount) return send(res, 400, { code: "INVALID_REQUEST", message: "결제 금액이 일치하지 않습니다." });
      const p = { paymentKey: body.paymentKey, orderId: body.orderId, amount: body.amount, status: "DONE", approvedAt: new Date().toISOString() };
      payments.set(p.orderId, p);
      return send(res, 200, view(p));
    }
    const m = url.pathname.match(/^\/v1\/payments\/orders\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const p = payments.get(decodeURIComponent(m[1]));
      return p ? send(res, 200, view(p)) : send(res, 404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
    }
    if (req.method === "POST" && url.pathname === "/v1/billing/authorizations/issue") {
      if (authKeys.get(body.authKey) !== body.customerKey) return send(res, 400, { code: "INVALID_AUTH_KEY", message: "인증 정보가 맞지 않습니다." });
      const billingKey = `bk_fake_${String(++seq).padStart(8, "0")}`;
      billing.set(billingKey, { customerKey: body.customerKey, fail: false });
      return send(res, 200, { billingKey, customerKey: body.customerKey });
    }
    const bm = url.pathname.match(/^\/v1\/billing\/([^/]+)$/);
    if (req.method === "POST" && bm) {
      const b = billing.get(decodeURIComponent(bm[1]));
      if (!b || b.customerKey !== body.customerKey) return send(res, 404, { code: "NOT_FOUND_BILLING_KEY", message: "존재하지 않는 빌링키 입니다." });
      const p = {
        paymentKey: `pay_fake_${String(++seq).padStart(8, "0")}`,
        orderId: body.orderId,
        amount: body.amount,
        status: b.fail ? "ABORTED" : "DONE",
        approvedAt: new Date().toISOString(),
      };
      payments.set(p.orderId, p);
      if (b.fail) return send(res, 403, { code: "REJECT_CARD_PAYMENT", message: "카드 결제가 거절됐습니다." });
      return send(res, 200, view(p));
    }
    const cm = url.pathname.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cm) {
      const p = [...payments.values()].find((x) => x.paymentKey === decodeURIComponent(cm[1]));
      if (!p) return send(res, 404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
      p.status = "CANCELED";
      return send(res, 200, view(p));
    }
    return send(res, 404, { code: "NOT_FOUND", message: "없는 경로입니다." });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    url,
    calls,
    registerPayment: (paymentKey, orderId, amount) => post("/__test/intent", { paymentKey, orderId, amount }),
    registerAuthKey: (authKey, customerKey) => post("/__test/auth-key", { authKey, customerKey }),
    setStatus: (orderId, status) => post("/__test/status", { orderId, status }),
    failBilling: (billingKey, fail = true) => post("/__test/fail-billing", { billingKey, fail }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// 직접 실행: node e2e/lib/fake-pg.mjs [포트] — 개발 서버와 함께 손으로 시험할 때
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  const fake = await startFakePg({ port: Number(process.argv[2] ?? 4010) });
  console.log(`가짜 PG 서버: ${fake.url}`);
}
