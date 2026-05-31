/**
 * ESLint rule: no-top-level-document
 * Flags top-level usages of `document.*` (except common safe patterns like
 * `document.readyState` and `document.addEventListener('DOMContentLoaded', ...)`).
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow top-level access to `document` to avoid DOM-timing issues",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        // only interested in `document.xxx` patterns
        const obj = node.object;
        if (!obj || obj.type !== "Identifier" || obj.name !== "document")
          return;

        // allow `document.readyState`
        if (
          node.property &&
          node.property.type === "Identifier" &&
          node.property.name === "readyState"
        )
          return;

        // allow `document.addEventListener('DOMContentLoaded', ...)`
        if (
          node.property &&
          node.property.type === "Identifier" &&
          node.property.name === "addEventListener"
        ) {
          const parent = node.parent;
          if (parent && parent.type === "CallExpression") {
            const args = parent.arguments || [];
            if (args.length > 0) {
              const first = args[0];
              if (
                (first.type === "Literal" &&
                  first.value === "DOMContentLoaded") ||
                (first.type === "TemplateLiteral" &&
                  first.quasis &&
                  first.quasis.length === 1 &&
                  first.quasis[0].value.raw === "DOMContentLoaded")
              ) {
                return;
              }
            }
          }
        }

        // check ancestor chain to determine if we're inside a function/class (allowed)
        const ancestors = context.getAncestors();
        const insideFunctionLike = ancestors.some((a) => {
          return (
            a.type === "FunctionDeclaration" ||
            a.type === "FunctionExpression" ||
            a.type === "ArrowFunctionExpression" ||
            a.type === "MethodDefinition" ||
            a.type === "ClassDeclaration" ||
            a.type === "ClassExpression" ||
            a.type === "TSModuleDeclaration" ||
            a.type === "PropertyDefinition" ||
            a.type === "TSAbstractClassDeclaration"
          );
        });
        if (insideFunctionLike) return;

        // All other top-level `document` accesses are flagged
        context.report({
          node,
          message:
            "Top-level access to `document` is disallowed — wrap in DOMContentLoaded or guard with null-check.",
        });
      },
    };
  },
};
