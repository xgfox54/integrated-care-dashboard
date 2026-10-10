# Third-party notices

## korean-law-mcp

- Project: korean-law-mcp
- Version pinned in this repository: 4.15.6
- Upstream source: https://github.com/chrisryugj/korean-law-mcp
- License: MIT (`vendor/korean-law-mcp.LICENSE`)
- Copyright: Copyright (c) 2025 Chris

This dashboard reuses the upstream law API client, schemas, parsers, search, legal-research, legal-analysis, decision-search, annex and ordinance-radar logic. The upstream Express/stdio transport is not used for the website. The logic is adapted to the existing Cloudflare Worker HTTP and MCP transports.

The upstream NOTICE states that its JavaScript anti-bot challenge implementation was inspired by a repository without a declared license and recommends obtaining permission before distribution. That module is intentionally replaced with a no-op adapter during the dashboard build and is not included in the deployment bundle. HTML challenge responses are handled as retriable upstream errors instead of being bypassed.

## Legal information source

Law, precedent, interpretation and decision information is retrieved at request time from the Korean Ministry of Government Legislation National Law Information Center OPEN API. The dashboard does not provide legal advice; users must verify effective dates and official text at https://www.law.go.kr.
