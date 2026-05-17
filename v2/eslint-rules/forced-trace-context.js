export const forcedTraceContext = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce logger.withContext usage instead of direct logger.info/error",
      category: "Security",
      recommended: true,
    },
    messages: {
      missingContext:
        "OBSERVABILITY_ERROR: Blind logging is forbidden. You must use logger.withContext(ctx) to attach tenantId and traceId before logging.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "logger" &&
          ["info", "warn", "error", "debug"].includes(node.callee.property.name)
        ) {
          context.report({
            node,
            messageId: "missingContext",
          });
        }
      },
    };
  },
};
