/**
 * QUBA AI — Governance ESLint Rule: no-native-dialog
 * 
 * Prevents usage of alert(), confirm(), and prompt() in component files.
 * All user feedback MUST use governance-compliant inline feedback patterns.
 * 
 * ❌ alert('Saved!')
 * ❌ confirm('Delete?')
 * ❌ window.alert('Error')
 * ✅ setSaveStatus('saved')
 * ✅ setSendError('Failed')
 * ✅ <ConfirmDialog />
 */
export const noNativeDialog = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow native browser dialogs (alert, confirm, prompt). Use inline feedback or governance components instead.",
    },
    messages: {
      noAlert: "alert() is banned. Use inline feedback state (e.g., setSaveStatus, setError) or a governance dialog component.",
      noConfirm: "confirm() is banned. Use a ConfirmDialog governance component instead.",
      noPrompt: "prompt() is banned. Use an inline input or governance modal instead.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (!filename.endsWith(".tsx") && !filename.endsWith(".jsx") && !filename.endsWith(".ts")) return {};

    const BANNED = {
      alert: "noAlert",
      confirm: "noConfirm",
      prompt: "noPrompt",
    };

    return {
      CallExpression(node) {
        // Direct call: alert(), confirm(), prompt()
        if (node.callee.type === "Identifier" && BANNED[node.callee.name]) {
          // Allow custom confirm hook which takes an object: confirm({ title: ... })
          if (node.callee.name === "confirm" && node.arguments.length > 0 && node.arguments[0].type === "ObjectExpression") {
            return;
          }

          context.report({
            node,
            messageId: BANNED[node.callee.name],
          });
        }
        // Member call: window.alert(), window.confirm()
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "window" &&
          node.callee.property.type === "Identifier" &&
          BANNED[node.callee.property.name]
        ) {
          context.report({
            node,
            messageId: BANNED[node.callee.property.name],
          });
        }
      },
    };
  },
};
