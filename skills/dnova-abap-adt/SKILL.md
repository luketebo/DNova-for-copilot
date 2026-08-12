---
name: dnova-abap-adt
description: 'Use when the task involves SAP ABAP development objects — reading, creating, updating, activating, or searching classes, function modules, programs, tables, CDS views, data elements, domains, behavior definitions, or transport requests — and the bundled dnova-abap-mcp MCP server is available. The server is exposed as 5 facade tools (abap_tool_search, abap_read, abap_search, abap_write, abap_execute) that forward to the real ABAP core tools. Covers the non-obvious tools, the create-update-activate workflow, transport-request handling, and when to use the tools vs local files.'
---

# DNova ABAP ADT — Tool Usage Guide

This workspace uses the bundled **`dnova-abap-mcp`** MCP server for real SAP ABAP work. The server is now wrapped in a **facade**: instead of exposing hundreds of individual `Get*`/`Create*`/`Activate*` tools directly, Copilot only sees **5 wrapper tools** that forward to the real `@mcp-abap-adt/core` tools. Full tool names carry a session-specific prefix (e.g. `mcp_dnova-abap-fa_abap_read`); the part after the last `_` is what matters. This guide explains how to drive the facades correctly.

## 0. Facade access pattern (critical — read first)

The 5 available tools are:

| Facade tool | Purpose |
|-------------|---------|
| `abap_tool_search` | Find the **exact** core tool name and which facade serves it |
| `abap_read` | Forward to read-only core tools (`Get*`, `Read*`, `List*`, `RuntimeGet*`, `RuntimeList*`, …) |
| `abap_search` | Forward to repository / source search tools (`Search*`, `GetWhereUsed`, `ListTransports`, …) |
| `abap_write` | Forward to write tools (`Create*`, `Update*`, `Delete*`, `Activate*`, `Transport*`, `Run*`, …) |
| `abap_execute` | Escape hatch — forwards to ANY core tool (advanced; least safe for writes) |

Every real ABAP call is **two steps**:

1. **Find the tool**: call `abap_tool_search` with a core tool name, capability, or keyword (e.g. `table`, `source search`, `transport`, `session`). The search is ranked by name and description, so an exact name is helpful but not required. If you do not know any useful keyword, omit `query` or use an empty string to browse the catalog. The result includes the tool's `inputSchema` and its `facade` (which wrapper to use), plus `total` and `nextOffset` for pagination.
2. **Forward the call**: call the matching facade with `{ "tool": "<exact name>", "arguments": { … } }`, e.g. `abap_read` → `{ tool: "ReadProgram", arguments: { program_name: "Z00001" } }`.

If you forward a core tool through the wrong facade the server replies with a hint (e.g. `Use abap_search for this tool, or use abap_execute`). When in doubt, `abap_execute` can reach any tool, but never route a write through it casually — use `abap_write` so the intent is explicit.

### Connection prerequisite

Only call the facade tools when the server is **enabled and connected** to SAP. A quick probe is `abap_read` → tool `GetSession` (returns a `session_id`). If the tools error with connection/unauthorized issues, tell the user the MCP is not connected and suggest `DNova: Check ABAP ADT MCP Connection` or `DNova: Show ABAP ADT MCP Config`.

## 1. Transport requests — CHECK BEFORE ANY WRITE (critical)

In SAP, **every create/update/activate of a transportable object needs a transport request**. Tools that write (e.g. `Create*`, `Update*`, `Delete*`, some `Activate*`) accept a `transport_request` argument such as `E19K905635`.

Before performing a write:

1. If the user already named a request, use it.
2. Otherwise, **check whether the object is attached to a request** — via `abap_search` call `ListTransports` (or `GetTransport`) to list the user's open requests.
3. If nothing suitable exists, **do NOT invent a request number** — ask the user to provide or create one, or via `abap_write` call `CreateTransport` (requires `description`; `transport_type` is `workbench` or `customizing`).

Never fabricate a transport number. Missing/invalid requests are the #1 cause of failed saves.

## 2. Standard workflow: create → update → activate

The steps below name the **core** tools; each is invoked through a facade — reads via `abap_read`, searches via `abap_search`, and creates/updates/activates via `abap_write` (confirm the exact tool + facade with `abap_tool_search` first). For building or changing an object, follow this order:

1. **Read first** (if it may exist): `Get*` / `Read*` (e.g. `GetClass`, `ReadTable`, `ReadProgram`) — never overwrite blindly.
2. **Create** (new object): `CreateClass`, `CreateProgram`, `CreateTable`, `CreateDataElement`, `CreateDomain`, `CreateBehaviorDefinition`, … — pass the `transport_request`.
3. **Update** to set the actual source/fields: `UpdateClass`, `UpdateProgram`, `UpdateBehaviorDefinition`, … (the create shell is usually empty; the body/fields come via the matching `Update*`).
4. **Activate**: single-object `Activate*` (e.g. `ActivateClass`, `ActivateTable`) or, for several related objects at once, `ActivateObjects`.
5. **Verify**: a follow-up `Get*` / read confirms the active state.

