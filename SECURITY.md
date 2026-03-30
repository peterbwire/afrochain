# AfroChain Security Policy

## Scope

Security reports are especially important for:

- consensus or validator manipulation
- transaction forgery or replay
- faucet abuse
- governance escalation
- snapshot tampering
- peer sync or relay abuse
- wallet keystore compromise
- remote node mutation without authorization

## Reporting

Please do not open public issues for exploitable vulnerabilities.

Report security concerns privately to:

- `peterbwire5@gmail.com`

Include:

- affected component
- reproduction steps
- expected impact
- proof-of-concept details if available
- whether funds, keys, or node state can be compromised

## Response Goals

AfroChain is still early-stage software, but the goal is to:

- acknowledge reports quickly
- reproduce and triage impact
- ship mitigations or patches
- document operator remediation steps when needed

## Current Security Posture

AfroChain is not yet a production-hardened mainnet blockchain. The repository contains a strong devnet/reference implementation with active hardening work underway across snapshot integrity, peer sync protections, wallet custody, and operations.

