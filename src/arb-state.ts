import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const PERP_DIR = resolve(process.env.HOME || "~", ".perp");
const STATE_FILE = resolve(PERP_DIR, "arb-state.json");

// Allow overriding the state file path for testing
let stateFilePath = STATE_FILE;

export function setStateFilePath(path: string): void {
  stateFilePath = path;
}

export function resetStateFilePath(): void {
  stateFilePath = STATE_FILE;
}

export interface ArbPositionState {
  id: string;
  symbol: string;
  longExchange: string;
  shortExchange: string;
  longSize: number;
  shortSize: number;
  entryTime: string; // ISO
  entrySpread: number; // annualized %
  entryLongPrice: number;
  entryShortPrice: number;
  accumulatedFunding: number;
  lastCheckTime: string; // ISO
}

export interface ArbDaemonState {
  version: 1;
  lastStartTime: string;
  lastScanTime: string;
  positions: ArbPositionState[];
  config: {
    minSpread: number;
    closeSpread: number;
    size: number | "auto";
    holdDays: number;
    bridgeCost: number;
    maxPositions: number;
    settleStrategy: string;
    notifyUrl?: string;
  };
}

function ensureDir(): void {
  const dir = resolve(stateFilePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Load daemon state from disk. Returns null if no state file exists. */
export function loadArbState(): ArbDaemonState | null {
  if (!existsSync(stateFilePath)) return null;
  try {
    const raw = readFileSync(stateFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) return null;
    return parsed as ArbDaemonState;
  } catch {
    return null;
  }
}

/** Save daemon state to disk (atomic write). */
export function saveArbState(state: ArbDaemonState): void {
  ensureDir();
  const json = JSON.stringify(state, null, 2);
  writeFileSync(stateFilePath, json, { mode: 0o600 });
}

/** Add a position to the persisted state. */
export function addPosition(pos: ArbPositionState): void {
  const state = loadArbState();
  if (!state) {
    throw new Error("No daemon state found. Initialize state before adding positions.");
  }
  // Avoid duplicates by symbol
  state.positions = state.positions.filter(p => p.symbol !== pos.symbol);
  state.positions.push(pos);
  saveArbState(state);
}

/** Remove a position by symbol from the persisted state. */
export function removePosition(symbol: string): void {
  const state = loadArbState();
  if (!state) return;
  state.positions = state.positions.filter(p => p.symbol !== symbol);
  saveArbState(state);
}

/** Update a position by symbol with partial updates. */
export function updatePosition(symbol: string, updates: Partial<ArbPositionState>): void {
  const state = loadArbState();
  if (!state) return;
  const idx = state.positions.findIndex(p => p.symbol === symbol);
  if (idx === -1) return;
  state.positions[idx] = { ...state.positions[idx], ...updates };
  saveArbState(state);
}

/** Get all persisted positions. */
export function getPositions(): ArbPositionState[] {
  const state = loadArbState();
  if (!state) return [];
  return state.positions;
}

/** Create a default empty daemon state with the given config. */
export function createInitialState(config: ArbDaemonState["config"]): ArbDaemonState {
  return {
    version: 1,
    lastStartTime: new Date().toISOString(),
    lastScanTime: new Date().toISOString(),
    positions: [],
    config,
  };
}
