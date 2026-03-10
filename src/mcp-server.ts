#!/usr/bin/env node
/**
 * MCP (Model Context Protocol) server for perp-cli.
 *
 * Read-only advisor mode: provides market data, account info, and CLI command suggestions.
 * Does NOT execute trades directly — instead suggests CLI commands for the user to run.
 * Adapters are created lazily from environment variables.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ExchangeAdapter } from "./exchanges/interface.js";
import { loadPrivateKey, parseSolanaKeypair, type Exchange } from "./config.js";
import { PacificaAdapter } from "./exchanges/pacifica.js";
import { HyperliquidAdapter } from "./exchanges/hyperliquid.js";
import { LighterAdapter } from "./exchanges/lighter.js";
import {
  fetchPacificaPrices,
  fetchHyperliquidMeta,
  fetchLighterOrderBookDetails,
  pingPacifica,
  pingHyperliquid,
  pingLighter,
} from "./shared-api.js";
import { fetchAllFundingRates } from "./funding-rates.js";

// ── Adapter cache & factory ──

const adapters = new Map<string, ExchangeAdapter>();

async function getOrCreateAdapter(exchange: string): Promise<ExchangeAdapter> {
  const key = exchange.toLowerCase();
  if (adapters.has(key)) return adapters.get(key)!;

  const pk = await loadPrivateKey(key as Exchange);

  let adapter: ExchangeAdapter;
  switch (key) {
    case "pacifica": {
      const keypair = parseSolanaKeypair(pk);
      adapter = new PacificaAdapter(keypair);
      break;
    }
    case "hyperliquid": {
      const hl = new HyperliquidAdapter(pk);
      await hl.init();
      adapter = hl;
      break;
    }
    case "lighter": {
      const lt = new LighterAdapter(pk);
      await lt.init();
      adapter = lt;
      break;
    }
    default:
      throw new Error(`Unknown exchange: ${exchange}. Supported: pacifica, hyperliquid, lighter`);
  }

  adapters.set(key, adapter);
  return adapter;
}

// ── JSON envelope helpers ──

function ok(data: unknown, meta?: Record<string, unknown>) {
  return JSON.stringify({ ok: true, data, meta }, null, 2);
}

function err(error: string, meta?: Record<string, unknown>) {
  return JSON.stringify({ ok: false, error, meta }, null, 2);
}

// ── MCP Server ──

const server = new McpServer(
  { name: "perp-cli", version: "0.3.1" },
  { capabilities: { tools: {}, resources: {} } },
);

// ============================================================
// Market Data tools (read-only, no private key needed)
// ============================================================

server.tool(
  "get_markets",
  "Get all available perpetual futures markets on an exchange, including price, funding rate, volume, and max leverage",
  { exchange: z.string().describe("Exchange name: pacifica, hyperliquid, or lighter") },
  async ({ exchange }) => {
    try {
      const adapter = await getOrCreateAdapter(exchange);
      const markets = await adapter.getMarkets();
      return { content: [{ type: "text", text: ok(markets, { exchange, count: markets.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e), { exchange }) }], isError: true };
    }
  },
);

server.tool(
  "get_orderbook",
  "Get the order book (bids and asks) for a symbol on an exchange",
  {
    exchange: z.string().describe("Exchange name: pacifica, hyperliquid, or lighter"),
    symbol: z.string().describe("Trading pair symbol, e.g. BTC, ETH, SOL"),
  },
  async ({ exchange, symbol }) => {
    try {
      const adapter = await getOrCreateAdapter(exchange);
      const book = await adapter.getOrderbook(symbol);
      return { content: [{ type: "text", text: ok(book, { exchange, symbol }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e), { exchange, symbol }) }], isError: true };
    }
  },
);

server.tool(
  "get_funding_rates",
  "Compare funding rates across all 3 exchanges (Pacifica, Hyperliquid, Lighter). Returns rates per symbol with spread analysis",
  {
    symbols: z
      .array(z.string())
      .optional()
      .describe("Filter to specific symbols (e.g. ['BTC','ETH']). Omit for all available"),
    minSpread: z.number().optional().describe("Minimum annualized spread % to include (default: 0)"),
  },
  async ({ symbols, minSpread }) => {
    try {
      const snapshot = await fetchAllFundingRates({ symbols, minSpread });
      return {
        content: [{
          type: "text",
          text: ok(snapshot, { symbolCount: snapshot.symbols.length, exchangeStatus: snapshot.exchangeStatus }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

server.tool(
  "get_prices",
  "Get cross-exchange prices for symbols. Fetches mark prices from all 3 exchanges for comparison",
  {
    symbols: z
      .array(z.string())
      .optional()
      .describe("Symbols to fetch prices for (e.g. ['BTC','ETH']). Omit for top assets"),
  },
  async ({ symbols }) => {
    try {
      const [pacifica, hl, lighter] = await Promise.all([
        fetchPacificaPrices(),
        fetchHyperliquidMeta(),
        fetchLighterOrderBookDetails(),
      ]);

      const filter = symbols ? new Set(symbols.map(s => s.toUpperCase())) : null;

      // Build symbol → exchange prices map
      const priceMap = new Map<string, Record<string, number>>();
      for (const p of pacifica) {
        const sym = p.symbol.toUpperCase();
        if (filter && !filter.has(sym)) continue;
        if (!priceMap.has(sym)) priceMap.set(sym, {});
        priceMap.get(sym)!.pacifica = p.mark;
      }
      for (const a of hl) {
        const sym = a.symbol.toUpperCase();
        if (filter && !filter.has(sym)) continue;
        if (!priceMap.has(sym)) priceMap.set(sym, {});
        priceMap.get(sym)!.hyperliquid = a.markPx;
      }
      for (const m of lighter) {
        const sym = m.symbol.toUpperCase();
        if (filter && !filter.has(sym)) continue;
        if (!priceMap.has(sym)) priceMap.set(sym, {});
        priceMap.get(sym)!.lighter = m.lastTradePrice;
      }

      const data = Array.from(priceMap.entries()).map(([symbol, prices]) => ({ symbol, prices }));
      return { content: [{ type: "text", text: ok(data, { count: data.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

// ============================================================
// Account tools (need private key)
// ============================================================

server.tool(
  "get_balance",
  "Get account balance (equity, available margin, margin used, unrealized PnL) on an exchange",
  { exchange: z.string().describe("Exchange name: pacifica, hyperliquid, or lighter") },
  async ({ exchange }) => {
    try {
      const adapter = await getOrCreateAdapter(exchange);
      const balance = await adapter.getBalance();
      return { content: [{ type: "text", text: ok(balance, { exchange }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e), { exchange }) }], isError: true };
    }
  },
);

server.tool(
  "get_positions",
  "Get all open positions on an exchange, including size, entry price, PnL, leverage",
  { exchange: z.string().describe("Exchange name: pacifica, hyperliquid, or lighter") },
  async ({ exchange }) => {
    try {
      const adapter = await getOrCreateAdapter(exchange);
      const positions = await adapter.getPositions();
      return { content: [{ type: "text", text: ok(positions, { exchange, count: positions.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e), { exchange }) }], isError: true };
    }
  },
);

server.tool(
  "get_open_orders",
  "Get all open/pending orders on an exchange",
  { exchange: z.string().describe("Exchange name: pacifica, hyperliquid, or lighter") },
  async ({ exchange }) => {
    try {
      const adapter = await getOrCreateAdapter(exchange);
      const orders = await adapter.getOpenOrders();
      return { content: [{ type: "text", text: ok(orders, { exchange, count: orders.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e), { exchange }) }], isError: true };
    }
  },
);

server.tool(
  "portfolio",
  "Cross-exchange portfolio summary: balances, positions, and risk metrics across all exchanges",
  {},
  async () => {
    const EXCHANGES = ["pacifica", "hyperliquid", "lighter"] as const;

    interface ExchangeSnapshot {
      exchange: string;
      connected: boolean;
      balance: { equity: string; available: string; marginUsed: string; unrealizedPnl: string } | null;
      positions: Awaited<ReturnType<ExchangeAdapter["getPositions"]>>;
      openOrders: number;
      error?: string;
    }

    const snapshots: ExchangeSnapshot[] = await Promise.all(
      EXCHANGES.map(async (name) => {
        try {
          const adapter = await getOrCreateAdapter(name);
          const [balance, positions, orders] = await Promise.all([
            adapter.getBalance(),
            adapter.getPositions(),
            adapter.getOpenOrders(),
          ]);
          return { exchange: name, connected: true, balance, positions, openOrders: orders.length };
        } catch (e) {
          return {
            exchange: name,
            connected: false,
            balance: null,
            positions: [],
            openOrders: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    let totalEquity = 0;
    let totalAvailable = 0;
    let totalMarginUsed = 0;
    let totalUnrealizedPnl = 0;
    let totalPositions = 0;
    let totalOpenOrders = 0;
    const allPositions: (Awaited<ReturnType<ExchangeAdapter["getPositions"]>>[number] & { exchange: string })[] = [];

    for (const snap of snapshots) {
      if (snap.balance) {
        totalEquity += Number(snap.balance.equity);
        totalAvailable += Number(snap.balance.available);
        totalMarginUsed += Number(snap.balance.marginUsed);
        totalUnrealizedPnl += Number(snap.balance.unrealizedPnl);
      }
      totalPositions += snap.positions.length;
      totalOpenOrders += snap.openOrders;
      for (const pos of snap.positions) {
        allPositions.push({ ...pos, exchange: snap.exchange });
      }
    }

    const marginUtilization = totalEquity > 0 ? (totalMarginUsed / totalEquity) * 100 : 0;

    let largestPosition: { symbol: string; exchange: string; notional: number } | null = null;
    for (const pos of allPositions) {
      const notional = Math.abs(Number(pos.size) * Number(pos.markPrice));
      if (!largestPosition || notional > largestPosition.notional) {
        largestPosition = { symbol: pos.symbol, exchange: pos.exchange, notional };
      }
    }

    const exchangeConcentration = snapshots
      .filter(s => s.balance && Number(s.balance.equity) > 0)
      .map(s => ({
        exchange: s.exchange,
        pct: totalEquity > 0 ? (Number(s.balance!.equity) / totalEquity) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

    const summary = {
      totalEquity,
      totalAvailable,
      totalMarginUsed,
      totalUnrealizedPnl,
      totalPositions,
      totalOpenOrders,
      exchanges: snapshots,
      positions: allPositions,
      riskMetrics: { marginUtilization, largestPosition, exchangeConcentration },
    };

    return { content: [{ type: "text", text: ok(summary) }] };
  },
);

// ============================================================
// Advisory tools (suggest CLI commands, do NOT execute trades)
// ============================================================

server.tool(
  "suggest_command",
  "Given a natural language trading goal, suggest the exact perp CLI commands to run. Does NOT execute anything — only returns commands for the user to review and run manually",
  {
    goal: z.string().describe("Natural language goal, e.g. 'buy 0.1 BTC on pacifica', 'close all positions', 'check funding arb opportunities'"),
    exchange: z.string().optional().describe("Preferred exchange (default: pacifica). Options: pacifica, hyperliquid, lighter"),
  },
  async ({ goal, exchange }) => {
    try {
      const ex = exchange ?? "pacifica";
      const g = goal.toLowerCase();
      const steps: { step: number; command: string; description: string; dangerous?: boolean }[] = [];

      if (g.includes("buy") || g.includes("long")) {
        const symbol = extractSymbol(g) || "BTC";
        const size = extractNumber(g) || "<size>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json market book ${symbol}`, description: `Check ${symbol} orderbook and liquidity` },
          { step: 2, command: `perp -e ${ex} --json account info`, description: "Check available balance and margin" },
          { step: 3, command: `perp -e ${ex} --json trade check ${symbol} buy ${size}`, description: "Pre-flight validation (dry run)" },
          { step: 4, command: `perp -e ${ex} --json trade market ${symbol} buy ${size}`, description: `Buy ${size} ${symbol} at market`, dangerous: true },
          { step: 5, command: `perp -e ${ex} --json account positions`, description: "Verify position opened" },
        );
      } else if (g.includes("sell") || g.includes("short")) {
        const symbol = extractSymbol(g) || "BTC";
        const size = extractNumber(g) || "<size>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json market book ${symbol}`, description: `Check ${symbol} orderbook and liquidity` },
          { step: 2, command: `perp -e ${ex} --json account info`, description: "Check available balance and margin" },
          { step: 3, command: `perp -e ${ex} --json trade check ${symbol} sell ${size}`, description: "Pre-flight validation (dry run)" },
          { step: 4, command: `perp -e ${ex} --json trade market ${symbol} sell ${size}`, description: `Sell ${size} ${symbol} at market`, dangerous: true },
          { step: 5, command: `perp -e ${ex} --json account positions`, description: "Verify position opened" },
        );
      } else if (g.includes("limit")) {
        const symbol = extractSymbol(g) || "BTC";
        const size = extractNumber(g) || "<size>";
        const side = g.includes("sell") || g.includes("short") ? "sell" : "buy";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json market book ${symbol}`, description: `Check ${symbol} orderbook for price levels` },
          { step: 2, command: `perp -e ${ex} --json account info`, description: "Check available balance" },
          { step: 3, command: `perp -e ${ex} --json trade limit ${symbol} ${side} <price> ${size}`, description: `Place limit ${side} order`, dangerous: true },
          { step: 4, command: `perp -e ${ex} --json account orders`, description: "Verify order placed" },
        );
      } else if (g.includes("close") || g.includes("exit")) {
        const symbol = extractSymbol(g);
        steps.push(
          { step: 1, command: `perp -e ${ex} --json account positions`, description: "Get current positions" },
          { step: 2, command: `perp -e ${ex} --json trade cancel-all`, description: "Cancel any open orders first", dangerous: true },
        );
        if (symbol) {
          steps.push(
            { step: 3, command: `perp -e ${ex} --json trade close ${symbol}`, description: `Close ${symbol} position at market`, dangerous: true },
          );
        } else {
          steps.push(
            { step: 3, command: `perp -e ${ex} --json trade close-all`, description: "Close all positions at market", dangerous: true },
          );
        }
      } else if (g.includes("tp") || g.includes("take profit") || g.includes("scale")) {
        const symbol = extractSymbol(g) || "<symbol>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json account positions`, description: "Check current position size and entry" },
          { step: 2, command: `perp -e ${ex} --json market book ${symbol}`, description: "Check current prices" },
          { step: 3, command: `perp -e ${ex} --json trade scale-tp ${symbol} --levels '<price1>:25%,<price2>:50%,<price3>:25%'`, description: "Place scaled take-profit orders", dangerous: true },
        );
      } else if (g.includes("stop") || g.includes("sl") || g.includes("stop loss")) {
        const symbol = extractSymbol(g) || "<symbol>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json account positions`, description: "Check current position" },
          { step: 2, command: `perp -e ${ex} --json trade stop ${symbol} <side> <stopPrice> <size>`, description: "Place stop order", dangerous: true },
        );
      } else if (g.includes("arb") || g.includes("arbitrage") || g.includes("funding")) {
        steps.push(
          { step: 1, command: "perp --json arb rates", description: "Compare funding rates across exchanges" },
          { step: 2, command: "perp --json arb scan", description: "Find high-spread opportunities" },
          { step: 3, command: "perp --json gap show", description: "Check cross-exchange price gaps" },
        );
      } else if (g.includes("status") || g.includes("check") || g.includes("overview") || g.includes("portfolio")) {
        steps.push(
          { step: 1, command: `perp -e ${ex} --json status`, description: "Full account overview" },
          { step: 2, command: `perp -e ${ex} --json account positions`, description: "Detailed positions" },
          { step: 3, command: `perp -e ${ex} --json account orders`, description: "Open orders" },
          { step: 4, command: "perp --json portfolio", description: "Cross-exchange portfolio summary" },
        );
      } else if (g.includes("deposit")) {
        const amount = extractNumber(g) || "<amount>";
        steps.push(
          { step: 1, command: "perp --json wallet balance", description: "Check wallet balance" },
          { step: 2, command: `perp --json deposit ${ex} ${amount}`, description: `Deposit $${amount} to ${ex}`, dangerous: true },
          { step: 3, command: `perp -e ${ex} --json account info`, description: "Verify deposit arrived" },
        );
      } else if (g.includes("withdraw")) {
        const amount = extractNumber(g) || "<amount>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json account info`, description: "Check available balance" },
          { step: 2, command: `perp --json withdraw ${ex} ${amount}`, description: `Withdraw $${amount} from ${ex}`, dangerous: true },
          { step: 3, command: "perp --json wallet balance", description: "Verify withdrawal received" },
        );
      } else if (g.includes("leverage")) {
        const symbol = extractSymbol(g) || "<symbol>";
        const lev = extractNumber(g) || "<leverage>";
        steps.push(
          { step: 1, command: `perp -e ${ex} --json risk status`, description: "Check current risk and leverage" },
          { step: 2, command: `perp -e ${ex} --json trade leverage ${symbol} ${lev}`, description: `Set ${symbol} leverage to ${lev}x`, dangerous: true },
        );
      } else if (g.includes("cancel")) {
        const symbol = extractSymbol(g);
        if (symbol) {
          steps.push(
            { step: 1, command: `perp -e ${ex} --json account orders`, description: "List open orders" },
            { step: 2, command: `perp -e ${ex} --json trade cancel ${symbol} <orderId>`, description: `Cancel order for ${symbol}`, dangerous: true },
          );
        } else {
          steps.push(
            { step: 1, command: `perp -e ${ex} --json account orders`, description: "List open orders" },
            { step: 2, command: `perp -e ${ex} --json trade cancel-all`, description: "Cancel all open orders", dangerous: true },
          );
        }
      } else if (g.includes("price") || g.includes("market")) {
        const symbol = extractSymbol(g);
        if (symbol) {
          steps.push(
            { step: 1, command: `perp -e ${ex} --json market book ${symbol}`, description: `${symbol} orderbook` },
            { step: 2, command: `perp -e ${ex} --json market funding ${symbol}`, description: `${symbol} funding history` },
            { step: 3, command: `perp -e ${ex} --json market kline ${symbol} 1h`, description: `${symbol} hourly candles` },
          );
        } else {
          steps.push(
            { step: 1, command: "perp --json market prices", description: "All market prices" },
            { step: 2, command: "perp --json gap show", description: "Cross-exchange price gaps" },
          );
        }
      } else {
        steps.push(
          { step: 1, command: "perp agent capabilities", description: "List all available CLI capabilities" },
          { step: 2, command: `perp -e ${ex} --json status`, description: "Check account status" },
          { step: 3, command: "perp --json health", description: "Check exchange connectivity" },
        );
      }

      return {
        content: [{
          type: "text",
          text: ok({
            goal,
            exchange: ex,
            steps,
            notes: [
              "Commands marked dangerous:true modify account state — review carefully before running",
              "All commands include --json for structured output",
              "Adjust exchange with -e <exchange> flag",
              "Use 'perp trade check' for pre-flight validation before executing trades",
              "Run commands in your terminal — this MCP server does NOT execute them",
            ],
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

server.tool(
  "explain_command",
  "Explain what a perp CLI command does, its parameters, and any risks. Helps the user understand a command before running it",
  {
    command: z.string().describe("The CLI command to explain, e.g. 'perp trade market BTC buy 0.1' or 'perp arb scan'"),
  },
  async ({ command }) => {
    try {
      const parts = command.replace(/^perp\s+/, "").split(/\s+/);
      const flags: string[] = [];
      const args: string[] = [];
      for (const p of parts) {
        if (p.startsWith("-")) flags.push(p);
        else args.push(p);
      }

      const category = args[0] ?? "";
      const sub = args[1] ?? "";

      interface Explanation {
        command: string;
        description: string;
        parameters: { name: string; value?: string; description: string }[];
        risks: string[];
        category: "read" | "write" | "analysis";
        relatedCommands: string[];
      }

      let explanation: Explanation;

      if (category === "trade" && (sub === "market" || sub === "limit")) {
        const symbol = args[2] || "<symbol>";
        const side = args[3] || "<side>";
        const sizeOrPrice = args[4] || "";
        const isLimit = sub === "limit";
        explanation = {
          command,
          description: isLimit
            ? `Places a limit ${side} order for ${symbol}. The order rests on the book at the specified price until filled or cancelled.`
            : `Places a market ${side} order for ${symbol}. Executes immediately at the best available price.`,
          parameters: [
            { name: "symbol", value: symbol, description: "Trading pair (e.g. BTC, ETH, SOL)" },
            { name: "side", value: side, description: "buy = open/increase long, sell = open/increase short" },
            ...(isLimit
              ? [
                  { name: "price", value: sizeOrPrice, description: "Limit price in USD" },
                  { name: "size", value: args[5] || "<size>", description: "Order size in base asset units" },
                ]
              : [{ name: "size", value: sizeOrPrice, description: "Order size in base asset units" }]),
          ],
          risks: [
            "This EXECUTES a real trade and uses real funds",
            isLimit ? "Limit orders may not fill if price doesn't reach the level" : "Market orders may experience slippage in low liquidity",
            "Use 'perp trade check' first for pre-flight validation",
          ],
          category: "write",
          relatedCommands: [
            `perp trade check ${symbol} ${side} ${sizeOrPrice || "<size>"}`,
            `perp market book ${symbol}`,
            `perp account info`,
          ],
        };
      } else if (category === "trade" && sub === "close") {
        explanation = {
          command,
          description: `Closes the position for ${args[2] || "the specified symbol"} by placing a market order in the opposite direction.`,
          parameters: [{ name: "symbol", value: args[2] || "<symbol>", description: "Symbol of the position to close" }],
          risks: ["Executes a market order — subject to slippage", "Closes the entire position size"],
          category: "write",
          relatedCommands: ["perp account positions", "perp trade cancel-all"],
        };
      } else if (category === "trade" && (sub === "cancel" || sub === "cancel-all")) {
        explanation = {
          command,
          description: sub === "cancel-all" ? "Cancels all open orders on the current exchange" : `Cancels a specific order by ID`,
          parameters: sub === "cancel-all" ? [] : [
            { name: "symbol", value: args[2], description: "Trading pair of the order" },
            { name: "orderId", value: args[3], description: "Order ID to cancel" },
          ],
          risks: ["Open orders will be removed and won't execute"],
          category: "write",
          relatedCommands: ["perp account orders"],
        };
      } else if (category === "trade" && sub === "stop") {
        explanation = {
          command,
          description: "Places a stop order that triggers when the mark price reaches the stop price",
          parameters: [
            { name: "symbol", value: args[2], description: "Trading pair" },
            { name: "side", value: args[3], description: "buy or sell" },
            { name: "stopPrice", value: args[4], description: "Trigger price" },
            { name: "size", value: args[5], description: "Order size" },
          ],
          risks: ["Stop orders become market orders when triggered — slippage possible", "Stop may not fill in fast markets"],
          category: "write",
          relatedCommands: ["perp account positions", "perp trade tpsl"],
        };
      } else if (category === "market") {
        explanation = {
          command,
          description: {
            list: "Lists all available markets with price, funding rate, volume, and max leverage",
            book: `Shows the order book (bids/asks) for ${args[2] || "a symbol"}`,
            prices: "Shows mark prices across exchanges for comparison",
            funding: `Shows funding rate history for ${args[2] || "a symbol"}`,
            trades: `Shows recent trades for ${args[2] || "a symbol"}`,
            kline: `Shows OHLCV candle data for ${args[2] || "a symbol"}`,
          }[sub] || `Market data command: ${sub}`,
          parameters: args.slice(2).map((a, i) => ({ name: `arg${i}`, value: a, description: "See perp market --help" })),
          risks: [],
          category: "read",
          relatedCommands: ["perp market list", "perp market prices"],
        };
      } else if (category === "account") {
        explanation = {
          command,
          description: {
            info: "Shows account balance: equity, available margin, margin used, unrealized PnL",
            positions: "Lists all open positions with size, entry price, mark price, PnL, leverage",
            orders: "Lists all pending/open orders",
            history: "Shows order history (filled, cancelled, etc.)",
            trades: "Shows trade execution history with prices and fees",
          }[sub] || `Account data command: ${sub}`,
          parameters: [],
          risks: [],
          category: "read",
          relatedCommands: ["perp status", "perp portfolio"],
        };
      } else if (category === "arb") {
        explanation = {
          command,
          description: {
            rates: "Compares funding rates across all 3 exchanges",
            scan: "Scans for funding rate arbitrage opportunities with the largest spreads",
          }[sub] || `Arbitrage analysis: ${sub}`,
          parameters: [],
          risks: [],
          category: "analysis",
          relatedCommands: ["perp arb rates", "perp arb scan", "perp gap show"],
        };
      } else {
        explanation = {
          command,
          description: `CLI command: ${command}. Run 'perp ${category} --help' for detailed usage.`,
          parameters: args.slice(1).map((a, i) => ({ name: `arg${i}`, value: a, description: "See --help for details" })),
          risks: category === "trade" || category === "deposit" || category === "withdraw"
            ? ["This command may modify account state — review carefully"]
            : [],
          category: (category === "trade" || category === "deposit" || category === "withdraw") ? "write" : "read",
          relatedCommands: ["perp agent capabilities", "perp schema"],
        };
      }

      return { content: [{ type: "text", text: ok(explanation) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

// ── Helper functions for suggest_command ──

function extractSymbol(text: string): string | null {
  const symbols = [
    "BTC", "ETH", "SOL", "ARB", "DOGE", "WIF", "JTO", "PYTH", "JUP",
    "ONDO", "SUI", "APT", "AVAX", "LINK", "OP", "MATIC", "NEAR",
    "AAVE", "UNI", "TIA", "SEI", "INJ", "FET", "RENDER", "PEPE",
  ];
  const upper = text.toUpperCase();
  for (const s of symbols) {
    if (upper.includes(s)) return s;
  }
  return null;
}

function extractNumber(text: string): string | null {
  const match = text.match(/(\d+\.?\d*)/);
  return match ? match[1] : null;
}

// ============================================================
// Analysis tools
// ============================================================

server.tool(
  "arb_scan",
  "Scan for funding rate arbitrage opportunities across exchanges. Finds symbols with the largest funding rate spreads",
  {
    minSpread: z.number().optional().describe("Minimum annualized spread % to show (default: 5)"),
    symbols: z
      .array(z.string())
      .optional()
      .describe("Filter to specific symbols. Omit for all"),
  },
  async ({ minSpread, symbols }) => {
    try {
      const snapshot = await fetchAllFundingRates({
        symbols,
        minSpread: minSpread ?? 5,
      });

      const opportunities = snapshot.symbols.map(s => ({
        symbol: s.symbol,
        maxSpreadAnnual: `${s.maxSpreadAnnual.toFixed(2)}%`,
        strategy: `Long ${s.longExchange} / Short ${s.shortExchange}`,
        estHourlyIncomePerK: `$${s.estHourlyIncomeUsd.toFixed(4)}`,
        rates: s.rates.map(r => ({
          exchange: r.exchange,
          hourlyRate: r.hourlyRate.toFixed(8),
          annualized: `${r.annualizedPct.toFixed(2)}%`,
        })),
      }));

      return {
        content: [{
          type: "text",
          text: ok(opportunities, {
            count: opportunities.length,
            exchangeStatus: snapshot.exchangeStatus,
            timestamp: snapshot.timestamp,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

server.tool(
  "health_check",
  "Ping all exchanges and return connectivity status and latency",
  {},
  async () => {
    try {
      const [pacifica, hyperliquid, lighter] = await Promise.all([
        pingPacifica(),
        pingHyperliquid(),
        pingLighter(),
      ]);

      const result = {
        pacifica: { ...pacifica, statusText: pacifica.ok ? "healthy" : "unreachable" },
        hyperliquid: { ...hyperliquid, statusText: hyperliquid.ok ? "healthy" : "unreachable" },
        lighter: { ...lighter, statusText: lighter.ok ? "healthy" : "unreachable" },
        allHealthy: pacifica.ok && hyperliquid.ok && lighter.ok,
      };

      return { content: [{ type: "text", text: ok(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: err(e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  },
);

// ============================================================
// Resources (CLI schema for agent discovery)
// ============================================================

server.resource(
  "cli_schema",
  "perp://schema",
  { mimeType: "application/json", description: "Full CLI command schema — all commands, args, options, exchanges, and error codes" },
  async () => {
    const schema = {
      schemaVersion: "2.0",
      name: "perp",
      description: "Multi-DEX Perpetual Futures CLI (Pacifica, Hyperliquid, Lighter)",
      exchanges: ["pacifica", "hyperliquid", "lighter"],
      globalFlags: [
        { flag: "-e, --exchange <name>", description: "Exchange to use (pacifica, hyperliquid, lighter)", default: "pacifica" },
        { flag: "--json", description: "Output as JSON for structured parsing" },
        { flag: "-n, --network <net>", description: "Network: mainnet or testnet", default: "mainnet" },
        { flag: "--dry-run", description: "Simulate without executing (for trade commands)" },
      ],
      commands: {
        market: {
          description: "Market data commands",
          subcommands: {
            list: { usage: "perp market list", description: "List all markets with prices, funding, volume" },
            book: { usage: "perp market book <symbol>", description: "Orderbook for a symbol" },
            prices: { usage: "perp market prices", description: "Cross-exchange price comparison" },
            funding: { usage: "perp market funding <symbol>", description: "Funding rate history" },
            trades: { usage: "perp market trades <symbol>", description: "Recent trades" },
            kline: { usage: "perp market kline <symbol> <interval>", description: "OHLCV candles (intervals: 1m,5m,15m,1h,4h,1d)" },
            mid: { usage: "perp market mid <symbol>", description: "Mid price (fast)" },
          },
        },
        account: {
          description: "Account data commands",
          subcommands: {
            info: { usage: "perp account info", description: "Balance, equity, margin, PnL" },
            positions: { usage: "perp account positions", description: "Open positions" },
            orders: { usage: "perp account orders", description: "Open/pending orders" },
            history: { usage: "perp account history", description: "Order history" },
            trades: { usage: "perp account trades", description: "Trade history" },
          },
        },
        trade: {
          description: "Trading commands (execute in your terminal)",
          subcommands: {
            market: { usage: "perp trade market <symbol> <buy|sell> <size>", description: "Market order" },
            limit: { usage: "perp trade limit <symbol> <buy|sell> <price> <size>", description: "Limit order" },
            stop: { usage: "perp trade stop <symbol> <side> <stopPrice> <size>", description: "Stop order" },
            close: { usage: "perp trade close <symbol>", description: "Close position at market" },
            "close-all": { usage: "perp trade close-all", description: "Close all positions" },
            cancel: { usage: "perp trade cancel <symbol> <orderId>", description: "Cancel order" },
            "cancel-all": { usage: "perp trade cancel-all", description: "Cancel all orders" },
            check: { usage: "perp trade check <symbol> <side> <size>", description: "Pre-flight validation" },
            reduce: { usage: "perp trade reduce <symbol> <percent>", description: "Reduce position by %" },
            "scale-tp": { usage: "perp trade scale-tp <symbol> --levels '<p1>:<pct>,...'", description: "Scaled take-profit" },
            "scale-in": { usage: "perp trade scale-in <symbol> <side> --levels '<p1>:<size>,...'", description: "Scaled entry" },
            tpsl: { usage: "perp trade tpsl <symbol> <side> --tp <price> --sl <price>", description: "TP/SL bracket" },
            twap: { usage: "perp trade twap <symbol> <side> <size> <duration>", description: "TWAP execution" },
            leverage: { usage: "perp trade leverage <symbol> <n>", description: "Set leverage" },
          },
        },
        arb: {
          description: "Arbitrage analysis",
          subcommands: {
            rates: { usage: "perp arb rates", description: "Compare funding rates" },
            scan: { usage: "perp arb scan", description: "Find arb opportunities" },
          },
        },
        risk: {
          description: "Risk management",
          subcommands: {
            status: { usage: "perp risk status", description: "Portfolio risk overview" },
            limits: { usage: "perp risk limits", description: "Position limits" },
            check: { usage: "perp risk check --notional <usd> --leverage <n>", description: "Pre-trade risk check" },
          },
        },
        portfolio: { usage: "perp portfolio", description: "Cross-exchange portfolio summary" },
        status: { usage: "perp status", description: "Full account overview" },
        health: { usage: "perp health", description: "Exchange connectivity check" },
        deposit: { usage: "perp deposit <exchange> <amount>", description: "Deposit USDC to exchange" },
        withdraw: { usage: "perp withdraw <exchange> <amount>", description: "Withdraw USDC from exchange" },
        bridge: { usage: "perp bridge <amount> --from <chain> --to <chain>", description: "Cross-chain bridge" },
      },
      tips: [
        "Always use --json for structured output when automating",
        "Use 'perp trade check' before executing trades for validation",
        "Use --dry-run to simulate trade commands",
        "Numbers are strings to avoid float precision loss",
      ],
    };

    return { contents: [{ uri: "perp://schema", text: JSON.stringify(schema, null, 2), mimeType: "application/json" }] };
  },
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running and listening on stdio
}

main().catch((e) => {
  console.error("Fatal: MCP server failed to start:", e);
  process.exit(1);
});
