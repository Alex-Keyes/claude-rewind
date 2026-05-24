# claude-rewind

Search and ask questions across all your past Claude Code sessions.

`claude-rewind` indexes every transcript under `~/.claude/projects/` into a local
SQLite database with full-text search, so you can rediscover decisions, debug
sessions, and code snippets from any past conversation.

```bash
claude-rewind index                          # build / update the local index
claude-rewind search "supabase rls"          # full-text search across all sessions
claude-rewind ask "what did I decide about auth in skilltree?"
claude-rewind stats                          # what's indexed
```

## Why

If you use Claude Code a lot, your transcripts contain a real history of how
you've thought about your projects — but they're hard to revisit. `claude-rewind`
makes them queryable.

## Install

```bash
git clone https://github.com/Alex-Keyes/claude-rewind
cd claude-rewind
npm install
npm run build
npm link    # exposes the `claude-rewind` command globally
```

## Usage

### `index`

Walks `~/.claude/projects/**/*.jsonl` and writes a local SQLite database at
`~/.claude/claude-rewind.db`. Indexing is incremental — only files whose
size or mtime have changed since the last run are re-parsed.

```bash
claude-rewind index           # default
claude-rewind index --rebuild # drop and recreate the DB
```

### `search`

Full-text search powered by SQLite FTS5. Returns ranked matches with session
title, project, timestamp, and a snippet.

```bash
claude-rewind search "rls policy"
claude-rewind search "auth" --limit 20
claude-rewind search "deploy" --project sellaria
```

### `ask`

Same retrieval as `search`, plus a synthesis pass through Claude.

Requires `ANTHROPIC_API_KEY` — grab one from
[console.anthropic.com](https://console.anthropic.com/settings/keys) and export
it (`export ANTHROPIC_API_KEY=sk-ant-…`, optionally in your shell rc file). If
the key isn't set, use `search` instead — it runs fully locally.

```bash
claude-rewind ask "when did I last work on the indexer in sellaria?"
```

### `stats`

```bash
claude-rewind stats
```

Shows total sessions, messages, and a per-project breakdown.

## Storage

- Index DB: `~/.claude/claude-rewind.db` (override with `--db <path>`)
- No data leaves your machine except when running `ask`, which sends the
  retrieved snippets (not the full transcripts) to the Anthropic API.

## Related

- [claude-secrets](https://github.com/Alex-Keyes/claude-secrets) — paste secrets
  straight into Claude Code chat and have them land in `.env` without ever
  entering the transcript.

## License

MIT — free and open source. If it's useful to you, a star on the repo is the
best thanks.
