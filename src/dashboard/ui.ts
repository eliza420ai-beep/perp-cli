/**
 * Dashboard frontend UI — single-file HTML/CSS/JS served inline.
 */

export function getUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>perp-cli Dashboard</title>
<style>
  :root {
    --bg: #0d1117; --card: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --green: #3fb950;
    --red: #f85149; --blue: #58a6ff; --yellow: #d29922;
    --cyan: #39d2c0;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'SF Mono', 'Fira Code', monospace; background: var(--bg); color: var(--text); min-height: 100vh; }
  .header { display:flex; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:1px solid var(--border); }
  .header h1 { font-size:18px; color:var(--cyan); }
  .status { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); }
  .status .dot { width:8px; height:8px; border-radius:50%; background:var(--green); }
  .status .dot.off { background:var(--red); }
  .container { padding:20px 24px; }

  /* Totals row */
  .totals { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:20px; }
  .total-card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:14px 16px; }
  .total-card .label { font-size:11px; text-transform:uppercase; color:var(--muted); margin-bottom:4px; letter-spacing:0.5px; }
  .total-card .value { font-size:22px; font-weight:600; }
  .total-card .value.green { color:var(--green); }
  .total-card .value.red { color:var(--red); }

  /* Exchange tabs */
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { padding:6px 14px; border-radius:6px; background:var(--card); border:1px solid var(--border); cursor:pointer; font-size:13px; color:var(--muted); transition:all 0.15s; }
  .tab:hover { border-color:var(--cyan); color:var(--text); }
  .tab.active { background:var(--cyan); color:var(--bg); border-color:var(--cyan); font-weight:600; }

  /* Exchange panels */
  .exchange-panel { display:none; }
  .exchange-panel.active { display:block; }

  /* Balance bar */
  .balance-bar { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:16px; }
  .balance-item { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:12px 14px; }
  .balance-item .label { font-size:11px; text-transform:uppercase; color:var(--muted); margin-bottom:2px; }
  .balance-item .val { font-size:17px; font-weight:500; }

  /* Tables */
  .section-title { font-size:14px; font-weight:600; margin:16px 0 8px; color:var(--cyan); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  thead th { text-align:left; padding:8px 10px; color:var(--muted); font-size:11px; text-transform:uppercase; border-bottom:1px solid var(--border); letter-spacing:0.5px; }
  tbody td { padding:8px 10px; border-bottom:1px solid var(--border); }
  tbody tr:hover { background:rgba(88,166,255,0.04); }
  .side-long { color:var(--green); font-weight:600; }
  .side-short, .side-sell { color:var(--red); font-weight:600; }
  .side-buy { color:var(--green); font-weight:600; }
  .pnl-pos { color:var(--green); }
  .pnl-neg { color:var(--red); }
  .empty-msg { color:var(--muted); font-size:13px; padding:12px 0; }

  /* Event log */
  .event-log { max-height:200px; overflow-y:auto; background:var(--card); border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:12px; line-height:1.6; }
  .event-log .event { border-bottom:1px solid var(--border); padding:3px 0; }
  .event-log .event:last-child { border:none; }
  .event-time { color:var(--muted); }
  .event-type { font-weight:600; }
  .event-type.warn { color:var(--yellow); }
  .event-type.crit { color:var(--red); }

  /* Footer */
  .footer { padding:16px 24px; text-align:center; font-size:11px; color:var(--muted); border-top:1px solid var(--border); margin-top:20px; }

  @media (max-width: 768px) {
    .balance-bar { grid-template-columns:repeat(2, 1fr); }
    .totals { grid-template-columns:repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="header">
  <h1>perp-cli dashboard</h1>
  <div class="status">
    <span class="dot" id="ws-dot"></span>
    <span id="ws-status">connecting...</span>
    <span id="last-update" style="margin-left:12px"></span>
  </div>
</div>

<div class="container">
  <!-- Totals -->
  <div class="totals" id="totals"></div>

  <!-- Exchange tabs -->
  <div class="tabs" id="tabs"></div>

  <!-- Exchange panels (rendered dynamically) -->
  <div id="panels"></div>

  <!-- Event Log -->
  <div class="section-title">Event Log</div>
  <div class="event-log" id="event-log">
    <div class="empty-msg">Waiting for events...</div>
  </div>
</div>

<div class="footer">perp-cli v0.3.1 &mdash; live dashboard</div>

<script>
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let ws;
let snapshot = null;
let activeExchange = null;
const MAX_EVENTS = 50;
const events = [];

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);
  ws.onopen = () => {
    $('#ws-dot').className = 'dot';
    $('#ws-status').textContent = 'connected';
  };
  ws.onclose = () => {
    $('#ws-dot').className = 'dot off';
    $('#ws-status').textContent = 'reconnecting...';
    setTimeout(connect, 3000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'snapshot') {
      snapshot = msg.data;
      render();
    }
  };
}

function fmt(v, decimals = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlClass(v) {
  const n = Number(v) || 0;
  return n >= 0 ? 'pnl-pos' : 'pnl-neg';
}

function pnlSign(v) {
  const n = Number(v) || 0;
  return n >= 0 ? '+$' + fmt(Math.abs(n)) : '-$' + fmt(Math.abs(n));
}

function renderTotals(t) {
  const pnlCls = Number(t.unrealizedPnl) >= 0 ? 'green' : 'red';
  $('#totals').innerHTML = [
    { label: 'Total Equity', value: '$' + fmt(t.equity), cls: '' },
    { label: 'Available', value: '$' + fmt(t.available), cls: '' },
    { label: 'Margin Used', value: '$' + fmt(t.marginUsed), cls: '' },
    { label: 'Unrealized PnL', value: pnlSign(t.unrealizedPnl), cls: pnlCls },
    { label: 'Positions', value: t.positionCount, cls: '' },
    { label: 'Open Orders', value: t.orderCount, cls: '' },
  ].map(c => \`
    <div class="total-card">
      <div class="label">\${c.label}</div>
      <div class="value \${c.cls}">\${c.value}</div>
    </div>
  \`).join('');
}

function renderTabs(exchanges) {
  if (!activeExchange && exchanges.length) activeExchange = exchanges[0].name;
  $('#tabs').innerHTML = exchanges.map(ex => \`
    <div class="tab \${ex.name === activeExchange ? 'active' : ''}" data-ex="\${ex.name}">\${ex.name}</div>
  \`).join('');
  $$('.tab').forEach(tab => {
    tab.onclick = () => {
      activeExchange = tab.dataset.ex;
      render();
    };
  });
}

function renderPanels(exchanges) {
  $('#panels').innerHTML = exchanges.map(ex => {
    const isActive = ex.name === activeExchange;
    return \`<div class="exchange-panel \${isActive ? 'active' : ''}" id="panel-\${ex.name}">
      <!-- Balance -->
      <div class="balance-bar">
        <div class="balance-item"><div class="label">Equity</div><div class="val">$\${fmt(ex.balance.equity)}</div></div>
        <div class="balance-item"><div class="label">Available</div><div class="val">$\${fmt(ex.balance.available)}</div></div>
        <div class="balance-item"><div class="label">Margin Used</div><div class="val">$\${fmt(ex.balance.marginUsed)}</div></div>
        <div class="balance-item"><div class="label">Unrealized PnL</div><div class="val \${pnlClass(ex.balance.unrealizedPnl)}">\${pnlSign(ex.balance.unrealizedPnl)}</div></div>
      </div>

      <!-- Positions -->
      <div class="section-title">Positions (\${ex.positions.length})</div>
      \${ex.positions.length ? \`
        <table>
          <thead><tr>
            <th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq</th><th>PnL</th><th>Leverage</th>
          </tr></thead>
          <tbody>\${ex.positions.map(p => \`
            <tr>
              <td>\${p.symbol}</td>
              <td class="side-\${p.side}">\${p.side.toUpperCase()}</td>
              <td>\${p.size}</td>
              <td>$\${fmt(p.entryPrice)}</td>
              <td>$\${fmt(p.markPrice)}</td>
              <td>\${p.liquidationPrice === 'N/A' ? 'N/A' : '$' + fmt(p.liquidationPrice)}</td>
              <td class="\${pnlClass(p.unrealizedPnl)}">\${pnlSign(p.unrealizedPnl)}</td>
              <td>\${p.leverage}x</td>
            </tr>
          \`).join('')}</tbody>
        </table>
      \` : '<div class="empty-msg">No open positions</div>'}

      <!-- Orders -->
      <div class="section-title">Open Orders (\${ex.orders.length})</div>
      \${ex.orders.length ? \`
        <table>
          <thead><tr>
            <th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Size</th><th>Filled</th><th>Status</th>
          </tr></thead>
          <tbody>\${ex.orders.map(o => \`
            <tr>
              <td>\${o.symbol}</td>
              <td class="side-\${o.side}">\${o.side.toUpperCase()}</td>
              <td>\${o.type}</td>
              <td>$\${fmt(o.price)}</td>
              <td>\${o.size}</td>
              <td>\${o.filled}</td>
              <td>\${o.status}</td>
            </tr>
          \`).join('')}</tbody>
        </table>
      \` : '<div class="empty-msg">No open orders</div>'}

      <!-- Top Markets -->
      <div class="section-title">Markets (Top 10)</div>
      \${ex.topMarkets.length ? \`
        <table>
          <thead><tr>
            <th>Symbol</th><th>Mark</th><th>Index</th><th>Funding</th><th>24h Vol</th><th>OI</th><th>Max Lev</th>
          </tr></thead>
          <tbody>\${ex.topMarkets.map(m => {
            const fr = Number(m.fundingRate);
            const frCls = fr >= 0 ? 'pnl-pos' : 'pnl-neg';
            return \`
            <tr>
              <td>\${m.symbol}</td>
              <td>$\${fmt(m.markPrice)}</td>
              <td>$\${fmt(m.indexPrice)}</td>
              <td class="\${frCls}">\${(fr * 100).toFixed(4)}%</td>
              <td>$\${fmt(m.volume24h, 0)}</td>
              <td>$\${fmt(m.openInterest, 0)}</td>
              <td>\${m.maxLeverage}x</td>
            </tr>\`;
          }).join('')}</tbody>
        </table>
      \` : '<div class="empty-msg">No market data</div>'}
    </div>\`;
  }).join('');
}

function addEvent(type, exchange, data) {
  const time = new Date().toLocaleTimeString();
  const isWarn = type.includes('warning');
  const isCrit = type.includes('margin_call') || type.includes('critical');
  events.unshift({ time, type, exchange, data, isWarn, isCrit });
  if (events.length > MAX_EVENTS) events.pop();
  renderEvents();
}

function renderEvents() {
  const el = $('#event-log');
  if (!events.length) { el.innerHTML = '<div class="empty-msg">Waiting for events...</div>'; return; }
  el.innerHTML = events.map(e => {
    const cls = e.isCrit ? 'crit' : e.isWarn ? 'warn' : '';
    return \`<div class="event"><span class="event-time">\${e.time}</span> <span class="event-type \${cls}">[\${e.type}]</span> <span>\${e.exchange}</span> <span style="color:var(--muted)">\${JSON.stringify(e.data).slice(0, 120)}</span></div>\`;
  }).join('');
}

let prevSnapshot = null;
function detectEvents(snap) {
  if (!prevSnapshot) { prevSnapshot = snap; return; }
  for (const ex of snap.exchanges) {
    const prev = prevSnapshot.exchanges.find(e => e.name === ex.name);
    if (!prev) continue;
    // Position changes
    const prevSyms = new Set(prev.positions.map(p => p.symbol));
    const currSyms = new Set(ex.positions.map(p => p.symbol));
    for (const p of ex.positions) {
      if (!prevSyms.has(p.symbol)) addEvent('position_opened', ex.name, { symbol: p.symbol, side: p.side, size: p.size });
    }
    for (const p of prev.positions) {
      if (!currSyms.has(p.symbol)) addEvent('position_closed', ex.name, { symbol: p.symbol, side: p.side });
    }
    // Balance changes
    const eqDelta = Math.abs(Number(ex.balance.equity) - Number(prev.balance.equity));
    if (eqDelta > 0.01) addEvent('balance_update', ex.name, { equity: ex.balance.equity, delta: eqDelta.toFixed(2) });
  }
  prevSnapshot = snap;
}

function render() {
  if (!snapshot) return;
  renderTotals(snapshot.totals);
  renderTabs(snapshot.exchanges);
  renderPanels(snapshot.exchanges);
  $('#last-update').textContent = new Date(snapshot.timestamp).toLocaleTimeString();
  detectEvents(snapshot);
}

connect();
</script>
</body>
</html>`;
}
