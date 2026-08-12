import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

interface RpcMessage {
	jsonrpc?: string;
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: Record<string, unknown>;
}

interface CoreTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

type FacadeToolName = 'abap_read' | 'abap_search' | 'abap_write' | 'abap_execute';

const READ_TOOL_PATTERN =
	/^(Get|Read|List|Find|Check|Validate|Describe|Inspect|RuntimeGet|RuntimeList)/i;
const SEARCH_TOOL_PATTERN = /^(Search|Find|GetWhereUsed|List)/i;
const WRITE_TOOL_PATTERN =
	/^(?!RuntimeGet|RuntimeList)(Activate|Create|Update|Delete|Lock|Unlock|Set|Run|Execute|Transport|Validate|Check)/i;

function matchesFacadeCategory(name: string, facadeTool: FacadeToolName): boolean {
	switch (facadeTool) {
		case 'abap_read':
			return READ_TOOL_PATTERN.test(name);
		case 'abap_search':
			return SEARCH_TOOL_PATTERN.test(name);
		case 'abap_write':
			return WRITE_TOOL_PATTERN.test(name);
		case 'abap_execute':
			return true;
	}
}

function categoryForTool(name: string): FacadeToolName | undefined {
	if (SEARCH_TOOL_PATTERN.test(name)) return 'abap_search';
	if (WRITE_TOOL_PATTERN.test(name)) return 'abap_write';
	if (READ_TOOL_PATTERN.test(name)) return 'abap_read';
	return undefined;
}

const FACADE_TOOLS = [
	{
		name: 'abap_tool_search',
		description:
			'Search the ABAP ADT core tools exposed by the current exposition setting. Use this before abap_execute when the required operation is not obvious.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Tool name, capability, or keyword to search for. Omit or leave empty to browse the catalog.',
				},
				limit: { type: 'number', minimum: 1, maximum: 30, default: 10 },
				offset: { type: 'number', minimum: 0, default: 0 },
			},
		},
	},
	{
		name: 'abap_read',
		description:
			'Read an ABAP object by forwarding to a named read-only core tool. Use abap_tool_search to find the exact tool name first.',
		inputSchema: {
			type: 'object',
			properties: {
				tool: {
					type: 'string',
					description: 'Exact core tool name, for example GetClass or ReadProgram.',
				},
				arguments: { type: 'object', additionalProperties: true },
			},
			required: ['tool', 'arguments'],
		},
	},
	{
		name: 'abap_search',
		description:
			'Search the SAP ABAP repository or source code. The tool and arguments are forwarded to the core server.',
		inputSchema: {
			type: 'object',
			properties: {
				tool: {
					type: 'string',
					description: 'Exact search core tool name, found with abap_tool_search.',
				},
				arguments: { type: 'object', additionalProperties: true },
			},
			required: ['tool', 'arguments'],
		},
	},
	{
		name: 'abap_write',
		description:
			'Create, update, delete, check, lock, unlock, or activate an ABAP object through a named core tool. Review the arguments before executing.',
		inputSchema: {
			type: 'object',
			properties: {
				tool: {
					type: 'string',
					description: 'Exact write core tool name, found with abap_tool_search.',
				},
				arguments: { type: 'object', additionalProperties: true },
			},
			required: ['tool', 'arguments'],
		},
	},
	{
		name: 'abap_execute',
		description:
			'Advanced escape hatch for any tool exposed by @mcp-abap-adt/core in the current exposition setting. Search the catalog first, then provide the exact tool name and arguments. Write tools require an exposition that includes high or low.',
		inputSchema: {
			type: 'object',
			properties: {
				tool: { type: 'string', description: 'Exact core tool name.' },
				arguments: { type: 'object', additionalProperties: true },
			},
			required: ['tool', 'arguments'],
		},
	},
];

function jsonLine(value: unknown): string {
	return JSON.stringify(value) + '\n';
}

class CoreProcess {
	private readonly child: cp.ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number | string, (message: RpcMessage) => void>();
	private nextId = 1;

