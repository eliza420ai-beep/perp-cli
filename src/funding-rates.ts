/**
 * Real-time 3-DEX funding rate comparison.
 *
 * Fetches funding rates from Pacifica, Hyperliquid, and Lighter in parallel,
 * normalizes them to comparable hourly rates, and identifies arbitrage
 * opportunities across exchanges.
 */

import { toHourlyRate, computeAnnualSpread, estimateHourlyFunding } from "./funding.js";
import {
  fetchPacificaPrices, fetchHyperliquidMeta,
  fetchLighterOrderBookDetails, fetchLighterFundingRates as fetchLtFundingRates,
} from "./shared-api.js";
import { saveFundingSnapshot, getHistoricalAverages, type HistoricalAverages } from "./funding-history.js";

// ── API URLs (centralized in shared-api.ts) ──

// ── Types ──

export interface ExchangeFundingRate {
  exchange: "pacifica" | "hyperliquid" | "lighter";
  symbol: string;
  fundingRate: number;       // raw rate (period depends on exchange)
  hourlyRate: number;        // normalized to per-hour
  annualizedPct: number;     // annualized percentage
  markPrice: number;
  nextFundingTime?: number;  // unix ms, if available
  historicalAvg?: HistoricalAverages;  // avg rates over time windows
}

export interface SymbolFundingComparison {
  symbol: string;
  rates: ExchangeFundingRate[];
  maxSpreadAnnual: number;      // annualized spread between extremes
  longExchange: string;         // go long where funding is lowest (you get paid)
  shortExchange: string;        // go short where funding is highest (you get paid)
  bestMarkPrice: number;        // best available mark price (prefer HL)
  estHourlyIncomeUsd: number;   // estimated hourly income for $1000 notional
}

export interface FundingRateSnapshot {
  timestamp: string;
  symbols: SymbolFundingComparison[];
  exchangeStatus: Record<string, "ok" | "error">;
}

// ── Default top symbols to track ──

export const TOP_SYMBOLS = [
  "BTC", "ETH", "SOL", "DOGE", "SUI", "AVAX", "LINK", "ARB",
  "WIF", "PEPE", "ONDO", "SEI", "TIA", "INJ", "NEAR",
  "APT", "OP", "FIL", "AAVE", "MKR",
];

// ── Fetchers (using shared-api.ts) ──

async function fetchPacificaRates(): Promise<ExchangeFundingRate[]> {
  try {
    const assets = await fetchPacificaPrices();
    return assets.map(p => {
      const hourly = toHourlyRate(p.funding, "pacifica");
      return {
        exchange: "pacifica" as const,
        symbol: p.symbol,
        fundingRate: p.funding,
        hourlyRate: hourly,
        annualizedPct: hourly * 24 * 365 * 100,
        markPrice: p.mark,
        nextFundingTime: p.nextFunding,
      };
    });
  } catch {
    return [];
  }
}

async function fetchHyperliquidRates(): Promise<ExchangeFundingRate[]> {
  try {
    const assets = await fetchHyperliquidMeta();
    return assets.map(a => {
      const hourly = toHourlyRate(a.funding, "hyperliquid");
      return {
        exchange: "hyperliquid" as const,
        symbol: a.symbol,
        fundingRate: a.funding,
        hourlyRate: hourly,
        annualizedPct: hourly * 24 * 365 * 100,
        markPrice: a.markPx,
      };
    });
  } catch {
    return [];
  }
}

async function fetchLighterRates(): Promise<ExchangeFundingRate[]> {
  try {
    const [details, funding] = await Promise.all([
      fetchLighterOrderBookDetails(),
      fetchLtFundingRates(),
    ]);

    const priceMap = new Map(details.map(d => [d.marketId, d.lastTradePrice]));
    const symMap = new Map(details.map(d => [d.marketId, d.symbol]));

    return funding.map(fr => {
      const symbol = fr.symbol || symMap.get(fr.marketId) || "";
      const rate = fr.rate;
      const hourly = toHourlyRate(rate, "lighter");
      return {
        exchange: "lighter" as const,
        symbol,
        fundingRate: rate,
        hourlyRate: hourly,
        annualizedPct: hourly * 24 * 365 * 100,
        markPrice: fr.markPrice || priceMap.get(fr.marketId) || 0,
      };
    });
  } catch {
    return [];
  }
}

// ── Core comparison logic ──

