import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import { Collection } from "@erauner/mdbase";
import yaml from "js-yaml";
import matter from "gray-matter";

interface FieldDef {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

interface TypeDef {
  name: string;
  template?: string;
  fields?: Record<string, FieldDef>;
}

async function loadTypeDef(cwd: string, typeName: string): Promise<TypeDef | null> {
  const typePath = path.join(cwd, "_types", `${typeName}.md`);
  try {
    const content = await fs.readFile(typePath, "utf-8");
    const parsed = matter(content);
    return parsed.data as TypeDef;
  } catch {
    return null;
  }
}

function validateAndEnrich(
  frontmatter: Record<string, unknown>,
  typeDef: TypeDef,
): { errors: string[]; hints: string[]; enriched: Record<string, unknown> } {
  const errors: string[] = [];
  const hints: string[] = [];
  const enriched = { ...frontmatter };
  const now = new Date();

  if (!typeDef.fields) {
    return { errors, hints, enriched };
  }

  for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
    const hasValue = fieldName in enriched && enriched[fieldName] != null;

    // Auto-compute date/datetime fields if not provided
    if (!hasValue && (fieldDef.type === "date" || fieldDef.type === "datetime")) {
      if (fieldDef.type === "date") {
        enriched[fieldName] = now.toISOString().split("T")[0];
      } else {
        enriched[fieldName] = now.toISOString();
      }
      continue;
    }

    // Apply defaults
    if (!hasValue && fieldDef.default !== undefined) {
      enriched[fieldName] = fieldDef.default;
      continue;
    }

    // Check required fields
    if (fieldDef.required && !hasValue) {
      const desc = fieldDef.description ? ` - ${fieldDef.description}` : "";
      errors.push(`${fieldName} (${fieldDef.type})${desc}`);
    }

    // Collect hints for optional fields not provided
    if (!fieldDef.required && !hasValue && fieldDef.description) {
      hints.push(`${fieldName}: ${fieldDef.description}`);
    }
  }

  return { errors, hints, enriched };
}

interface TemplateContext {
  body?: string;
  frontmatter: Record<string, unknown>;
}

function applyTemplate(template: string, ctx: TemplateContext): string {
  const now = new Date();

  // Built-in variables
  const builtins: Record<string, string> = {
    body: ctx.body ?? "",
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().slice(0, 5),
    now: now.toISOString(),
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    // Check built-ins first
    if (key in builtins) return builtins[key];
    // Then check frontmatter fields
    if (key in ctx.frontmatter) {
      const val = ctx.frontmatter[key];
      if (Array.isArray(val)) return val.join(", ");
      return String(val ?? "");
    }
    // Leave unknown placeholders as-is
    return match;
  });
}

function parseFieldValue(raw: string): unknown {
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Null
  if (raw === "null") return null;

  // Number (integer or float)
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);

  // List (comma-separated in brackets)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((s) => s.trim());
  }

  // String (default)
  return raw;
}

function parseFields(fieldArgs: string[]): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  for (const f of fieldArgs) {
    const eqIdx = f.indexOf("=");
    if (eqIdx === -1) {
      console.error(chalk.red(`error: invalid field format: ${f} (expected key=value)`));
      process.exit(1);
    }
    const key = f.slice(0, eqIdx);
    const rawValue = f.slice(eqIdx + 1);
    frontmatter[key] = parseFieldValue(rawValue);
  }
  return frontmatter;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return chalk.dim("null");
  if (Array.isArray(value)) return `[${value.map(String).join(", ")}]`;
  return String(value);
}

