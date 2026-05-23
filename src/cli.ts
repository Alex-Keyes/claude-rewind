import { Command } from "commander";
import kleur from "kleur";
import { openDB, resetDB, DEFAULT_DB_PATH } from "./db.js";
import { indexAll, DEFAULT_TRANSCRIPT_ROOT } from "./indexer.js";
import { search } from "./search.js";
import { ask } from "./ask.js";
import { getStats } from "./stats.js";

const program = new Command();

program
  .name("claude-rewind")
  .description("Search and ask questions across your past Claude Code sessions.")
  .version("0.1.0")
  .option("--db <path>", "path to the index DB", DEFAULT_DB_PATH);

program
  .command("index")
  .description("Build or update the local transcript index")
  .option("--root <path>", "transcript root directory", DEFAULT_TRANSCRIPT_ROOT)
  .option("--rebuild", "drop and recreate the index from scratch")
  .action(async (opts) => {
    const dbPath = program.opts().db as string;
    const db = openDB(dbPath);
    if (opts.rebuild) {
      console.log(kleur.yellow("Rebuilding index from scratch..."));
      resetDB(db);
    }
    const t0 = Date.now();
    const result = await indexAll(db, {
      root: opts.root,
      onProgress: (m) => console.log(kleur.gray(m)),
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      kleur.green(
        `Done in ${dt}s — scanned ${result.scanned}, indexed ${result.indexed}, skipped ${result.skipped}, removed ${result.removed}.`,
      ),
    );
    console.log(kleur.gray(`Index: ${dbPath}`));
    db.close();
  });

program
  .command("search <query...>")
  .description("Full-text search across all indexed messages")
  .option("-n, --limit <number>", "max results", "10")
  .option("-p, --project <name>", "filter by project name")
  .action((queryParts: string[], opts) => {
    const dbPath = program.opts().db as string;
    const db = openDB(dbPath);
    const query = queryParts.join(" ");
    const hits = search(db, query, {
      limit: Number(opts.limit),
      project: opts.project,
    });
    if (hits.length === 0) {
      console.log(kleur.yellow("No matches."));
    } else {
      for (const h of hits) {
        const when = h.ts ? h.ts.slice(0, 19).replace("T", " ") : "(no ts)";
        const project = h.project ?? "(unknown)";
        const title = h.title ? ` · ${h.title}` : "";
        console.log(
          kleur.cyan(`${when}  `) +
            kleur.magenta(project) +
            kleur.gray(title) +
            kleur.gray(`  [${h.role}]`),
        );
        console.log("  " + h.snippet.replace(/\n+/g, " "));
        console.log(kleur.gray(`  session=${h.sessionId}`));
        console.log();
      }
    }
    db.close();
  });

program
  .command("ask <question...>")
  .description("Ask Claude a question over your indexed sessions")
  .option("-n, --limit <number>", "max excerpts to retrieve", "12")
  .option("-p, --project <name>", "filter by project name")
  .option("--model <name>", "override the Anthropic model")
  .action(async (questionParts: string[], opts) => {
    const dbPath = program.opts().db as string;
    const db = openDB(dbPath);
    const question = questionParts.join(" ");
    try {
      const { answer, hits } = await ask(db, question, {
        limit: Number(opts.limit),
        project: opts.project,
        model: opts.model,
      });
      console.log(answer);
      console.log();
      console.log(kleur.gray(`Sources (${hits.length}):`));
      hits.forEach((h, i) => {
        const when = h.ts ? h.ts.slice(0, 10) : "(no ts)";
        const project = h.project ?? "(unknown)";
        console.log(
          kleur.gray(
            `  [#${i + 1}] ${when}  ${project}${h.title ? " · " + h.title : ""}  session=${h.sessionId}`,
          ),
        );
      });
    } catch (err) {
      console.error(kleur.red((err as Error).message));
      process.exitCode = 1;
    } finally {
      db.close();
    }
  });

program
  .command("stats")
  .description("Show what's indexed")
  .action(() => {
    const dbPath = program.opts().db as string;
    const db = openDB(dbPath);
    const s = getStats(db);
    console.log(kleur.bold(`Sessions: ${s.sessions}`));
    console.log(kleur.bold(`Messages: ${s.messages}`));
    console.log(`Range: ${s.oldest ?? "?"} → ${s.newest ?? "?"}`);
    console.log();
    console.log(kleur.bold("By project:"));
    for (const row of s.byProject) {
      console.log(
        `  ${row.project.padEnd(24)} ${String(row.sessions).padStart(4)} sessions  ${String(row.messages).padStart(6)} messages`,
      );
    }
    db.close();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
