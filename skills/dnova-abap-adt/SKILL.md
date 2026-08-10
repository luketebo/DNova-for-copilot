---
name: dnova-abap-adt
description: 'Use when the task involves SAP ABAP development objects — reading, creating, updating, activating, or searching classes, function modules, programs, tables, CDS views, data elements, domains, behavior definitions, or transport requests — and the bundled dnova-abap-mcp MCP server is available (tools prefixed mcp__dnova-abap-mcp__). Covers the non-obvious tools, the create-update-activate workflow, transport-request handling, and when to use the tools vs local files.'
---

# DNova ABAP ADT — Tool Usage Guide

This workspace uses the bundled **`dnova-abap-mcp`** MCP server for real SAP ABAP work. Its tools appear under the `mcp__dnova-abap-mcp__` prefix. This guide explains how to use the tools correctly.

## 0. Connection prerequisite

Only call `mcp__dnova-abap-mcp__*` tools when the server is **enabled and connected** to SAP. A quick probe is `mcp__dnova-abap-mcp__GetSession` (returns a `session_id`). If the tools error with connection/unauthorized issues, tell the user the MCP is not connected and suggest `DNova: Check ABAP ADT MCP Connection` or `DNova: Show ABAP ADT MCP Config`.

## 1. Transport requests — CHECK BEFORE ANY WRITE (critical)

In SAP, **every create/update/activate of a transportable object needs a transport request**. Tools that write (e.g. `Create*`, `Update*`, `Delete*`, some `Activate*`) accept a `transport_request` argument such as `E19K905635`.

Before performing a write:

1. If the user already named a request, use it.
2. Otherwise, **check whether the object is attached to a request** — call `mcp__dnova-abap-mcp__ListTransports` (or `GetTransport`) to list the user's open requests.
3. If nothing suitable exists, **do NOT invent a request number** — ask the user to provide or create one, or offer `mcp__dnova-abap-mcp__CreateTransport` (requires `description`; `transport_type` is `workbench` or `customizing`).

Never fabricate a transport number. Missing/invalid requests are the #1 cause of failed saves.

## 2. Standard workflow: create → update → activate

For building or changing an object, follow this order:

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

- **`GetSqlQuery`** — executes an ABAP **SQL SELECT** (read-only) on tables/CDS via ADT Data Preview. Parameter `sql_query` is required; `row_number` caps rows (default 100). It is a read: never use it to change data, and never claim it returns more than `row_number` rows.
- **`SearchSource`** — full-text source search **inside packages**. `packages` is required and accepts `*` masks (`Z*`, `ZFI_*`, `/NS/Z*`) or exact names; mask resolution is best-effort — **prefer concrete package names when you need certainty**. Controls after package resolution: `object_types` (`FUGR`/`CLAS`/`PROG`), `object_filter`, `max_objects`. `exclude_comments=true` skips comment lines. `truncated.by_object_cap` only means one object hit the per-object cap (`max_hits_per_object`) — raise that to see more. **Run only ONE `SearchSource` at a time** against a system; parallel calls saturate the backend and time out. Combine terms in a single call instead.
- **`RuntimeRunClass` / `RuntimeRunProgram`** — **execute** ABAP code (`if_oo_adt_classrun` for classes). This runs on the real system with real side effects: confirm with the user before executing, and prefer running the user's own class/program only. `profile=true` adds a profiler trace (returns `profilerId`/`traceId`).
- **`RuntimeGetDumpById` / `RuntimeListFeeds` / `RuntimeGetGatewayErrorLog` / `RuntimeListSystemMessages`** — inspect runtime dumps / gateway error logs / system messages. Use `RuntimeListFeeds` first to find dump IDs, then `RuntimeGetDumpById` with the ID. Good for debugging failed runs.
- **`GetSession` / `GetObjectNodeFromCache`** — session & cache helpers; `GetSession` is also the connectivity probe (see §0).
- **Analysis tools** — `GetWhereUsed`, `GetAbapAST`, `GetAbapSemanticAnalysis`, `GetAbapSystemSymbols`, `GetTypeInfo`, `GetObjectStructure`, `GetObjectVersions` / `GetObjectVersionDiff` / `GetObjectVersionSource` are read-only deep-analysis helpers; use them for impact analysis and version review instead of guessing from local files.
- **`CreateTransport`** — see §1. `transport_type`: `workbench` (cross-client, default) or `customizing` (client-specific); `description` is mandatory.

## 4. Decision rules — tool vs local files

- **Repository truth**: prefer `mcp__dnova-abap-mcp__Get*/Read*/Search*` over reading local copies — the system, not disk, is authoritative for ABAP objects.
- **Read-only vs write**: use read-only tools (`Get*`, `Read*`, `Search*`, `List*`, analysis tools) freely. For **writes** (`Create*`, `Update*`, `Delete*`, `Activate*`, runtime execution) be deliberate: know the object, have a transport request (§1), and confirm side effects with the user.
- **Fallback**: if the MCP is unavailable, say so and inspect local files as a best-effort, but flag that ABAP changes still need the MCP + a transport request.
- **Naming**: ABAP object names are uppercase (e.g. `ZCL_MY_CLASS`); keep them uppercase in tool arguments.

## 5. Common pitfalls

- Writing without a transport request (see §1).
- `GetSqlQuery` used for anything but read-only SELECT.
- Parallel `SearchSource` calls (they time out — run one at a time).
- Activating dependent objects out of order — batch with `ActivateObjects` in dependency order.
- Inventing type codes in `ActivateObjects` — use the table in §2.
