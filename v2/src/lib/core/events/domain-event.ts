export interface DomainEvent<T = any> {
  id: string;
  tenantId: string;
  eventType: string;
  payload: T;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export abstract class BaseDomainEvent<T> implements DomainEvent<T> {
  public id: string;
  public timestamp: Date;

  constructor(
    public tenantId: string,
    public eventType: string,
    public payload: T,
    public metadata?: Record<string, any>
  ) {
    this.id = crypto.randomUUID();
    this.timestamp = new Date();
  }
}

// Example Event Implementations
export class LeadImportedEvent extends BaseDomainEvent<{ sourceId: string; data: any }> {
  constructor(tenantId: string, payload: { sourceId: string; data: any }) {
    super(tenantId, 'LeadImported', payload);
  }
}

export class SemanticAnalysisCompletedEvent extends BaseDomainEvent<{ sourceId: string; entities: any[]; confidence: number }> {
  constructor(tenantId: string, payload: { sourceId: string; entities: any[]; confidence: number }) {
    super(tenantId, 'SemanticAnalysisCompleted', payload);
  }
}

export class HumanReviewQueuedEvent extends BaseDomainEvent<{ sourceId: string; reason: string }> {
  constructor(tenantId: string, payload: { sourceId: string; reason: string }) {
    super(tenantId, 'HumanReviewQueued', payload);
  }
}
