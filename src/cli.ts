#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
import { registerValidate } from "./commands/validate.js";
import { registerQuery } from "./commands/query.js";
import { registerRead } from "./commands/read.js";
import { registerCreate } from "./commands/create.js";
import { registerUpdate } from "./commands/update.js";
import { registerDelete } from "./commands/delete.js";
import { registerRename } from "./commands/rename.js";
import { registerTypes } from "./commands/types.js";
import { registerBase } from "./commands/base.js";
import { registerInit } from "./commands/init.js";
import { registerLint } from "./commands/lint.js";
import { registerFmt } from "./commands/fmt.js";
import { registerExport } from "./commands/export.js";
import { registerImport } from "./commands/import.js";
import { registerGraph } from "./commands/graph.js";
import { registerStats } from "./commands/stats.js";
import { registerWatch } from "./commands/watch.js";
import { registerDiff } from "./commands/diff.js";
import { registerSchema } from "./commands/schema.js";
import { registerCapture } from "./commands/capture.js";
import { registerInbox } from "./commands/inbox.js";
import { registerRun } from "./commands/run.js";

const program = new Command();

program
  .name("mdbase")
  .description("CLI tool for mdbase collections")
  .version(pkg.version);

// Core spec commands
registerValidate(program);
registerQuery(program);
registerRead(program);
registerCreate(program);
registerUpdate(program);
registerDelete(program);
registerRename(program);
registerTypes(program);

// Obsidian Bases integration
registerBase(program);

// Beyond-spec commands
registerInit(program);
registerLint(program);
registerFmt(program);
registerExport(program);
registerImport(program);
registerGraph(program);
registerStats(program);
registerWatch(program);
registerDiff(program);
registerSchema(program);

// Quick capture workflow
registerCapture(program);
registerInbox(program);

// YAML query execution
registerRun(program);

await program.parseAsync();
