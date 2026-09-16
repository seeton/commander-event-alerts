import type { EventInfo } from "./discovery";

const BUTTONDOWN_API = "https://api.buttondown.com/v1";

interface ButtondownConfig {
  apiKey: string;
}

export function buttondownConfig(env: Cloudflare.Env): ButtondownConfig | null {
  const apiKey = env.BUTTONDOWN_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

export async function sendMonthlyNewsletter(
  config: ButtondownConfig,
  events: EventInfo[],
  monthLabel: string,
  digestMonth: string,
): Promise<{ id?: string; duplicate: boolean }> {
  let draft: { id: string };
  try {
    draft = await buttondownRequest<{ id: string }>(config.apiKey, "/emails", {
      method: "POST",
      body: {
        subject: `【統率者大型大会アラート】${monthLabel}・開催予定${events.length}件`,
        slug: `commander-events-${digestMonth}`,
        body: monthlyMarkdown(events),
        status: "draft",
        archival_mode: "disabled",
        commenting_mode: "disabled",
      },
    });
  } catch (error) {
    if (error instanceof ButtondownError && error.status === 409) return { duplicate: true };
    throw error;
  }
  if (!draft.id) throw new Error("Buttondown did not return an email ID");
  await buttondownRequest(config.apiKey, `/emails/${encodeURIComponent(draft.id)}/publish`, {
    method: "POST",
  });
  return { id: draft.id, duplicate: false };
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
  return `<!-- buttondown-editor-mode: plaintext -->\n${lines.join("\n")}`;
}

class ButtondownError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function buttondownRequest<T = unknown>(
  apiKey: string,
  path: string,
  options: { method: "POST"; body?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`${BUTTONDOWN_API}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ButtondownError(response.status, `Buttondown returned invalid JSON (HTTP ${response.status})`);
    }
  }
  if (!response.ok) {
    const message = errorMessage(payload);
    throw new ButtondownError(response.status, `Buttondown request failed: ${message.slice(0, 300)}`);
  }
  return payload as T;
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.message === "string") return record.message;
  }
  return "request rejected";
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>-])/gu, "\\$1");
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().replaceAll(")", "%29") : "https://example.invalid/";
  } catch {
    return "https://example.invalid/";
  }
}
