import ts from "typescript";

import type { SkillSummary } from "../../agent-loop/system-prompt/generate.js";
import type { BundleConfig } from "../../schema/bundle.js";

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

function printStatements(statements: ts.Statement[], filename: string): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sourceFile = ts.createSourceFile(filename, "", ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);

  const rendered = statements
    .map((statement) => {
      return printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile);
    })
    .join("\n\n");

  return `${rendered}\n`;
}

function createFactoryConfigExpression(resolved: ResolvedBundleConfig): ts.ObjectLiteralExpression {
  const variableArray = ts.factory.createAsExpression(
    toExpression(sanitizeJsonValue(resolved.prompt.variables)),
    ts.factory.createTypeReferenceNode("const", undefined),
  );
  const mcpServers = resolved.mcp?.servers;

  const properties = [
    ts.factory.createPropertyAssignment("name", ts.factory.createStringLiteral(resolved.name)),
    ts.factory.createPropertyAssignment(
      "sandbox",
      toExpression(sanitizeJsonValue(resolved.sandbox)),
    ),
    ts.factory.createPropertyAssignment("model", toExpression(sanitizeJsonValue(resolved.model))),
    ts.factory.createPropertyAssignment(
      "systemPrompt",
      ts.factory.createStringLiteral(resolved.systemPrompt),
    ),
    ts.factory.createPropertyAssignment("variables", variableArray),
  ];

  if (mcpServers) {
    // AgentConfig expects an array; BundleConfig stores it under mcp.servers.
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
      kubernetes: {
        ...sandbox.kubernetes,
        image: imageRef.ref,
      },
    };
  }

  return {
    ...sandbox,
    provider: "e2b",
    e2b: {
      ...sandbox.e2b,
      template: imageRef.ref,
    },
  };
}

export function createResolvedBundleConfig(input: {
  config: BundleConfig;
  systemPrompt: string;
  skills: SkillSummary[];
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
    mcp: input.config.mcp,
    sandboxImage: input.sandboxImage,
  };
}

export function generateIndexSource(resolved: ResolvedBundleConfig): string {
  const importDeclaration = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("defineAgent")),
      ]),
    ),
    ts.factory.createStringLiteral("agent-bundle/runtime"),
    undefined,
  );

  const declaration = ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier(resolved.namePascal),
          undefined,
          undefined,
          ts.factory.createCallExpression(ts.factory.createIdentifier("defineAgent"), undefined, [
            createFactoryConfigExpression(resolved),
          ]),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );

  return printStatements([importDeclaration, declaration], "index.ts");
}

export function generateTypesSource(resolved: ResolvedBundleConfig): string {
  const interfaceName = `${resolved.namePascal}Variables`;
  const variableNames = Array.from(new Set(resolved.prompt.variables));

  const members = variableNames.map((variableName) => {
    return ts.factory.createPropertySignature(
      undefined,
      ts.factory.createIdentifier(variableName),
      undefined,
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    );
  });

  const declaration = ts.factory.createInterfaceDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createIdentifier(interfaceName),
    undefined,
    undefined,
    members,
  );

  return printStatements([declaration], "types.ts");
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
    dependencies: {
      "agent-bundle": "*",
    },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

export function generateSources(resolved: ResolvedBundleConfig): GeneratedSources {
  return {
    indexSource: generateIndexSource(resolved),
    typesSource: generateTypesSource(resolved),
    bundleJsonSource: generateBundleJsonSource(resolved),
    packageJsonSource: generatePackageJsonSource(resolved.name),
  };
}
