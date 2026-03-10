import { describe, it, expect } from "vitest";
import {
  computeEnhancedStats,
  normalizeExchangePair,
  getTimeBucket,
  type ArbTradeForStats,
} from "../arb-history-stats.js";

function makeTrade(overrides: Partial<ArbTradeForStats> = {}): ArbTradeForStats {
  return {
    symbol: "ETH",
    exchanges: "hyperliquid+pacifica",
    entryDate: "2025-01-15T10:00:00.000Z",
    exitDate: "2025-01-19T14:00:00.000Z",
    holdDurationMs: 4 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000, // 4d 4h
    entrySpread: 35.0,
    exitSpread: 8.0,
    netReturn: 5.20,
    status: "completed",
    ...overrides,
  };
}

describe("normalizeExchangePair", () => {
  it("converts exchange names to abbreviations and sorts", () => {
    expect(normalizeExchangePair("hyperliquid+pacifica")).toBe("HL/PAC");
    expect(normalizeExchangePair("pacifica+hyperliquid")).toBe("HL/PAC");
    expect(normalizeExchangePair("lighter+hyperliquid")).toBe("HL/LT");
    expect(normalizeExchangePair("lighter+pacifica")).toBe("LT/PAC");
  });

  it("handles unknown exchanges with truncation", () => {
    expect(normalizeExchangePair("binance+coinbase")).toBe("BIN/COI");
  });
});

describe("getTimeBucket", () => {
  it("returns correct 4-hour UTC buckets", () => {
    expect(getTimeBucket("2025-01-15T00:00:00.000Z")).toBe("00-04 UTC");
    expect(getTimeBucket("2025-01-15T03:59:59.000Z")).toBe("00-04 UTC");
    expect(getTimeBucket("2025-01-15T04:00:00.000Z")).toBe("04-08 UTC");
    expect(getTimeBucket("2025-01-15T08:30:00.000Z")).toBe("08-12 UTC");
    expect(getTimeBucket("2025-01-15T12:00:00.000Z")).toBe("12-16 UTC");
    expect(getTimeBucket("2025-01-15T16:45:00.000Z")).toBe("16-20 UTC");
    expect(getTimeBucket("2025-01-15T20:00:00.000Z")).toBe("20-24 UTC");
    expect(getTimeBucket("2025-01-15T23:59:59.000Z")).toBe("20-24 UTC");
  });
});

