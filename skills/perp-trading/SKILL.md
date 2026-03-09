---
name: perp-trading
description: Multi-DEX perpetual futures trading agent for Pacifica, Hyperliquid, and Lighter. Execute trades, manage positions, scan funding rate arbitrage, bridge USDC cross-chain, and monitor portfolios across 3 exchanges via perp-cli. Use when the user wants to trade perps, check balances, bridge funds, or run arbitrage strategies.
license: MIT
compatibility: Requires Node.js 20+, perp-cli installed (npm install -g perp-cli or clone repo), and exchange API keys configured in .env
metadata:
  author: hypurrquant
  version: "0.1.0"
---

# Perpetual Futures Trading Agent

Trade, bridge, arbitrage, and manage positions across 3 DEX exchanges from a single CLI.

## Setup

```bash
# Option A: Global install
npm install -g perp-cli

# Option B: From source
git clone https://github.com/hypurrquant/perp-cli.git
cd perp-cli && pnpm install
# Run with: npx tsx src/index.ts [args]
```

Configure exchange keys in `.env`:
```bash
PRIVATE_KEY=<solana-base58>           # Pacifica
HL_PRIVATE_KEY=<evm-hex>             # Hyperliquid
LIGHTER_PRIVATE_KEY=<evm-hex-32b>    # Lighter
LIGHTER_API_KEY=<40-byte>            # Lighter API
```

## Core Rules

### 1. Always use --json
Every command MUST include `--json` for structured, parseable output.

```bash
perp --json -e hyperliquid account info    # correct
perp -e hyperliquid account info           # wrong - human-readable only
```

### 2. Response envelope
```json
{ "ok": true,  "data": { ... }, "meta": { "timestamp": "..." } }
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "...", "retryable": true }, "meta": { "timestamp": "..." } }
```

### 3. Pre-trade checklist (MANDATORY before any buy/sell/close)
1. `account info` — verify balance
2. `market mid <SYMBOL>` — check current price
3. `market info <SYMBOL>` — check tick size, min order, max leverage
4. Show order details to user and get confirmation
5. Execute trade
6. `account positions` — verify result

### 4. Error handling
- `retryable: true` (RATE_LIMITED, EXCHANGE_UNREACHABLE, TIMEOUT, PRICE_STALE) — wait 5s, retry once
- `retryable: false` (INSUFFICIENT_BALANCE, RISK_VIOLATION, SIGNATURE_FAILED) — report to user, do NOT retry

### 5. Safety guardrails
- NEVER execute trades without user confirmation
- Warn if single trade exceeds 50% of balance
- Warn if leverage exceeds 10x
- Double-confirm bridge transfers over $1000
- Pause and suggest strategy review after 3 consecutive losses

## Exchange Selection

```bash
perp --json -e pacifica ...       # Pacifica (Solana) — default
perp --json -e hyperliquid ...    # Hyperliquid (HyperEVM)
perp --json -e lighter ...        # Lighter (Ethereum)
```

## Command Reference

### Market Data (read-only, safe)
```bash
perp --json market list                          # all markets
perp --json market mid <SYMBOL>                  # mid price
perp --json market info <SYMBOL>                 # details (tick size, max leverage)
perp --json market book <SYMBOL>                 # orderbook
perp --json market funding <SYMBOL>              # funding rate
```

### Account (read-only, safe)
```bash
perp --json account info                         # balance & margin
perp --json account positions                    # open positions
perp --json account orders                       # open orders
perp --json account history                      # trade history
perp --json account margin <SYMBOL>              # position margin info
```

### Trading (requires user confirmation)
```bash
perp --json trade buy <SYMBOL> <SIZE>            # market buy
perp --json trade sell <SYMBOL> <SIZE>           # market sell
perp --json trade buy <SYMBOL> <SIZE> -p <PRICE> # limit buy
perp --json trade sell <SYMBOL> <SIZE> -p <PRICE># limit sell
perp --json trade close <SYMBOL>                 # close position
perp --json trade cancel <ORDER_ID>              # cancel order
perp --json trade tp <SYMBOL> <PRICE>            # take-profit
perp --json trade sl <SYMBOL> <PRICE>            # stop-loss
```

### Position Management
```bash
perp --json manage leverage <SYMBOL> <MULT>      # set leverage
perp --json manage margin-mode <SYMBOL> cross    # cross/isolated
perp --json manage deposit <EXCHANGE> <AMOUNT>   # deposit USDC
perp --json manage withdraw <EXCHANGE> <AMOUNT>  # withdraw USDC
```

