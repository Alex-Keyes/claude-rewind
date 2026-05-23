import type { DB } from "./db.js";

export interface Stats {
  sessions: number;
  messages: number;
  byProject: { project: string; sessions: number; messages: number }[];
  newest: string | null;
  oldest: string | null;
}

export function getStats(db: DB): Stats {
  const sessions = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as {
    n: number;
  }).n;
  const messages = (db.prepare("SELECT COUNT(*) AS n FROM messages").get() as {
    n: number;
  }).n;

  const byProject = db
    .prepare<[], { project: string; sessions: number; messages: number }>(
      `SELECT
         COALESCE(s.project, '(unknown)') AS project,
         COUNT(DISTINCT s.session_id)      AS sessions,
         COUNT(m.id)                       AS messages
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.session_id
       GROUP BY s.project
       ORDER BY messages DESC`,
    )
    .all();

  const newest = (db
    .prepare("SELECT MAX(last_ts) AS ts FROM sessions")
    .get() as { ts: string | null }).ts;
  const oldest = (db
    .prepare("SELECT MIN(first_ts) AS ts FROM sessions")
    .get() as { ts: string | null }).ts;

  return { sessions, messages, byProject, newest, oldest };
}
