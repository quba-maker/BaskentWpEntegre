export const noDefaultExport = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow default exports for better static analysis and refactoring",
      category: "Architecture",
      recommended: true,
    },
    messages: {
      noDefaultExport:
        "ARCHITECTURE_ERROR: Default exports are forbidden. Use named exports (e.g. export class MyService) to ensure reliable static analysis and tracing.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    // Allow default exports only in Next.js App Router pages/layouts which require them
    if (filename.includes("/app/") && (filename.endsWith("page.tsx") || filename.endsWith("layout.tsx") || filename.endsWith("route.ts"))) {
      return {};
    }

    return {
      ExportDefaultDeclaration(node) {
        context.report({
          node,
          messageId: "noDefaultExport",
        });
      },
    };
  },
};
