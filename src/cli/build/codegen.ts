import ts from "typescript";

import type { SkillSummary } from "../../agent-loop/system-prompt/generate.js";
import type { Command } from "../../commands/types.js";
import type { BundleConfig } from "../../schema/bundle.js";
import {
  createCommandDefsStatement,
  createCommandTypeStatements,
  createRuntimeTypeImport,
  createRuntimeValueImport,
  createWrapperExport,
  resolveCommandMethods,
} from "./codegen-commands.js";

export type CommandSummary = {
  name: string;
  description: string;
  argumentHint?: string;
  sourcePath: string;
};

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SandboxImageRef = {
  provider: "e2b" | "kubernetes";
  ref: string;
};

export type ResolvedBundleConfig = {
  name: string;
  namePascal: string;
  model: BundleConfig["model"];
  sandbox: BundleConfig["sandbox"];
  prompt: BundleConfig["prompt"];
  systemPrompt: string;
  skills: SkillSummary[];
  commands: CommandSummary[];
  mcp?: BundleConfig["mcp"];
  sandboxImage: SandboxImageRef;
};

export type GeneratedSources = {
  indexSource: string;
  typesSource: string;
  bundleJsonSource: string;
  packageJsonSource: string;
};

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function toPropertyName(key: string): ts.PropertyName {
  if (IDENTIFIER_PATTERN.test(key)) {
    return ts.factory.createIdentifier(key);
  }

  return ts.factory.createStringLiteral(key);
}

function toPascalSegment(segment: string): string {
  const normalized = segment.trim();
  if (normalized.length === 0) {
    return "";
  }

  return normalized[0].toUpperCase() + normalized.slice(1);
}

export function toPascalCase(bundleName: string): string {
  if (bundleName.trim().length === 0) {
    throw new Error("Bundle name cannot be empty.");
  }

  const segments = bundleName
    .split("-")
    .map((segment) => toPascalSegment(segment))
    .filter((segment) => segment.length > 0);

  return segments.join("");
}

export function toCamelCase(name: string): string {
  const segments = name
    .split(/[\s-]+/)
    .map((segment) => toPascalSegment(segment))
    .filter((segment) => segment.length > 0);

  const pascal = segments.join("");
  if (pascal.length === 0) {
    return "";
  }

  const result = pascal[0].toLowerCase() + pascal.slice(1);

  if (!IDENTIFIER_PATTERN.test(result)) {
    throw new Error(`Command name "${name}" produces invalid identifier "${result}".`);
  }

  return result;
}

function sanitizeJsonValue(raw: unknown): JsonValue {
  if (
    typeof raw === "string"
    || typeof raw === "number"
    || typeof raw === "boolean"
    || raw === null
  ) {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw.map((entry) => sanitizeJsonValue(entry));
  }

  if (typeof raw === "object") {
    const entries = Object.entries(raw).filter((entry) => entry[1] !== undefined);

    return entries.reduce<{ [key: string]: JsonValue }>((acc, [key, value]) => {
      acc[key] = sanitizeJsonValue(value);
      return acc;
    }, {});
  }

  throw new Error("Cannot serialize unsupported value in generated artifact.");
}

function toExpression(value: JsonValue): ts.Expression {
  if (value === null) {
    return ts.factory.createNull();
  }

  if (typeof value === "string") {
    return ts.factory.createStringLiteral(value);
  }

  if (typeof value === "number") {
    return ts.factory.createNumericLiteral(value);
  }

  if (typeof value === "boolean") {
    return value ? ts.factory.createTrue() : ts.factory.createFalse();
  }

  if (Array.isArray(value)) {
    return ts.factory.createArrayLiteralExpression(
      value.map((entry) => toExpression(entry)),
      true,
    );
  }

  return ts.factory.createObjectLiteralExpression(
    Object.entries(value).map(([key, entryValue]) => {
      return ts.factory.createPropertyAssignment(toPropertyName(key), toExpression(entryValue));
    }),
    true,
  );
}

export function printStatements(statements: ts.Statement[], filename: string): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sourceFile = ts.createSourceFile(filename, "", ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);

  const rendered = statements
    .map((statement) => {
      return printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile);
    })
    .join("\n\n");

  return `${rendered}\n`;
}

export function createFactoryConfigExpression(resolved: ResolvedBundleConfig): ts.ObjectLiteralExpression {
  const variableArray = ts.factory.createAsExpression(
    toExpression(sanitizeJsonValue(resolved.prompt.variables)),
    ts.factory.createTypeReferenceNode("const", undefined),
  );
  const mcpServers = resolved.mcp?.servers;

  const properties = [
    ts.factory.createPropertyAssignment("name", ts.factory.createStringLiteral(resolved.name)),
    ts.factory.createPropertyAssignment("sandbox", toExpression(sanitizeJsonValue(resolved.sandbox))),
    ts.factory.createPropertyAssignment("model", toExpression(sanitizeJsonValue(resolved.model))),
    ts.factory.createPropertyAssignment("systemPrompt", ts.factory.createStringLiteral(resolved.systemPrompt)),
    ts.factory.createPropertyAssignment("variables", variableArray),
  ];

  if (mcpServers) {
    properties.push(ts.factory.createPropertyAssignment("mcp", toExpression(sanitizeJsonValue(mcpServers))));
  }

  return ts.factory.createObjectLiteralExpression(properties, true);
}

