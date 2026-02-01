import { Command } from "commander";
import chalk from "chalk";
import { Collection } from "@erauner/mdbase";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function registerInbox(program: Command): void {
  program
    .command("inbox")
    .description("List unprocessed fleeting notes in inbox")
    .option("--all", "Show all fleeting notes, not just unprocessed")
    .option("--format <format>", "Output format: text, json", "text")
    .action(async (opts) => {
      const cwd = process.cwd();

      const openResult = await Collection.open(cwd);
      if (openResult.error) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: openResult.error }, null, 2));
        } else {
          console.error(chalk.red(`error: ${openResult.error.message}`));
        }
        process.exit(3);
      }
      const collection = openResult.collection!;

      const whereClause = opts.all ? undefined : 'status == "unprocessed"';

      const result = await collection.query({
        types: ["fleeting"],
        where: whereClause,
        order_by: [{ field: "captured", direction: "desc" }],
        include_body: true,
      });

      if (result.error) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: result.error }, null, 2));
        } else {
          console.error(chalk.red(`error: ${result.error.message}`));
        }
        process.exit(1);
      }

      const notes = result.results ?? [];

      if (opts.format === "json") {
        console.log(JSON.stringify({
          results: notes.map(doc => ({
            path: doc.path,
            ...doc.frontmatter,
            body: doc.body,
          })),
          total: notes.length,
        }, null, 2));
        process.exit(0);
      }

      // Text format
      console.log(chalk.bold(opts.all ? "Inbox (all)" : "Inbox (unprocessed)"));
      console.log("─".repeat(60));

      if (notes.length === 0) {
        console.log(chalk.dim("  No notes in inbox."));
      } else {
        for (const doc of notes) {
          const fm = doc.frontmatter as Record<string, unknown>;
          const captured = fm.captured as string;
          const context = fm.context as string | undefined;
          const source = fm.source as string | undefined;
          const status = fm.status as string;
          const id = (fm.id as string) || doc.path;

          const capturedDate = new Date(captured);
          const relativeTime = formatRelativeTime(capturedDate);

          // Get first line of body as preview
          const preview = (doc.body ?? "").split("\n")[0].slice(0, 50);

          const statusColor = status === "unprocessed" ? chalk.yellow : chalk.dim;
          console.log(`${chalk.dim(`[${relativeTime}]`)} ${chalk.cyan(id.slice(0, 8))}: ${preview}${preview.length >= 50 ? "..." : ""}`);
          if (context) console.log(`         ${chalk.dim("Context:")} ${context}`);
          if (source) console.log(`         ${chalk.dim("Source:")} ${source}`);
          if (opts.all && status !== "unprocessed") {
            console.log(`         ${chalk.dim("Status:")} ${statusColor(status)}`);
          }
        }
      }

      console.log();
      console.log(chalk.dim(`Total: ${notes.length} notes`));

      process.exit(0);
    });
}
