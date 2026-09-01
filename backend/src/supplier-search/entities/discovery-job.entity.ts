import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export enum DiscoveryJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('discovery_jobs')
export class DiscoveryJob extends BaseEntity {
  @Column({ type: 'text' })
  promptText: string;

  @Column({ type: 'jsonb' })
  criteria: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  queries?: string[];

  @Column({ type: 'enum', enum: DiscoveryJobStatus, default: DiscoveryJobStatus.PENDING })
  status: DiscoveryJobStatus;

  @Column({ name: 'discovered_count', type: 'int', default: 0 })
  discoveredCount: number;

  @Column({ name: 'qualified_count', type: 'int', default: 0 })
  qualifiedCount: number;

  @Column({ name: 'error_message', nullable: true })
  errorMessage?: string;
}
