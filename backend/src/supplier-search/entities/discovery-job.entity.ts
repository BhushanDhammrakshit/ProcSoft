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

  @Column({ name: 'target_count', type: 'int', default: 10 })
  targetCount: number;

  @Column({ name: 'min_score', type: 'int', default: 70 })
  minScore: number;

  // Human-readable current stage, e.g. "Finding additional suppliers via licensed APIs...".
  @Column({ name: 'progress_stage', nullable: true })
  progressStage?: string;

  @Column({ name: 'progress_message', nullable: true })
  progressMessage?: string;

  // Priority tiers (1=licensed API, 2=internal semantic, 3=open data, 4=official sites) that yielded results.
  @Column({ name: 'tiers_used', type: 'jsonb', nullable: true })
  tiersUsed?: number[];

  // Partial ranked results while the job is still running, for progressive-result polling UIs.
  @Column({ name: 'results_preview', type: 'jsonb', nullable: true })
  resultsPreview?: unknown[];

  @Column({ name: 'final_results', type: 'jsonb', nullable: true })
  finalResults?: unknown[];

  @Column({ name: 'discovered_count', type: 'int', default: 0 })
  discoveredCount: number;

  @Column({ name: 'qualified_count', type: 'int', default: 0 })
  qualifiedCount: number;

  @Column({ name: 'error_message', nullable: true })
  errorMessage?: string;
}
