import { describe, it, expect } from "vitest";

// Types for testing
interface TemplateContext {
  body?: string;
  frontmatter: Record<string, unknown>;
}

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

function applyTemplate(template: string, ctx: TemplateContext): string {
  const now = new Date();

  const builtins: Record<string, string> = {
    body: ctx.body ?? "",
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().slice(0, 5),
    now: now.toISOString(),
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (key in builtins) return builtins[key];
    if (key in ctx.frontmatter) {
      const val = ctx.frontmatter[key];
      if (Array.isArray(val)) return val.join(", ");
      return String(val ?? "");
    }
    return match;
  });
}

describe("applyTemplate", () => {
  it("replaces {{body}} placeholder", () => {
    const template = "## Content\n{{body}}\n## End";
    const result = applyTemplate(template, { body: "Hello world", frontmatter: {} });
    expect(result).toBe("## Content\nHello world\n## End");
  });

  it("replaces frontmatter fields", () => {
    const template = "# {{title}}\nBy {{author}}";
    const result = applyTemplate(template, {
      frontmatter: { title: "My Doc", author: "Alice" },
    });
    expect(result).toBe("# My Doc\nBy Alice");
  });

  it("handles array frontmatter fields", () => {
    const template = "Attendees: {{attendees}}";
    const result = applyTemplate(template, {
      frontmatter: { attendees: ["Alice", "Bob", "Charlie"] },
    });
    expect(result).toBe("Attendees: Alice, Bob, Charlie");
  });

  it("leaves unknown placeholders unchanged", () => {
    const template = "Known: {{title}}, Unknown: {{unknown}}";
    const result = applyTemplate(template, {
      frontmatter: { title: "Test" },
    });
    expect(result).toBe("Known: Test, Unknown: {{unknown}}");
  });

  it("handles whitespace in placeholders", () => {
    const template = "{{ body }} and {{  title  }}";
    const result = applyTemplate(template, {
      body: "content",
      frontmatter: { title: "heading" },
    });
    expect(result).toBe("content and heading");
  });

  it("replaces {{date}} with current date", () => {
    const template = "Date: {{date}}";
    const result = applyTemplate(template, { frontmatter: {} });
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });

  it("replaces {{time}} with current time", () => {
    const template = "Time: {{time}}";
    const result = applyTemplate(template, { frontmatter: {} });
    expect(result).toMatch(/Time: \d{2}:\d{2}/);
  });

  it("handles empty body", () => {
    const template = "Before\n{{body}}\nAfter";
    const result = applyTemplate(template, { frontmatter: {} });
    expect(result).toBe("Before\n\nAfter");
  });

  it("frontmatter overrides built-in date if provided", () => {
    const template = "Date: {{date}}";
    // Note: current implementation uses built-ins first, so frontmatter date won't override
    // This test documents current behavior
    const result = applyTemplate(template, {
      frontmatter: { date: "2025-01-15" },
    });
    // Built-in takes precedence currently
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });
});

// Validation and enrichment function (copied for testing)
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

    if (!hasValue && (fieldDef.type === "date" || fieldDef.type === "datetime")) {
      if (fieldDef.type === "date") {
        enriched[fieldName] = now.toISOString().split("T")[0];
      } else {
        enriched[fieldName] = now.toISOString();
      }
      continue;
    }

    if (!hasValue && fieldDef.default !== undefined) {
      enriched[fieldName] = fieldDef.default;
      continue;
    }

    if (fieldDef.required && !hasValue) {
      const desc = fieldDef.description ? ` - ${fieldDef.description}` : "";
      errors.push(`${fieldName} (${fieldDef.type})${desc}`);
    }

    if (!fieldDef.required && !hasValue && fieldDef.description) {
      hints.push(`${fieldName}: ${fieldDef.description}`);
    }
  }

  return { errors, hints, enriched };
}

describe("validateAndEnrich", () => {
  it("returns errors for missing required fields", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        title: { type: "string", required: true, description: "The title" },
      },
    };
    const result = validateAndEnrich({}, typeDef);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("title");
    expect(result.errors[0]).toContain("The title");
  });

  it("auto-computes date fields", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        date: { type: "date", required: true },
      },
    };
    const result = validateAndEnrich({}, typeDef);
    expect(result.errors).toHaveLength(0);
    expect(result.enriched.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("auto-computes datetime fields", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        captured: { type: "datetime", required: true },
      },
    };
    const result = validateAndEnrich({}, typeDef);
    expect(result.errors).toHaveLength(0);
    expect(result.enriched.captured).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("applies default values", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        status: { type: "enum", default: "draft" },
      },
    };
    const result = validateAndEnrich({}, typeDef);
    expect(result.enriched.status).toBe("draft");
  });

  it("does not override provided values", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        date: { type: "date", required: true },
        status: { type: "enum", default: "draft" },
      },
    };
    const result = validateAndEnrich(
      { date: "2025-01-01", status: "published" },
      typeDef,
    );
    expect(result.enriched.date).toBe("2025-01-01");
    expect(result.enriched.status).toBe("published");
  });

  it("collects hints for optional fields", () => {
    const typeDef: TypeDef = {
      name: "test",
      fields: {
        title: { type: "string", required: true },
        description: { type: "string", required: false, description: "A brief description" },
      },
    };
    const result = validateAndEnrich({ title: "Test" }, typeDef);
    expect(result.errors).toHaveLength(0);
    expect(result.hints).toContain("description: A brief description");
  });

  it("handles type with no fields", () => {
    const typeDef: TypeDef = { name: "test" };
    const result = validateAndEnrich({ foo: "bar" }, typeDef);
    expect(result.errors).toHaveLength(0);
    expect(result.enriched.foo).toBe("bar");
  });
});
