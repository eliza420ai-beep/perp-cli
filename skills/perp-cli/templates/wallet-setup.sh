#!/bin/bash
# Wallet setup for perp-cli
# Usage: ./wallet-setup.sh <exchange> <private-key>
# Exchanges: hl (Hyperliquid), pac (Pacifica), lt (Lighter)

set -e

EXCHANGE="${1:?Usage: wallet-setup.sh <exchange> <private-key>}"
KEY="${2:?Usage: wallet-setup.sh <exchange> <private-key>}"

echo "Setting up wallet for $EXCHANGE..."
perp --json wallet set "$EXCHANGE" "$KEY"

echo "Verifying..."
perp --json wallet show

echo "Done. Wallet configured for $EXCHANGE."