	constructor(serverJs: string, args: string[]) {
		this.child = cp.spawn(process.execPath, [serverJs, ...args], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const lines = readline.createInterface({ input: this.child.stdout });
		lines.on('line', (line) => {
			try {
				const message = JSON.parse(line) as RpcMessage;
				if (message.id !== undefined) {
					this.pending.get(message.id)?.(message);
					this.pending.delete(message.id);
				}
			} catch {
				// The core server must keep stdout JSON-only; ignore malformed noise defensively.
			}
		});
		this.child.on('exit', (code, signal) => {
			const error = {
				jsonrpc: '2.0',
				error: { code: -32000, message: `ABAP core exited (${code ?? signal ?? 'unknown'})` },
			};
			for (const resolve of this.pending.values()) resolve(error);
			this.pending.clear();
		});
		this.child.stderr.on('data', (chunk) => process.stderr.write(`[abap-core] ${chunk}`));
	}

	request(method: string, params: Record<string, unknown> = {}): Promise<RpcMessage> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, 30000);
			this.pending.set(id, (message) => {
				clearTimeout(timer);
				resolve(message);
			});
			this.child.stdin.write(jsonLine({ jsonrpc: '2.0', id, method, params }));
		});
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		this.child.stdin.write(jsonLine({ jsonrpc: '2.0', method, params }));
	}

	close(): void {
		if (!this.child.killed) this.child.kill();
	}
}

function textResult(value: unknown, isError = false): Record<string, unknown> {
	return {
		content: [
			{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
		],
		...(isError ? { isError: true } : {}),
	};
}

async function callFacadeTool(
	name: string,
	input: Record<string, unknown>,
	catalog: CoreTool[],
	catalogByName: Map<string, CoreTool>,
	core: CoreProcess,
): Promise<Record<string, unknown>> {
	if (name === 'abap_tool_search') {
		const rawQuery = String(input.query ?? '').trim().toLowerCase();
		const queryTokens = rawQuery.split(/\s+/).filter(Boolean);
		const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 30);
		const offset = Math.max(Number(input.offset ?? 0), 0);
		const ranked = catalog
			.map((tool, index) => {
				const toolName = tool.name.toLowerCase();
				const description = (tool.description ?? '').toLowerCase();
				const haystack = `${toolName} ${description}`;
				if (queryTokens.length > 0 && !queryTokens.some((token) => haystack.includes(token))) {
					return undefined;
				}
				let score = 0;
				for (const token of queryTokens) {
					if (toolName === token) score += 1000;
					else if (toolName.startsWith(token)) score += 500;
					else if (toolName.includes(token)) score += 100;
					else if (description.includes(token)) score += 10;
				}
				return { tool, score, index };
			})
			.filter((entry): entry is { tool: CoreTool; score: number; index: number } => Boolean(entry))
			.sort((a, b) => b.score - a.score || a.index - b.index);
		const results = ranked
			.slice(offset, offset + limit)
			.map(({ tool }) => ({ ...tool, facade: categoryForTool(tool.name) ?? 'abap_execute' }));
		const nextOffset = offset + results.length < ranked.length ? offset + results.length : undefined;
		return textResult({
			query: rawQuery,
			total: ranked.length,
			offset,
			limit,
			nextOffset,
			results,
		});
	}
	const target = String(input.tool ?? '');
	const targetArgs = (input.arguments ?? {}) as Record<string, unknown>;
	if (!catalogByName.has(target)) {
		return textResult(`Unknown core tool: ${target}. Use abap_tool_search first.`, true);
	}
	if (name !== 'abap_execute' && !matchesFacadeCategory(target, name as FacadeToolName)) {
		const suggestedFacade = categoryForTool(target);
		const suggestion = suggestedFacade
			? `Use ${suggestedFacade} for this tool, or use abap_execute for an advanced call.`
			: 'Use abap_tool_search and then abap_execute for an advanced call.';
		return textResult(`${target} is not allowed through ${name}. ${suggestion}`, true);
	}
	const startedAt = Date.now();
	process.stderr.write(`[abap-facade] call start entry=${name} tool=${target}\n`);
	const response = await core.request('tools/call', { name: target, arguments: targetArgs });
	process.stderr.write(
		`[abap-facade] call end entry=${name} tool=${target} elapsedMs=${Date.now() - startedAt} ok=${!response.error}\n`,
	);
	return response.error ? { error: response.error } : (response.result ?? textResult('Core tool returned no result.', true));
}

