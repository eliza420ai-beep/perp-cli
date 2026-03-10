/**
 * Live Dashboard Server — HTTP + WebSocket for real-time portfolio monitoring.
 *
 * Polls all configured exchange adapters and pushes updates to connected clients.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { ExchangeAdapter, ExchangeBalance, ExchangePosition, ExchangeOrder, ExchangeMarketInfo } from "../exchanges/interface.js";
import { getUI } from "./ui.js";

export interface DashboardExchange {
  name: string;
  adapter: ExchangeAdapter;
}

export interface DashboardSnapshot {
  timestamp: string;
  exchanges: {
    name: string;
    balance: ExchangeBalance;
    positions: ExchangePosition[];
    orders: ExchangeOrder[];
    topMarkets: ExchangeMarketInfo[];
  }[];
  totals: {
    equity: number;
    available: number;
    marginUsed: number;
    unrealizedPnl: number;
    positionCount: number;
    orderCount: number;
  };
}

export interface DashboardOpts {
  port?: number;
  pollInterval?: number; // ms, default 5000
  signal?: AbortSignal;
}

/**
 * Find an available port starting from the given port.
 */
async function findPort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(startPort, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : startPort;
      srv.close(() => resolve(port));
    });
    srv.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(findPort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Poll all exchanges and return a unified snapshot.
 */
async function pollSnapshot(exchanges: DashboardExchange[]): Promise<DashboardSnapshot> {
  const results = await Promise.allSettled(
    exchanges.map(async (ex) => {
      const [balance, positions, orders, markets] = await Promise.all([
        ex.adapter.getBalance(),
        ex.adapter.getPositions(),
        ex.adapter.getOpenOrders(),
        ex.adapter.getMarkets().then((m) => m.slice(0, 10)).catch(() => [] as ExchangeMarketInfo[]),
      ]);
      return { name: ex.name, balance, positions, orders, topMarkets: markets };
    }),
  );

  const exchangeData = results
    .filter((r): r is PromiseFulfilledResult<DashboardSnapshot["exchanges"][0]> => r.status === "fulfilled")
    .map((r) => r.value);

  const totals = {
    equity: 0,
    available: 0,
    marginUsed: 0,
    unrealizedPnl: 0,
    positionCount: 0,
    orderCount: 0,
  };

  for (const ex of exchangeData) {
    totals.equity += Number(ex.balance.equity) || 0;
    totals.available += Number(ex.balance.available) || 0;
    totals.marginUsed += Number(ex.balance.marginUsed) || 0;
    totals.unrealizedPnl += Number(ex.balance.unrealizedPnl) || 0;
    totals.positionCount += ex.positions.length;
    totals.orderCount += ex.orders.length;
  }

  return { timestamp: new Date().toISOString(), exchanges: exchangeData, totals };
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(wss: WebSocketServer, data: unknown) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/**
 * Start the dashboard HTTP + WebSocket server.
 */
export async function startDashboard(
  exchanges: DashboardExchange[],
  opts: DashboardOpts = {},
): Promise<{ port: number; close: () => void }> {
  const pollInterval = opts.pollInterval ?? 5000;
  const requestedPort = opts.port ?? 3456;
  const port = await findPort(requestedPort);

  const html = getUI();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (req.url === "/api/snapshot") {
      pollSnapshot(exchanges).then((snap) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snap));
      }).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  const wss = new WebSocketServer({ server });

  // Send initial snapshot on connect
  wss.on("connection", async (ws) => {
    try {
      const snap = await pollSnapshot(exchanges);
      ws.send(JSON.stringify({ type: "snapshot", data: snap }));
    } catch {
      // ignore
    }
  });

  // Polling loop
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    pollTimer = setInterval(async () => {
      try {
        const snap = await pollSnapshot(exchanges);
        broadcast(wss, { type: "snapshot", data: snap });
      } catch {
        // ignore poll errors, will retry next interval
      }
    }, pollInterval);
  };

  // Handle abort signal
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      if (pollTimer) clearInterval(pollTimer);
      wss.close();
      server.close();
    }, { once: true });
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      startPolling();
      resolve({
        port,
        close: () => {
          if (pollTimer) clearInterval(pollTimer);
          wss.close();
          server.close();
        },
      });
    });
  });
}
