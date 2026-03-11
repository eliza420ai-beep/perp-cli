import { Command } from "commander";
import chalk from "chalk";
import { printJson, jsonOk } from "../utils.js";
import { ENV_FILE, loadEnvFile, setEnvVar, EXCHANGE_ENV_MAP, validateKey } from "./init.js";

// Resolve exchange alias → env var key
function resolveEnvKey(nameOrKey: string): { envKey: string; chain: "solana" | "evm" } | null {
  // Direct env var name
  const upper = nameOrKey.toUpperCase();
  for (const info of Object.values(EXCHANGE_ENV_MAP)) {
    if (info.envKey === upper) return { envKey: info.envKey, chain: info.chain };
  }
  // Exchange name alias
  const info = EXCHANGE_ENV_MAP[nameOrKey.toLowerCase()];
  if (info) return { envKey: info.envKey, chain: info.chain };
  // Common aliases
  const aliases: Record<string, string> = { hl: "hyperliquid", pac: "pacifica", lt: "lighter" };
  const aliased = aliases[nameOrKey.toLowerCase()];
  if (aliased) return resolveEnvKey(aliased);
  return null;
}

export function registerEnvCommands(program: Command, isJson: () => boolean) {
  const env = program.command("env").description("Manage ~/.perp/.env configuration");

  // ── perp env show ──
  env
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      const stored = loadEnvFile();
      const entries: { name: string; chain: "solana" | "evm"; key: string; source: string }[] = [];

      for (const [exchange, info] of Object.entries(EXCHANGE_ENV_MAP)) {
        const fromFile = stored[info.envKey];
        const fromEnv = process.env[info.envKey];
        if (fromFile) {
          entries.push({ name: exchange, chain: info.chain, key: fromFile, source: "~/.perp/.env" });
        } else if (fromEnv) {
          entries.push({ name: exchange, chain: info.chain, key: fromEnv, source: "environment" });
        }
      }

      // Derive addresses
      const results: { name: string; address: string; source: string }[] = [];
      for (const entry of entries) {
        const { valid, address } = await validateKey(entry.chain, entry.key);
        results.push({ name: entry.name, address: valid ? address : "(invalid key)", source: entry.source });
      }

      if (isJson()) {
        const data = results.map((r) => ({ exchange: r.name, address: r.address, source: r.source }));
        return printJson(jsonOk({ envFile: ENV_FILE, exchanges: data }));
      }

      console.log(chalk.cyan.bold("\n  perp-cli Configuration\n"));
      console.log(`  File: ${chalk.gray(ENV_FILE)}\n`);

      if (results.length === 0) {
        console.log(chalk.gray("  No keys configured. Run 'perp init' or 'perp env set <exchange> <key>'\n"));
        return;
      }

      for (const { name, address, source } of results) {
        console.log(`  ${chalk.cyan(name.padEnd(14))} ${chalk.green(address)}  ${chalk.gray(source)}`);
      }
      console.log();
    });

  // ── perp env set <exchange|key> <value> ──
  env
    .command("set <name> <value>")
    .description("Set a key (exchange name or env var name)")
    .action(async (name: string, value: string) => {
      const resolved = resolveEnvKey(name);

      if (resolved) {
        // Validate the key
        const { valid, address } = await validateKey(resolved.chain, value);
        if (!valid) {
          if (isJson()) {
            const { jsonError } = await import("../utils.js");
            return printJson(jsonError("INVALID_PARAMS", `Invalid ${resolved.chain} private key`));
          }
          console.error(chalk.red(`\n  Invalid ${resolved.chain} private key.\n`));
          process.exit(1);
        }

        const normalized = resolved.chain === "evm"
          ? (value.startsWith("0x") ? value : `0x${value}`)
          : value;

        setEnvVar(resolved.envKey, normalized);

        if (isJson()) return printJson(jsonOk({ key: resolved.envKey, address, file: ENV_FILE }));
        console.log(chalk.green(`\n  ${resolved.envKey} set.`));
        console.log(`  Address: ${chalk.gray(address)}`);
        console.log(`  File:    ${chalk.gray("~/.perp/.env")}\n`);
      } else {
        // Raw env var (e.g. LIGHTER_API_KEY, custom vars)
        setEnvVar(name, value);

        if (isJson()) return printJson(jsonOk({ key: name, file: ENV_FILE }));
        console.log(chalk.green(`\n  ${name} set.`));
        console.log(`  File: ${chalk.gray("~/.perp/.env")}\n`);
      }
    });

  // ── perp env remove <name> ──
  env
    .command("remove <name>")
    .description("Remove a key from ~/.perp/.env")
    .action(async (name: string) => {
      const resolved = resolveEnvKey(name);
      const envKey = resolved?.envKey || name;

      const env = loadEnvFile();
      if (!(envKey in env)) {
        if (isJson()) {
          const { jsonError } = await import("../utils.js");
          return printJson(jsonError("NOT_FOUND", `${envKey} not found in ~/.perp/.env`));
        }
        console.log(chalk.gray(`\n  ${envKey} not found in ~/.perp/.env\n`));
        return;
      }

      delete env[envKey];
      // Rewrite file
      const { writeFileSync } = await import("fs");
      const lines = ["# perp-cli configuration", "# Generated by 'perp init' — edit freely", ""];
      for (const [k, v] of Object.entries(env)) lines.push(`${k}=${v}`);
      lines.push("");
      writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });

      if (isJson()) return printJson(jsonOk({ removed: envKey }));
      console.log(chalk.yellow(`\n  ${envKey} removed from ~/.perp/.env\n`));
    });

  // ── perp env path ──
  env
    .command("path")
    .description("Print env file path")
    .action(() => {
      if (isJson()) return printJson(jsonOk({ path: ENV_FILE }));
      console.log(ENV_FILE);
    });
}
