#!/bin/bash
# Open a perp position with pre-flight checks
# Usage: ./open-position.sh <exchange> <symbol> <side> <size>
# Example: ./open-position.sh hl BTC buy 0.01

set -e

EX="${1:?Usage: open-position.sh <exchange> <symbol> <side> <size>}"
SYM="${2:?Usage: open-position.sh <exchange> <symbol> <side> <size>}"
SIDE="${3:?Usage: open-position.sh <exchange> <symbol> <side> <size>}"
SIZE="${4:?Usage: open-position.sh <exchange> <symbol> <side> <size>}"

echo "=== Pre-flight checks ==="
echo "1. Account info:"
perp --json -e "$EX" account info

echo "2. Current price:"
perp --json -e "$EX" market mid "$SYM"

echo "3. Trade validation:"
perp --json -e "$EX" trade check "$SYM" "$SIDE" "$SIZE"

echo ""
echo "=== Ready to execute ==="
echo "  Exchange: $EX"
echo "  Symbol:   $SYM"
echo "  Side:     $SIDE"
echo "  Size:     $SIZE"
echo ""
read -p "Confirm? (y/N): " CONFIRM

if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
  perp --json -e "$EX" trade market "$SYM" "$SIDE" "$SIZE"
  echo "=== Position verification ==="
  perp --json -e "$EX" account positions
else
  echo "Cancelled."
fi
