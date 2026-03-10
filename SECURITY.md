# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | No       |

We only provide security fixes for the latest release. Please update to the latest version before reporting.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Please report security issues through [GitHub Private Vulnerability Reporting](https://github.com/hypurrquant/perp-cli/security/advisories/new).

### What to Include

- Description of the vulnerability
- Affected command or MCP tool
- Steps to reproduce
- Package version, OS, and Node.js version
- Proof of concept (if possible)
- Sanitized logs (**remove all private keys and wallet addresses**)

### Important

- **Never include private keys** in your report
- **Never test vulnerabilities with real funds** without maintainer approval
- **Do not disclose publicly** until a fix is released

### Scope

The following areas are in scope:

- Command injection via CLI arguments
- Credential leakage (private keys, API keys exposed in logs/output)
- JSON output corruption that could cause unintended trades
- Unsafe default trading behavior
- MCP server exposure or unauthorized access
- Dependency vulnerabilities that affect perp-cli

### Response

We aim to acknowledge reports within **48 hours** and provide a fix timeline within **7 days**.
