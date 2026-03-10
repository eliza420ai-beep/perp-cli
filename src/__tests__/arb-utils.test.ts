import { describe, it, expect, vi } from "vitest";
import {
  getLastSettlement,
  getMinutesSinceSettlement,
  aggressiveSettleBoost,
  estimateFundingUntilSettlement,
  computeBasisRisk,
  formatNotifyMessage,
  sendNotification,
  type SettleStrategy,
  type ArbNotifyEvent,
} from "../arb-utils.js";

// ── Settlement Timing Tests ──

describe("getMinutesSinceSettlement", () => {
  it("returns correct minutes after HL settlement (hourly)", () => {
    // 14:30 UTC — last HL settlement was at 14:00, so 30 minutes ago
    const now = new Date("2024-06-15T14:30:00Z");
    const mins = getMinutesSinceSettlement("hyperliquid", now);
    expect(mins).toBeCloseTo(30, 0);
  });

  it("returns correct minutes after PAC settlement (every 8h)", () => {
    // 10:15 UTC — last PAC settlement was at 08:00, so 135 minutes ago
    const now = new Date("2024-06-15T10:15:00Z");
    const mins = getMinutesSinceSettlement("pacifica", now);
    expect(mins).toBeCloseTo(135, 0);
  });

  it("returns small value right after settlement", () => {
    // 16:02 UTC — 2 minutes after PAC settlement at 16:00
    const now = new Date("2024-06-15T16:02:00Z");
    const mins = getMinutesSinceSettlement("pacifica", now);
    expect(mins).toBeCloseTo(2, 0);
  });

  it("returns correct value right before next settlement", () => {
    // 07:55 UTC — 475 minutes since last PAC settlement at 00:00
    const now = new Date("2024-06-15T07:55:00Z");
    const mins = getMinutesSinceSettlement("pacifica", now);
    expect(mins).toBeCloseTo(475, 0);
  });

  it("handles midnight correctly for PAC", () => {
    // 00:05 UTC — 5 minutes after 00:00 PAC settlement
    const now = new Date("2024-06-15T00:05:00Z");
    const mins = getMinutesSinceSettlement("pacifica", now);
    expect(mins).toBeCloseTo(5, 0);
  });

  it("handles Lighter same as Pacifica", () => {
    const now = new Date("2024-06-15T10:00:00Z");
    const pacMins = getMinutesSinceSettlement("pacifica", now);
    const ltMins = getMinutesSinceSettlement("lighter", now);
    expect(ltMins).toBe(pacMins);
  });
});

describe("getLastSettlement", () => {
  it("returns the exact settlement time for HL", () => {
    const now = new Date("2024-06-15T14:30:00Z");
    const last = getLastSettlement("hyperliquid", now);
    expect(last.getUTCHours()).toBe(14);
    expect(last.getUTCMinutes()).toBe(0);
  });

  it("returns previous day for PAC when before first settlement", () => {
    // Actually 00:00 is a settlement, so at 00:05 the last is 00:00 same day
    const now = new Date("2024-06-15T00:05:00Z");
    const last = getLastSettlement("pacifica", now);
    expect(last.getUTCHours()).toBe(0);
    expect(last.getUTCDate()).toBe(15); // same day since 00:00 is a settlement
  });
});

