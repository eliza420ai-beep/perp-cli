# Exchange Reference

## Pacifica (default)
- **Chain**: Solana
- **Key format**: Solana base58 private key
- **Env var**: `PRIVATE_KEY` or `PACIFICA_PRIVATE_KEY`
- **Signing**: Ed25519 via tweetnacl
- **Flag**: `-e pacifica` (default, can omit)
- **Quirks**:
  - `reduce_only`, `slippage_percent`, `tif`, `exclude_reduce_only` are mandatory fields
  - TP/SL side must be opposite of position (LONG -> "ask", SHORT -> "bid")
  - Margin mode uses `is_isolated: boolean` not string
  - Cancel stop order uses `order_id` not `stop_order_id`

## Hyperliquid
- **Chain**: HyperEVM (Arbitrum L2)
- **Key format**: EVM hex private key (0x...)
- **Env var**: `HL_PRIVATE_KEY`
- **Signing**: EIP-712 via ethers
- **Flag**: `-e hyperliquid`
- **Features**:
  - HIP-3 deployed perp dexes (`perp dex list`)
  - Vault trading support
  - Sub-account support
- **Quirks**:
  - Rate limiting can be aggressive (429 errors common)
  - Referral code support via `HL_REFERRAL_CODE`

## Lighter
- **Chain**: Ethereum
- **Key format**: EVM hex 32-byte + separate 40-byte API key
- **Env vars**: `LIGHTER_PRIVATE_KEY`, `LIGHTER_API_KEY`
- **Signing**: WASM-based lighter-sdk signer
- **Flag**: `-e lighter`
- **Quirks**:
  - Two-key system: private key for signing, API key for auth
  - TimeInForce: 0=IOC, 1=GTT, 2=Post Only
  - Market orders: type=1, timeInForce=0, orderExpiry=0
  - Limit orders: type=0, timeInForce=1, orderExpiry=-1 (auto 28-day)
  - Price/size use tick decimals from market info

## Bridge Routes (CCTP V2)
| From | To | Fee | Relay |
|------|----|-----|-------|
| Solana -> Arbitrum | $0 | Circle auto-relay |
| Solana -> Base | $0 | Circle auto-relay |
| Arbitrum -> Solana | $0 | Manual relay (CLI handles) |
| Base -> Solana | $0 | Manual relay (CLI handles) |
| Arbitrum -> Base | $0 | Manual relay (CLI handles) |
| Base -> Arbitrum | $0 | Manual relay (CLI handles) |
