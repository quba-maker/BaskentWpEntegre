"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

export interface CandidateFilters {
  status?: 'pending' | 'approved' | 'rejected' | 'ignored' | 'all';
  riskLevel?: 'low' | 'medium' | 'high' | 'blocked' | 'all';
  candidateType?: string;
  channelId?: string;
  search?: string;
  createdDateStart?: string;
  createdDateEnd?: string;
  page?: number;
  limit?: number;
}

export interface CandidateRow {
  id: string;
  tenantId: string;
  organizationId: string | null;
  channelId: string | null;
  conversationId: string | null;
  sourceEventIds: string[];
  candidateType: string;
  title: string;
  summary: string;
  suggestedRuleText: string;
  evidenceSummary: string;
  confidenceScore: string;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  riskTags: string[];
  status: 'pending' | 'approved' | 'rejected' | 'ignored';
  fingerprint: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lists learning candidates for a tenant with robust pagination and filters.
 */
export async function listLearningCandidates(filters?: CandidateFilters) {
  return withActionGuard(
    { actionName: 'listLearningCandidates', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;
      let whereClause = " WHERE tenant_id = $1";
      const values: any[] = [ctx.tenantId];

      // Default status is 'pending' if none is specified or if status is not explicitly 'all'
      const statusFilter = filters?.status || 'pending';
      if (statusFilter !== 'all') {
        whereClause += ` AND status = $${values.length + 1}`;
        values.push(statusFilter);
      }

      if (filters?.riskLevel && filters.riskLevel !== 'all') {
        whereClause += ` AND risk_level = $${values.length + 1}`;
        values.push(filters.riskLevel);
      }

      if (filters?.candidateType && filters.candidateType !== 'all') {
        whereClause += ` AND candidate_type = $${values.length + 1}`;
        values.push(filters.candidateType);
      }

      if (filters?.channelId && filters.channelId !== 'all') {
        whereClause += ` AND channel_id = $${values.length + 1}`;
        values.push(filters.channelId);
      }

      if (filters?.search && filters.search.trim()) {
        whereClause += ` AND (title ILIKE $${values.length + 1} OR summary ILIKE $${values.length + 1} OR suggested_rule_text ILIKE $${values.length + 1})`;
        values.push(`%${filters.search.trim()}%`);
      }

      if (filters?.createdDateStart) {
        whereClause += ` AND created_at >= $${values.length + 1}`;
        values.push(new Date(filters.createdDateStart));
      }

      if (filters?.createdDateEnd) {
        whereClause += ` AND created_at <= $${values.length + 1}`;
        values.push(new Date(filters.createdDateEnd));
      }

      // Count query
      const countRes = await db.executeSafe({
        text: `SELECT COUNT(*)::int as total FROM tenant_learning_candidates ${whereClause}`,
        values
      });
      const total = countRes[0]?.total || 0;

      // Select query with sorting and pagination
      const limit = Math.min(filters?.limit || 20, 100);
      const page = Math.max(filters?.page || 1, 1);
      const offset = (page - 1) * limit;

      const itemValues = [...values];
      const itemsQuery = `
        SELECT 
          id, 
          tenant_id as "tenantId", 
          organization_id as "organizationId", 
          channel_id as "channelId", 
          conversation_id as "conversationId", 
          source_event_ids as "sourceEventIds", 
          candidate_type as "candidateType", 
          title, 
          summary, 
          suggested_rule_text as "suggestedRuleText", 
          evidence_summary as "evidenceSummary", 
          confidence_score as "confidenceScore", 
          risk_level as "riskLevel", 
          risk_tags as "riskTags", 
          status, 
          fingerprint, 
          metadata, 
          created_at as "createdAt", 
          updated_at as "updatedAt"
        FROM tenant_learning_candidates 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${itemValues.length + 1} OFFSET $${itemValues.length + 2}
      `;
      itemValues.push(limit, offset);

      const items = await db.executeSafe({
        text: itemsQuery,
        values: itemValues
      }) as CandidateRow[];

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    }
  );
}

/**
 * Fetches a single candidate by ID with strict tenant isolation and KVKK compliance.
 */
export async function getLearningCandidateDetail(candidateId: string) {
  return withActionGuard(
    { actionName: 'getLearningCandidateDetail', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;
      const res = await db.executeSafe({
        text: `
          SELECT 
            id, 
            tenant_id as "tenantId", 
            organization_id as "organizationId", 
            channel_id as "channelId", 
            conversation_id as "conversationId", 
            source_event_ids as "sourceEventIds", 
            candidate_type as "candidateType", 
            title, 
            summary, 
            suggested_rule_text as "suggestedRuleText", 
            evidence_summary as "evidenceSummary", 
            confidence_score as "confidenceScore", 
            risk_level as "riskLevel", 
            risk_tags as "riskTags", 
            status, 
            fingerprint, 
            metadata, 
            created_at as "createdAt", 
            updated_at as "updatedAt"
          FROM tenant_learning_candidates 
          WHERE id = $1 AND tenant_id = $2
        `,
        values: [candidateId, ctx.tenantId]
      });

      if (!res.length) {
        throw new Error("Candidate not found.");
      }

      const candidate = res[0] as CandidateRow;
      const sourceEventsCount = Array.isArray(candidate.sourceEventIds) ? candidate.sourceEventIds.length : 0;

      return {
        ...candidate,
        sourceEventsCount
      };
    }
  );
}

/**
 * Transitions candidate review status according to strict transition rules.
 */
export async function updateCandidateStatus(candidateId: string, newStatus: 'approved' | 'rejected' | 'ignored' | 'pending') {
  return withActionGuard(
    { actionName: 'updateCandidateStatus', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;

      // 1. Fetch current status
      const res = await db.executeSafe({
        text: `SELECT status, risk_level as "riskLevel", candidate_type as "candidateType" FROM tenant_learning_candidates WHERE id = $1 AND tenant_id = $2`,
        values: [candidateId, ctx.tenantId]
      });

      if (!res.length) {
        throw new Error("Candidate not found.");
      }

      const { status: currentStatus, riskLevel, candidateType } = res[0];

      // 2. Blocked status check: blocked candidates cannot be approved
      if (newStatus === 'approved' && riskLevel === 'blocked') {
        throw new Error("Blocked candidates cannot be approved.");
      }

      // 3. Status Transition Rules:
      // pending → approved ✅
      // pending → rejected ✅
      // pending → ignored ✅
      // approved → * ❌
      // rejected → pending ❌
      // ignored → pending ✅
      let allowed = false;
      let auditAction = '';

      if (currentStatus === 'pending') {
        if (newStatus === 'approved') {
          allowed = true;
          auditAction = 'learning_candidate_approved';
        } else if (newStatus === 'rejected') {
          allowed = true;
          auditAction = 'learning_candidate_rejected';
        } else if (newStatus === 'ignored') {
          allowed = true;
          auditAction = 'learning_candidate_ignored';
        }
      } else if (currentStatus === 'ignored' && newStatus === 'pending') {
        allowed = true;
        auditAction = 'learning_candidate_restored_to_pending';
      }

      if (!allowed) {
        throw new Error(`Invalid status transition from '${currentStatus}' to '${newStatus}'.`);
      }

      // 4. Perform database update
      await db.executeSafe({
        text: `
          UPDATE tenant_learning_candidates 
          SET status = $1, updated_at = NOW() 
          WHERE id = $2 AND tenant_id = $3
        `,
        values: [newStatus, candidateId, ctx.tenantId]
      });

      // 5. Audit Log (Strictly non-outbound)
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: auditAction,
        entityType: 'learning_candidate',
        entityId: candidateId,
        details: {
          previousStatus: currentStatus,
          newStatus,
          candidateType,
          riskLevel,
          timestamp: new Date().toISOString()
        }
      });

      return { success: true };
    }
  );
}

