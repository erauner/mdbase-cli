import { Command } from "commander";
import chalk from "chalk";
import { Collection } from "@erauner/mdbase";
import { ulid } from "ulid";
import * as readline from "readline";

async function readStdin(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join("\n");
}

export function registerCapture(program: Command): void {
  program
    .command("capture [content...]")
    .description("Quick capture a fleeting note or transcript to inbox")
    .option("-t, --type <type>", "Capture type: fleeting, transcript", "fleeting")
    .option("--context <context>", "Additional context about the note")
    .option("--source <source>", "Source (fleeting: thought, reading, meeting | transcript: superwhisper, otter, manual)")
    .option("--meeting-date <date>", "Meeting date for transcripts (YYYY-MM-DD)")
    .option("--meeting-title <title>", "Meeting title for transcripts")
    .option("--stdin", "Read content from stdin (for large pastes)")
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

      // Get content from args or stdin
      let content: string;
      if (opts.stdin) {
        content = await readStdin();
      } else if (contentParts.length > 0) {
        content = contentParts.join(" ");
      } else {
        console.error(chalk.red("error: No content provided. Use arguments or --stdin"));
        process.exit(1);
      }

      const id = ulid();
      const captured = new Date().toISOString();
      const captureType = opts.type.toLowerCase();

      let frontmatter: Record<string, unknown>;
      let typeName: string;

      if (captureType === "transcript") {
        typeName = "transcript";
        frontmatter = {
          id,
          status: "unprocessed",
          captured,
          transcript_source: opts.source || "superwhisper",
        };
        if (opts.meetingDate) frontmatter.meeting_date = opts.meetingDate;
        if (opts.meetingTitle) frontmatter.meeting_title = opts.meetingTitle;
      } else {
        // Default: fleeting
        typeName = "fleeting";
        frontmatter = {
          id,
          status: "unprocessed",
          captured,
        };
        if (opts.context) frontmatter.context = opts.context;
        if (opts.source) frontmatter.source = opts.source;
      }

      const result = await collection.create({
        type: typeName,
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
          type: typeName,
          id,
          captured,
          contentLength: content.length,
          ...(opts.meetingDate && { meetingDate: opts.meetingDate }),
          ...(opts.meetingTitle && { meetingTitle: opts.meetingTitle }),
        }, null, 2));
      } else {
        console.log(`${chalk.green("captured")} ${chalk.bold(result.path)} (${typeName}, ${content.length} chars)`);
      }

      process.exit(0);
    });
}
