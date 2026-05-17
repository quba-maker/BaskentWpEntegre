export const noRawSql = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw SQL execution outside of TenantDB (AST-level analysis)",
      category: "Security",
      recommended: true,
    },
    messages: {
      rawSqlForbidden:
        "SECURITY_ISOLATION_ERROR: Raw SQL execution is strictly forbidden. Use tenantDb.executeSafe() to enforce TenantQueryGuard.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    
    // Sadece TenantDB, QueryGuard ve db setup dosyalarında raw SQL'e izin ver
    if (
      filename.includes("tenant-db.ts") || 
      filename.includes("tenant-query-guard.ts") ||
      filename.includes("core/db.ts")
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (node.callee && node.callee.name === "sql") {
          context.report({
            node,
            messageId: "rawSqlForbidden",
          });
        }
      },
      TaggedTemplateExpression(node) {
        if (node.tag && node.tag.name === "sql") {
          context.report({
            node,
            messageId: "rawSqlForbidden",
          });
        }
      }
    };
  },
};
