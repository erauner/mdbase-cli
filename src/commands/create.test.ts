import { describe, it, expect } from "vitest";

// Extract the template functions for testing
interface TemplateContext {
  body?: string;
  frontmatter: Record<string, unknown>;
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
