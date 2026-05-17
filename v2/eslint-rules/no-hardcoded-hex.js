/**
 * QUBA AI — Governance ESLint Rule: no-hardcoded-hex
 * 
 * Prevents hardcoded HEX color values in TSX/JSX files.
 * All colors MUST use CSS tokens from tokens.css.
 * 
 * ❌ color: '#FF3B30'
 * ❌ background: '#007AFF'
 * ✅ color: 'var(--q-red)'
 * ✅ background: 'var(--q-blue)'
 * 
 * Exceptions:
 * - tokens.css (token definitions themselves)
 * - .css files (raw CSS is allowed)
 * - Comments
 */
export const noHardcodedHex = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow hardcoded HEX color values in component files. Use governance tokens instead.",
    },
    messages: {
      noHex: "Hardcoded HEX '{{hex}}' detected. Use a governance token from tokens.css instead (e.g., var(--q-blue), var(--q-red)).",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    // Skip non-component files
    if (!filename.endsWith(".tsx") && !filename.endsWith(".jsx")) return {};
    // Skip token definition file
    if (filename.includes("tokens.css")) return {};

    const HEX_PATTERN = /#[0-9A-Fa-f]{6}\b/g;

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const matches = node.value.match(HEX_PATTERN);
        if (matches) {
          matches.forEach((hex) => {
            context.report({
              node,
              messageId: "noHex",
              data: { hex },
            });
          });
        }
      },
      TemplateLiteral(node) {
        node.quasis.forEach((quasi) => {
          const matches = quasi.value.raw.match(HEX_PATTERN);
          if (matches) {
            matches.forEach((hex) => {
              context.report({
                node: quasi,
                messageId: "noHex",
                data: { hex },
              });
            });
          }
        });
      },
    };
  },
};
