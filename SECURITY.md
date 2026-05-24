# Security Policy

`sighash` is a wallet-connector library. Vulnerabilities in this library can affect users' Bitcoin and ordinal assets, so we take them seriously.

## Reporting

Please do **not** report security vulnerabilities via public GitHub issues. Instead, email a description and reproduction to the maintainers (see repository owner). PGP key on request.

We will acknowledge receipt within 72 hours, and aim to publish a patch within 14 days of confirmation for high-severity issues.

## Scope

In scope:

- Anything that could cause a user to sign an unintended transaction or message.
- Anything that exfiltrates private keys, mnemonics, or session secrets (the library should never see any of these — if it does, that's the bug).
- PSBT-parsing bugs that misclassify inputs / outputs.
- Bypasses of the user's wallet confirmation prompts.
- Supply-chain risks in `sighash`'s own dependency tree.

Out of scope:

- Vulnerabilities in the underlying wallet extensions (Xverse, UniSat, OKX). Report those upstream.
- Issues that require the user to install a malicious browser extension.

## Coordinated disclosure

We follow standard coordinated-disclosure practice. We're happy to credit reporters in release notes, and we can request CVE IDs for confirmed issues.
