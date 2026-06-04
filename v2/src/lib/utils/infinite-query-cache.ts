// ==========================================
// QUBA AI — InfiniteData Cache Helpers
// Ensures React Query InfiniteData<T> shape is
// always preserved in setQueryData mutations.
//
// Root cause fix: setQueryData calls were converting
// { pages: T[][], pageParams: any[] } → T[] (flat array),
// causing getNextPageParam → data.pages.length → crash.
// ==========================================

/**
 * Minimal InfiniteData shape matching @tanstack/react-query.
 * We keep this local to avoid tight coupling with the library's
 * internal types while ensuring structural compatibility.
 */
export interface SafeInfiniteData<T> {
  pages: T[][];
  pageParams: unknown[];
}

/**
 * Default page param matching our useInfiniteQuery configs.
 * Both contact-list and chat-area use `initialPageParam: 1`.
 */
const DEFAULT_PAGE_PARAM = 1;

// ─── Type guard ───

function isInfiniteData<T>(data: unknown): data is SafeInfiniteData<T> {
  return (
    data != null &&
    typeof data === "object" &&
    "pages" in data &&
    Array.isArray((data as any).pages) &&
    "pageParams" in data &&
    Array.isArray((data as any).pageParams)
  );
}

// ─── Core helpers ───

/**
 * Normalizes any cache value into a valid InfiniteData shape.
 *
 * - Valid InfiniteData → returned as-is
 * - Plain array → wrapped in single page
 * - undefined/null/invalid → empty InfiniteData
 */
export function normalizeInfiniteData<T>(oldData: unknown): SafeInfiniteData<T> {
  if (isInfiniteData<T>(oldData)) {
    return oldData;
  }

  if (Array.isArray(oldData)) {
    // Legacy flat array — wrap into single page to preserve items
    return { pages: [oldData as T[]], pageParams: [DEFAULT_PAGE_PARAM] };
  }

  // Cache miss or corrupted shape
  return { pages: [], pageParams: [] };
}

/**
 * Appends a single item to the last page of an InfiniteData cache.
 * Preserves existing page structure and pageParams.
 *
 * Used for optimistic message insertion (text & media send).
 */
export function appendToInfiniteData<T>(oldData: unknown, item: T): SafeInfiniteData<T> {
  const normalized = normalizeInfiniteData<T>(oldData);

  if (normalized.pages.length === 0) {
    // Empty cache — create first page
    return {
      pages: [[item]],
      pageParams: [DEFAULT_PAGE_PARAM],
    };
  }

  // Clone pages, append to last page
  const newPages = normalized.pages.map((page, i) =>
    i === normalized.pages.length - 1 ? [...page, item] : page
  );

  return { ...normalized, pages: newPages };
}

/**
 * Updates a single item in-place across all pages using a predicate.
 * If no match is found, the data is returned unchanged.
 *
 * Used for status updates, dedup reconciliation.
 */
export function updateInfiniteDataItem<T>(
  oldData: unknown,
  predicate: (item: T, index: number) => boolean,
  updater: (item: T) => T
): SafeInfiniteData<T> {
  const normalized = normalizeInfiniteData<T>(oldData);

  let found = false;
  const newPages = normalized.pages.map((page) =>
    page.map((item, idx) => {
      if (!found && predicate(item, idx)) {
        found = true;
        return updater(item);
      }
      return item;
    })
  );

  return { ...normalized, pages: newPages };
}

/**
 * Replaces all items in the cache with a new flat array,
 * collapsing into a single page. Preserves the first pageParam.
 *
 * Used when realtime reconciliation needs to sort/dedup the
 * entire message list. Pagination is re-established on next fetch.
 *
 * NOTE: This intentionally collapses pages. Document this behavior
 * in the walkthrough: "Realtime mutation sonrası cache tek sayfa
 * normalize edilir; pagination sonraki fetch'te yeniden kurulur."
 */
export function replaceInfiniteDataItems<T>(
  oldData: unknown,
  items: T[]
): SafeInfiniteData<T> {
  const normalized = normalizeInfiniteData<T>(oldData);

  return {
    pages: [items],
    pageParams: [normalized.pageParams[0] ?? DEFAULT_PAGE_PARAM],
  };
}

/**
 * Finds the index of an item across all pages.
 * Returns [pageIndex, itemIndex] or null if not found.
 */
export function findInInfiniteData<T>(
  oldData: unknown,
  predicate: (item: T) => boolean
): { pageIndex: number; itemIndex: number; item: T } | null {
  const normalized = normalizeInfiniteData<T>(oldData);

  for (let pi = 0; pi < normalized.pages.length; pi++) {
    for (let ii = 0; ii < normalized.pages[pi].length; ii++) {
      if (predicate(normalized.pages[pi][ii])) {
        return { pageIndex: pi, itemIndex: ii, item: normalized.pages[pi][ii] };
      }
    }
  }

  return null;
}

/**
 * Flattens all pages into a single array.
 * Useful for search/sort operations that need the full list.
 */
export function flattenInfiniteData<T>(oldData: unknown): T[] {
  const normalized = normalizeInfiniteData<T>(oldData);
  return normalized.pages.flat();
}
