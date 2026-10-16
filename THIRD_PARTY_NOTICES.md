# Third-party notices

## JSZip

- Version: 3.10.2 (npm registry)
- License: MIT or GPL-3.0-or-later; used under MIT (included in the installed package)

Used on the server to package XLSX search-result downloads. The workbook XML is written by lib/dataset-xlsx.ts.

## korean-law-mcp

- Project: korean-law-mcp
- Version pinned in this repository: 4.15.6
- Upstream source: https://github.com/chrisryugj/korean-law-mcp
- License: MIT (`vendor/korean-law-mcp.LICENSE`)
- Copyright: Copyright (c) 2025 Chris

This dashboard reuses the upstream law API client, schemas, parsers, search, legal-research, legal-analysis, decision-search, annex and ordinance-radar logic. The upstream Express/stdio transport is not used for the website. The logic is adapted to the existing Cloudflare Worker HTTP and MCP transports.

The upstream NOTICE states that its JavaScript anti-bot challenge implementation was inspired by a repository without a declared license and recommends obtaining permission before distribution. That module is intentionally replaced with a no-op adapter during the dashboard build and is not included in the deployment bundle. HTML challenge responses are handled as retriable upstream errors instead of being bypassed.

The upstream cache module is replaced with a Worker-safe in-memory cache that performs lazy expiry cleanup. It does not start a global interval. The separate local evidence collector retains its existing block-page detector, which returns a 403 response and never solves the challenge; its installed dependencies are not included in the website artifact.

The pinned `kordoc` 4.18.2 attachment parser retains its JavaScript HWP/HWPX and text-PDF extraction. Its CFB dependency is statically bundled for Workers. Optional native OCR, model download and browser/image rendering paths are disabled at their lazy import boundaries; the upstream law parser already requests `ocr: false`. Image-only attachments must be read from their official file links. Its MIT license, upstream notices and accompanying third-party licenses are preserved in `vendor/kordoc.LICENSE`, `vendor/kordoc.NOTICE` and `vendor/kordoc-third-party/`.

## Legal information source

Law, precedent, interpretation and decision information is retrieved at request time from the Korean Ministry of Government Legislation National Law Information Center OPEN API. The dashboard does not provide legal advice; users must verify effective dates and official text at https://www.law.go.kr.
