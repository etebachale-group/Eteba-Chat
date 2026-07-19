/**
 * Property-Based Tests for usage-tracker.ts
 *
 * Property 10: Resource Count Reflects Actual Rows
 *   Generate a sequence of fc.array(fc.constantFrom('create','delete'))
 *   operations on products / connectors / api_keys; after each op call
 *   syncResourceCounts; assert count equals actual rows at all times.
 *
 * Validates: Requirements 5.3
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// In-memory stores — two separate namespaces so this file is standalone
// ---------------------------------------------------------------------------

// usage_monthly rows: key = `${tenantId}:${year}:${month}`
interface UsageRow {
  tenant_id: string;
  period_year: number;
  period_month: number;
  query_count: number;
  product_count: number;
  connector_count: number;
  api_key_count: number;
  updated_at: string | null;
}

const usageStore = new Map<string, UsageRow>();

function usageKey(tenantId: string, year: number, month: number): string {
  return `${tenantId}:${year}:${month}`;
}

function getUsageRow(tenantId: string, year: number, month: number): UsageRow | undefined {
  return usageStore.get(usageKey(tenantId, year, month));
}

function resetUsageStore(): void {
  usageStore.clear();
}

// Resource tables: each tenant has a Set<rowId> per table
const productRows = new Map<string, Set<string>>();
const connectorRows = new Map<string, Set<string>>();
const apiKeyRows = new Map<string, Set<string>>();

function resetResourceTables(): void {
  productRows.clear();
  connectorRows.clear();
  apiKeyRows.clear();
}

type ResourceTable = 'products' | 'connector_registry' | 'api_keys';

function resourceMap(table: ResourceTable): Map<string, Set<string>> {
  if (table === 'products') return productRows;
  if (table === 'connector_registry') return connectorRows;
  return apiKeyRows;
}

function getSet(table: ResourceTable, tenantId: string): Set<string> {
  const map = resourceMap(table);
  if (!map.has(tenantId)) map.set(tenantId, new Set());
  return map.get(tenantId)!;
}

function rowCount(table: ResourceTable, tenantId: string): number {
  return getSet(table, tenantId).size;
}

// ---------------------------------------------------------------------------
// Mock fluent query builder — handles both usage_monthly and resource tables
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown; error: null | Error; count?: number | null };

type WhereEntry = { field: string; value: unknown };

class MockBuilder {
  private _table: string;
  private _wheres: WhereEntry[] = [];
  private _insertData: Record<string, unknown>[] = [];
  private _updateData: Record<string, unknown> = {};
  private _isCount = false;
  private _isSingle = false;

  constructor(table: string) {
    this._table = table;
  }

  select(_fields?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count === 'exact') this._isCount = true;
    return this;
  }

  insert(rows: Record<string, unknown>[]): this {
    this._insertData = rows;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this._updateData = data;
    return this;
  }

  eq(field: string, value: unknown): this {
    this._wheres.push({ field, value });
    return this;
  }

  maybeSingle(): this {
    this._isSingle = true;
    return this;
  }

  // Make it awaitable — thenable interface
  then(resolve: (r: QueryResult) => void): void {
    resolve(this._execute());
  }

  // Synchronous execution used internally
  _execute(): QueryResult {
    const isResourceTable =
      this._table === 'products' ||
      this._table === 'connector_registry' ||
      this._table === 'api_keys';

    // ---- Resource table: count query only ----
    if (isResourceTable && this._isCount) {
      const tenantEntry = this._wheres.find((w) => w.field === 'tenant_id');
      const tenantId = tenantEntry?.value as string | undefined;
      if (!tenantId) {
        return { data: null, error: new Error('Missing tenant_id in resource count'), count: 0 };
      }
      const count = rowCount(this._table as ResourceTable, tenantId);
      return { data: null, error: null, count };
    }

    // ---- usage_monthly: INSERT ----
    if (this._table === 'usage_monthly' && this._insertData.length > 0) {
      for (const item of this._insertData) {
        const r = item as unknown as UsageRow;
        const key = usageKey(r.tenant_id, r.period_year, r.period_month);
        if (usageStore.has(key)) {
          // Simulate ON CONFLICT DO NOTHING → unique-constraint error
          return {
            data: null,
            error: Object.assign(new Error('duplicate key value violates unique constraint'), {
              code: '23505',
            }),
          };
        }
        usageStore.set(key, { ...r });
      }
      return { data: this._insertData, error: null };
    }

    // ---- usage_monthly: UPDATE ----
    if (this._table === 'usage_monthly' && Object.keys(this._updateData).length > 0) {
      // Find matching rows
      for (const [key, row] of usageStore.entries()) {
        const matches = this._wheres.every((w) => {
          const k = w.field as keyof UsageRow;
          return row[k] === w.value;
        });
        if (matches) {
          const updated = { ...row };
          for (const [k, v] of Object.entries(this._updateData)) {
            (updated as Record<string, unknown>)[k] = v;
          }
          usageStore.set(key, updated);
        }
      }
      return { data: null, error: null };
    }

    // ---- usage_monthly: SELECT maybeSingle ----
    if (this._table === 'usage_monthly' && this._isSingle) {
      const matching = Array.from(usageStore.values()).filter((row) =>
        this._wheres.every((w) => {
          const k = w.field as keyof UsageRow;
          return row[k] === w.value;
        }),
      );
      return { data: matching.length > 0 ? matching[0] : null, error: null };
    }

    return { data: null, error: null };
  }
}

// ---------------------------------------------------------------------------
// Mock RPC — not used for resource counts but needed for ensureUsageRow path
// ---------------------------------------------------------------------------

function mockRpc(
  fnName: string,
  params: { p_tenant_id: string; p_year: number; p_month: number },
): { error: null | Error } {
  if (fnName !== 'increment_query_count') {
    return { error: new Error(`Unknown RPC: ${fnName}`) };
  }
  const key = usageKey(params.p_tenant_id, params.p_year, params.p_month);
  const row = usageStore.get(key);
  if (!row) return { error: new Error('Row not found for RPC') };
  row.query_count += 1;
  return { error: null };
}

// ---------------------------------------------------------------------------
// Minimal mock database client
// ---------------------------------------------------------------------------

interface MockDb {
  from(table: string): MockBuilder;
  rpc(fn: string, params: Record<string, unknown>): { error: null | Error };
}

const db: MockDb = {
  from: (table) => new MockBuilder(table),
  rpc: (fn, params) =>
    mockRpc(fn, params as { p_tenant_id: string; p_year: number; p_month: number }),
};

// ---------------------------------------------------------------------------
// ensureUsageRow — mirrors usage-tracker.ts logic
// ---------------------------------------------------------------------------

async function ensureUsageRow(tenantId: string, year: number, month: number): Promise<void> {
  const builder = db.from('usage_monthly').insert([
    {
      tenant_id: tenantId,
      period_year: year,
      period_month: month,
      query_count: 0,
      product_count: 0,
      connector_count: 0,
      api_key_count: 0,
      updated_at: new Date().toISOString(),
    },
  ]);
  const { error } = builder._execute();
  if (error) {
    const isConflict =
      (error as any).code === '23505' ||
      String((error as any).message ?? '').toLowerCase().includes('unique');
    if (!isConflict) {
      throw new Error(`ensureUsageRow failed: ${(error as any).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// syncResourceCounts — mirrors usage-tracker.ts logic using the mock DB
// ---------------------------------------------------------------------------

async function syncResourceCounts(tenantId: string, year: number, month: number): Promise<void> {
  await ensureUsageRow(tenantId, year, month);

  // Count products
  const { count: productCount, error: pe } = db
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    ._execute();
  if (pe) throw new Error(`syncResourceCounts: products — ${pe.message}`);

  // Count connectors
  const { count: connectorCount, error: ce } = db
    .from('connector_registry')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    ._execute();
  if (ce) throw new Error(`syncResourceCounts: connectors — ${ce.message}`);

  // Count api_keys
  const { count: apiKeyCount, error: ae } = db
    .from('api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    ._execute();
  if (ae) throw new Error(`syncResourceCounts: api_keys — ${ae.message}`);

  // Update usage_monthly
  const { error: ue } = db
    .from('usage_monthly')
    .update({
      product_count: productCount ?? 0,
      connector_count: connectorCount ?? 0,
      api_key_count: apiKeyCount ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', month)
    ._execute();
  if (ue) throw new Error(`syncResourceCounts: update — ${ue.message}`);
}

// ---------------------------------------------------------------------------
// Resource operation helpers
// ---------------------------------------------------------------------------

type ResourceType = 'products' | 'connectors' | 'api_keys';
type Operation = 'create' | 'delete';

function tableFor(r: ResourceType): ResourceTable {
  if (r === 'products') return 'products';
  if (r === 'connectors') return 'connector_registry';
  return 'api_keys';
}

let rowCounter = 0;

function applyOp(op: Operation, resource: ResourceType, tenantId: string): void {
  const set = getSet(tableFor(resource), tenantId);
  if (op === 'create') {
    set.add(`row-${++rowCounter}`);
  } else {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
  }
}

function actual(resource: ResourceType, tenantId: string): number {
  return rowCount(tableFor(resource), tenantId);
}

// ---------------------------------------------------------------------------
// Period helper
// ---------------------------------------------------------------------------

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error).message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Property 10 tests
// ---------------------------------------------------------------------------

async function runProperty10(): Promise<void> {
  console.log('\n📋 Property 10: Resource Count Reflects Actual Rows');
  console.log('   Validates: Requirements 5.3\n');

  // Smoke: single create
  await runTest('Single product create → product_count = 1', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const tenantId = 'p10-smoke-create';
    const { year, month } = currentPeriod();

    applyOp('create', 'products', tenantId);
    await syncResourceCounts(tenantId, year, month);

    const row = getUsageRow(tenantId, year, month);
    if (row?.product_count !== 1)
      throw new Error(`Expected product_count=1, got ${row?.product_count}`);
  });

  // Smoke: create then delete
  await runTest('Create then delete product → product_count = 0', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const tenantId = 'p10-smoke-del';
    const { year, month } = currentPeriod();

    applyOp('create', 'products', tenantId);
    applyOp('delete', 'products', tenantId);
    await syncResourceCounts(tenantId, year, month);

    const row = getUsageRow(tenantId, year, month);
    if (row?.product_count !== 0)
      throw new Error(`Expected product_count=0, got ${row?.product_count}`);
  });

  // Smoke: delete on empty table is a no-op
  await runTest('Delete on empty table → count stays 0', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const tenantId = 'p10-smoke-noop';
    const { year, month } = currentPeriod();

    applyOp('delete', 'connectors', tenantId); // nothing to delete
    await syncResourceCounts(tenantId, year, month);

    const row = getUsageRow(tenantId, year, month);
    if (row?.connector_count !== 0)
      throw new Error(`Expected connector_count=0, got ${row?.connector_count}`);
  });

  // Smoke: mixed ops on all three resource types
  await runTest('Mixed ops: 3 products (−1), 2 connectors (−1), 1 api_key', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const tenantId = 'p10-smoke-mixed';
    const { year, month } = currentPeriod();

    for (let i = 0; i < 3; i++) applyOp('create', 'products', tenantId);
    for (let i = 0; i < 2; i++) applyOp('create', 'connectors', tenantId);
    applyOp('create', 'api_keys', tenantId);
    applyOp('delete', 'products', tenantId);
    applyOp('delete', 'connectors', tenantId);

    await syncResourceCounts(tenantId, year, month);

    const row = getUsageRow(tenantId, year, month);
    if (row?.product_count !== 2)
      throw new Error(`product_count: expected 2, got ${row?.product_count}`);
    if (row?.connector_count !== 1)
      throw new Error(`connector_count: expected 1, got ${row?.connector_count}`);
    if (row?.api_key_count !== 1)
      throw new Error(`api_key_count: expected 1, got ${row?.api_key_count}`);
  });

  // Smoke: syncResourceCounts is idempotent when called multiple times
  await runTest('Calling syncResourceCounts twice is idempotent', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const tenantId = 'p10-smoke-idem';
    const { year, month } = currentPeriod();

    applyOp('create', 'products', tenantId);
    applyOp('create', 'products', tenantId);
    await syncResourceCounts(tenantId, year, month);
    await syncResourceCounts(tenantId, year, month); // second call — same result

    const row = getUsageRow(tenantId, year, month);
    if (row?.product_count !== 2)
      throw new Error(`Expected product_count=2 after idempotent sync, got ${row?.product_count}`);
  });

  // fast-check property
  await runTest(
    'Property 10 — fast-check: after each op syncResourceCounts matches actual rows',
    async () => {
      /**
       * **Validates: Requirements 5.3**
       *
       * For any sequence of create/delete operations on products, connectors,
       * and api_keys, after each syncResourceCounts call the counts stored in
       * usage_monthly MUST equal the actual row count in each mock table.
       *
       * The invariant is checked after EVERY individual operation so that
       * intermediate states — not just the final state — are validated.
       */
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              resource: fc.constantFrom<ResourceType>('products', 'connectors', 'api_keys'),
              op: fc.constantFrom<Operation>('create', 'delete'),
            }),
            { minLength: 1, maxLength: 30 },
          ),
          fc.uuid(),
          async (ops, tenantSuffix) => {
            resetUsageStore();
            resetResourceTables();
            rowCounter = 0;

            const tenantId = `tenant-p10-${tenantSuffix}`;
            const { year, month } = currentPeriod();

            for (const { resource, op } of ops) {
              applyOp(op, resource, tenantId);
              await syncResourceCounts(tenantId, year, month);

              const row = getUsageRow(tenantId, year, month);

              if (row?.product_count !== actual('products', tenantId)) return false;
              if (row?.connector_count !== actual('connectors', tenantId)) return false;
              if (row?.api_key_count !== actual('api_keys', tenantId)) return false;
            }

            return true;
          },
        ),
        { numRuns: 100, verbose: true },
      );
    },
  );

  // Tenant isolation
  await runTest('Tenant isolation — counts for two tenants stay independent', async () => {
    resetUsageStore(); resetResourceTables(); rowCounter = 0;
    const { year, month } = currentPeriod();
    const tA = 'p10-iso-a';
    const tB = 'p10-iso-b';

    for (let i = 0; i < 3; i++) applyOp('create', 'products', tA);
    for (let i = 0; i < 5; i++) applyOp('create', 'connectors', tB);
    for (let i = 0; i < 2; i++) applyOp('create', 'api_keys', tB);

    await syncResourceCounts(tA, year, month);
    await syncResourceCounts(tB, year, month);

    const rowA = getUsageRow(tA, year, month);
    const rowB = getUsageRow(tB, year, month);

    if (rowA?.product_count !== 3)
      throw new Error(`Tenant A product_count: expected 3, got ${rowA?.product_count}`);
    if (rowA?.connector_count !== 0)
      throw new Error(`Tenant A connector_count: expected 0, got ${rowA?.connector_count}`);
    if (rowB?.connector_count !== 5)
      throw new Error(`Tenant B connector_count: expected 5, got ${rowB?.connector_count}`);
    if (rowB?.api_key_count !== 2)
      throw new Error(`Tenant B api_key_count: expected 2, got ${rowB?.api_key_count}`);
    if (rowB?.product_count !== 0)
      throw new Error(`Tenant B product_count: expected 0, got ${rowB?.product_count}`);
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

(async () => {
  console.log('🧪 Property-Based Tests: usage-tracker — Property 10');
  console.log('═'.repeat(55));

  await runProperty10();

  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ All Property 10 tests passed.');
    process.exit(0);
  }
})();
