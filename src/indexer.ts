import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DB } from "./db.js";
import { parseTranscript, projectNameFromCwd } from "./parse.js";

export const DEFAULT_TRANSCRIPT_ROOT = `${homedir()}/.claude/projects`;

export interface IndexOptions {
  root?: string;
  onProgress?: (msg: string) => void;
}

export interface IndexResult {
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
}

function walkJsonl(root: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const name = entry.name as string;
    const full = join(root, name);
    if (entry.isDirectory()) {
      out.push(...walkJsonl(full));
    } else if (entry.isFile() && name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

export async function indexAll(
  db: DB,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const root = opts.root ?? DEFAULT_TRANSCRIPT_ROOT;
  const log = opts.onProgress ?? (() => {});

  const files = walkJsonl(root);
  log(`Found ${files.length} transcript file(s) under ${root}`);

  const getState = db.prepare<
    [string],
    { size: number; mtime_ms: number }
  >("SELECT size, mtime_ms FROM file_state WHERE file_path = ?");
  const upsertState = db.prepare(
    `INSERT INTO file_state(file_path, size, mtime_ms, indexed_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       size=excluded.size, mtime_ms=excluded.mtime_ms, indexed_at=excluded.indexed_at`,
  );
  const deleteSession = db.prepare(
    "DELETE FROM sessions WHERE session_id = ?",
  );
  const findSessionByFile = db.prepare<[string], { session_id: string }>(
    "SELECT session_id FROM sessions WHERE file_path = ?",
  );
  const upsertSession = db.prepare(
    `INSERT INTO sessions(session_id, file_path, cwd, project, title, first_ts, last_ts, message_count)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       file_path=excluded.file_path, cwd=excluded.cwd, project=excluded.project,
       title=excluded.title, first_ts=excluded.first_ts, last_ts=excluded.last_ts,
       message_count=excluded.message_count`,
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages(session_id, ts, role, text) VALUES(?, ?, ?, ?)",
  );

  let indexed = 0;
  let skipped = 0;

  for (const file of files) {
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    const prev = getState.get(file);
    if (
      prev &&
      prev.size === st.size &&
      Math.floor(prev.mtime_ms) === Math.floor(st.mtimeMs)
    ) {
      skipped++;
      continue;
    }

    let parsed;
    try {
      parsed = await parseTranscript(file);
    } catch (err) {
      log(`  ! failed to parse ${file}: ${(err as Error).message}`);
      continue;
    }

    if (parsed.messages.length === 0) {
      upsertState.run(file, st.size, Math.floor(st.mtimeMs), new Date().toISOString());
      skipped++;
      continue;
    }

    const project = projectNameFromCwd(parsed.cwd);

    const tx = db.transaction(() => {
      const existing = findSessionByFile.get(file);
      if (existing) deleteSession.run(existing.session_id);
      upsertSession.run(
        parsed.sessionId,
        file,
        parsed.cwd,
        project,
        parsed.title,
        parsed.firstTs,
        parsed.lastTs,
        parsed.messages.length,
      );
      for (const m of parsed.messages) {
        insertMessage.run(parsed.sessionId, m.ts, m.role, m.text);
      }
      upsertState.run(file, st.size, Math.floor(st.mtimeMs), new Date().toISOString());
    });
    tx();

    indexed++;
    if (indexed % 25 === 0) log(`  indexed ${indexed}...`);
  }

  // Clean up state rows for files that no longer exist on disk.
  const known = new Set(files);
  const allState = db
    .prepare<[], { file_path: string }>("SELECT file_path FROM file_state")
    .all();
  let removed = 0;
  const removeState = db.prepare("DELETE FROM file_state WHERE file_path = ?");
  const removeSessionByFile = db.prepare(
    "DELETE FROM sessions WHERE file_path = ?",
  );
  for (const row of allState) {
    if (!known.has(row.file_path)) {
      removeSessionByFile.run(row.file_path);
      removeState.run(row.file_path);
      removed++;
    }
  }

  return { scanned: files.length, indexed, skipped, removed };
}
