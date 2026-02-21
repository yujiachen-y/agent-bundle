import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/lib/frontmatter.mjs";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and trims the markdown body", () => {
    const content = "---\nname: demo\ndescription: Sample skill\n---\n\n# Heading\n\nBody text.\n";
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter).toEqual({ name: "demo", description: "Sample skill" });
    expect(parsed.body).toBe("# Heading\n\nBody text.");
  });

  it("normalizes CRLF line endings before parsing", () => {
    const content = "---\r\nname: windows\r\ndescription: Works\r\n---\r\nLine one\r\nLine two\r\n";
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter).toEqual({ name: "windows", description: "Works" });
    expect(parsed.body).toBe("Line one\nLine two");
  });

  it("returns empty frontmatter when no YAML block exists", () => {
    const parsed = parseFrontmatter("  plain markdown body  \n");

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("plain markdown body");
  });

  it("returns empty frontmatter when YAML parses to a non-object", () => {
    const content = "---\njust-a-string\n---\nBody\n";
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("Body");
  });
});
