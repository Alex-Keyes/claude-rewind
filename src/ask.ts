import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "./db.js";
import { search, type SearchHit } from "./search.js";

const MODEL = "claude-sonnet-4-6";

export interface AskOptions {
  limit?: number;
  project?: string;
  model?: string;
}

export interface AskResult {
  answer: string;
  hits: SearchHit[];
}

function formatContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => {
      const when = h.ts ?? "(no timestamp)";
      const project = h.project ?? "(unknown)";
      const title = h.title ? ` — ${h.title}` : "";
      const text = h.text.length > 2000 ? h.text.slice(0, 2000) + "…" : h.text;
      return `[#${i + 1}] ${when}  project=${project}${title}  role=${h.role}
${text}`;
    })
    .join("\n\n---\n\n");
}

export async function ask(
  db: DB,
  question: string,
  opts: AskOptions = {},
): Promise<AskResult> {
  const limit = opts.limit ?? 12;
  const hits = search(db, question, { limit, project: opts.project });

  if (hits.length === 0) {
    return {
      answer: "I couldn't find any matching messages in your indexed sessions.",
      hits,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      [
        "ANTHROPIC_API_KEY is not set — the `ask` command needs it to synthesize an answer.",
        "",
        "Get a key at https://console.anthropic.com/settings/keys and export it:",
        "",
        "  export ANTHROPIC_API_KEY=sk-ant-...",
        "",
        "(add it to ~/.bashrc or ~/.zshrc to persist).",
        "",
        "Or use `claude-rewind search` instead — it runs fully locally with no API key.",
      ].join("\n"),
    );
  }

  const client = new Anthropic({ apiKey });
  const context = formatContext(hits);

  const system = `You are answering questions about the user's own past Claude Code sessions.
You will receive a question and a set of message excerpts retrieved from the user's session history.
Answer concisely and cite which excerpts ([#1], [#2], …) you used.
If the excerpts do not contain enough information, say so plainly — do not invent details.`;

  const user = `Question: ${question}

Excerpts from past sessions:

${context}`;

  const response = await client.messages.create({
    model: opts.model ?? MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { answer, hits };
}