export function applySandboxImageRef(
  sandbox: BundleConfig["sandbox"],
  imageRef: SandboxImageRef,
): BundleConfig["sandbox"] {
  if (imageRef.provider === "kubernetes") {
    return {
      ...sandbox,
      provider: "kubernetes",
      kubernetes: { ...sandbox.kubernetes, image: imageRef.ref },
    };
  }

  return {
    ...sandbox,
    provider: "e2b",
    e2b: { ...sandbox.e2b, template: imageRef.ref },
  };
}

export function toCommandSummaries(commands: readonly Command[]): CommandSummary[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
    sourcePath: cmd.sourcePath,
  }));
}

export function createResolvedBundleConfig(input: {
  config: BundleConfig;
  systemPrompt: string;
  skills: SkillSummary[];
  commands?: CommandSummary[];
  sandboxImage: SandboxImageRef;
}): ResolvedBundleConfig {
  return {
    name: input.config.name,
    namePascal: toPascalCase(input.config.name),
    model: input.config.model,
    sandbox: applySandboxImageRef(input.config.sandbox, input.sandboxImage),
    prompt: input.config.prompt,
    systemPrompt: input.systemPrompt,
    skills: input.skills,
    commands: input.commands ?? [],
    mcp: input.config.mcp,
    sandboxImage: input.sandboxImage,
  };
}

function generateIndexSourceWithoutCommands(resolved: ResolvedBundleConfig): string {
  const importDecl = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports([
      ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("defineAgent")),
    ])),
    ts.factory.createStringLiteral("agent-bundle/runtime"),
    undefined,
  );

  const exportDecl = ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(
        ts.factory.createIdentifier(resolved.namePascal), undefined, undefined,
        ts.factory.createCallExpression(ts.factory.createIdentifier("defineAgent"), undefined, [
          createFactoryConfigExpression(resolved),
        ]),
      ),
    ], ts.NodeFlags.Const),
  );

  return printStatements([importDecl, exportDecl], "index.ts");
}

export function generateIndexSource(
  resolved: ResolvedBundleConfig,
  commandContents: Map<string, string> = new Map(),
): string {
  if (resolved.commands.length === 0) {
    return generateIndexSourceWithoutCommands(resolved);
  }

  const methods = resolveCommandMethods(resolved.commands, commandContents);
  const commandsTypeName = `${resolved.namePascal}Commands`;
  const runtimeImport = createRuntimeValueImport();
  const typeImport = createRuntimeTypeImport();
  const factoryDecl = ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(
        ts.factory.createIdentifier("_factory"), undefined, undefined,
        ts.factory.createCallExpression(ts.factory.createIdentifier("defineAgent"), undefined, [
          createFactoryConfigExpression(resolved),
        ]),
      ),
    ], ts.NodeFlags.Const),
  );
  const { commandTypeAlias, agentTypeAlias } = createCommandTypeStatements(resolved, methods);
  const commandDefs = createCommandDefsStatement(methods);
  const wrapper = createWrapperExport(resolved.namePascal, commandsTypeName);

  return printStatements(
    [runtimeImport, typeImport, factoryDecl, commandTypeAlias, agentTypeAlias, commandDefs, wrapper],
    "index.ts",
  );
}

export function generateTypesSource(resolved: ResolvedBundleConfig): string {
  const statements: ts.Statement[] = [];
  const interfaceName = `${resolved.namePascal}Variables`;
  const variableNames = Array.from(new Set(resolved.prompt.variables));

  const members = variableNames.map((variableName) => {
    return ts.factory.createPropertySignature(
      undefined, ts.factory.createIdentifier(variableName), undefined,
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    );
  });

  statements.push(ts.factory.createInterfaceDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createIdentifier(interfaceName), undefined, undefined, members,
  ));

  if (resolved.commands.length > 0) {
    const methods = resolved.commands.map((cmd) => ({
      methodName: toCamelCase(cmd.name),
      content: "",
    }));
    const { commandTypeAlias, agentTypeAlias } = createCommandTypeStatements(resolved, methods);
    statements.unshift(createRuntimeTypeImport());
    statements.push(commandTypeAlias, agentTypeAlias);
  }

  return printStatements(statements, "types.ts");
}

export function generateBundleJsonSource(resolved: ResolvedBundleConfig): string {
  return `${JSON.stringify(sanitizeJsonValue(resolved), null, 2)}\n`;
}

export function generatePackageJsonSource(bundleName: string): string {
  const packageJson = {
    name: `@agent-bundle/${bundleName}`,
    version: "0.0.0",
    type: "module",
    main: "./index.ts",
    types: "./index.ts",
    dependencies: { "agent-bundle": "*" },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

export function generateSources(
  resolved: ResolvedBundleConfig,
  commandContents: Map<string, string> = new Map(),
): GeneratedSources {
  return {
    indexSource: generateIndexSource(resolved, commandContents),
    typesSource: generateTypesSource(resolved),
    bundleJsonSource: generateBundleJsonSource(resolved),
    packageJsonSource: generatePackageJsonSource(resolved.name),
  };
}
