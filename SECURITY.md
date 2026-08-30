# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability in LFCbot, please report it privately
rather than opening a public GitHub issue.

The preferred way is
[GitHub's private vulnerability reporting](https://github.com/mkane848/lfc-bot/security/advisories/new)
for this repository (**Security** tab → **Report a vulnerability**). This
opens a private discussion with the maintainer and lets you attach details
without exposing the issue to other users before a fix ships.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it (a minimal example is ideal).
- Any relevant logs, screenshots, or affected versions.

## Scope

In scope:

- This repository's code (`src/`), including the Discord bot itself, its
  database access, and the Scryfall/Manapool integrations.
- The Docker packaging and deployment scripts in this repository.

Out of scope:

- Discord's own platform, API, or client applications — report those to
  [Discord directly](https://discord.com/safety).
- Vulnerabilities in third-party dependencies with no LFCbot-specific
  exploit path — please report those upstream, though a note here is still
  welcome if it affects a deployed instance.

## Response Expectations

This is a small, self-hosted open source project maintained on a
best-effort basis. There's no formal SLA, but reports are triaged as soon
as reasonably possible, and a fix or mitigation is prioritized for anything
that could expose a bot token, database contents, or another server's data.

## Supported Versions

Only the latest released version is supported. If you're running an older
version, please update before reporting an issue that may already be fixed
— check [CHANGELOG.md](CHANGELOG.md) first.
