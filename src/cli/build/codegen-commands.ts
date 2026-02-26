import ts from "typescript";

import { toCamelCase, type CommandSummary, type ResolvedBundleConfig } from "./codegen.js";

export type CommandMethodInfo = { methodName: string; content: string };

export function resolveCommandMethods(
  commands: CommandSummary[],
  commandContents: Map<string, string>,
): CommandMethodInfo[] {
  const seen = new Set<string>();

  return commands.map((cmd) => {
    const content = commandContents.get(cmd.name);
    if (content === undefined) {
      throw new Error(`Missing content for command "${cmd.name}". Ensure all commands are loaded.`);
    }

    const methodName = toCamelCase(cmd.name);
    if (seen.has(methodName)) {
      throw new Error(`Duplicate command method name "${methodName}" (from "${cmd.name}").`);
    }
    seen.add(methodName);

    return { methodName, content };
  });
}

export function createCommandMethodSignature(methodName: string): ts.MethodSignature {
  return ts.factory.createMethodSignature(
    undefined,
    ts.factory.createIdentifier(methodName),
    undefined,
    undefined,
    [
      ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        ts.factory.createIdentifier("args"),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ),
    ],
    ts.factory.createTypeReferenceNode("Promise", [
      ts.factory.createTypeReferenceNode("ResponseOutput"),
    ]),
  );
}

export function createRuntimeValueImport(): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("defineAgent")),
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("withCommands")),
      ]),
    ),
    ts.factory.createStringLiteral("agent-bundle/runtime"),
    undefined,
  );
}

export function createRuntimeTypeImport(): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("Agent")),
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("ResponseOutput")),
      ]),
    ),
    ts.factory.createStringLiteral("agent-bundle/runtime"),
    undefined,
  );
}

export function createCommandTypeStatements(
  resolved: ResolvedBundleConfig,
  methods: CommandMethodInfo[],
): { commandTypeAlias: ts.Statement; agentTypeAlias: ts.Statement } {
  const commandsTypeName = `${resolved.namePascal}Commands`;
  const agentTypeName = `${resolved.namePascal}Agent`;

  const commandTypeAlias = ts.factory.createTypeAliasDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createIdentifier(commandsTypeName),
    undefined,
    ts.factory.createTypeLiteralNode(
      methods.map((m) => createCommandMethodSignature(m.methodName)),
    ),
  );

  const agentTypeAlias = ts.factory.createTypeAliasDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createIdentifier(agentTypeName),
    undefined,
    ts.factory.createIntersectionTypeNode([
      ts.factory.createTypeReferenceNode("Agent"),
      ts.factory.createTypeReferenceNode(commandsTypeName),
    ]),
  );

  return { commandTypeAlias, agentTypeAlias };
}

export function createCommandDefsStatement(methods: CommandMethodInfo[]): ts.Statement {
  return ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier("_commandDefs"),
          undefined,
          undefined,
          ts.factory.createArrayLiteralExpression(
            methods.map((m) =>
              ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment("methodName", ts.factory.createStringLiteral(m.methodName)),
                ts.factory.createPropertyAssignment("content", ts.factory.createStringLiteral(m.content)),
              ], false),
            ),
            true,
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

export function createWrapperExport(
  namePascal: string,
  commandsTypeName: string,
): ts.Statement {
  return ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier(namePascal),
          undefined,
          undefined,
          ts.factory.createObjectLiteralExpression([
            ts.factory.createSpreadAssignment(ts.factory.createIdentifier("_factory")),
            ts.factory.createPropertyAssignment("init", createInitArrow(commandsTypeName)),
          ], true),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

function createInitArrow(commandsTypeName: string): ts.ArrowFunction {
  const returnType = ts.factory.createTypeReferenceNode("Promise", [
    ts.factory.createIntersectionTypeNode([
      ts.factory.createTypeReferenceNode("Agent"),
      ts.factory.createTypeReferenceNode(commandsTypeName),
    ]),
  ]);

  return ts.factory.createArrowFunction(
    [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
    undefined,
    [
      ts.factory.createParameterDeclaration(
        undefined, undefined,
        ts.factory.createIdentifier("options"), undefined,
        ts.factory.createIndexedAccessTypeNode(
          ts.factory.createTypeReferenceNode("Parameters", [
            ts.factory.createTypeQueryNode(
              ts.factory.createQualifiedName(
                ts.factory.createIdentifier("_factory"),
                ts.factory.createIdentifier("init"),
              ),
            ),
          ]),
          ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(0)),
        ),
      ),
    ],
    returnType,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createBlock([
      ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList([
          ts.factory.createVariableDeclaration(
            ts.factory.createIdentifier("agent"), undefined, undefined,
            ts.factory.createAwaitExpression(
              ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createIdentifier("_factory"),
                  ts.factory.createIdentifier("init"),
                ),
                undefined,
                [ts.factory.createIdentifier("options")],
              ),
            ),
          ),
        ], ts.NodeFlags.Const),
      ),
      ts.factory.createReturnStatement(
        ts.factory.createCallExpression(
          ts.factory.createIdentifier("withCommands"),
          [ts.factory.createTypeReferenceNode(commandsTypeName)],
          [ts.factory.createIdentifier("agent"), ts.factory.createIdentifier("_commandDefs")],
        ),
      ),
    ], true),
  );
}
