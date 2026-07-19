export interface IncomingProduct {
  name: string;
  description?: string | null;
  price: number | string;
  stock?: number | string | null;
  image_url?: string | null;
}

export interface ExistingProduct {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number | null;
  image_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NormalizedProduct {
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
}

export interface UpsertAction {
  type: 'insert' | 'update' | 'unchanged';
  name: string;
  productId?: string;
}

export interface UpsertBatchResult {
  actions: UpsertAction[];
  toInsert: NormalizedProduct[];
  toUpdate: { id: string; name: string; description: string | null; price: number; stock: number; image_url: string | null }[];
  unchangedCount: number;
}

/**
 * Normalizes a product name by trimming and converting to lowercase.
 */
export function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

/**
 * Normalizes a text field, treating null, undefined, and empty string as equivalent (returning null).
 */
export function normalizeTextField(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Normalizes the price to 2 decimal places.
 */
export function normalizePrice(price: number | string | null | undefined): number {
  const val = typeof price === 'string' ? parseFloat(price) : price;
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Math.round(val * 100) / 100;
}

/**
 * Normalizes the stock to an integer, defaulting to 0 if missing/NaN.
 */
export function normalizeStock(stock: number | string | null | undefined): number {
  const val = typeof stock === 'string' ? parseFloat(stock) : stock;
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Math.round(val);
}

/**
 * Normalizes all fields of an incoming product.
 */
export function normalizeProduct(p: IncomingProduct): NormalizedProduct {
  return {
    name: (p.name || '').trim(), // keep original casing for name in database, but trim it
    description: normalizeTextField(p.description),
    price: normalizePrice(p.price),
    stock: normalizeStock(p.stock),
    image_url: normalizeTextField(p.image_url),
  };
}

/**
 * Compares normalized incoming product fields against existing product fields.
 * Returns true if at least one field differs, false otherwise.
 */
export function hasChanges(incoming: NormalizedProduct, existing: ExistingProduct): boolean {
  const incomingDesc = incoming.description;
  const existingDesc = normalizeTextField(existing.description);

  const incomingPrice = incoming.price;
  const existingPrice = normalizePrice(existing.price);

  const incomingStock = incoming.stock;
  const existingStock = normalizeStock(existing.stock);

  const incomingImage = incoming.image_url;
  const existingImage = normalizeTextField(existing.image_url);

  return (
    incomingDesc !== existingDesc ||
    incomingPrice !== existingPrice ||
    incomingStock !== existingStock ||
    incomingImage !== existingImage
  );
}

/**
 * Deduplicates the incoming batch of products.
 * Last occurrence wins for duplicate names (case-insensitive and trimmed name comparison).
 */
export function deduplicateBatch(batch: IncomingProduct[]): IncomingProduct[] {
  const seen = new Map<string, IncomingProduct>();
  for (const p of batch) {
    const key = normalizeName(p.name);
    seen.set(key, p);
  }
  return Array.from(seen.values());
}

/**
 * Processes an incoming batch of products against existing ones,
 * classifying them into inserts, updates, and unchanged.
 */
export function processUpsertBatch(
  incomingBatch: IncomingProduct[],
  existingProducts: ExistingProduct[]
): UpsertBatchResult {
  const uniqueIncoming = deduplicateBatch(incomingBatch);
  const actions: UpsertAction[] = [];
  const toInsert: NormalizedProduct[] = [];
  const toUpdate: { id: string; name: string; description: string | null; price: number; stock: number; image_url: string | null }[] = [];
  let unchangedCount = 0;

  // Group existing products by normalized name
  const existingMap = new Map<string, ExistingProduct[]>();
  for (const ep of existingProducts) {
    const key = normalizeName(ep.name);
    if (!existingMap.has(key)) {
      existingMap.set(key, []);
    }
    existingMap.get(key)!.push(ep);
  }

  for (const ip of uniqueIncoming) {
    const normalizedNameKey = normalizeName(ip.name);
    const matches = existingMap.get(normalizedNameKey);

    const normalizedIp = normalizeProduct(ip);

    if (matches && matches.length > 0) {
      // If multiple matches (legacy duplicates), use the latest created_at
      let matchedEp = matches[0];
      for (let i = 1; i < matches.length; i++) {
        const currentCreated = matchedEp.created_at ? new Date(matchedEp.created_at as string).getTime() : 0;
        const nextCreated = matches[i].created_at ? new Date(matches[i].created_at as string).getTime() : 0;
        if (nextCreated > currentCreated) {
          matchedEp = matches[i];
        }
      }

      if (hasChanges(normalizedIp, matchedEp)) {
        actions.push({ type: 'update', name: normalizedIp.name, productId: matchedEp.id });
        toUpdate.push({
          id: matchedEp.id,
          name: normalizedIp.name, // Keep casing from last occurrence in batch
          description: normalizedIp.description,
          price: normalizedIp.price,
          stock: normalizedIp.stock,
          image_url: normalizedIp.image_url,
        });
      } else {
        actions.push({ type: 'unchanged', name: normalizedIp.name, productId: matchedEp.id });
        unchangedCount++;
      }
    } else {
      actions.push({ type: 'insert', name: normalizedIp.name });
      toInsert.push(normalizedIp);
    }
  }

  return {
    actions,
    toInsert,
    toUpdate,
    unchangedCount,
  };
}