/**
 * Updates title, summary, suggestedRuleText, or review notes for pending candidates.
 */
export async function updateCandidateContent(
  candidateId: string, 
  updates: { 
    title?: string; 
    summary?: string; 
    suggestedRuleText?: string; 
    reviewNote?: string;
  }
) {
  return withActionGuard(
    { actionName: 'updateCandidateContent', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;

      // 1. Fetch candidate to verify current status
      const res = await db.executeSafe({
        text: `SELECT status, metadata FROM tenant_learning_candidates WHERE id = $1 AND tenant_id = $2`,
        values: [candidateId, ctx.tenantId]
      });

      if (!res.length) {
        throw new Error("Candidate not found.");
      }

      const { status, metadata } = res[0];

      // 2. Only pending candidates can be edited
      if (status !== 'pending') {
        throw new Error("Only pending candidates can be edited.");
      }

      // 3. Construct update query
      const updateFields: string[] = [];
      const values: any[] = [];

      if (updates.title !== undefined) {
        updateFields.push(`title = $${values.length + 1}`);
        values.push(updates.title);
      }
      if (updates.summary !== undefined) {
        updateFields.push(`summary = $${values.length + 1}`);
        values.push(updates.summary);
      }
      if (updates.suggestedRuleText !== undefined) {
        updateFields.push(`suggested_rule_text = $${values.length + 1}`);
        values.push(updates.suggestedRuleText);
      }

      // Parse metadata & update review_note
      const currentMeta = typeof metadata === 'string' ? JSON.parse(metadata) : (metadata || {});
      if (updates.reviewNote !== undefined) {
        currentMeta.review_note = updates.reviewNote;
        updateFields.push(`metadata = $${values.length + 1}`);
        values.push(JSON.stringify(currentMeta));
      }

      if (updateFields.length === 0) {
        return { success: true };
      }

      values.push(candidateId, ctx.tenantId);
      const query = `
        UPDATE tenant_learning_candidates 
        SET ${updateFields.join(', ')}, updated_at = NOW() 
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
      `;

      await db.executeSafe({
        text: query,
        values
      });

      // 4. Audit Log
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'learning_candidate_edited',
        entityType: 'learning_candidate',
        entityId: candidateId,
        details: {
          updates: {
            title: updates.title !== undefined ? 'edited' : undefined,
            summary: updates.summary !== undefined ? 'edited' : undefined,
            suggestedRuleText: updates.suggestedRuleText !== undefined ? 'edited' : undefined,
            reviewNote: updates.reviewNote !== undefined ? 'edited' : undefined
          },
          timestamp: new Date().toISOString()
        }
      });

      return { success: true };
    }
  );
}

