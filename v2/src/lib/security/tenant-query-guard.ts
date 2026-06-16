import { SecurityIsolationError } from "./tenant-firewall";
import { telemetry } from "../observability/telemetry";

export const TenantQueryGuard = {
  /**
   * Enforces that every raw SQL query execution includes tenant boundary checks.
   * Scans the query string for expected tenant_id parameterization.
   * This is a fail-safe mechanism before DB execution.
   */
  assertTenantBoundQuery: (tenantId: string, query: string, params: any[]) => {
    const normalizedQuery = query.toLowerCase();
    
    // Allow basic connection checks and simple transaction commands to bypass
    const safeSystemQueries = ['begin', 'commit', 'rollback', 'select 1'];
    if (safeSystemQueries.includes(normalizedQuery.trim())) {
      return;
    }

    // Exception: Allow self tenant lookup/update on tenants table where the id parameter matches tenantId
    const isTenantsSelfQuery = normalizedQuery.includes("from tenants") || normalizedQuery.includes("update tenants");
    if (isTenantsSelfQuery) {
      // 1. MUST NOT contain SELECT * or wildcards
      if (normalizedQuery.includes("select *") || normalizedQuery.includes("*")) {
        throw new SecurityIsolationError("Query execution rejected. SELECT * or wildcard queries are forbidden on tenants table.");
      }

      // 2. MUST NOT contain JOIN
      if (normalizedQuery.includes("join")) {
        throw new SecurityIsolationError("Query execution rejected. JOIN operations are forbidden on tenants table self-lookup.");
      }

      // 3. MUST NOT bind by slug
      if (normalizedQuery.includes("slug =") || normalizedQuery.includes("slug = $") || normalizedQuery.includes("slug=")) {
        throw new SecurityIsolationError("Query execution rejected. Querying tenants table by slug is forbidden under self-lookup exception.");
      }

      // 4. MUST be bound by id
      const isBoundById = normalizedQuery.includes("where id =") || normalizedQuery.includes("id = $") || normalizedQuery.includes("where id=");
      if (!isBoundById) {
        throw new SecurityIsolationError("Query execution rejected. Query must explicitly bound tenants table by 'id'.");
      }

      // 5. Param must match tenantId and NO other tenant IDs allowed in params
      if (!params || !params.includes(tenantId)) {
        throw new SecurityIsolationError("Query execution rejected. Parameters must contain the current executing tenantId.");
      }

      const hasOtherTenantId = params.some(p => typeof p === 'string' && p.startsWith('tenant-') && p !== tenantId);
      if (hasOtherTenantId) {
        throw new SecurityIsolationError("Query execution rejected. Parameters contain an unauthorized tenant ID.");
      }

      // 6. UPDATE check: only allowed to update name, industry, primary_color, timezone, updated_at, schema_version
      if (normalizedQuery.includes("update tenants")) {
        const setIndex = normalizedQuery.indexOf("set");
        const whereIndex = normalizedQuery.indexOf("where");
        if (setIndex !== -1 && whereIndex !== -1 && setIndex < whereIndex) {
          const setClause = normalizedQuery.substring(setIndex + 3, whereIndex).trim();
          const updatedColumns = setClause.split(",").map(c => c.split("=")[0].trim());
          const allowedUpdateColumns = ["name", "industry", "primary_color", "timezone", "updated_at", "schema_version"];
          for (const col of updatedColumns) {
            const cleanCol = col.replace(/^tenants\./, "").trim();
            if (!allowedUpdateColumns.includes(cleanCol)) {
              throw new SecurityIsolationError(`Query execution rejected. Updating column '${cleanCol}' is forbidden on tenants table.`);
            }
          }
        }
      }

      return;
    }

    // A simplistic check to ensure the query string mentions tenant_id
    // Real enforcement happens via the ORM/QueryBuilder, but this blocks raw strings
    if (!normalizedQuery.includes("tenant_id")) {
      telemetry.track("SECURITY_QUERY_REJECTED", "warn", {
        reason: "Raw query lacks tenant_id bound",
        query
      });
      throw new SecurityIsolationError(`Query execution rejected. Query must explicitly bound 'tenant_id'. Query: ${query}`);
    }

    // Verify the tenantId is actually in the parameters if we are executing a prepared statement
    // Note: In postgres/mysql drivers, parameters are array values.
    // We enforce that the executing tenantId is present in the parameters array.
    if (params && params.length > 0) {
      if (!params.includes(tenantId)) {
        telemetry.track("SECURITY_QUERY_REJECTED", "warn", {
          reason: "Query parameters lack execution tenantId",
          query,
          params
        });
        throw new SecurityIsolationError("Query execution rejected. Parameters must contain the current executing tenant_id to prevent cross-tenant queries.");
      }
    } else {
        telemetry.track("SECURITY_QUERY_REJECTED", "warn", {
          reason: "Query lacks parameters (raw execution attempt)",
          query
        });
        throw new SecurityIsolationError("Raw queries without parameters are forbidden for data operations.");
    }
  }
};
