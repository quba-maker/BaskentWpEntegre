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

    // A simplistic check to ensure the query string mentions tenant_id
    // Real enforcement happens via the ORM/QueryBuilder, but this blocks raw strings
    if (!normalizedQuery.includes("tenant_id")) {
      telemetry.track("SECURITY_QUERY_REJECTED", "failure", {
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
        telemetry.track("SECURITY_QUERY_REJECTED", "failure", {
          reason: "Query parameters lack execution tenantId",
          query,
          params
        });
        throw new SecurityIsolationError("Query execution rejected. Parameters must contain the current executing tenant_id to prevent cross-tenant queries.");
      }
    } else {
        telemetry.track("SECURITY_QUERY_REJECTED", "failure", {
          reason: "Query lacks parameters (raw execution attempt)",
          query
        });
        throw new SecurityIsolationError("Raw queries without parameters are forbidden for data operations.");
    }
  }
};
