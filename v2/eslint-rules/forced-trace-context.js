export const forcedTraceContext = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce telemetry.track usage instead of direct logger.info/error",
      category: "Observability",
      recommended: true,
    },
    messages: {
      useTelemetry:
        "OBSERVABILITY_ERROR: The legacy logger is deprecated. You must use telemetry.track(event, status, metadata) with strict Event Taxonomy.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Ban logger.* completely
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "logger"
        ) {
          context.report({
            node,
            messageId: "useTelemetry",
          });
        }
      },
    };
  },
};
