import type { DB } from "./db.js";

export interface SearchHit {
  messageId: number;
  sessionId: string;
  ts: string | null;
  role: string;
  snippet: string;
  text: string;
  title: string | null;
  project: string | null;
  cwd: string | null;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  project?: string;
}

/**
 * Convert a free-form user query into an FTS5 MATCH expression.
 * Quotes each token so punctuation/operators don't get interpreted as syntax.
 */
function toFtsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/"/g, ""));
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" ");
}

export function search(
  db: DB,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const limit = opts.limit ?? 10;
  const ftsQuery = toFtsQuery(query);

  const params: any[] = [ftsQuery];
  let projectClause = "";
  if (opts.project) {
    projectClause = "AND s.project = ?";
    params.push(opts.project);
  }
  params.push(limit);

  const rows = db
    .prepare<any[], any>(
      `
      SELECT
        m.id          AS messageId,
        m.session_id  AS sessionId,
        m.ts          AS ts,
        m.role        AS role,
        m.text        AS text,
        snippet(messages_fts, 0, '[1;33m', '[0m', '…', 16) AS snippet,
        s.title       AS title,
        s.project     AS project,
        s.cwd         AS cwd,
        bm25(messages_fts) AS score
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN sessions s ON s.session_id = m.session_id
      WHERE messages_fts MATCH ?
      ${projectClause}
      ORDER BY score
      LIMIT ?
    `,
    )
    .all(...params) as SearchHit[];

  return rows;
}
