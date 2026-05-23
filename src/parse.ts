import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface ParsedMessage {
  ts: string | null;
  role: "user" | "assistant" | "system";
  text: string;
  hasToolUse: boolean;
  hasToolResult: boolean;
}

export interface ParsedSession {
  sessionId: string;
  filePath: string;
  cwd: string | null;
  title: string | null;
  firstTs: string | null;
  lastTs: string | null;
  messages: ParsedMessage[];
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  content?: unknown;
  input?: unknown;
  name?: string;
}

function extractText(content: unknown): {
  text: string;
  hasToolUse: boolean;
  hasToolResult: boolean;
} {
  let text = "";
  let hasToolUse = false;
  let hasToolResult = false;

  if (typeof content === "string") {
    return { text: content, hasToolUse: false, hasToolResult: false };
  }
  if (!Array.isArray(content)) {
    return { text: "", hasToolUse: false, hasToolResult: false };
  }

  for (const block of content as ContentBlock[]) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        if (block.text) text += block.text + "\n";
        break;
      case "thinking":
        // Skip thinking content — it's noisy and often empty/encrypted.
        break;
      case "tool_use": {
        hasToolUse = true;
        const name = block.name ?? "tool";
        const inputStr =
          typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input ?? {});
        text += `[tool:${name}] ${inputStr}\n`;
        break;
      }
      case "tool_result": {
        hasToolResult = true;
        const inner = block.content;
        if (typeof inner === "string") {
          text += `[result] ${inner}\n`;
        } else if (Array.isArray(inner)) {
          const nested = extractText(inner);
          if (nested.text) text += `[result] ${nested.text}\n`;
        }
        break;
      }
      default:
        break;
    }
  }

  return { text: text.trim(), hasToolUse, hasToolResult };
}

export async function parseTranscript(
  filePath: string,
): Promise<ParsedSession> {
  const session: ParsedSession = {
    sessionId: filePath
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, ""),
    filePath,
    cwd: null,
    title: null,
    firstTs: null,
    lastTs: null,
    messages: [],
  };

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.sessionId && !session.sessionId) {
      session.sessionId = event.sessionId;
    }

    switch (event.type) {
      case "custom-title":
        if (event.customTitle) session.title = event.customTitle;
        break;
      case "user":
      case "assistant": {
        const message = event.message ?? {};
        const role = (event.type ?? message.role) as ParsedMessage["role"];
        const { text, hasToolUse, hasToolResult } = extractText(
          message.content,
        );
        if (!text) break;
        if (event.cwd && !session.cwd) session.cwd = event.cwd;
        const ts = event.timestamp ?? event.ts ?? null;
        if (ts) {
          if (!session.firstTs || ts < session.firstTs) session.firstTs = ts;
          if (!session.lastTs || ts > session.lastTs) session.lastTs = ts;
        }
        session.messages.push({
          ts,
          role,
          text,
          hasToolUse,
          hasToolResult,
        });
        break;
      }
      default:
        if (event.cwd && !session.cwd) session.cwd = event.cwd;
        break;
    }
  }

  return session;
}

/**
 * Decode the encoded cwd directory name back into a filesystem path.
 * Claude Code stores transcripts under e.g. `-home-alex-Projects-sellaria`.
 */
export function decodeProjectDir(encoded: string): string {
  if (!encoded.startsWith("-")) return encoded;
  return "/" + encoded.slice(1).replace(/-/g, "/");
}

/**
 * Best-effort short project name from a cwd path.
 * `/home/alex/Projects/sellaria` -> `sellaria`
 * `/home/alex/Projects` -> `Projects`
 */
export function projectNameFromCwd(cwd: string | null): string {
  if (!cwd) return "(unknown)";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "(unknown)";
}