async function runHttpServer(
	core: CoreProcess,
	catalog: CoreTool[],
	catalogByName: Map<string, CoreTool>,
	host: string,
	port: number,
): Promise<http.Server> {
	const app = http.createServer(async (request, response) => {
		if (request.url !== '/mcp') {
			response.writeHead(404).end();
			return;
		}
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		const server = new Server({ name: 'dnova-abap-facade', version: '1.0.0' }, { capabilities: { tools: {} } });
		server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: FACADE_TOOLS }));
		server.setRequestHandler(CallToolRequestSchema, async (rpcRequest) =>
			callFacadeTool(
				rpcRequest.params.name,
				(rpcRequest.params.arguments ?? {}) as Record<string, unknown>,
				catalog,
				catalogByName,
				core,
			),
		);
		try {
			await server.connect(transport);
			await transport.handleRequest(request, response);
		} catch (error) {
			process.stderr.write(`[abap-facade] HTTP request failed: ${error instanceof Error ? error.message : String(error)}\n`);
			if (!response.headersSent) response.writeHead(500).end();
		}
	});
	await new Promise<void>((resolve, reject) => {
		app.once('error', reject);
		app.listen(port, host, () => {
			app.removeListener('error', reject);
			process.stderr.write(`[abap-facade] HTTP listening on http://${host}:${port}/mcp\n`);
			resolve();
		});
	});
	return app;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const valueAfter = (name: string): string | undefined => {
		const index = args.indexOf(name);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const extensionRoot = valueAfter('--extension-root') ?? process.cwd();
	const coreJs =
		valueAfter('--core-server') ??
		path.join(extensionRoot, 'node_modules', '@mcp-abap-adt', 'core', 'bin', 'mcp-abap-adt.js');
	const exposition = valueAfter('--exposition') ?? 'readonly';
	const transport = valueAfter('--transport') ?? 'stdio';
	const host = valueAfter('--host') ?? '127.0.0.1';
	const port = Number(valueAfter('--port') ?? 3000);
	const coreArgs = ['--transport=stdio', '--exposition', exposition];
	const envPath = valueAfter('--env-path');
	const systemType = valueAfter('--system-type');
	if (envPath) coreArgs.push('--env-path', envPath);
	if (systemType) coreArgs.push('--system-type', systemType);
	if (!fs.existsSync(coreJs)) throw new Error(`ABAP core server not found: ${coreJs}`);

	const core = new CoreProcess(coreJs, coreArgs);
	const closeCore = (): void => core.close();
	process.once('SIGINT', closeCore);
	process.once('SIGTERM', closeCore);
	const init = await core.request('initialize', {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'dnova-abap-facade', version: '1.0.0' },
	});
	if (init.error) throw new Error(String(init.error.message ?? 'core initialize failed'));
	core.notify('notifications/initialized');
	const catalogResponse = await core.request('tools/list');
	const catalog = ((catalogResponse.result?.tools ?? []) as CoreTool[]).filter((tool) => tool.name);
	const catalogByName = new Map(catalog.map((tool) => [tool.name, tool]));
	if (transport === 'http') {
		const app = await runHttpServer(core, catalog, catalogByName, host, port);
		const close = (): void => {
			app.close();
			core.close();
		};
		process.once('SIGINT', close);
		process.once('SIGTERM', close);
		return;
	}

	const send = (message: Record<string, unknown>): void => {
		process.stdout.write(jsonLine({ jsonrpc: '2.0', ...message }));
	};
	const rl = readline.createInterface({ input: process.stdin });
	rl.on('close', closeCore);
	rl.on('line', async (line) => {
		let request: RpcMessage;
		try {
			request = JSON.parse(line) as RpcMessage;
		} catch {
			return;
		}
		if (request.id === undefined || !request.method) return;
		try {
			if (request.method === 'initialize') {
				send({
					id: request.id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: { tools: {} },
						serverInfo: { name: 'dnova-abap-facade', version: '1.0.0' },
					},
				});
				return;
			}
			if (request.method === 'tools/list') {
				send({ id: request.id, result: { tools: FACADE_TOOLS } });
				return;
			}
			if (request.method !== 'tools/call') {
				send({
					id: request.id,
					error: { code: -32601, message: `Unsupported method: ${request.method}` },
				});
				return;
			}
			const params = request.params ?? {};
			const name = String(params.name ?? '');
			const input = (params.arguments ?? {}) as Record<string, unknown>;
			const result = await callFacadeTool(name, input, catalog, catalogByName, core);
			send({ id: request.id, ...(result.error ? result : { result }) });
		} catch (error) {
			send({
				id: request.id,
				result: textResult(error instanceof Error ? error.message : String(error), true),
			});
		}
	});
}

void main().catch((error) => {
	process.stderr.write(
		`[abap-facade] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 1;
});
