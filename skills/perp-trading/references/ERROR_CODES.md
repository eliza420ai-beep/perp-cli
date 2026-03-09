# Error Codes Reference

## Full Error Code Table

| Code | HTTP Status | Retryable | Description | Recommended Action |
|------|-------------|-----------|-------------|-------------------|
| INVALID_PARAMS | 400 | No | Invalid parameters | Check parameter types and values |
| SYMBOL_NOT_FOUND | 404 | No | Symbol not found | Run `perp --json market list` for valid symbols |
| ORDER_NOT_FOUND | 404 | No | Order not found | Verify order ID with `perp --json account orders` |
| POSITION_NOT_FOUND | 404 | No | Position not found | Check `perp --json account positions` |
| INSUFFICIENT_BALANCE | 400 | No | Insufficient balance | Check balance, suggest deposit or smaller size |
| MARGIN_INSUFFICIENT | 400 | No | Margin insufficient | Reduce leverage or position size |
| SIZE_TOO_SMALL | 400 | No | Size too small | Check `market info` for minimum size |
| SIZE_TOO_LARGE | 400 | No | Size too large | Check `market info` for maximum size |
| RISK_VIOLATION | 403 | No | Risk violation | Position exceeds risk limits |
| DUPLICATE_ORDER | 409 | No | Duplicate order | Order already exists |
| EXCHANGE_UNREACHABLE | 503 | Yes | Exchange unreachable | Wait 5s, retry up to 3 times |
| RATE_LIMITED | 429 | Yes | Rate limited | Wait 5s, retry once |
| PRICE_STALE | 503 | Yes | Price stale | Re-fetch price, retry |
| SIGNATURE_FAILED | 500 | No | Signature failed | Verify private key configuration |
| TIMEOUT | 504 | Yes | Timeout | Retry, check network connectivity |
| UNKNOWN | 500 | No | Unknown error | Report full error to user |

## Retry Logic

```
if error.retryable:
    wait 5 seconds
    retry once (max 3 for EXCHANGE_UNREACHABLE)
    if still fails: report to user
else:
    report to user immediately
    suggest corrective action
```
