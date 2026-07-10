import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Provider = "anthropic" | "openai" | "gemini" | "ollama" | "openrouter";
type SandboxProvider = "e2b" | "kubernetes" | "docker" | "none";

interface InitAnswers {
  name: string;
  provider: Provider;
  model: string;
  sandbox: SandboxProvider;
  createSkill: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3",
  openrouter: "openai/gpt-4o",
};

const API_KEY_VARS: Record<Provider, string | null> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  ollama: null,
  openrouter: "OPENROUTER_API_KEY",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl: readline.Interface, question: string): Promise<string> {
  return rl.question(question);
}

async function askWithDefault(
  rl: readline.Interface,
  question: string,
  defaultValue: string,
): Promise<string> {
  const answer = await ask(rl, `${question} (${defaultValue}): `);
  return answer.trim() || defaultValue;
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: T[],
  defaultChoice: T,
): Promise<T> {
  const choiceStr = choices
    .map((c) => (c === defaultChoice ? `[${c}]` : c))
    .join(" / ");
  while (true) {
    const answer = (await ask(rl, `${question} ${choiceStr}: `)).trim().toLowerCase();
    if (answer === "") return defaultChoice;
    if ((choices as string[]).includes(answer)) return answer as T;
    console.log(`  Please choose one of: ${choices.join(", ")}`);
  }
}

async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await ask(rl, `${question} ${hint}: `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function generateYaml(answers: InitAnswers): string {
  const sandboxBlock =
    answers.sandbox === "none"
      ? ""
      : `\nsandbox:\n  provider: ${answers.sandbox}\n`;

  const skillsBlock = answers.createSkill
    ? `\nskills:\n  - path: ./skills/hello\n`
    : "";

  return `name: ${answers.name}

model:
  provider: ${answers.provider}
  model: ${answers.model}

prompt:
  system: |
    You are a helpful assistant.
${sandboxBlock}${skillsBlock}`;
}

function generateEnvExample(answers: InitAnswers): string {
  const keyVar = API_KEY_VARS[answers.provider];
  const lines: string[] = [
    "# Copy this file to .env and fill in your values.",
    "",
  ];
  if (keyVar) {
    lines.push(`${keyVar}=`);
  }
  if (answers.sandbox === "e2b") {
    lines.push("E2B_API_KEY=");
  }
  return lines.join("\n") + "\n";
}

function generateSkillMd(projectName: string): string {
  return `# hello

A simple example skill for ${projectName}.

## Description

Greet the user by name.

## Usage

Ask the agent: "Say hello to Alice"
`;
}

function generateSkillTs(): string {
  return `import { defineTool } from "agent-bundle/runtime";
import { z } from "zod";

export const helloTool = defineTool({
  name: "hello",
  description: "Greet a user by name.",
  input: z.object({
    name: z.string().describe("The name to greet."),
  }),
  run: async ({ name }) => {
    return \`Hello, \${name}!\`;
  },
});
`;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function writeFiles(cwd: string, answers: InitAnswers): void {
  const yaml = generateYaml(answers);
  const envExample = generateEnvExample(answers);

  const yamlPath = path.join(cwd, "agent-bundle.yaml");
  const envPath = path.join(cwd, ".env.example");

  if (existsSync(yamlPath)) {
    console.log(`\n  ⚠  agent-bundle.yaml already exists — skipping.`);
  } else {
    writeFileSync(yamlPath, yaml, "utf8");
    console.log(`  ✔  Created agent-bundle.yaml`);
  }

  writeFileSync(envPath, envExample, "utf8");
  console.log(`  ✔  Created .env.example`);

  if (answers.createSkill) {
    const skillDir = path.join(cwd, "skills", "hello");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), generateSkillMd(answers.name), "utf8");
    writeFileSync(path.join(skillDir, "tool.ts"), generateSkillTs(), "utf8");
    console.log(`  ✔  Created skills/hello/SKILL.md`);
    console.log(`  ✔  Created skills/hello/tool.ts`);
  }
}

// ---------------------------------------------------------------------------
// Next-steps message
// ---------------------------------------------------------------------------

function printNextSteps(answers: InitAnswers): void {
  const keyVar = API_KEY_VARS[answers.provider];
  console.log(`
Next steps:
`);
  if (keyVar) {
    console.log(`  1. Set your API key:`);
    console.log(`       export ${keyVar}=<your-key>\n`);
    console.log(`  2. Start the development server:`);
    console.log(`       npx agent-bundle dev\n`);
    console.log(`  3. Open http://localhost:3000 to chat with your agent.`);
  } else {
    console.log(`  1. Make sure Ollama is running locally.`);
    console.log(`  2. Start the development server:`);
    console.log(`       npx agent-bundle dev\n`);
    console.log(`  3. Open http://localhost:3000 to chat with your agent.`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface InitOptions {
  cwd?: string;
}

export async function runInitCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const defaultName = path.basename(cwd);

  const rl = readline.createInterface({ input, output });

  console.log("\n  agent-bundle init\n");

  try {
    const name = await askWithDefault(rl, "Project name", defaultName);

    const provider = await askChoice<Provider>(
      rl,
      "Model provider",
      ["anthropic", "openai", "gemini", "ollama", "openrouter"],
      "anthropic",
    );

    const defaultModel = DEFAULT_MODELS[provider];
    const model = await askWithDefault(rl, "Model", defaultModel);

    const sandbox = await askChoice<SandboxProvider>(
      rl,
      "Sandbox provider",
      ["e2b", "kubernetes", "docker", "none"],
      "none",
    );

    const createSkill = await askYesNo(rl, "Create an example skill?", true);

    const answers: InitAnswers = { name, provider, model, sandbox, createSkill };

    console.log("");
    writeFiles(cwd, answers);
    printNextSteps(answers);
  } finally {
    rl.close();
  }
}