describe("aggressiveSettleBoost", () => {
  it("returns > 1.0 immediately after both exchanges settle", () => {
    // Right after both HL and PAC settle (e.g., 16:01)
    const now = new Date("2024-06-15T16:01:00Z");
    const boost = aggressiveSettleBoost("hyperliquid", "pacifica", 10, now);
    expect(boost).toBeGreaterThan(1.0);
    expect(boost).toBeLessThanOrEqual(1.5);
  });

  it("returns 1.5 at exactly settlement time", () => {
    // At exactly 16:00:01 — both just settled
    const now = new Date("2024-06-15T16:00:01Z");
    const boost = aggressiveSettleBoost("hyperliquid", "pacifica", 10, now);
    // HL settled 0.01min ago, PAC settled 0.01min ago
    // min = ~0.01, factor = 1 + 0.5 * (1 - 0.01/10) = ~1.499
    expect(boost).toBeGreaterThan(1.4);
    expect(boost).toBeLessThanOrEqual(1.5);
  });

  it("returns 1.0 when far from settlement", () => {
    // 14:30 — PAC settled at 08:00, 390 minutes ago
    const now = new Date("2024-06-15T14:30:00Z");
    const boost = aggressiveSettleBoost("hyperliquid", "pacifica", 10, now);
    // HL settled 30min ago > 10 window, PAC settled 390min ago
    // min(30, 390) = 30 > 10, so boost = 1.0
    expect(boost).toBe(1.0);
  });

  it("returns 1.0 for HL-only pair when HL settled > window ago", () => {
    // HL settled 15 minutes ago, PAC settled 15 minutes ago
    // With window of 10, both are > 10 so boost = 1.0
    const now = new Date("2024-06-15T08:15:00Z");
    const boost = aggressiveSettleBoost("hyperliquid", "pacifica", 10, now);
    // HL settled at 08:00 (15 min ago), PAC settled at 08:00 (15 min ago)
    // min(15, 15) = 15 > 10 => 1.0
    expect(boost).toBe(1.0);
  });

  it("decays linearly within window", () => {
    // HL settled 5 minutes ago, PAC settled 5 minutes ago (at 08:05)
    const now = new Date("2024-06-15T08:05:00Z");
    const boost = aggressiveSettleBoost("hyperliquid", "pacifica", 10, now);
    // min(5, 5) = 5, factor = 1 + 0.5 * (1 - 5/10) = 1.25
    expect(boost).toBeCloseTo(1.25, 1);
  });
});

// ── Funding Estimation Tests ──

describe("estimateFundingUntilSettlement", () => {
  it("calculates correct cumulative HL funding", () => {
    // 0.01% hourly rate, $1000 position, 4 hours until PAC settlement
    const result = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 4);
    // hlCumulative = 0.0001 * 1000 * 4 = 0.4
    expect(result.hlCumulative).toBeCloseTo(0.4, 4);
  });

  it("calculates correct PAC payment", () => {
    const result = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 4);
    // pacPayment = 0.0008 * 1000 = 0.8
    expect(result.pacPayment).toBeCloseTo(0.8, 4);
  });

  it("calculates net funding correctly", () => {
    const result = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 4);
    // net = 0.4 - 0.8 = -0.4
    expect(result.netFunding).toBeCloseTo(-0.4, 4);
  });

  it("handles zero rates", () => {
    const result = estimateFundingUntilSettlement(0, 0, 1000, 8);
    expect(result.hlCumulative).toBe(0);
    expect(result.pacPayment).toBe(0);
    expect(result.netFunding).toBe(0);
  });

  it("scales linearly with position size", () => {
    const small = estimateFundingUntilSettlement(0.0001, 0.0008, 100, 4);
    const big = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 4);
    expect(big.hlCumulative).toBeCloseTo(small.hlCumulative * 10, 4);
    expect(big.pacPayment).toBeCloseTo(small.pacPayment * 10, 4);
  });

  it("HL cumulative scales with time", () => {
    const short = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 2);
    const long = estimateFundingUntilSettlement(0.0001, 0.0008, 1000, 8);
    expect(long.hlCumulative).toBeCloseTo(short.hlCumulative * 4, 4);
  });
});

// ── Basis Risk Tests ──

describe("computeBasisRisk", () => {
  it("detects divergence correctly", () => {
    const result = computeBasisRisk(100, 104, 3);
    // |100 - 104| / 102 * 100 = ~3.92%
    expect(result.divergencePct).toBeCloseTo(3.92, 1);
    expect(result.warning).toBe(true);
  });

  it("no warning when divergence is low", () => {
    const result = computeBasisRisk(100, 101, 3);
    // |100 - 101| / 100.5 * 100 = ~0.995%
    expect(result.divergencePct).toBeCloseTo(1.0, 0);
    expect(result.warning).toBe(false);
  });

  it("handles equal prices", () => {
    const result = computeBasisRisk(50, 50, 3);
    expect(result.divergencePct).toBe(0);
    expect(result.warning).toBe(false);
  });

  it("handles zero prices", () => {
    const result = computeBasisRisk(0, 100, 3);
    expect(result.divergencePct).toBe(0);
    expect(result.warning).toBe(false);
  });

  it("uses custom threshold", () => {
    const result = computeBasisRisk(100, 101, 0.5);
    // ~1% divergence > 0.5% threshold
    expect(result.warning).toBe(true);
  });

  it("symmetric for long/short swap", () => {
    const a = computeBasisRisk(100, 105, 3);
    const b = computeBasisRisk(105, 100, 3);
    expect(a.divergencePct).toBeCloseTo(b.divergencePct, 4);
    expect(a.warning).toBe(b.warning);
  });
});

