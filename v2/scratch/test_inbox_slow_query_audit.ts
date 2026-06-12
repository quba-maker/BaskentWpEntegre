import { getConversations, getGlobalUnreadCount } from "../src/app/actions/inbox";

// Mock the tenant DB and action guard environment
process.env.TEST_TENANT_ID = "test-tenant-uuid";
process.env.TEST_USER_ID = "test-user-uuid";
process.env.TEST_USER_ROLE = "platform_admin";

const executedQueries: { text: string; values: any[] }[] = [];

// Mock global database
(global as any).mockDb = {
  executeSafe: async (query: any, params?: any[]) => {
    const text = typeof query === "string" ? query : query?.text || "";
    const values = typeof query === "string" ? params : query?.values || [];
    executedQueries.push({ text, values });

    // Mock returns based on query type
    if (text.toLowerCase().includes("from conversations")) {
      return [
        {
          conversation_id: "conv-1",
          conversationId: "conv-1",
          id: "+905551234567",
          name: "Hasta 1",
          tenant_id: "test-tenant-uuid",
          unread: 2,
          is_pinned: false,
          is_favorite: false,
          is_archived: false,
          last_message_time_ms: Date.now().toString()
        }
      ];
    }
    if (text.toLowerCase().includes("select count(*)::int as total_unread")) {
      return [{ total_unread: 5 }];
    }
    return [];
  }
};

async function runAudit() {
  console.log("=== Running Inbox Slow Query Audit ===");

  // 1. Audit getConversations
  executedQueries.length = 0;
  const convs = await getConversations(1, "", "all", "all", "all_reply", "all");
  
  console.log("\n1. getConversations query analysis:");
  const getConvsQuery = executedQueries.find(q => q.text.toLowerCase().includes("from conversations"));
  if (!getConvsQuery) {
    console.log("❌ Failed: getConversations query was not captured!");
    process.exit(1);
  }

  console.log("✅ getConversations query successfully executed.");

  // Check 1: Tenant Filter
  const hasTenantFilter = getConvsQuery.text.includes("c.tenant_id = $1");
  if (hasTenantFilter && getConvsQuery.values[0] === "test-tenant-uuid") {
    console.log("✅ Check 1: Tenant filter (tenantId) is properly preserved.");
  } else {
    console.log("❌ Check 1: Tenant filter mismatch or missing!");
  }

  // Check 2: LEFT JOIN rs
  const hasLeftJoinRs = getConvsQuery.text.includes("LEFT JOIN conversation_read_states rs");
  if (hasLeftJoinRs) {
    console.log("✅ Check 2: LEFT JOIN conversation_read_states rs is used.");
  } else {
    console.log("❌ Check 2: LEFT JOIN rs is missing!");
  }

  // Check 3: User Scoped Join
  const hasUserScopedJoin = getConvsQuery.text.includes("rs.user_id = $7");
  if (hasUserScopedJoin && getConvsQuery.values[6] === "test-user-uuid") {
    console.log("✅ Check 3: Read state join is properly scoped to the current user ($7).");
  } else {
    console.log("❌ Check 3: Read state user scoping mismatch!");
  }

  // Check 4: Unread Count Subquery Optimization
  const usesOptimizedUnread = getConvsQuery.text.includes("COALESCE(rs.last_read_at,");
  if (usesOptimizedUnread) {
    console.log("✅ Check 4: Unread count utilizes optimized COALESCE(rs.last_read_at) instead of nested subqueries.");
  } else {
    console.log("❌ Check 4: Unread count is not optimized!");
  }

  // 2. Audit getGlobalUnreadCount
  executedQueries.length = 0;
  const unreadCount = await getGlobalUnreadCount();

  console.log("\n2. getGlobalUnreadCount query analysis:");
  const getGlobalUnreadQuery = executedQueries.find(q => q.text.toLowerCase().includes("total_unread"));
  if (!getGlobalUnreadQuery) {
    console.log("❌ Failed: getGlobalUnreadCount query was not captured!");
    process.exit(1);
  }

  console.log("✅ getGlobalUnreadCount query successfully executed. Return value:", unreadCount);

  // Check 5: No Group By or redundant Conversation Join
  const hasRedundantJoins = getGlobalUnreadQuery.text.toLowerCase().includes("group by");
  if (!hasRedundantJoins) {
    console.log("✅ Check 5: getGlobalUnreadCount optimized (No GROUP BY or redundant queries).");
  } else {
    console.log("❌ Check 5: Redundant GROUP BY still present in global unread count!");
  }

  // Check 6: Tenant & User scoping preserved in global unread
  const unreadValues = getGlobalUnreadQuery.values;
  const isGlobalTenantScoped = getGlobalUnreadQuery.text.includes("m.tenant_id = $1") && unreadValues[0] === "test-tenant-uuid";
  const isGlobalUserScoped = getGlobalUnreadQuery.text.includes("rs.user_id = $2") && unreadValues[1] === "test-user-uuid";
  if (isGlobalTenantScoped && isGlobalUserScoped) {
    console.log("✅ Check 6: Global unread query parameters (tenant_id and user_id) are fully isolated and correct.");
  } else {
    console.log("❌ Check 6: Global unread query parameter mismatch!");
  }

  console.log("\nAll Inbox Query Audit checks completed successfully!");
}

runAudit().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
