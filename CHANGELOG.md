# Changelog

## [0.0.3] (2026-08-13)

### Added

- **ABAP ADT MCP over HTTP with a 5-tool facade** — Copilot only sees `abap_tool_search`, `abap_read`, `abap_search`, `abap_write`, `abap_execute`; the full core catalog (206 tools) is searchable on demand.
- **Startup health check** — a delayed `GetSession` probe against SAP after activation, with an actionable result button (`DNova: Check ABAP ADT MCP Connection` to run manually).
- **ABAP Agent Guide** — auto-creates/updates an `AGENTS.md` in ABAP workspaces so Copilot agents prefer the bundled MCP (`DNova: Update/Remove ABAP Agent Guide`), plus a bundled ABAP skill.
- New settings: `startupCheck`, `exposition`, `abap.agentGuide.autoCreate`, `abap.agentGuide.file`.

### Changed

- The bundled `@mcp-abap-adt/core` server is exposed **only** through the local Streamable HTTP facade (`http://127.0.0.1:3000/mcp`); disabling `httpEnabled` stops MCP entirely — no stdio fallback.
- Settings changes regenerate `.env` and restart the server automatically; a full window reload is only needed the first time.
- `exposition` default stays `readonly` (~68 read-only tools); `readonly,high` exposes the full 206-tool catalog.

## [0.0.1] (2026-07-19)

### Added

- DNova GLM-5.2 as a Copilot Chat model (BYOK, zero config).
