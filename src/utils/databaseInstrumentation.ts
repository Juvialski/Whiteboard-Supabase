/**
 * Development-only database instrumentation
 * Tracks application-level estimated reads, writes, deletes, and transactions.
 *
 * NOTE: These are estimated application-level logical counters for development and debugging.
 */

export interface OperationStats {
  reads: number;
  writes: number;
  deletes: number;
  transactionAttempts: number;
  transactionCommits: number;
  byLabel: Record<
    string,
    {
      reads: number;
      writes: number;
      deletes: number;
      transactionAttempts?: number;
      transactionCommits?: number;
    }
  >;
}

let isEnabled =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? Boolean((import.meta as any).env.DEV)
    : true;

const stats: OperationStats = {
  reads: 0,
  writes: 0,
  deletes: 0,
  transactionAttempts: 0,
  transactionCommits: 0,
  byLabel: {},
};

export function setInstrumentationEnabled(enabled: boolean): void {
  isEnabled = enabled;
}

export function resetInstrumentationStats(): void {
  stats.reads = 0;
  stats.writes = 0;
  stats.deletes = 0;
  stats.transactionAttempts = 0;
  stats.transactionCommits = 0;
  stats.byLabel = {};
}

export function getInstrumentationStats(): OperationStats {
  return JSON.parse(JSON.stringify(stats));
}

export function trackOperation(
  type: 'read' | 'write' | 'delete' | 'tx_attempt' | 'tx_commit',
  label: string,
  count: number = 1
): void {
  if (!isEnabled || count < 0) return;

  if (!stats.byLabel[label]) {
    stats.byLabel[label] = { reads: 0, writes: 0, deletes: 0, transactionAttempts: 0, transactionCommits: 0 };
  }

  if (type === 'read') {
    stats.reads += count;
    stats.byLabel[label].reads += count;
  } else if (type === 'write') {
    stats.writes += count;
    stats.byLabel[label].writes += count;
  } else if (type === 'delete') {
    stats.deletes += count;
    stats.byLabel[label].deletes += count;
  } else if (type === 'tx_attempt') {
    stats.transactionAttempts += count;
    stats.byLabel[label].transactionAttempts = (stats.byLabel[label].transactionAttempts || 0) + count;
  } else if (type === 'tx_commit') {
    stats.transactionCommits += count;
    stats.byLabel[label].transactionCommits = (stats.byLabel[label].transactionCommits || 0) + count;
  }
}

export function printInstrumentationSummary(): void {
  if (!isEnabled) return;
  console.log('================ [DATABASE INSTRUMENTATION ESTIMATED COUNTS] ================');
  console.log(`Estimated Reads:                ${stats.reads}`);
  console.log(`Estimated Writes:               ${stats.writes}`);
  console.log(`Estimated Deletes:              ${stats.deletes}`);
  console.log(`Transaction Attempts:          ${stats.transactionAttempts}`);
  console.log(`Transaction Commits:           ${stats.transactionCommits}`);
  console.log('Breakdown by Call-Site Label:');
  Object.entries(stats.byLabel).forEach(([label, counts]) => {
    console.log(
      `  - ${label.padEnd(28)} | R: ${counts.reads} | W: ${counts.writes} | D: ${counts.deletes} | TxTry: ${counts.transactionAttempts || 0} | TxOk: ${counts.transactionCommits || 0}`
    );
  });
  console.log('================================================================================');
}