// ── Notification Tests ──

describe("formatNotifyMessage", () => {
  it("formats entry message", () => {
    const msg = formatNotifyMessage("entry", {
      symbol: "WIF", longExchange: "lighter", shortExchange: "pacifica",
      size: 500, netSpread: 28.5,
    });
    expect(msg).toContain("WIF");
    expect(msg).toContain("Long lighter");
    expect(msg).toContain("Short pacifica");
    expect(msg).toContain("$500");
    expect(msg).toContain("28.5%");
  });

  it("formats exit message", () => {
    const msg = formatNotifyMessage("exit", {
      symbol: "ETH", pnl: 10.5, duration: "7d 3h",
    });
    expect(msg).toContain("ETH");
    expect(msg).toContain("+$10.50");
    expect(msg).toContain("7d 3h");
  });

  it("formats exit message with negative PnL", () => {
    const msg = formatNotifyMessage("exit", {
      symbol: "SOL", pnl: -5.25, duration: "2d",
    });
    expect(msg).toContain("SOL");
    expect(msg).toContain("-$5.25");
  });

  it("formats reversal message", () => {
    const msg = formatNotifyMessage("reversal", { symbol: "WIF" });
    expect(msg).toContain("REVERSAL");
    expect(msg).toContain("WIF");
  });

  it("formats margin message", () => {
    const msg = formatNotifyMessage("margin", {
      exchange: "Lighter", marginPct: 25.3, threshold: 30,
    });
    expect(msg).toContain("LOW MARGIN");
    expect(msg).toContain("Lighter");
    expect(msg).toContain("25.3%");
    expect(msg).toContain("30.0%");
  });

  it("formats basis risk message", () => {
    const msg = formatNotifyMessage("basis", {
      symbol: "WIF", divergencePct: 4.2, longExchange: "LT", shortExchange: "PAC",
    });
    expect(msg).toContain("BASIS RISK");
    expect(msg).toContain("WIF");
    expect(msg).toContain("4.2%");
    expect(msg).toContain("LT/PAC");
  });
});

describe("sendNotification", () => {
  it("sends Discord webhook with content field", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendNotification(
      "https://discord.com/api/webhooks/123/abc",
      "entry",
      { symbol: "BTC", longExchange: "HL", shortExchange: "PAC", size: 100, netSpread: 30 },
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("discord.com/api/webhooks");
    const body = JSON.parse(opts.body);
    expect(body).toHaveProperty("content");
    expect(body.content).toContain("BTC");
  });

  it("sends Telegram webhook with chat_id and text", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendNotification(
      "https://api.telegram.org/bot123:TOKEN/sendMessage?chat_id=456",
      "exit",
      { symbol: "ETH", pnl: 5, duration: "3h" },
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("api.telegram.org");
    const body = JSON.parse(opts.body);
    expect(body).toHaveProperty("chat_id", "456");
    expect(body).toHaveProperty("text");
    expect(body.text).toContain("ETH");
  });

  it("sends generic webhook with JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await sendNotification(
      "https://my-api.example.com/webhook",
      "basis",
      { symbol: "SOL", divergencePct: 5 },
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("my-api.example.com");
    const body = JSON.parse(opts.body);
    expect(body).toHaveProperty("event", "basis");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("data");
  });

  it("does not throw on fetch failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    // Should not throw
    await sendNotification(
      "https://discord.com/api/webhooks/123/abc",
      "entry",
      { symbol: "BTC" },
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
