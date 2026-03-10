/**
 * Shared API URL management for all exchanges.
 * URLs are mutable to support --network testnet switching.
 */

const MAINNET_URLS = {
  pacifica: "https://api.pacifica.fi/api/v1/info/prices",
  hyperliquid: "https://api.hyperliquid.xyz/info",
  lighter: "https://mainnet.zklighter.elliot.ai",
} as const;

const TESTNET_URLS: Record<string, string | null> = {
  pacifica: null, // no public testnet API
  hyperliquid: "https://api.hyperliquid-testnet.xyz/info",
  lighter: "https://testnet.zklighter.elliot.ai",
};

export let PACIFICA_API_URL: string = MAINNET_URLS.pacifica;
export let HYPERLIQUID_API_URL: string = MAINNET_URLS.hyperliquid;
export let LIGHTER_API_URL: string = MAINNET_URLS.lighter;

/**
 * Switch shared API URLs between mainnet and testnet.
 * Call from CLI entry point after parsing --network flag.
 */
export function setSharedApiNetwork(network: "mainnet" | "testnet"): void {
  if (network === "testnet") {
    PACIFICA_API_URL = TESTNET_URLS.pacifica ?? MAINNET_URLS.pacifica;
    HYPERLIQUID_API_URL = TESTNET_URLS.hyperliquid ?? MAINNET_URLS.hyperliquid;
    LIGHTER_API_URL = TESTNET_URLS.lighter ?? MAINNET_URLS.lighter;
  } else {
    PACIFICA_API_URL = MAINNET_URLS.pacifica;
    HYPERLIQUID_API_URL = MAINNET_URLS.hyperliquid;
    LIGHTER_API_URL = MAINNET_URLS.lighter;
  }
}