/**
 * Fetch funding rates from all 3 DEXs in parallel, normalize, and compare.
 * Returns rates sorted by max spread (descending).
 */
export async function fetchAllFundingRates(opts?: {
  symbols?: string[];      // filter to these symbols (default: all)
  minSpread?: number;      // minimum annualized spread % to include
}): Promise<FundingRateSnapshot> {
  const exchangeStatus: Record<string, "ok" | "error"> = {};

  const [pacRates, hlRates, ltRates] = await Promise.all([
    fetchPacificaRates().then(r => { exchangeStatus.pacifica = r.length > 0 ? "ok" : "error"; return r; }),
    fetchHyperliquidRates().then(r => { exchangeStatus.hyperliquid = r.length > 0 ? "ok" : "error"; return r; }),
    fetchLighterRates().then(r => { exchangeStatus.lighter = r.length > 0 ? "ok" : "error"; return r; }),
  ]);

  // Persist snapshot for historical tracking
  const allRates = [...pacRates, ...hlRates, ...ltRates];
  try {
    saveFundingSnapshot(allRates);
  } catch {
    // Non-critical: don't fail the command if persistence fails
  }

  // Build per-symbol rate map
  const rateMap = new Map<string, ExchangeFundingRate[]>();
  for (const r of allRates) {
    if (!r.symbol) continue;
    if (opts?.symbols && !opts.symbols.includes(r.symbol.toUpperCase())) continue;
    const key = r.symbol.toUpperCase();
    if (!rateMap.has(key)) rateMap.set(key, []);
    rateMap.get(key)!.push(r);
  }

  // Attach historical averages when available
  try {
    const symbols = Array.from(rateMap.keys());
    const exchanges = ["pacifica", "hyperliquid", "lighter"];
    const historicals = getHistoricalAverages(symbols, exchanges);
    for (const [, rates] of rateMap) {
      for (const r of rates) {
        const key = `${r.symbol.toUpperCase()}:${r.exchange}`;
        const avg = historicals.get(key);
        if (avg) r.historicalAvg = avg;
      }
    }
  } catch {
    // Non-critical
  }

  const comparisons: SymbolFundingComparison[] = [];
  const minSpread = opts?.minSpread ?? 0;

  for (const [symbol, rates] of rateMap) {
    // Need at least 2 exchanges to compare
    if (rates.length < 2) continue;

    // Sort by hourly rate (ascending)
    rates.sort((a, b) => a.hourlyRate - b.hourlyRate);
    const lowest = rates[0];
    const highest = rates[rates.length - 1];

    const maxSpreadAnnual = computeAnnualSpread(
      highest.fundingRate, highest.exchange,
      lowest.fundingRate, lowest.exchange,
    );

    if (maxSpreadAnnual < minSpread) continue;

    // Best mark price: prefer HL (most liquid), then PAC, then LT
    const hlRate = rates.find(r => r.exchange === "hyperliquid");
    const pacRate = rates.find(r => r.exchange === "pacifica");
    const ltRate = rates.find(r => r.exchange === "lighter");
    const bestMarkPrice = hlRate?.markPrice || pacRate?.markPrice || ltRate?.markPrice || 0;

    // Estimate hourly income for $1000 notional arb
    const notional = 1000;
    const longIncome = estimateHourlyFunding(
      lowest.fundingRate, lowest.exchange, notional, "long",
    );
    const shortIncome = estimateHourlyFunding(
      highest.fundingRate, highest.exchange, notional, "short",
    );
    const estHourlyIncomeUsd = -(longIncome + shortIncome); // negate because income = -cost

    comparisons.push({
      symbol,
      rates,
      maxSpreadAnnual,
      longExchange: lowest.exchange,   // long where funding is lowest
      shortExchange: highest.exchange, // short where funding is highest
      bestMarkPrice,
      estHourlyIncomeUsd,
    });
  }

  // Sort by spread descending
  comparisons.sort((a, b) => b.maxSpreadAnnual - a.maxSpreadAnnual);

  return {
    timestamp: new Date().toISOString(),
    symbols: comparisons,
    exchangeStatus,
  };
}

/**
 * Fetch rates for a single symbol across all exchanges.
 */
export async function fetchSymbolFundingRates(symbol: string): Promise<SymbolFundingComparison | null> {
  const snapshot = await fetchAllFundingRates({ symbols: [symbol.toUpperCase()] });
  return snapshot.symbols[0] ?? null;
}