### Bridge (CCTP V2, $0 fee)
```bash
perp --json bridge chains                        # supported chains
perp --json bridge quote --from <SRC> --to <DST> --amount <AMT>
perp --json bridge send --from <SRC> --to <DST> --amount <AMT>
perp --json bridge exchange --from <EX1> --to <EX2> --amount <AMT>
perp --json bridge status <ORDER_ID>
```
Routes: Solana <-> Arbitrum <-> Base (all 6 directions, $0 CCTP fee)

### Arbitrage
```bash
perp --json arb rates                            # compare funding rates
perp --json arb scan --min <BPS>                 # scan opportunities (>N bps)
perp --json arb auto --min-spread <BPS>          # auto-execute arb daemon
```

### Cross-Exchange Tools
```bash
perp --json gap show                             # price gaps between exchanges
perp --json gap watch --min <PCT>                # live gap monitor
perp --json portfolio                            # unified portfolio view
perp --json risk overview                        # cross-exchange risk
perp --json analytics pnl                        # P&L analytics
perp --json analytics funding --limit <N>        # funding history
perp --json analytics report --exchange <EX> --since <PERIOD>
```

### Status & Discovery
```bash
perp --json status                               # account + positions + orders
perp --json schema                               # full CLI schema (agent discovery)
perp --json api-spec                             # API spec
```

### Automated Strategies
```bash
perp --json run grid <SYMBOL> --range <PCT> --grids <N> --size <USD>
perp --json run dca <SYMBOL> --interval <TIME> --size <USD> --side buy|sell
perp --json run arb --min-spread <BPS>
perp --json jobs list                            # running jobs
perp --json jobs stop <ID>                       # stop job
```

### Composite Plans
```bash
perp --json plan example                         # example plan JSON
perp --json plan validate <FILE>                 # validate plan
perp --json plan execute <FILE>                  # execute multi-step plan
perp --json plan execute <FILE> --dry-run        # simulate only
```

## Workflow Patterns

### Safe Trade Execution
```
1. perp --json -e <EX> account info              -> check balance
2. perp --json -e <EX> market mid <SYM>          -> current price
3. perp --json -e <EX> market info <SYM>         -> tick size, min order
4. [Show order summary to user, get confirmation]
5. perp --json -e <EX> trade buy <SYM> <SIZE>    -> execute
6. perp --json -e <EX> account positions         -> verify result
```

### Cross-Exchange Health Check
```
1. perp --json -e pacifica status
2. perp --json -e hyperliquid status
3. perp --json -e lighter status
4. perp --json portfolio
5. perp --json risk overview
```

### Funding Rate Arbitrage
```
1. perp --json arb rates                         -> compare rates
2. perp --json arb scan --min 10                 -> find >10bps opportunities
3. [Analyze opportunities, confirm with user]
4. perp --json arb auto --min-spread 30          -> auto-execute at 30bps+
```

### Cross-Chain Fund Transfer
```
1. perp --json bridge quote --from solana --to arbitrum --amount 100
2. [Show quote, get user approval]
3. perp --json bridge send --from solana --to arbitrum --amount 100
4. perp --json bridge status <ORDER_ID>          -> confirm completion
```

### Position with TP/SL
```
1. perp --json -e <EX> account positions         -> current positions
2. perp --json -e <EX> market mid <SYM>          -> current price
3. perp --json -e <EX> trade tp <SYM> <PRICE>    -> set take-profit
4. perp --json -e <EX> trade sl <SYM> <PRICE>    -> set stop-loss
5. perp --json -e <EX> account orders            -> verify TP/SL orders
```

## Error Codes

| Code | Retryable | Action |
|------|-----------|--------|
| INSUFFICIENT_BALANCE | No | Report low balance, suggest deposit |
| MARGIN_INSUFFICIENT | No | Suggest lower leverage or smaller size |
| SIZE_TOO_SMALL | No | Show minimum order size |
| SIZE_TOO_LARGE | No | Show maximum order size |
| RISK_VIOLATION | No | Report risk limit exceeded |
| SYMBOL_NOT_FOUND | No | Run `market list` for valid symbols |
| RATE_LIMITED | Yes | Wait 5s, retry once |
| EXCHANGE_UNREACHABLE | Yes | Wait 5s, retry up to 3 times |
| TIMEOUT | Yes | Retry, check network |
| PRICE_STALE | Yes | Re-fetch price, retry |
| SIGNATURE_FAILED | No | Check key configuration |

## Post-Trade Report Format

After every trade execution, report:
```
[Exchange] [Symbol] [Direction] filled
- Price: $XX,XXX
- Size: X.XX
- Fee: $X.XX
- Remaining balance: $XX,XXX
- Position: [LONG/SHORT] X.XX @ $XX,XXX (Xx leverage)
```