### Activation order matters for dependent DDIC objects
When creating a chain like domain → data element → table (or CDS view + metadata extension + behavior definition), activate in dependency order. `ActivateObjects` can batch them in one call — pass the full `[{name, type}]` array.

### Object type codes for ActivateObjects
Each item needs `{ "name": "<NAME>", "type": "<TYPE>" }` where TYPE is one of:

| Code | Object | Code | Object |
|------|--------|------|--------|
| `DOMA` | Domain | `DDLS` | CDS view |
| `DTEL` | Data element | `DDLX` | Metadata extension |
| `TABL` | Table | `SRVD` | Service definition |
| `STRU` | Structure | `SRVB` | Service binding |
| `TTYP` | Table type | `BDEF` | Behavior definition |
| `CLAS` | Class | `DCLS` | Access control |
| `INTF` | Interface | `ENHO` | Enhancement |
| `PROG` | Program | `FUGR` / `FUGR/FF` | Function group / module |
| `CLAS` | Class (local members via Update*) | | |

Names are **uppercase**. `ActivateObjects` uses ADT group activation, so related objects can be activated together after creation.

## 3. Special / non-obvious tools

These are easy to misuse:

- **`GetSqlQuery`** (via `abap_read`) — executes an ABAP **SQL SELECT** (read-only) on tables/CDS via ADT Data Preview. Parameter `sql_query` is required; `row_number` caps rows (default 100). It is a read: never use it to change data, and never claim it returns more than `row_number` rows.
- **`SearchSource`** (via `abap_search`) — full-text source search **inside packages**. `packages` is required and accepts `*` masks (`Z*`, `ZFI_*`, `/NS/Z*`) or exact names; mask resolution is best-effort — **prefer concrete package names when you need certainty**. Controls after package resolution: `object_types` (`FUGR`/`CLAS`/`PROG`), `object_filter`, `max_objects`. `exclude_comments=true` skips comment lines. `truncated.by_object_cap` only means one object hit the per-object cap (`max_hits_per_object`) — raise that to see more. **Run only ONE `SearchSource` at a time** against a system; parallel calls saturate the backend and time out. Combine terms in a single call instead.
- **`RuntimeRunClass` / `RuntimeRunProgram`** (via `abap_write` — the `Run*` family is classified as write) — **execute** ABAP code (`if_oo_adt_classrun` for classes). This runs on the real system with real side effects: confirm with the user before executing, and prefer running the user's own class/program only. `profile=true` adds a profiler trace (returns `profilerId`/`traceId`).
- **`RuntimeGetDumpById` / `RuntimeListFeeds` / `RuntimeGetGatewayErrorLog` / `RuntimeListSystemMessages`** (via `abap_read`) — inspect runtime dumps / gateway error logs / system messages. Use `RuntimeListFeeds` first to find dump IDs, then `RuntimeGetDumpById` with the ID (the `dump_id` must be a bare file-name ID, without `/`). Good for debugging failed runs.
- **`GetSession` / `GetObjectNodeFromCache`** (via `abap_read`) — session & cache helpers; `GetSession` is also the connectivity probe (see §0).
- **Analysis tools** — `GetAbapAST`, `GetAbapSemanticAnalysis`, `GetAbapSystemSymbols`, `GetTypeInfo`, `GetObjectStructure`, `GetObjectVersions` / `GetObjectVersionDiff` / `GetObjectVersionSource` go via `abap_read`; `GetWhereUsed` goes via `abap_search` (it matches the search facade). These are read-only deep-analysis helpers; use them for impact analysis and version review instead of guessing from local files.
- **`CreateTransport`** (via `abap_write`) — see §1. `transport_type`: `workbench` (cross-client, default) or `customizing` (client-specific); `description` is mandatory.

## 4. Decision rules — tool vs local files

- **Repository truth**: prefer the facade-wrapped ABAP tools (`abap_read`/`abap_search` → `Get*`/`Read*`/`Search*`) over reading local copies — the system, not disk, is authoritative for ABAP objects.
- **Read-only vs write**: use read-only tools (`Get*`, `Read*`, `Search*`, `List*`, analysis tools — via `abap_read`/`abap_search`) freely. For **writes** (`Create*`, `Update*`, `Delete*`, `Activate*`, runtime execution — via `abap_write`) be deliberate: know the object, have a transport request (§1), and confirm side effects with the user.
- **Fallback**: if the MCP is unavailable, say so and inspect local files as a best-effort, but flag that ABAP changes still need the MCP + a transport request.
- **Naming**: ABAP object names are uppercase (e.g. `ZCL_MY_CLASS`); keep them uppercase in tool arguments.

## 5. Common pitfalls

- Assuming the first search must know the exact core tool name — use a capability keyword or an empty query to browse, then use the returned exact name and `inputSchema`.
- Forwarding a core tool through the **wrong facade** (e.g. `GetWhereUsed` through `abap_read`) — read the server's hint or fall back to `abap_execute`.
- Writing without a transport request (see §1).
- `GetSqlQuery` used for anything but read-only SELECT.
- Parallel `SearchSource` calls (they time out — run one at a time).
- Activating dependent objects out of order — batch with `ActivateObjects` in dependency order.
- Inventing type codes in `ActivateObjects` — use the table in §2.
