import { z } from "zod";

const BUNDLE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GITHUB_REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;
const PROMPT_VARIABLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const modelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openrouter",
]);
const ollamaModelSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

const sandboxProviderSchema = z.enum(["e2b", "kubernetes"]);

const promptVariableSchema = z
  .string()
  .min(1, "Prompt variable names cannot be empty.")
  .regex(
    PROMPT_VARIABLE_PATTERN,
    "Prompt variable names must start with a letter or underscore and contain only letters, numbers, or underscores.",
  );

const resourcesSchema = z
  .object({
    cpu: z.number().positive(),
    memory: z.string().min(1),
  })
  .strict()
  .default({
    cpu: 2,
    memory: "512MB",
  });

const sandboxSchema = z
  .object({
    provider: sandboxProviderSchema,
    timeout: z.number().int().positive().default(900),
    resources: resourcesSchema,
    e2b: z
      .object({
        template: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    kubernetes: z
      .object({
        namespace: z.string().min(1).optional(),
        kubeconfig: z.string().min(1).optional(),
        nodeSelector: z.record(z.string(), z.string()).optional(),
        registry: z.string().min(1).optional(),
        image: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    serve: z
      .object({
        provider: sandboxProviderSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const localSkillSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const githubSkillSchema = z
  .object({
    github: z
      .string()
      .regex(GITHUB_REPO_PATTERN, "GitHub skill source must be in owner/repo format."),
    skill: z.string().min(1).optional(),
    ref: z.string().min(1).default("main"),
  })
  .strict();

const urlSkillSchema = z
  .object({
    url: z.string().url(),
    version: z.string().min(1).optional(),
  })
  .strict();

const skillEntrySchema = z.union([localSkillSchema, githubSkillSchema, urlSkillSchema]);

const mcpServerSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    auth: z.enum(["bearer"]),
  })
  .strict();

const mcpSchema = z
  .object({
    servers: z.array(mcpServerSchema).min(1),
  })
  .strict();

export const bundleSchema = z
  .object({
    name: z
      .string()
      .regex(BUNDLE_NAME_PATTERN, "Bundle name must be kebab-case."),
    model: z
      .object({
        provider: modelProviderSchema,
        model: z.string().min(1),
        ollama: ollamaModelSchema.optional(),
      })
      .strict(),
    prompt: z
      .object({
        system: z.string().min(1),
        variables: z.array(promptVariableSchema).default([]),
      })
      .strict(),
    sandbox: sandboxSchema,
    skills: z.array(skillEntrySchema).min(1),
    mcp: mcpSchema.optional(),
  })
  .strict();

export type BundleConfig = z.infer<typeof bundleSchema>;
export type SkillEntry = BundleConfig["skills"][number];

export function parseBundleConfig(raw: unknown): BundleConfig {
  return bundleSchema.parse(raw);
}
