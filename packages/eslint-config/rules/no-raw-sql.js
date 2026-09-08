const SQL_STATEMENT_PATTERN =
  /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|SCHEMA)|DROP\s+(TABLE|INDEX|SCHEMA)|ALTER\s+TABLE|WITH)\b/i;

const RAW_SQL_CALL_METHODS = new Set(["query", "execute", "exec", "raw", "unsafe"]);

function stringContentOf(node) {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((quasi) => quasi.value.raw).join(" ");
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw SQL outside packages/db so every query goes through the vetted, dialect-specific, tenant-scoped data-access layer.",
    },
    schema: [],
    messages: {
      rawSqlLiteral:
        "Raw SQL string/template literal found outside packages/db. Route this through @smb-os/db so dialect handling and tenant scoping are enforced in one place.",
      rawSqlTag:
        "Raw SQL tagged template found outside packages/db. Route this through @smb-os/db so dialect handling and tenant scoping are enforced in one place.",
      rawSqlCall:
        "Raw SQL call found outside packages/db. Route this through @smb-os/db so dialect handling and tenant scoping are enforced in one place.",
    },
  },
  create(context) {
    return {
      "Literal, TemplateLiteral"(node) {
        const content = stringContentOf(node);
        if (content && SQL_STATEMENT_PATTERN.test(content)) {
          context.report({ node, messageId: "rawSqlLiteral" });
        }
      },
      TaggedTemplateExpression(node) {
        const tag = node.tag;
        const tagName =
          tag.type === "Identifier"
            ? tag.name
            : tag.type === "MemberExpression" && tag.property.type === "Identifier"
              ? tag.property.name
              : null;
        if (tagName === "sql") {
          context.report({ node, messageId: "rawSqlTag" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
          if (RAW_SQL_CALL_METHODS.has(callee.property.name)) {
            const firstArg = node.arguments[0];
            if (firstArg && stringContentOf(firstArg) !== null) {
              context.report({ node, messageId: "rawSqlCall" });
            }
          }
        }
      },
    };
  },
};

export default rule;