export function registerCreate(program: Command): void {
  program
    .command("create <path>")
    .description("Create a new file with typed frontmatter")
    .option("-t, --type <type>", "Type for the new file")
    .option("-f, --field <fields...>", "Field values as key=value pairs")
    .option("--body <body>", "Body content")
    .option("--body-stdin", "Read body from stdin")
    .option("--format <format>", "Output format: text, json, yaml", "text")
    .action(async (filePath: string, opts) => {
      const cwd = process.cwd();

      // Open the collection
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

      // Parse field values
      const frontmatter = opts.field ? parseFields(opts.field as string[]) : {};

      // Read body from stdin if requested
      let body: string | undefined = opts.body;
      if (opts.bodyStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString("utf-8");
      }

      const relativePath = path.relative(cwd, path.resolve(cwd, filePath));

      // Build create input
      const input: {
        type?: string;
        types?: string[];
        path?: string;
        frontmatter?: Record<string, unknown>;
        body?: string;
      } = {
        path: relativePath,
        frontmatter,
      };

      if (opts.type) {
        input.type = opts.type;

        // Load type definition for validation and template
        const typeDef = await loadTypeDef(cwd, opts.type);
        if (typeDef) {
          // Validate required fields and enrich with defaults/auto-computed values
          const { errors, hints, enriched } = validateAndEnrich(frontmatter, typeDef);

          if (errors.length > 0) {
            console.error(chalk.red("error: missing required fields:"));
            for (const err of errors) {
              console.error(chalk.red(`  - ${err}`));
            }
            if (hints.length > 0 && opts.format !== "json") {
              console.error(chalk.dim("\nOptional fields you can also provide:"));
              for (const hint of hints.slice(0, 5)) {
                console.error(chalk.dim(`  -f "${hint.split(":")[0]}=..."`));
              }
            }
            process.exit(1);
          }

          // Use enriched frontmatter
          Object.assign(frontmatter, enriched);
          input.frontmatter = frontmatter;

          // Apply template if defined
          if (typeDef.template) {
            body = applyTemplate(typeDef.template, { body, frontmatter });
          }

          // Show hints for optional fields (only in text mode, non-error)
          if (hints.length > 0 && opts.format === "text" && !opts.quiet) {
            // We'll show these after successful creation
          }
        }
      }
      if (body !== undefined) {
        input.body = body;
      }

      const result = await collection.create(input);
      outputResult(result, relativePath, opts);
    });
}

function outputResult(
  result: { valid?: boolean; frontmatter?: Record<string, unknown>; body?: string; path?: string; error?: { code: string; message: string } },
  requestedPath: string,
  opts: { format: string },
): void {
  if (result.error) {
    const exitCode = result.error.code === "path_conflict" ? 1
      : result.error.code === "unknown_type" ? 1
      : result.error.code === "validation_failed" ? 2
      : result.error.code === "permission_denied" ? 5
      : 1;

    if (opts.format === "json") {
      console.log(JSON.stringify({ error: result.error }, null, 2));
    } else {
      console.error(chalk.red(`error: ${result.error.message}`));
    }
    process.exit(exitCode);
  }

  const outputPath = result.path ?? requestedPath;

  switch (opts.format) {
    case "json": {
      const output: Record<string, unknown> = {
        path: outputPath,
        frontmatter: result.frontmatter ?? {},
      };
      if (result.body != null && result.body !== "") {
        output.body = result.body;
      }
      console.log(JSON.stringify(output, null, 2));
      break;
    }

    case "yaml": {
      const output: Record<string, unknown> = {
        path: outputPath,
        frontmatter: result.frontmatter ?? {},
      };
      if (result.body != null && result.body !== "") {
        output.body = result.body;
      }
      console.log(yaml.dump(output, { lineWidth: -1, noRefs: true }).trimEnd());
      break;
    }

    case "text":
    default: {
      console.log(`${chalk.green("created")} ${chalk.bold(outputPath)}`);

      const fm = result.frontmatter ?? {};
      const keys = Object.keys(fm);
      if (keys.length > 0) {
        const maxLen = Math.max(...keys.map((k) => k.length));
        for (const key of keys) {
          console.log(`  ${chalk.cyan(key.padEnd(maxLen))}  ${formatValue(fm[key])}`);
        }
      }
      break;
    }
  }

  process.exit(0);
}
