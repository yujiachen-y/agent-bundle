import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We test the file-generation helpers in isolation by importing the module
// and exercising its public surface through runInitCommand with mocked stdin.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `agent-bundle-init-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// We mock readline so we can feed answers programmatically.
// ---------------------------------------------------------------------------

const mockQuestion = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

async function runInit(answers: string[], cwd: string): Promise<void> {
  // Reset call count and queue up answers in order.
  mockQuestion.mockReset();
  for (const answer of answers) {
    mockQuestion.mockResolvedValueOnce(answer);
  }
  // Import lazily to pick up the mock.
  const { runInitCommand } = await import("./init.js");
  await runInitCommand({ cwd });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runInitCommand", () => {
  it("creates agent-bundle.yaml and .env.example with default values", async () => {
    // Simulate pressing Enter for every prompt (accept defaults).
    await runInit(["", "", "", "", ""], tmpDir);

    expect(existsSync(path.join(tmpDir, "agent-bundle.yaml"))).toBe(true);
    expect(existsSync(path.join(tmpDir, ".env.example"))).toBe(true);
  });

  it("writes the chosen provider into agent-bundle.yaml", async () => {
    await runInit(["my-agent", "openai", "", "none", "n"], tmpDir);

    const yaml = readFileSync(path.join(tmpDir, "agent-bundle.yaml"), "utf8");
    expect(yaml).toContain("provider: openai");
    expect(yaml).toContain("name: my-agent");
  });

  it("includes the sandbox block when sandbox != none", async () => {
    await runInit(["my-agent", "anthropic", "", "e2b", "n"], tmpDir);

    const yaml = readFileSync(path.join(tmpDir, "agent-bundle.yaml"), "utf8");
    expect(yaml).toContain("provider: e2b");
  });

  it("omits the sandbox block when sandbox == none", async () => {
    await runInit(["my-agent", "anthropic", "", "none", "n"], tmpDir);

    const yaml = readFileSync(path.join(tmpDir, "agent-bundle.yaml"), "utf8");
    expect(yaml).not.toContain("sandbox:");
  });

  it("creates example skill files when user answers y", async () => {
    await runInit(["my-agent", "anthropic", "", "none", "y"], tmpDir);

    expect(existsSync(path.join(tmpDir, "skills", "hello", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "skills", "hello", "tool.ts"))).toBe(true);
  });

  it("does NOT create skill files when user answers n", async () => {
    await runInit(["my-agent", "anthropic", "", "none", "n"], tmpDir);

    expect(existsSync(path.join(tmpDir, "skills"))).toBe(false);
  });

  it("writes the correct API key placeholder in .env.example", async () => {
    await runInit(["proj", "openai", "", "none", "n"], tmpDir);

    const env = readFileSync(path.join(tmpDir, ".env.example"), "utf8");
    expect(env).toContain("OPENAI_API_KEY=");
  });

  it("writes E2B_API_KEY placeholder when sandbox is e2b", async () => {
    await runInit(["proj", "anthropic", "", "e2b", "n"], tmpDir);

    const env = readFileSync(path.join(tmpDir, ".env.example"), "utf8");
    expect(env).toContain("E2B_API_KEY=");
  });

  it("does NOT write an API key placeholder for ollama", async () => {
    await runInit(["proj", "ollama", "", "none", "n"], tmpDir);

    const env = readFileSync(path.join(tmpDir, ".env.example"), "utf8");
    expect(env).not.toContain("API_KEY=");
  });

  it("skips writing agent-bundle.yaml if it already exists", async () => {
    const yamlPath = path.join(tmpDir, "agent-bundle.yaml");
    // Write a sentinel value.
    mkdirSync(path.dirname(yamlPath), { recursive: true });
    require("node:fs").writeFileSync(yamlPath, "original", "utf8");

    await runInit(["proj", "anthropic", "", "none", "n"], tmpDir);

    const content = readFileSync(yamlPath, "utf8");
    expect(content).toBe("original");
  });
});