describe("computeEnhancedStats", () => {
  it("handles empty history gracefully", () => {
    const stats = computeEnhancedStats([]);
    expect(stats.avgEntrySpread).toBe(0);
    expect(stats.avgExitSpread).toBe(0);
    expect(stats.avgSpreadDecay).toBe(0);
    expect(stats.byExchangePair).toEqual([]);
    expect(stats.byTimeOfDay).toEqual([]);
    expect(stats.optimalHoldTime).toBeNull();
    expect(stats.optimalHoldTimeMs).toBeNull();
  });

  it("ignores open and failed trades in completed stats", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ status: "open", netReturn: 0 }),
      makeTrade({ status: "failed", netReturn: -1 }),
    ];
    const stats = computeEnhancedStats(trades);
    expect(stats.byExchangePair).toEqual([]);
    expect(stats.byTimeOfDay).toEqual([]);
  });

  it("computes average entry/exit spreads correctly", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ entrySpread: 30, exitSpread: 10 }),
      makeTrade({ entrySpread: 40, exitSpread: 6 }),
    ];
    const stats = computeEnhancedStats(trades);
    expect(stats.avgEntrySpread).toBe(35);
    expect(stats.avgExitSpread).toBe(8);
    expect(stats.avgSpreadDecay).toBe(27); // (20 + 34) / 2
  });

  it("handles null spreads in averages", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ entrySpread: 30, exitSpread: null }),
      makeTrade({ entrySpread: null, exitSpread: 10 }),
    ];
    const stats = computeEnhancedStats(trades);
    expect(stats.avgEntrySpread).toBe(30);
    expect(stats.avgExitSpread).toBe(10);
    expect(stats.avgSpreadDecay).toBe(0); // neither has both
  });

  it("groups by exchange pair correctly", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ exchanges: "hyperliquid+pacifica", netReturn: 10 }),
      makeTrade({ exchanges: "hyperliquid+pacifica", netReturn: 5 }),
      makeTrade({ exchanges: "hyperliquid+pacifica", netReturn: -2 }),
      makeTrade({ exchanges: "lighter+pacifica", netReturn: 8 }),
      makeTrade({ exchanges: "lighter+pacifica", netReturn: 3 }),
      makeTrade({ exchanges: "hyperliquid+lighter", netReturn: 1 }),
    ];
    const stats = computeEnhancedStats(trades);

    expect(stats.byExchangePair).toHaveLength(3);

    // Sorted by trade count descending
    const hlPac = stats.byExchangePair.find(p => p.pair === "HL/PAC");
    expect(hlPac).toBeDefined();
    expect(hlPac!.trades).toBe(3);
    expect(hlPac!.winRate).toBeCloseTo(66.67, 0);
    expect(hlPac!.avgNetPnl).toBeCloseTo(4.33, 1);

    const ltPac = stats.byExchangePair.find(p => p.pair === "LT/PAC");
    expect(ltPac).toBeDefined();
    expect(ltPac!.trades).toBe(2);
    expect(ltPac!.winRate).toBe(100);
    expect(ltPac!.avgNetPnl).toBe(5.5);

    const hlLt = stats.byExchangePair.find(p => p.pair === "HL/LT");
    expect(hlLt).toBeDefined();
    expect(hlLt!.trades).toBe(1);
  });

  it("buckets by time of day correctly", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ entryDate: "2025-01-15T01:00:00.000Z", netReturn: 12 }),
      makeTrade({ entryDate: "2025-01-16T02:30:00.000Z", netReturn: 8 }),
      makeTrade({ entryDate: "2025-01-17T03:00:00.000Z", netReturn: 16 }),
      makeTrade({ entryDate: "2025-01-18T08:15:00.000Z", netReturn: 5 }),
      makeTrade({ entryDate: "2025-01-19T09:00:00.000Z", netReturn: -3 }),
      makeTrade({ entryDate: "2025-01-20T16:00:00.000Z", netReturn: -2 }),
      makeTrade({ entryDate: "2025-01-20T18:30:00.000Z", netReturn: 1 }),
    ];
    const stats = computeEnhancedStats(trades);

    const bucket00 = stats.byTimeOfDay.find(b => b.bucket === "00-04 UTC");
    expect(bucket00).toBeDefined();
    expect(bucket00!.trades).toBe(3);
    expect(bucket00!.winRate).toBe(100);
    expect(bucket00!.avgNetPnl).toBe(12);

    const bucket08 = stats.byTimeOfDay.find(b => b.bucket === "08-12 UTC");
    expect(bucket08).toBeDefined();
    expect(bucket08!.trades).toBe(2);
    expect(bucket08!.winRate).toBe(50);

    const bucket16 = stats.byTimeOfDay.find(b => b.bucket === "16-20 UTC");
    expect(bucket16).toBeDefined();
    expect(bucket16!.trades).toBe(2);
    expect(bucket16!.avgNetPnl).toBe(-0.5);
  });

  it("computes optimal hold time as median of winning trades", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const trades: ArbTradeForStats[] = [
      makeTrade({ holdDurationMs: 2 * dayMs, netReturn: 5 }),    // win
      makeTrade({ holdDurationMs: 4 * dayMs, netReturn: 10 }),   // win
      makeTrade({ holdDurationMs: 6 * dayMs, netReturn: 8 }),    // win
      makeTrade({ holdDurationMs: 8 * dayMs, netReturn: -3 }),   // loss
      makeTrade({ holdDurationMs: 10 * dayMs, netReturn: 12 }),  // win
    ];
    const stats = computeEnhancedStats(trades);

    // Profitable hold times sorted: 2d, 4d, 6d, 10d
    // Median of 4 items: (4d + 6d) / 2 = 5d
    expect(stats.optimalHoldTimeMs).toBe(5 * dayMs);
    expect(stats.optimalHoldTime).toBe("5d 0h");
  });

  it("optimal hold time with odd number of winning trades", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const trades: ArbTradeForStats[] = [
      makeTrade({ holdDurationMs: 3 * dayMs, netReturn: 2 }),
      makeTrade({ holdDurationMs: 5 * dayMs, netReturn: 7 }),
      makeTrade({ holdDurationMs: 7 * dayMs, netReturn: 1 }),
    ];
    const stats = computeEnhancedStats(trades);

    // Median of [3d, 5d, 7d] = 5d
    expect(stats.optimalHoldTimeMs).toBe(5 * dayMs);
    expect(stats.optimalHoldTime).toBe("5d 0h");
  });

  it("optimal hold time is null when no profitable trades", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ netReturn: -5 }),
      makeTrade({ netReturn: -2 }),
    ];
    const stats = computeEnhancedStats(trades);
    expect(stats.optimalHoldTime).toBeNull();
    expect(stats.optimalHoldTimeMs).toBeNull();
  });

  it("skips empty time-of-day buckets", () => {
    const trades: ArbTradeForStats[] = [
      makeTrade({ entryDate: "2025-01-15T02:00:00.000Z" }),
    ];
    const stats = computeEnhancedStats(trades);
    // Only the 00-04 bucket should appear
    expect(stats.byTimeOfDay).toHaveLength(1);
    expect(stats.byTimeOfDay[0].bucket).toBe("00-04 UTC");
  });
});
