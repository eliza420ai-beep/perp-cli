/**
 * Shared API fetchers for Pacifica, Hyperliquid, and Lighter.
 *
 * Centralizes all public REST calls so that API URLs live in one place
 * and fetch/parse logic isn't duplicated across 7+ command files.
 */

// ── API URLs ──

export const PACIFICA_API_URL = "https://api.pacifica.fi/api/v1/info/prices";
export const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz/info";
export const LIGHTER_API_URL = "https://mainnet.zklighter.elliot.ai";

// ── Shared response types ──

export interface PacificaAsset {
  symbol: string;
  funding: number;
  mark: number;
  nextFunding?: number;
}

export interface HyperliquidAsset {
  symbol: string;
  funding: number;
  markPx: number;
}

export interface LighterMarketDetail {
  marketId: number;
  symbol: string;
  lastTradePrice: number;
}

export interface LighterFundingEntry {
  marketId: number;
  symbol: string;
  rate: number;
  markPrice: number;
}

// ── Pacifica ──

/**
 * Fetch all Pacifica asset prices/funding from `/info/prices`.
 * Returns parsed array or empty on error.
 */
export async function fetchPacificaPrices(): Promise<PacificaAsset[]> {
  try {
    const res = await fetch(PACIFICA_API_URL);
    const json = await res.json();
    const data = (json as Record<string, unknown>).data ?? json;
    if (!Array.isArray(data)) return [];
    return data.map((p: Record<string, unknown>) => ({
      symbol: String(p.symbol ?? ""),
      funding: Number(p.funding ?? 0),
      mark: Number(p.mark ?? 0),
      nextFunding: p.next_funding ? Number(p.next_funding) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch Pacifica and return null on error (for Promise.all patterns).
 */
export function fetchPacificaPricesRaw(): Promise<unknown> {
  return fetch(PACIFICA_API_URL).then(r => r.json()).catch(() => null);
}

/**
 * Parse raw Pacifica response into rate/price maps.
 */
export function parsePacificaRaw(raw: unknown): { rates: Map<string, number>; prices: Map<string, number> } {
  const rates = new Map<string, number>();
  const prices = new Map<string, number>();
  const data = (raw as Record<string, unknown>)?.data ?? raw;
  if (!Array.isArray(data)) return { rates, prices };
  for (const p of data as Record<string, unknown>[]) {
    const sym = String(p.symbol ?? "");
    if (!sym) continue;
    rates.set(sym, Number(p.funding ?? 0));
    const mark = Number(p.mark ?? p.price ?? 0);
    if (mark > 0) prices.set(sym, mark);
  }
  return { rates, prices };
}

// ── Hyperliquid ──

function hlPost(type: string): Promise<unknown> {
  return fetch(HYPERLIQUID_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  }).then(r => r.json());
}

/**
 * Fetch Hyperliquid metaAndAssetCtxs — returns parsed assets.
 */
export async function fetchHyperliquidMeta(): Promise<HyperliquidAsset[]> {
  try {
    const json = await hlPost("metaAndAssetCtxs") as unknown[];
    const universe = ((json[0] ?? {}) as Record<string, unknown>).universe ?? [];
    const ctxs = (json[1] ?? []) as Record<string, unknown>[];
    return (universe as Record<string, unknown>[]).map((asset, i) => {
      const ctx = (ctxs[i] ?? {}) as Record<string, unknown>;
      return {
        symbol: String(asset.name ?? ""),
        funding: Number(ctx.funding ?? 0),
        markPx: Number(ctx.markPx ?? 0),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetch metaAndAssetCtxs raw (for Promise.all patterns).
 */
export function fetchHyperliquidMetaRaw(): Promise<unknown> {
  return hlPost("metaAndAssetCtxs").catch(() => null);
}

/**
 * Parse raw HL metaAndAssetCtxs into rate/price maps.
 */
export function parseHyperliquidMetaRaw(raw: unknown): { rates: Map<string, number>; prices: Map<string, number> } {
  const rates = new Map<string, number>();
  const prices = new Map<string, number>();
  if (!raw || !Array.isArray(raw)) return { rates, prices };
  const universe = (raw as Record<string, unknown>[])[0] as Record<string, unknown> | undefined;
  const ctxs = ((raw as unknown[])[1] ?? []) as Record<string, unknown>[];
  const assets = (universe?.universe ?? []) as Record<string, unknown>[];
  assets.forEach((a, i) => {
    const ctx = (ctxs[i] ?? {}) as Record<string, unknown>;
    const sym = String(a.name ?? "");
    if (!sym) return;
    rates.set(sym, Number(ctx.funding ?? 0));
    const mp = Number(ctx.markPx ?? 0);
    if (mp > 0) prices.set(sym, mp);
  });
  return { rates, prices };
}

/**
 * Fetch Hyperliquid allMids — returns symbol→price map.
 */
export async function fetchHyperliquidAllMids(): Promise<Record<string, string>> {
  try {
    return await hlPost("allMids") as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Fetch allMids raw (for Promise.all patterns).
 */
export function fetchHyperliquidAllMidsRaw(): Promise<unknown> {
  return hlPost("allMids").catch(() => null);
}

// ── Lighter ──

/**
 * Fetch Lighter orderBookDetails — returns parsed market details.
 */
export async function fetchLighterOrderBookDetails(): Promise<LighterMarketDetail[]> {
  try {
    const res = await fetch(`${LIGHTER_API_URL}/api/v1/orderBookDetails`);
    const json = await res.json() as Record<string, unknown>;
    const details = (json.order_book_details ?? []) as Array<Record<string, unknown>>;
    return details.map(m => ({
      marketId: Number(m.market_id),
      symbol: String(m.symbol ?? ""),
      lastTradePrice: Number(m.last_trade_price ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch orderBookDetails raw (for Promise.all patterns).
 */
export function fetchLighterOrderBookDetailsRaw(): Promise<unknown> {
  return fetch(`${LIGHTER_API_URL}/api/v1/orderBookDetails`).then(r => r.json()).catch(() => null);
}

/**
 * Fetch Lighter funding-rates — returns parsed entries.
 */
export async function fetchLighterFundingRates(): Promise<LighterFundingEntry[]> {
  try {
    const res = await fetch(`${LIGHTER_API_URL}/api/v1/funding-rates`);
    const json = await res.json() as Record<string, unknown>;
    const list = (json.funding_rates ?? []) as Array<Record<string, unknown>>;
    const seen = new Set<number>();
    const entries: LighterFundingEntry[] = [];
    for (const fr of list) {
      const mid = Number(fr.market_id);
      if (seen.has(mid)) continue; // deduplicate by market_id (keeps first/latest)
      seen.add(mid);
      entries.push({
        marketId: mid,
        symbol: String(fr.symbol ?? ""),
        rate: Number(fr.rate ?? fr.funding_rate ?? 0),
        markPrice: Number(fr.mark_price ?? 0),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Fetch funding-rates raw (for Promise.all patterns).
 */
export function fetchLighterFundingRatesRaw(): Promise<unknown> {
  return fetch(`${LIGHTER_API_URL}/api/v1/funding-rates`).then(r => r.json()).catch(() => null);
}

/**
 * Parse raw Lighter orderBookDetails + funding-rates into rate/price maps.
 */
export function parseLighterRaw(
  detailsRaw: unknown,
  fundingRaw: unknown,
): { rates: Map<string, number>; prices: Map<string, number> } {
  const rates = new Map<string, number>();
  const prices = new Map<string, number>();

  // Build market_id → {symbol, price} from details
  const idToSym = new Map<number, string>();
  const idToPrice = new Map<number, number>();
  if (detailsRaw) {
    const details = ((detailsRaw as Record<string, unknown>).order_book_details ?? []) as Array<Record<string, unknown>>;
    for (const m of details) {
      const mid = Number(m.market_id);
      idToSym.set(mid, String(m.symbol ?? ""));
      const p = Number(m.last_trade_price ?? 0);
      if (p > 0) idToPrice.set(mid, p);
    }
  }

  if (fundingRaw) {
    const fundingList = ((fundingRaw as Record<string, unknown>).funding_rates ?? []) as Array<Record<string, unknown>>;
    for (const fr of fundingList) {
      const sym = String(fr.symbol ?? "") || idToSym.get(Number(fr.market_id)) || "";
      if (!sym || rates.has(sym)) continue; // deduplicate: keep first (latest)
      rates.set(sym, Number(fr.rate ?? fr.funding_rate ?? 0));
      const mp = Number(fr.mark_price ?? 0) || idToPrice.get(Number(fr.market_id)) || 0;
      if (mp > 0) prices.set(sym, mp);
    }
  }

  // Fill in prices from details for symbols without a funding-rate price
  for (const [mid, sym] of idToSym) {
    if (!prices.has(sym)) {
      const p = idToPrice.get(mid);
      if (p && p > 0) prices.set(sym, p);
    }
  }

  return { rates, prices };
}

// ── Health check helpers ──

/**
 * Check if Pacifica API is reachable.
 */
export async function pingPacifica(): Promise<{ ok: boolean; latencyMs: number; status: number }> {
  const start = Date.now();
  try {
    const res = await fetch(PACIFICA_API_URL);
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, status: 0 };
  }
}

/**
 * Check if Hyperliquid API is reachable.
 */
export async function pingHyperliquid(): Promise<{ ok: boolean; latencyMs: number; status: number }> {
  const start = Date.now();
  try {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, status: 0 };
  }
}

/**
 * Check if Lighter API is reachable.
 */
export async function pingLighter(): Promise<{ ok: boolean; latencyMs: number; status: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${LIGHTER_API_URL}/api/v1/orderBookDetails`);
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, status: 0 };
  }
}
