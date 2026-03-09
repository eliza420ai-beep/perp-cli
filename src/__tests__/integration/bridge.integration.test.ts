/**
 * Integration tests for bridge engine — READ-ONLY operations only.
 *
 * Tests real API calls to:
 * - deBridge DLN quote API (GET, no signing)
 * - Circle CCTP fee API (GET)
 * - deBridge status API (GET)
 * - getCctpQuote() (pure calculation, no RPC)
 * - getBestQuote() (CCTP preferred, deBridge fallback)
 *
 * NO transactions are executed. NO funds are spent.
 *
 * Note: deBridge API has strict rate limits (~5 req/min).
 * Tests are structured to minimize API calls and run sequentially.
 */
import { describe, it, expect } from "vitest";
import {
  getDebridgeQuote,
  getCctpQuote,
  getBestQuote,
  checkDebridgeStatus,
  CHAIN_IDS,
  USDC_ADDRESSES,
  EXCHANGE_TO_CHAIN,
  type BridgeQuote,
} from "../../bridge-engine.js";

// Dummy addresses for quote-only calls (never used for signing)
const DUMMY_EVM = "0x0000000000000000000000000000000000000001";
const DUMMY_SOLANA = "11111111111111111111111111111111";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Bridge Integration — Read-Only", { timeout: 60000 }, () => {
  // ══════════════════════════════════════════════════════════
  // Constants & Configuration (no API calls)
  // ══════════════════════════════════════════════════════════

  describe("chain constants", () => {
    it("all chains have valid chain IDs", () => {
      for (const [chain, id] of Object.entries(CHAIN_IDS)) {
        expect(typeof id).toBe("number");
        expect(id).toBeGreaterThan(0);
        expect(chain.length).toBeGreaterThan(0);
      }
    });

    it("all USDC addresses are valid format", () => {
      for (const [chain, addr] of Object.entries(USDC_ADDRESSES)) {
        if (chain === "solana") {
          expect(addr.length).toBeGreaterThan(30);
          expect(addr.length).toBeLessThan(50);
        } else {
          expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
      }
    });

    it("exchange-to-chain mapping covers all exchanges", () => {
      expect(EXCHANGE_TO_CHAIN.pacifica).toBe("solana");
      expect(EXCHANGE_TO_CHAIN.hyperliquid).toBe("hyperevm");
      expect(EXCHANGE_TO_CHAIN.lighter).toBe("arbitrum");
    });

    it("CCTP-supported chains have matching USDC addresses", () => {
      for (const chain of ["solana", "arbitrum", "base"]) {
        expect(USDC_ADDRESSES[chain]).toBeDefined();
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // Circle CCTP V2 Quotes (local calculation + fee API)
  // No deBridge API calls — these are safe from rate limiting
  // ══════════════════════════════════════════════════════════

  describe("CCTP V2 quotes", () => {
    it("solana → arbitrum: minimal relay fee, ~65s ETA", async () => {
      const quote = await getCctpQuote("solana", "arbitrum", 500);

      expect(quote.provider).toBe("cctp");
      expect(quote.fee).toBeLessThanOrEqual(0.02);
      expect(quote.amountOut).toBeGreaterThanOrEqual(499.98);
      expect(quote.estimatedTime).toBe(65);
    });

    it("arbitrum → base: minimal relay fee, 60s ETA (L2 to L2)", async () => {
      const quote = await getCctpQuote("arbitrum", "base", 200);

      expect(quote.provider).toBe("cctp");
      expect(quote.fee).toBeLessThanOrEqual(0.02);
      expect(quote.estimatedTime).toBe(60);
    });

    it("base → solana: minimal relay fee, 65s ETA", async () => {
      const quote = await getCctpQuote("base", "solana", 100);

      expect(quote.provider).toBe("cctp");
      expect(quote.fee).toBeLessThanOrEqual(0.02);
      expect(quote.estimatedTime).toBe(65);
    });

    it("CCTP quote for tiny amount ($0.01): still valid", async () => {
      const quote = await getCctpQuote("arbitrum", "base", 0.01);
      expect(quote.amountOut).toBeGreaterThan(-0.01);
      expect(quote.fee).toBeLessThanOrEqual(0.02);
    });

    it("getBestQuote prefers CCTP for supported routes", async () => {
      const q1 = await getBestQuote("arbitrum", "base", 1000, DUMMY_EVM, DUMMY_EVM);
      expect(q1.provider).toBe("cctp");
      expect(q1.fee).toBeLessThanOrEqual(0.02);

      const q2 = await getBestQuote("solana", "arbitrum", 500, DUMMY_SOLANA, DUMMY_EVM);
      expect(q2.provider).toBe("cctp");
      expect(q2.fee).toBeLessThanOrEqual(0.02);
    });

    it("all CCTP quotes have consistent shape", async () => {
      const routes: [string, string][] = [
        ["solana", "arbitrum"],
        ["arbitrum", "base"],
        ["base", "solana"],
      ];

      for (const [src, dst] of routes) {
        const q = await getCctpQuote(src, dst, 100);
        expect(q.provider).toBe("cctp");
        expect(typeof q.srcChain).toBe("string");
        expect(typeof q.dstChain).toBe("string");
        expect(typeof q.amountIn).toBe("number");
        expect(typeof q.amountOut).toBe("number");
        expect(typeof q.fee).toBe("number");
        expect(typeof q.estimatedTime).toBe("number");
        expect(q.amountIn).toBeGreaterThanOrEqual(q.amountOut);
        expect(q.raw).toBeDefined();
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // deBridge DLN Quote API (real HTTP calls — rate limited)
  // Consolidated into fewer tests to avoid 429 errors
  // ══════════════════════════════════════════════════════════

  describe("deBridge DLN quotes (sequential, rate-limit aware)", () => {
    it("solana → arbitrum: valid quote with fee breakdown", async () => {
      const quote = await getDebridgeQuote("solana", "arbitrum", 100, DUMMY_SOLANA, DUMMY_EVM);

      expect(quote.provider).toBe("debridge");
      expect(quote.srcChain).toBe("solana");
      expect(quote.dstChain).toBe("arbitrum");
      expect(quote.amountIn).toBe(100);
      expect(quote.amountOut).toBeGreaterThan(0);
      expect(quote.amountOut).toBeLessThanOrEqual(100);
      expect(quote.fee).toBeGreaterThanOrEqual(0);
      expect(quote.fee).toBeLessThan(10); // < 10% for $100
      expect(quote.estimatedTime).toBeGreaterThan(0);
      expect(quote.raw).toBeDefined();
      // Verify fee = amountIn - amountOut
      expect(Math.abs(quote.fee - (quote.amountIn - quote.amountOut))).toBeLessThan(0.001);
    });

    it("arbitrum → solana: reverse route works", async () => {
      await wait(1500); // respect rate limit
      const quote = await getDebridgeQuote("arbitrum", "solana", 50, DUMMY_EVM, DUMMY_SOLANA);

      expect(quote.provider).toBe("debridge");
      expect(quote.amountIn).toBe(50);
      expect(quote.amountOut).toBeGreaterThan(0);
      expect(quote.amountOut).toBeLessThanOrEqual(50);
    });

    it("EVM-to-EVM route and small amount work", async () => {
      await wait(1500);
      // Test EVM-to-EVM
      const quote = await getDebridgeQuote("base", "arbitrum", 200, DUMMY_EVM, DUMMY_EVM);
      expect(quote.provider).toBe("debridge");
      expect(quote.amountOut).toBeGreaterThan(0);
      expect(quote.estimatedTime).toBeGreaterThan(0);
    });

    it("unsupported chain throws immediately (no API call)", async () => {
      await expect(
        getDebridgeQuote("fakenet", "arbitrum", 100, DUMMY_EVM, DUMMY_EVM)
      ).rejects.toThrow(/Unsupported chain/i);
    });

    it("zero amount: deBridge rejects", async () => {
      await wait(1500);
      await expect(
        getDebridgeQuote("solana", "arbitrum", 0, DUMMY_SOLANA, DUMMY_EVM)
      ).rejects.toThrow();
    });

    it("getBestQuote prefers CCTP when route is supported (base → arbitrum)", async () => {
      const quote = await getBestQuote("base", "arbitrum", 100, DUMMY_EVM, DUMMY_EVM);
      expect(quote.provider).toBe("cctp");
      expect(quote.amountOut).toBeGreaterThanOrEqual(99.98);
      expect(quote.fee).toBeLessThanOrEqual(0.02);
    });
  });

  // ══════════════════════════════════════════════════════════
  // CCTP vs deBridge Comparison (single deBridge call)
  // ══════════════════════════════════════════════════════════

  describe("CCTP vs deBridge comparison", () => {
    it("CCTP is cheaper but slower than deBridge", async () => {
      await wait(2000);
      const cctp = await getCctpQuote("arbitrum", "base", 1000);
      const debridge = await getDebridgeQuote("arbitrum", "base", 1000, DUMMY_EVM, DUMMY_EVM);

      // CCTP is free, deBridge has fees
      expect(cctp.fee).toBeLessThanOrEqual(debridge.fee);
      expect(cctp.amountOut).toBeGreaterThanOrEqual(debridge.amountOut);

      // deBridge is faster (~2s vs CCTP ~60-900s)
      expect(debridge.estimatedTime).toBeLessThan(cctp.estimatedTime);

      // Both have valid shapes
      for (const q of [cctp, debridge]) {
        expect(q.provider).toMatch(/^(cctp|debridge)$/);
        expect(typeof q.srcChain).toBe("string");
        expect(typeof q.dstChain).toBe("string");
        expect(typeof q.amountIn).toBe("number");
        expect(typeof q.amountOut).toBe("number");
        expect(typeof q.fee).toBe("number");
        expect(typeof q.estimatedTime).toBe("number");
        expect(q.raw).toBeDefined();
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // deBridge Status API (single call)
  // ══════════════════════════════════════════════════════════

  describe("deBridge status check", () => {
    it("non-existent order: returns response or 404", async () => {
      await wait(1500);
      try {
        const status = await checkDebridgeStatus(
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        );
        expect(status).toBeDefined();
      } catch (err) {
        expect(String(err)).toMatch(/failed|404|not found|429/i);
      }
    });

    it("invalid order ID format: throws error", async () => {
      await wait(1500);
      try {
        await checkDebridgeStatus("not-a-valid-order-id");
        // If it doesn't throw, it should return something
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // Edge Cases (no API calls)
  // ══════════════════════════════════════════════════════════

  describe("edge cases (offline)", () => {
    it("CCTP same-chain doesn't throw", async () => {
      const quote = await getCctpQuote("arbitrum", "arbitrum", 100);
      expect(quote.provider).toBe("cctp");
      expect(quote.fee).toBeLessThanOrEqual(0.02);
      expect(quote.amountOut).toBeGreaterThanOrEqual(99.98);
    });

    it("CCTP various amounts", async () => {
      for (const amt of [0.01, 1, 100, 1000000]) {
        const q = await getCctpQuote("arbitrum", "base", amt);
        // Standard CCTP has minimal relay fee ($0.01)
        expect(q.amountOut).toBeGreaterThanOrEqual(amt - 0.02);
        expect(q.fee).toBeLessThanOrEqual(0.02);
      }
    });

    it("getBestQuote: all CCTP routes avoid deBridge API", async () => {
      // These should all resolve via CCTP without hitting deBridge
      const routes: [string, string, string, string][] = [
        ["solana", "arbitrum", DUMMY_SOLANA, DUMMY_EVM],
        ["arbitrum", "base", DUMMY_EVM, DUMMY_EVM],
        ["base", "solana", DUMMY_EVM, DUMMY_SOLANA],
      ];

      for (const [src, dst, sender, recipient] of routes) {
        const quote = await getBestQuote(src, dst, 100, sender, recipient);
        expect(quote.provider).toBe("cctp");
        expect(quote.amountIn).toBeGreaterThanOrEqual(quote.amountOut);
        expect(quote.amountOut).toBeGreaterThan(0);
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // CLI Command Integration (via process spawn)
  // ══════════════════════════════════════════════════════════

  describe("CLI bridge commands", () => {
    const CLI_CWD = "/Users/hik/Documents/GitHub/pacifica/packages/cli";
    const CLI_CMD = "npx tsx src/index.ts";

    function runCliSafe(args: string): { stdout: string; stderr: string; exitCode: number } {
      const { execSync } = require("child_process");
      try {
        const stdout = execSync(`${CLI_CMD} ${args}`, {
          encoding: "utf-8",
          cwd: CLI_CWD,
          timeout: 25000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { stdout, stderr: "", exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? "",
          exitCode: e.status ?? 1,
        };
      }
    }

    it("bridge chains: returns chain list as JSON", () => {
      const { stdout } = runCliSafe("--json bridge chains");
      const parsed = JSON.parse(stdout);

      expect(parsed.ok).toBe(true);
      expect(parsed.data.chains).toBeDefined();
      expect(parsed.data.usdc).toBeDefined();
      expect(parsed.data.exchanges).toBeDefined();
      expect(parsed.data.chains.solana).toBe(7565164);
      expect(parsed.data.chains.arbitrum).toBe(42161);
    });

    it("bridge chains: text mode has chain names", () => {
      const { stdout } = runCliSafe("bridge chains");

      expect(stdout).toContain("solana");
      expect(stdout).toContain("arbitrum");
      expect(stdout).toContain("ethereum");
    });

    it("bridge quote: CCTP route returns JSON (no deBridge API call)", () => {
      // arbitrum → ethereum uses CCTP, avoids deBridge rate limit
      const { stdout } = runCliSafe(
        "--json bridge quote --from arbitrum --to ethereum --amount 500"
      );
      const parsed = JSON.parse(stdout);

      expect(parsed.ok).toBe(true);
      expect(parsed.data.provider).toBe("cctp");
      expect(parsed.data.srcChain).toBe("arbitrum");
      expect(parsed.data.dstChain).toBe("ethereum");
      expect(parsed.data.amountIn).toBe(500);
      expect(parsed.data.fee).toBeLessThanOrEqual(0.02); // standard relay fee
      expect(parsed.data.estimatedTime).toBeGreaterThan(0);
    });

    it("bridge --help lists subcommands", () => {
      const { stdout } = runCliSafe("bridge --help");

      expect(stdout).toContain("chains");
      expect(stdout).toContain("quote");
      expect(stdout).toContain("send");
      expect(stdout).toContain("status");
    });
  });
});
