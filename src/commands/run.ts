import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { parse as parseYaml } from "yaml";
import { Collection } from "@erauner/mdbase";
import Table from "cli-table3";

interface QuerySpec {
  types?: string[];
  where?: string;
  order_by?: Array<{ field: string; direction?: string }>;
  folder?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
  formulas?: Record<string, string>;
}

interface ResultRow {
  path: string;
  frontmatter: Record<string, unknown>;
  types: string[];
  body?: string;
  formulas?: Record<string, unknown>;
}

function getField(row: ResultRow, field: string): unknown {
  if (field in (row.frontmatter ?? {})) return row.frontmatter[field];
  if (row.formulas && field in row.formulas) return row.formulas[field];
  return null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function pickFields(
  row: ResultRow,
  fields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    result[f] = getField(row, f);
  }
  return result;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function registerRun(program: Command): void {
  program
    .command("run <file>")
    .description("Execute a YAML query file")
    .option("--format <format>", "Output format: table, json, jsonl, csv, paths", "table")
    .option("--body", "Include body in output")
    .option("--count", "Only show result count")
    .action(async (file: string, opts) => {
      const cwd = process.cwd();

      // Read and parse the YAML query file
      let content: string;
      try {
        content = await readFile(file, "utf-8");
      } catch (err) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: { code: "file_not_found", message: `Cannot read ${file}` } }, null, 2));
        } else {
          console.error(chalk.red(`error: Cannot read ${file}`));
        }
        process.exit(1);
      }

      let spec: QuerySpec;
      try {
        spec = parseYaml(content) as QuerySpec;
      } catch (err) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: { code: "parse_error", message: `Invalid YAML: ${err}` } }, null, 2));
        } else {
          console.error(chalk.red(`error: Invalid YAML: ${err}`));
        }
        process.exit(1);
      }

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

      const queryResult = await collection.query({
        types: spec.types,
        where: spec.where,
        order_by: spec.order_by,
        folder: spec.folder,
        limit: spec.limit,
        offset: spec.offset,
        include_body: opts.body ?? false,
        formulas: spec.formulas,
      });

      if (queryResult.error) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ error: queryResult.error }, null, 2));
        } else {
          console.error(chalk.red(`error: ${queryResult.error.message}`));
        }
        process.exit(1);
      }

      const results = queryResult.results as ResultRow[];

      // --count: just print the count
      if (opts.count) {
        console.log(String(queryResult.meta?.total_count ?? results.length));
        process.exit(0);
      }

      if (results.length === 0) {
        if (opts.format === "json") {
          console.log(JSON.stringify({ results: [], meta: queryResult.meta }, null, 2));
        } else if (opts.format !== "paths" && opts.format !== "csv" && opts.format !== "jsonl") {
          console.error(chalk.dim("No results"));
        }
        process.exit(0);
      }

      // Collect formula names
      const formulaNames = spec.formulas ? Object.keys(spec.formulas) : [];

      // Determine which fields to show
      const allFields = new Set<string>();
      for (const r of results) {
        for (const key of Object.keys(r.frontmatter)) {
          allFields.add(key);
        }
      }
      const fields = spec.fields
        ? spec.fields
        : [...Array.from(allFields).filter((f) => f !== "type"), ...formulaNames];

      switch (opts.format) {
        case "paths": {
          for (const r of results) {
            console.log(r.path);
          }
          break;
        }

        case "json": {
          const output = {
            results: results.map((r) => ({
              path: r.path,
              types: r.types,
              frontmatter: spec.fields ? pickFields(r, fields) : { ...r.frontmatter, ...r.formulas },
              ...(opts.body && r.body != null ? { body: r.body } : {}),
            })),
            meta: queryResult.meta,
          };
          console.log(JSON.stringify(output, null, 2));
          break;
        }

        case "jsonl": {
          for (const r of results) {
            const row = {
              path: r.path,
              types: r.types,
              frontmatter: spec.fields ? pickFields(r, fields) : { ...r.frontmatter, ...r.formulas },
              ...(opts.body && r.body != null ? { body: r.body } : {}),
            };
            console.log(JSON.stringify(row));
          }
          break;
        }

        case "csv": {
          const header = ["path", ...fields];
          console.log(header.map(csvEscape).join(","));
          for (const r of results) {
            const row = [r.path, ...fields.map((f) => formatValue(getField(r, f)))];
            console.log(row.map(csvEscape).join(","));
          }
          break;
        }

        case "table":
        default: {
          const table = new Table({
            head: [chalk.bold("path"), ...fields.map((f) => chalk.bold(f))],
            style: { head: [], border: [] },
          });

          for (const r of results) {
            table.push([
              r.path,
              ...fields.map((f) => formatValue(getField(r, f))),
            ]);
          }

          console.log(table.toString());

          if (queryResult.meta) {
            const { total_count, has_more } = queryResult.meta;
            if (has_more) {
              console.log(chalk.dim(`Showing ${results.length} of ${total_count} results`));
            }
          }
          break;
        }
      }

      process.exit(0);
    });
}
