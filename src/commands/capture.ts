import { Command } from "commander";
import chalk from "chalk";
import { Collection } from "@erauner/mdbase";
import { ulid } from "ulid";

export function registerCapture(program: Command): void {
  program
    .command("capture <content...>")
    .description("Quick capture a fleeting note to inbox")
    .option("--context <context>", "Additional context about the note")
    .option("--source <source>", "Source type (e.g., reading, meeting, thought)")
    .option("--format <format>", "Output format: text, json", "text")
    .action(async (contentParts: string[], opts) => {
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

      const content = contentParts.join(" ");
      const id = ulid();
      const captured = new Date().toISOString();

      const frontmatter: Record<string, unknown> = {
        id,
        status: "unprocessed",
        captured,
      };

      if (opts.context) frontmatter.context = opts.context;
      if (opts.source) frontmatter.source = opts.source;

      const result = await collection.create({
        type: "fleeting",
        frontmatter,
        body: content,
      });

      if (result.error) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: result.error }, null, 2));
        } else {
          console.error(chalk.red(`error: ${result.error.message}`));
        }
        process.exit(1);
      }

      if (opts.format === "json") {
        console.log(JSON.stringify({
          path: result.path,
          id,
          captured,
          content,
          context: opts.context,
          source: opts.source,
        }, null, 2));
      } else {
        console.log(`${chalk.green("captured")} ${chalk.bold(result.path)}`);
      }

      process.exit(0);
    });
}