/**
 * Fetches aggregate counts of candidates by status for dashboard summary.
 */
export async function getLearningStats() {
  return withActionGuard(
    { actionName: 'getLearningStats', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;
      const res = await db.executeSafe({
        text: `
          SELECT 
            status,
            COUNT(*)::int as count
          FROM tenant_learning_candidates
          WHERE tenant_id = $1
          GROUP BY status
        `,
        values: [ctx.tenantId]
      });

      const stats = {
        pending: 0,
        approved: 0,
        rejected: 0,
        ignored: 0
      };

      for (const row of res) {
        if (row.status in stats) {
          stats[row.status as keyof typeof stats] = row.count;
        }
      }

      return stats;
    }
  );
}

/**
 * Fetches active channels for the tenant to populate channel dropdown filter.
 */
export async function getTenantChannels() {
  return withActionGuard(
    { actionName: 'getTenantChannels', roles: ['owner', 'admin', 'platform_admin'] },
    async (ctx) => {
      const db = ctx.db;
      const res = await db.executeSafe({
        text: `
          SELECT c.id, c.name, c.provider
          FROM channels c
          JOIN channel_groups cg ON c.group_id = cg.id
          WHERE cg.tenant_id = $1
          ORDER BY c.name ASC
        `,
        values: [ctx.tenantId]
      });

      return res as Array<{ id: string; name: string; provider: string }>;
    }
  );
}
