import { discoverAll, type EventInfo } from "./discovery";
import { buttondownConfig, sendMonthlyNewsletter } from "./buttondown";
import { landingPage, privacyPage } from "./pages";
import { constantTimeEqual } from "./security";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") return renderLanding(env);
      if (request.method === "GET" && url.pathname === "/privacy") return html(privacyPage(env.APP_NAME));
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ ok: true, acceptingSubscriptions: subscriptionReady(env) });
      }
      if (request.method === "GET" && url.pathname === "/api/admin/preview") return await adminPreview(request, env);
      if (request.method === "POST" && url.pathname === "/api/admin/dispatch") return await adminDispatch(request, env);
      return json({ message: "Not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message: safeError(error) }));
      return json({ message: "処理中にエラーが発生しました。しばらくしてからお試しください。" }, 500);
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    if (String(env.SERVICE_ENABLED) !== "true") {
      console.log(JSON.stringify({ event: "scheduled_dispatch", status: "disabled" }));
      return;
    }
    ctx.waitUntil(
      dispatchMonthly(env, new Date(controller.scheduledTime)).then((result) => {
        console.log(JSON.stringify({ event: "scheduled_dispatch", ...result }));
      }).catch((error) => {
        console.error(JSON.stringify({ event: "scheduled_dispatch_error", message: safeError(error) }));
        throw error;
      }),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function adminPreview(request: Request, env: Cloudflare.Env): Promise<Response> {
  if (!(await authorized(request, env))) return json({ message: "Unauthorized" }, 401);
  const result = await discoverAll();
  return json({ count: result.events.length, failures: result.failures, events: result.events });
}

async function adminDispatch(request: Request, env: Cloudflare.Env): Promise<Response> {
  if (!(await authorized(request, env))) return json({ message: "Unauthorized" }, 401);
  return json(await dispatchMonthly(env, new Date()));
}

async function dispatchMonthly(env: Cloudflare.Env, now: Date): Promise<Record<string, unknown>> {
  const emailConfig = buttondownConfig(env);
  if (!emailConfig) throw new Error("email delivery is not configured");
  const discovery = await discoverAll();
  const digestMonth = jstMonthKey(now);
  if (discovery.events.length === 0) {
    return { status: "empty", digestMonth, failures: discovery.failures };
  }
  const sent = await sendMonthlyNewsletter(emailConfig, discovery.events, jstMonthLabel(now), digestMonth);
  if (sent.duplicate) return { status: "skipped", digestMonth, reason: "already exists" };
  return { status: "queued", digestMonth, eventCount: discovery.events.length, failures: discovery.failures, emailId: sent.id };
}

async function authorized(request: Request, env: Cloudflare.Env): Promise<boolean> {
  const expected = env.ADMIN_TOKEN?.trim();
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(expected && supplied && await constantTimeEqual(supplied, expected));
}

function renderLanding(env: Cloudflare.Env): Response {
  return html(landingPage({
    appName: env.APP_NAME,
    buttondownUsername: env.BUTTONDOWN_USERNAME,
    enabled: subscriptionReady(env),
  }));
}

function subscriptionReady(env: Cloudflare.Env): boolean {
  return Boolean(
    String(env.SERVICE_ENABLED) === "true" &&
    env.BUTTONDOWN_USERNAME?.trim() &&
    buttondownConfig(env),
  );
}

function jstMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("could not determine JST month");
  return `${year}-${month}`;
}

function jstMonthLabel(now: Date): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long" }).format(now);
}

function html(body: string): Response {
  return new Response(body, { headers: securityHeaders("text/html; charset=utf-8") });
}

function securityHeaders(contentType: string): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=300",
    "content-security-policy": "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action https://buttondown.com; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown error";
}

export const testing = { dispatchMonthly, jstMonthKey };
export type { EventInfo };
