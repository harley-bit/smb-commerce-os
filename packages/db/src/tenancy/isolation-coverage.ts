import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

/**
 * A tenant-scoped repository method that Gate G1 requires isolation
 * evidence for: `docs/design/07` Control #1 is only real if every method
 * on every `TenantScopedRepository` subclass is provably exercised across
 * two different merchants, not just declared to take a `TenantContext`.
 */
export interface RepositoryMethodRef {
  readonly className: string;
  readonly sourceFile: string;
  readonly methodName: string;
}

/** One method that has no isolation-test evidence in its class's test file. */
export interface IsolationCoverageGap {
  readonly className: string;
  readonly sourceFile: string;
  readonly methodName: string;
  readonly reason: string;
}

/**
 * Parses a repository source file with the TypeScript compiler API (same
 * pattern as `packages/config/test/strict-config.test.ts`) and returns
 * every public method of every class that extends `TenantScopedRepository`.
 * Constructors are excluded — they take a `Connection`, not a `TenantContext`.
 */
export function listTenantScopedMethods(sourceFilePath: string): RepositoryMethodRef[] {
  const text = readFileSync(sourceFilePath, "utf8");
  const source = ts.createSourceFile(sourceFilePath, text, ts.ScriptTarget.Latest, true);
  const results: RepositoryMethodRef[] = [];

  source.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;

    const extendsTenantScoped = (node.heritageClauses ?? []).some(
      (clause) =>
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some((t) => t.expression.getText(source).startsWith("TenantScopedRepository")),
    );
    if (!extendsTenantScoped) return;

    const className = node.name.text;
    for (const member of node.members) {
      const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
      const isPrivateOrProtected = modifiers.some(
        (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      if (isPrivateOrProtected) continue;

      // Repository methods are declared as class properties assigned an
      // arrow function, typed `RepositoryMethod<...>` — see any file in
      // `packages/db/src/repositories`.
      if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        results.push({ className, sourceFile: sourceFilePath, methodName: member.name.text });
      }
    }
  });

  return results;
}

function extractItBlocks(testFilePath: string): string[] {
  const text = readFileSync(testFilePath, "utf8");
  const source = ts.createSourceFile(testFilePath, text, ts.ScriptTarget.Latest, true);
  const blocks: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "it" &&
      node.arguments.length >= 2
    ) {
      blocks.push(node.arguments[1]!.getText(source));
    }
    node.forEachChild(visit);
  }
  visit(source);

  return blocks;
}

/**
 * A method counts as isolation-tested when at least one `it()` block both
 * calls it (`repo.<method>(`) and references two distinct tenant contexts
 * (e.g. `ctxA` / `ctxB`) — proof the test actually exercises two merchants,
 * not just one. A block that only ever touches a single context can't be
 * evidence of cross-tenant isolation no matter what it asserts.
 */
function hasIsolationEvidence(methodName: string, itBlocks: string[]): boolean {
  const callPattern = new RegExp(`\\.${methodName}\\s*\\(`);
  const contextPattern = /\bctx[A-Z]\w*/g;

  return itBlocks.some((block) => {
    if (!callPattern.test(block)) return false;
    const contexts = new Set(block.match(contextPattern) ?? []);
    return contexts.size >= 2;
  });
}

/**
 * The generator: scans every repository source file in `repositoriesDir`
 * for `TenantScopedRepository` methods, and reports every one that has no
 * cross-tenant isolation evidence in its sibling `.test.ts` file. Card
 * D021's acceptance criterion ("new repository method without a test
 * fails the build") is this function returning a non-empty array for it.
 */
export function findIsolationCoverageGaps(repositoriesDir: string): IsolationCoverageGap[] {
  const gaps: IsolationCoverageGap[] = [];
  const files = readdirSync(repositoriesDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  for (const file of files) {
    const sourceFilePath = join(repositoriesDir, file);
    const methods = listTenantScopedMethods(sourceFilePath);
    if (methods.length === 0) continue;

    const testFilePath = join(repositoriesDir, `${basename(file, ".ts")}.test.ts`);
    let itBlocks: string[];
    try {
      itBlocks = extractItBlocks(testFilePath);
    } catch {
      for (const method of methods) {
        gaps.push({
          className: method.className,
          sourceFile: method.sourceFile,
          methodName: method.methodName,
          reason: `no test file found at ${testFilePath}`,
        });
      }
      continue;
    }

    for (const method of methods) {
      if (!hasIsolationEvidence(method.methodName, itBlocks)) {
        gaps.push({
          className: method.className,
          sourceFile: method.sourceFile,
          methodName: method.methodName,
          reason: `no it() block in ${testFilePath} calls ${method.methodName}() while referencing two distinct tenant contexts`,
        });
      }
    }
  }

  return gaps;
}
