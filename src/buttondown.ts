import type { EventInfo } from "./discovery";
import { createHash } from "node:crypto";
import { readLimitedText } from "./http";

const sha256Hex = async (value: string) => createHash("sha256").update(value).digest("hex");

const BUTTONDOWN_API = "https://api.buttondown.com/v1";

export interface ButtondownConfig {
  apiKey: string;
}

interface EmailRecord { id: string; slug: string; status: string }
const ACCEPTED_STATUSES = new Set(["about_to_send", "scheduled", "in_flight", "sent", "throttled", "resending"]);

export async function sendMonthlyNewsletter(
  config: ButtondownConfig,
  events: EventInfo[],
  monthLabel: string,
  digestMonth: string,
): Promise<{ id?: string; duplicate: boolean }> {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(digestMonth)) throw new Error("Invalid digest month");
  const slug = `commander-events-${digestMonth}`;
  const subjectPrefix = `【統率者大型大会アラート】${monthLabel}`;
  let draft = await findMonthlyEmail(config.apiKey, subjectPrefix, slug);
  if (!draft) try {
    draft = emailRecord(await buttondownRequest(config.apiKey, "/emails", {
      method: "POST",
      idempotencyKey: await sha256Hex(`${config.apiKey}:create:${slug}`),
      body: {
        subject: `${subjectPrefix}・開催予定${events.length}件`,
        slug,
        body: monthlyMarkdown(events),
        status: "draft",
        archival_mode: "disabled",
        commenting_mode: "disabled",
      },
    }));
  } catch (error) {
    // Another invocation may have created the same monthly draft. A generic
    // 400/409 is NOT proof that the newsletter was actually sent.
    if (!(error instanceof ButtondownError) || ![400, 409].includes(error.status)) throw error;
    draft = await findMonthlyEmail(config.apiKey, subjectPrefix, slug);
    if (!draft) throw error;
  }
  if (draft.slug !== slug) throw new Error("Buttondown returned an unexpected email slug");
  // Idempotent creates can replay a stale draft response: read its live status.
  draft = emailRecord(await buttondownRequest(config.apiKey, `/emails/${encodeURIComponent(draft.id)}`, { method: "GET" }));
  if (draft.slug !== slug) throw new Error("Buttondown returned an unexpected email slug");
  if (ACCEPTED_STATUSES.has(draft.status)) return { id: draft.id, duplicate: true };
  if (draft.status !== "draft") throw new Error("Monthly email needs manual review; refusing to resend");
  const published = emailRecord(await buttondownRequest(config.apiKey, `/emails/${encodeURIComponent(draft.id)}/publish`, {
    method: "POST",
    // Publishing requires a JSON object even when no fields change. Version the
    // key so a cached 422 from the old empty-body request is not replayed.
    idempotencyKey: await sha256Hex(`${config.apiKey}:publish-v2:${draft.id}`),
    body: {},
  }));
  if (published.id !== draft.id || published.slug !== slug) throw new Error("Unexpected publication response");
  if (!ACCEPTED_STATUSES.has(published.status)) throw new Error("Buttondown did not queue the monthly email");
  return { id: draft.id, duplicate: false };
}

export async function findMonthlyEmail(apiKey: string, subject: string, slug: string): Promise<EmailRecord | null> {
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ subject, excluded_fields: "body", page: String(page) });
    const payload = await buttondownRequest(apiKey, `/emails?${query}`, { method: "GET" });
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("Invalid Buttondown email list");
    const match = payload.results.map(emailRecord).find((email) => email.slug === slug);
    if (match) return match;
    if (!payload.next) return null;
  }
  throw new Error("Monthly email lookup exceeded its page limit");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emailRecord(value: unknown): EmailRecord {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
    typeof value.slug !== "string" || typeof value.status !== "string") throw new Error("Invalid Buttondown email response");
  return { id: value.id, slug: value.slug, status: value.status };
}

export function monthlyMarkdown(events: EventInfo[]): string {
  const lines = [
    "今後開催予定の大規模な統率者イベントです。",
    "",
    "開催前の対象イベントを、月初に毎回お知らせします。",
    "",
  ];
  for (const event of events) {
    lines.push(`## ${escapeMarkdown(event.title)}`, "");
    if (event.dateText) {
      lines.push(`- ${event.kind === "announcement" ? "掲載日" : "開催日"}: ${escapeMarkdown(event.dateText)}`);
    }
    if (event.location) lines.push(`- 会場: ${escapeMarkdown(event.location)}`);
    lines.push(`- 情報元: ${escapeMarkdown(event.source)}`, "", `[公式情報を見る](${safeUrl(event.url)})`, "");
  }
  lines.push("非公式の通知サービスです。日程・会場・申込方法はリンク先の公式情報で確認してください。");
  return `<!-- buttondown-editor-mode: plaintext -->\n${lines.join("\n")}`;
}

export class ButtondownError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function buttondownRequest(
  apiKey: string,
  path: string,
  options: { method: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string },
): Promise<unknown> {
  const response = await fetch(`${BUTTONDOWN_API}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "X-Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await readLimitedText(response, 2 * 1024 * 1024);
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ButtondownError(response.status, `Buttondown returned invalid JSON (HTTP ${response.status})`);
    }
  }
  if (!response.ok) {
    // Provider details may contain subscriber data. Log only a bounded code.
    const code = isRecord(payload) && typeof payload.code === "string" && /^[a-z_]{1,80}$/u.test(payload.code)
      ? payload.code : "request_rejected";
    throw new ButtondownError(response.status, `Buttondown HTTP ${response.status}: ${code}`);
  }
  return payload;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|<>-])/gu, "\\$1").replace(/[\r\n]+/gu, " ");
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().replaceAll(")", "%29") : "https://example.invalid/";
  } catch {
    return "https://example.invalid/";
  }
}
