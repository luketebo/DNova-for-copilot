import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';

/**
 * Bundled ABAP ADT MCP server integration.
 *
 * Registers `@mcp-abap-adt/core` through the `contributes.mcpServerDefinitionProviders`
 * contribution point so the ABAP ADT tools are available to the language model
 * (e.g. Copilot Chat). The server ships inside this extension, so users do not
 * need to install it globally. SAP connection parameters are read from the
 * `dnova-copilot.mcp.abapAdt.*` settings and passed to the server as environment
 * variables.
 */

const MCP_PROVIDER_ID = 'dnova.mcp-abap-adt';
const MCP_SERVER_LABEL = 'dnova-abap-mcp';
const MCP_SERVER_VERSION = '8.13.0-facade.6';
const SECRET_PASSWORD_KEY = 'dnova.mcp.abapAdt.password';
const RELATIVE_CORE_SERVER_JS = path.join(
	'node_modules',
	'@mcp-abap-adt',
	'core',
	'bin',
	'mcp-abap-adt.js',
);
const RELATIVE_FACADE_JS = path.join('out', 'abapFacade.js');

interface AbapAdtSettings {
	enabled: boolean;
	httpEnabled: boolean;
	httpHost: string;
	httpPort: number;
	startupCheck: boolean;
	url: string;
	client: string;
	username: string;
	password: string;
	language: string;
	systemType: string;
	authType: string;
	useSecretStorage: boolean;
	envPath: string;
	exposition: string;
}

function readSettings(): AbapAdtSettings {
	const cfg = vscode.workspace.getConfiguration('dnova-copilot.mcp.abapAdt');
	return {
		enabled: cfg.get<boolean>('enabled', true),
		httpEnabled: cfg.get<boolean>('httpEnabled', true),
		httpHost: cfg.get<string>('httpHost', '127.0.0.1'),
		httpPort: cfg.get<number>('httpPort', 3000),
		startupCheck: cfg.get<boolean>('startupCheck', true),
		url: cfg.get<string>('url', ''),
		client: cfg.get<string>('client', ''),
		username: cfg.get<string>('username', ''),
		password: cfg.get<string>('password', ''),
		language: cfg.get<string>('language', ''),
		systemType: cfg.get<string>('systemType', 'onprem'),
		authType: cfg.get<string>('authType', 'basic'),
		useSecretStorage: cfg.get<boolean>('useSecretStorage', false),
		envPath: cfg.get<string>('envPath', ''),
		exposition: cfg.get<string>('exposition', 'readonly'),
	};
}

/**
 * Resolve the SAP password. When `useSecretStorage` is enabled the password is
 * read from the OS-backed `SecretStorage` instead of the settings file.
 */
async function resolvePassword(
	context: vscode.ExtensionContext,
	settings: AbapAdtSettings,
): Promise<string> {
	if (settings.useSecretStorage) {
		return (await context.secrets.get(SECRET_PASSWORD_KEY)) ?? '';
	}
	return settings.password;
}

/** Command handler — prompts for the SAP password and stores it in SecretStorage. */
export async function setAbapAdtPassword(context: vscode.ExtensionContext): Promise<void> {
	const password = await vscode.window.showInputBox({
		password: true,
		placeHolder: '••••••••',
		title: 'dnova-abap-mcp',
		prompt: 'Enter the SAP password',
		ignoreFocusOut: true,
	});
	if (password === undefined) {
		return; // cancelled
	}
	await context.secrets.store(SECRET_PASSWORD_KEY, password);
	void vscode.window.showInformationMessage('dnova-abap-mcp: SAP password saved.');
}

/**
 * Resolve a Node.js executable that satisfies the `>=22` engine requirement of
 * `@mcp-abap-adt/core`. Prefers the system `node` (resolved via PATH), falling
 * back to the runtime embedded in VS Code.
 */
function resolveNodeExecutable(): string {
	try {
		const resolved = cp
			.execFileSync('node', ['-e', 'process.stdout.write(process.execPath)'], {
				encoding: 'utf8',
			})
			.trim();
		if (resolved) {
			return resolved;
		}
	} catch {
		// Fall back to the VS Code embedded runtime below.
	}
	return process.execPath;
}

/** Quote a value as a single-quoted dotenv literal so `#`, spaces etc. are safe. */
function quoteEnvValue(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Generate a `.env` file from the extension settings so the v2 server can read
 * the SAP connection parameters (it does not accept them as process env vars).
 * Returns the file path, or `undefined` when no URL is configured.
 */
async function ensureGeneratedEnvFile(
	context: vscode.ExtensionContext,
	settings: AbapAdtSettings,
): Promise<string | undefined> {
	if (!settings.url) {
		logger.warn(
			'ABAP ADT MCP: no SAP_URL configured — .env NOT generated. Server will run in inspection-only (mock) mode and cannot connect to SAP.',
		);
		return undefined;
	}
	const password = await resolvePassword(context, settings);
	if (!password) {
		logger.warn(
			`ABAP ADT MCP: no password resolved — ${settings.useSecretStorage ? 'useSecretStorage=true but SecretStorage is empty (run "DNova: Set ABAP ADT MCP Password")' : 'password setting is empty'}. Connection will likely fail with 401/403.`,
		);
	}
	const lines = [
		`SAP_URL=${quoteEnvValue(settings.url)}`,
		`SAP_CLIENT=${quoteEnvValue(settings.client)}`,
		`SAP_AUTH_TYPE=${quoteEnvValue(settings.authType)}`,
		`SAP_SYSTEM_TYPE=${quoteEnvValue(settings.systemType)}`,
		`SAP_USERNAME=${quoteEnvValue(settings.username)}`,
	];
	if (password) {
		lines.push(`SAP_PASSWORD=${quoteEnvValue(password)}`);
	}
	if (settings.language) {
		lines.push(`SAP_LANGUAGE=${quoteEnvValue(settings.language)}`);
	}

	const dir = context.globalStorageUri;
	await fs.promises.mkdir(dir.fsPath, { recursive: true });
	const filePath = path.join(dir.fsPath, 'abap-adt.env');
	await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
	logger.info(
		`ABAP ADT MCP: .env regenerated at ${filePath} (url=${settings.url}, passwordInjected=${password ? 'yes' : 'no'}, secretStorage=${settings.useSecretStorage})`,
	);
	return filePath;
}

/** Deterministic path of the generated `.env` file inside global storage. */
function getGeneratedEnvPath(context: vscode.ExtensionContext): string {
	return vscode.Uri.joinPath(context.globalStorageUri, 'abap-adt.env').fsPath;
}

export async function registerMcpServer(context: vscode.ExtensionContext): Promise<void> {
	const definitionsChanged = new vscode.EventEmitter<void>();
	let httpChild: cp.ChildProcess | undefined;

	function stopHttpServer(): void {
		if (httpChild && !httpChild.killed) {
			httpChild.kill();
		}
		httpChild = undefined;
	}

	// Regenerate the `.env` file from settings (or log why it cannot be built).
	// This keeps `provideMcpServerDefinitions` synchronous/side-effect free so it
	// matches the pattern of extensions whose MCP servers show up in the
	// "MCP SERVERS - INSTALLED" list (e.g. fiori-mcp).
	async function regenerateEnv(): Promise<void> {
		const settings = readSettings();
		if (settings.envPath) {
			logger.info(`ABAP ADT MCP: using user-specified envPath=${settings.envPath}`);
			return;
		}
		if (!settings.url) {
			logger.warn('ABAP ADT MCP: no SAP_URL configured — .env will not be generated; the server starts in inspection-only mode');
			return;
		}
		await ensureGeneratedEnvFile(context, settings);
	}

	try {
		await regenerateEnv();
	} catch (error) {
		logger.warn('Failed to pre-generate ABAP ADT .env file', error);
	}

	async function startHttpServer(): Promise<void> {
		const settings = readSettings();
		stopHttpServer();
		if (!settings.enabled || !settings.httpEnabled) {
			return;
		}
		const facadeJs = path.join(context.extensionPath, RELATIVE_FACADE_JS);
		const coreJs = path.join(context.extensionPath, RELATIVE_CORE_SERVER_JS);
		if (!fs.existsSync(facadeJs) || !fs.existsSync(coreJs)) {
			logger.warn('ABAP ADT MCP: HTTP facade unavailable because bundled files are missing');
			return;
		}
		const args = [
			facadeJs,
			'--extension-root',
			context.extensionPath,
			'--core-server',
			coreJs,
			'--transport',
			'http',
			'--host',
			settings.httpHost,
			'--port',
			String(settings.httpPort),
			'--system-type',
			settings.systemType,
			'--exposition',
			settings.exposition,
		];
		const envPath = settings.envPath || getGeneratedEnvPath(context);
		if (envPath) args.push('--env-path', envPath);
		const child = cp.spawn(resolveNodeExecutable(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
		httpChild = child;
		child.stderr?.on('data', (chunk: Buffer) => {
			logger.info(`[abap-facade-http] ${chunk.toString().trimEnd()}`);
		});
		child.on('error', (error) => logger.error('ABAP ADT MCP HTTP server failed', error));
		child.on('exit', (code, signal) => {
			logger.info(`ABAP ADT MCP HTTP server exited code=${code ?? 'none'} signal=${signal ?? 'none'}`);
			if (httpChild === child) httpChild = undefined;
		});
		logger.info(`ABAP ADT MCP HTTP server starting on http://${settings.httpHost}:${settings.httpPort}/mcp`);
	}

	await startHttpServer();

	const disposable = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
		onDidChangeMcpServerDefinitions: definitionsChanged.event,
		provideMcpServerDefinitions: (): vscode.McpServerDefinition[] => {
			const settings = readSettings();
			if (!settings.enabled) {
				return [];
			}
			if (!settings.httpEnabled) {
				return [];
			}

			// HTTP is the only supported transport. Do not fall back to stdio:
			// otherwise disabling HTTP would silently expose a second MCP path.
			return [
				new vscode.McpHttpServerDefinition(
					MCP_SERVER_LABEL,
					vscode.Uri.parse(`http://${settings.httpHost}:${settings.httpPort}/mcp`),
					{},
					MCP_SERVER_VERSION,
				),
			];
		},
		resolveMcpServerDefinition: (
			server: vscode.McpServerDefinition,
		): vscode.McpServerDefinition | undefined => server,
	});

	// Fix #4: settings changes no longer require a full window reload. When the
	// `dnova-copilot.mcp.abapAdt.*` settings change, regenerate the `.env` file
	// and notify the editor so it restarts the MCP server with the new params.
	const configListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
		if (!event.affectsConfiguration('dnova-copilot.mcp.abapAdt')) {
			return;
		}
		logger.info('ABAP ADT MCP: configuration changed — regenerating .env and notifying editor');
		try {
			await regenerateEnv();
			await startHttpServer();
			definitionsChanged.fire();
			if (readSettings().httpEnabled && readSettings().startupCheck) {
				void runStartupCheck(context).catch((error) => {
					logger.warn('ABAP ADT MCP: config-change startup check threw an error', error);
				});
			}
		} catch (error) {
			logger.warn('ABAP ADT MCP: failed to regenerate .env on config change', error);
		}
	});

	context.subscriptions.push(
		disposable,
		definitionsChanged,
		configListener,
		new vscode.Disposable(stopHttpServer),
	);

	// Remove any legacy duplicate manual MCP config (mcp.json) so only the
	// auto-registered `dnova-abap-mcp` server runs in this workspace.
	void cleanupDuplicateMcpJsonConfig()
		.then((cleaned) => {
			if (cleaned.length > 0) {
				logger.info(`ABAP ADT MCP: removed duplicate config from ${cleaned.join(', ')}`);
			}
		})
		.catch((error) => {
			logger.warn('ABAP ADT MCP: failed to clean duplicate config on startup', error);
		});

	// Startup health check — delayed so activation is never blocked. When
	// enabled it spawns the bundled server and calls GetSession against SAP,
	// then notifies the user of success/failure (with an actionable button).
	const startupCheckTimer = setTimeout(() => {
		void runStartupCheck(context).catch((error) => {
			logger.warn('ABAP ADT MCP: startup check threw an error', error);
		});
	}, 5000);
	context.subscriptions.push(
		new vscode.Disposable(() => clearTimeout(startupCheckTimer)),
	);
}

// ---- Startup health check --------------------------------------------------

interface McpConnectionTestResult {
	ok: boolean;
	error?: string;
}

/** Send one JSON-RPC request to the local streamable HTTP MCP endpoint. */
function requestHttpMcp(
	settings: AbapAdtSettings,
	request: Record<string, unknown>,
): Promise<{ statusCode?: number; body: string; error?: string }> {
	return new Promise((resolve) => {
		const body = JSON.stringify(request);
		const req = http.request(
			{
				host: settings.httpHost,
				port: settings.httpPort,
				path: '/mcp',
				method: 'POST',
				timeout: 5000,
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'content-length': Buffer.byteLength(body),
				},
			},
			(response) => {
				let responseBody = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					responseBody += chunk;
				});
				response.on('end', () =>
					resolve({ statusCode: response.statusCode, body: responseBody }),
				);
			},
		);
		req.on('timeout', () => req.destroy(new Error('request timed out')));
		req.on('error', (error) =>
			resolve({
				body: '',
				error: `${error.message} (http://${settings.httpHost}:${settings.httpPort}/mcp)`,
			}),
		);
		req.end(body);
	});
}

/** Verify that the HTTP process is listening and that the facade is serving tools. */
async function testHttpMcpService(settings: AbapAdtSettings): Promise<McpConnectionTestResult> {
	const response = await requestHttpMcp(settings, {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/list',
		params: {},
	});
	if (response.error) {
		return { ok: false, error: response.error };
	}
	if (response.statusCode !== 200) {
		return {
			ok: false,
			error: `HTTP ${response.statusCode ?? 'unknown'} from http://${settings.httpHost}:${settings.httpPort}/mcp`,
		};
	}
	if (!response.body.includes('abap_tool_search') || !response.body.includes('abap_execute')) {
		return { ok: false, error: 'HTTP MCP responded, but facade tools were not discovered' };
	}
	return { ok: true };
}

/** Probe SAP through the already-running HTTP facade when credentials are complete. */
async function testHttpMcpConnection(
	settings: AbapAdtSettings,
): Promise<McpConnectionTestResult> {
	const service = await testHttpMcpService(settings);
	if (!service.ok) {
		return service;
	}
	const response = await requestHttpMcp(settings, {
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/call',
		params: { name: 'abap_execute', arguments: { tool: 'GetSession', arguments: {} } },
	});
	if (response.error) {
		return { ok: false, error: response.error };
	}
	if (response.statusCode !== 200) {
		return { ok: false, error: `HTTP ${response.statusCode ?? 'unknown'} while probing GetSession` };
	}
	if (response.body.includes('"isError":true') || response.body.includes('"isError": true')) {
		return { ok: false, error: 'GetSession returned an error through the HTTP MCP service' };
	}
	return { ok: true };
}

/**
 * Spawn the bundled MCP server and verify it can reach SAP by sending an
 * `initialize` request followed by a real `GetSession` tool call. The child is
 * killed afterwards. Never blocks activation — it is only invoked from the
 * delayed startup check.
 */
// Kept exported for compatibility with older extension tests; production checks
// use the running HTTP service exclusively.
export function testMcpConnection(
	context: vscode.ExtensionContext,
	settings: AbapAdtSettings,
): Promise<McpConnectionTestResult> {
	return new Promise((resolve) => {
		const serverJs = path.join(context.extensionPath, RELATIVE_CORE_SERVER_JS);
		if (!fs.existsSync(serverJs)) {
			resolve({
				ok: false,
				error: 'bundled MCP server file not found (please reinstall the extension)',
			});
			return;
		}

		const envPath = settings.envPath || getGeneratedEnvPath(context);
		const args = ['--transport=stdio'];
		if (envPath) {
			args.push('--env-path', envPath, '--system-type', settings.systemType);
		}
		args.push('--exposition', settings.exposition);

		let child: cp.ChildProcess;
		try {
			child = cp.spawn(resolveNodeExecutable(), [serverJs, ...args], {
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch (error) {
			resolve({
				ok: false,
				error: `spawn failed: ${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}

		let settled = false;
		let stdoutBuffer = '';
		const pending = new Map<number, (message: Record<string, unknown>) => void>();
		let nextId = 1;

		const finish = (result: McpConnectionTestResult): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			try {
				child.kill();
			} catch {
				// Already exited — nothing to clean up.
			}
			resolve(result);
		};

		const timer = setTimeout(() => {
			finish({
				ok: false,
				error: 'timeout — MCP server did not respond within 15s',
			});
		}, 15000);

		child.on('error', (error) => finish({ ok: false, error: error.message }));

		child.stdout?.on('data', (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			let newlineIndex: number;
			while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
				const line = stdoutBuffer.slice(0, newlineIndex).trim();
				stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
				if (!line) {
					continue;
				}
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue; // Not JSON — probably a stray log line.
				}
				const id = message.id;
				if (typeof id === 'number' && pending.has(id)) {
					const handler = pending.get(id)!;
					pending.delete(id);
					handler(message);
				}
			}
		});

		const request = (method: string, params: unknown): Promise<Record<string, unknown>> =>
			new Promise((res, rej) => {
				const id = nextId++;
				const requestTimer = setTimeout(() => {
					pending.delete(id);
					rej(new Error(`${method} timed out`));
				}, 10000);
				pending.set(id, (message) => {
					clearTimeout(requestTimer);
					res(message);
				});
				child.stdin?.write(
					JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n',
				);
			});

		void (async () => {
			try {
				const init = await request('initialize', {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'dnova-startup-check', version: '1.0.0' },
				});
				if (init.error) {
					finish({
						ok: false,
						error: `initialize failed: ${JSON.stringify(init.error)}`,
					});
					return;
				}

				const call = await request('tools/call', {
					name: 'GetSession',
					arguments: {},
				});
				const rpcError = call.error as { message?: string } | undefined;
				if (rpcError) {
					finish({
						ok: false,
						error: rpcError.message ?? 'GetSession failed',
					});
					return;
				}
				const result = call.result as
					| {
							isError?: boolean;
							content?: Array<{ type?: string; text?: string }>;
					  }
					| undefined;
				const text = result?.content?.map((c) => c.text ?? '').join(' ') ?? '';
				if (result?.isError) {
					finish({
						ok: false,
						error: text || 'GetSession returned an error (credentials rejected or server in inspection-only mode)',
					});
					return;
				}
				if (/session/i.test(text) && !/inspection|mock|not configured|no SAP system/i.test(text)) {
					finish({ ok: true });
					return;
				}
				// The tool answered but the payload looks non-connecting — treat as
				// failure unless the response was just empty.
				finish({
					ok: text === '',
					error: text || 'GetSession did not return a session (server likely in inspection-only mode)',
				});
			} catch (error) {
				finish({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	});
}

/**
 * Startup health check for the bundled ABAP ADT MCP server. Runs a few seconds
 * after activation (delayed so it never blocks startup). When the MCP is
 * disabled it does nothing. Automatic checks respect `startupCheck`; an explicit
 * command invocation can force a check. When the configuration is incomplete it
 * warns and offers to open the config report; otherwise it checks the running
 * running HTTP service and probes GetSession through it.
 */
export async function runStartupCheck(
	context: vscode.ExtensionContext,
	manual = false,
): Promise<void> {
	const settings = readSettings();
	if (!settings.enabled) {
		logger.info('ABAP ADT MCP: startup check skipped — MCP disabled');
		return;
	}
	if (!settings.startupCheck && !manual) {
		logger.info('ABAP ADT MCP: startup check skipped — startupCheck setting is off');
		return;
	}
	if (!settings.httpEnabled) {
		logger.info('ABAP ADT MCP: startup check skipped — HTTP MCP is disabled');
		if (manual) {
			void vscode.window.showWarningMessage(t('mcp.startup.httpDisabled'));
		}
		return;
	}

	// In HTTP mode, check the listening service first. This makes port conflicts,
	// failed child startup, and dead endpoints visible even when SAP credentials
	// are also incomplete.
	if (settings.httpEnabled) {
		logger.info(`ABAP ADT MCP: startup check — probing HTTP service at http://${settings.httpHost}:${settings.httpPort}/mcp…`);
		const service = await testHttpMcpService(settings);
		if (!service.ok) {
			logger.warn(`ABAP ADT MCP: HTTP startup check — FAILED: ${service.error}`);
			const action = await vscode.window.showErrorMessage(
				t('mcp.startup.httpFailed', service.error ?? 'unknown error'),
				t('mcp.startup.openConfig'),
				t('mcp.startup.retry'),
				t('mcp.startup.dismiss'),
			);
			if (action === t('mcp.startup.openConfig')) {
				void showAbapAdtMcpConfig(context);
			} else if (action === t('mcp.startup.retry')) {
				void runStartupCheck(context, true);
			}
			return;
		}
	}

	// Config completeness (fast, no spawn).
	const missing: string[] = [];
	if (!settings.url) {
		missing.push(t('mcp.startup.missing.url'));
	}
	if (!settings.username) {
		missing.push(t('mcp.startup.missing.username'));
	}
	if (!(await resolvePassword(context, settings))) {
		missing.push(t('mcp.startup.missing.password'));
	}

	if (missing.length > 0) {
		logger.warn(`ABAP ADT MCP: startup check — not fully configured, missing: ${missing.join(', ')}`);
		const action = await vscode.window.showWarningMessage(
			t('mcp.startup.notConfigured', missing.join('、')),
			t('mcp.startup.openConfig'),
			t('mcp.startup.dismiss'),
		);
		if (action === t('mcp.startup.openConfig')) {
			void showAbapAdtMcpConfig(context);
		}
		return;
	}

	// Real connection probe.
	logger.info('ABAP ADT MCP: startup check — probing SAP connection…');
	const result = await testHttpMcpConnection(settings);
	if (result.ok) {
		logger.info('ABAP ADT MCP: startup check — OK (connected to SAP)');
		void vscode.window.showInformationMessage(t('mcp.startup.ok'));
		return;
	}

	logger.warn(`ABAP ADT MCP: startup check — FAILED: ${result.error}`);
	const action = await vscode.window.showErrorMessage(
		t('mcp.startup.failed', result.error ?? 'unknown error'),
		t('mcp.startup.openConfig'),
		t('mcp.startup.dismiss'),
	);
	if (action === t('mcp.startup.openConfig')) {
		void showAbapAdtMcpConfig(context);
	}
}

// ---- mcp.json configuration helper -----------------------------------------

interface McpJsonFile {
	servers?: Record<string, unknown>;
	[key: string]: unknown;
}

/** VS Code user-level (global) mcp.json — servers here apply to all workspaces. */
function getUserMcpJsonPath(): string | undefined {
	const home = os.homedir();
	switch (process.platform) {
		case 'darwin':
			return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
		case 'win32': {
			const appData = process.env.APPDATA;
			return appData ? path.join(appData, 'Code', 'User', 'mcp.json') : undefined;
		}
		default:
			return path.join(home, '.config', 'Code', 'User', 'mcp.json');
	}
}

/** Workspace-level `.vscode/mcp.json` — scoped to the current workspace. */
function getWorkspaceMcpJsonPath(): vscode.Uri | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder ? vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json') : undefined;
}

/**
 * Remove any legacy manual `mcp-abap-adt` entry from `mcp.json` (global and
 * workspace). The extension registers the server automatically via
 * `mcpServerDefinitionProviders` as `dnova-abap-mcp`, so a manually-written
 * `mcp-abap-adt` entry would make VS Code start two identical servers in one
 * workspace. Returns the labels of the files that were cleaned.
 */
async function cleanupDuplicateMcpJsonConfig(): Promise<string[]> {
	const candidates: Array<[string, string | undefined]> = [
		['global mcp.json', getUserMcpJsonPath()],
		['workspace .vscode/mcp.json', getWorkspaceMcpJsonPath()?.fsPath],
	];
	const cleaned: string[] = [];
	for (const [label, filePath] of candidates) {
		if (!filePath || !fs.existsSync(filePath)) {
			continue;
		}
		try {
			const config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as McpJsonFile;
			const servers = config.servers as Record<string, unknown> | undefined;
			if (servers && typeof servers['mcp-abap-adt'] !== 'undefined') {
				delete servers['mcp-abap-adt'];
				await fs.promises.writeFile(
					filePath,
					JSON.stringify(config, null, 2) + '\n',
					'utf8',
				);
				cleaned.push(label);
			}
		} catch (error) {
			logger.warn(`ABAP ADT MCP: failed to clean duplicate config in ${label}`, error);
		}
	}
	return cleaned;
}

/**
 * Command handler — ensures there is exactly ONE ABAP ADT MCP per workspace.
 *
 * The extension registers the server automatically via
 * `mcpServerDefinitionProviders` (as `dnova-abap-mcp`), so writing it into
 * `mcp.json` would create a duplicate. This command instead removes any legacy
 * manual `mcp-abap-adt` entry from the global and workspace `mcp.json`.
 */
export async function configureAbapAdtMcp(_context: vscode.ExtensionContext): Promise<void> {
	const cleaned = await cleanupDuplicateMcpJsonConfig();
	if (cleaned.length > 0) {
		void vscode.window.showInformationMessage(
			`已清理重复的 ABAP ADT MCP 配置（${cleaned.join('、')}）。MCP 现由扩展统一管理，每个工作区只启动一个（dnova-abap-mcp）。`,
		);
		return;
	}
	void vscode.window.showInformationMessage(
		'未发现重复的手动 MCP 配置。ABAP ADT MCP（dnova-abap-mcp）已由扩展自动注册，无需写入 mcp.json。',
	);
}

/**
 * Command handler — reveals the full connection/health status of the bundled
 * MCP server: where the `.env` lives, what it contains (password masked), the
 * launch arguments, and any missing pieces that would prevent a real SAP
 * connection. Fixes the "black box" problems (server config invisible, status
 * not exposed, errors not pointing at the real cause).
 */
export async function showAbapAdtMcpConfig(context: vscode.ExtensionContext): Promise<void> {
	const settings = readSettings();
	const generatedPath = getGeneratedEnvPath(context);
	const effectiveEnvPath = settings.envPath || generatedPath;
	const envExists = effectiveEnvPath ? fs.existsSync(effectiveEnvPath) : false;

	let envContent = '(未配置 SAP_URL，未生成 .env)';
	if (settings.envPath) {
		envContent = `使用用户指定的 envPath: ${settings.envPath}\n` + (envExists ? '(文件存在)' : '(⚠️ 文件不存在)');
	} else if (envExists) {
		try {
			envContent = fs
				.readFileSync(generatedPath, 'utf8')
				.split('\n')
				.map((line) => (line.startsWith('SAP_PASSWORD') ? 'SAP_PASSWORD=********' : line))
				.join('\n');
		} catch {
			envContent = '(读取失败)';
		}
	}

	const password = await resolvePassword(context, settings);
	const issues: string[] = [];
	if (!settings.enabled) issues.push('⚠️ enabled=false — MCP 不会启动');
	if (!settings.url) issues.push('❌ SAP_URL 未配置 — 无法连 SAP（服务器以 inspection-only 模式运行）');
	if (settings.useSecretStorage && !password) {
		issues.push('❌ useSecretStorage=true 但 SecretStorage 中没有密码 — 请运行 "DNova: Set ABAP ADT MCP Password"');
	}
	if (!settings.useSecretStorage && !settings.password) issues.push('⚠️ password 设置为空');
	if (!settings.envPath && !envExists) issues.push('❌ 自动生成的 .env 不存在 — 请检查 url 配置或重载窗口');
	if (settings.envPath && !envExists) issues.push('❌ envPath 指向的文件不存在');

	const serverJs = path.join(context.extensionPath, RELATIVE_CORE_SERVER_JS);
	const launchTransport = `--transport=http --host ${settings.httpHost} --port ${settings.httpPort}`;
	const report = [
		'==== dnova-abap-mcp 配置状态 ====',
		`● enabled           : ${settings.enabled}`,
		`● SAP URL           : ${settings.url || '(未配置)'}`,
		`● Client            : ${settings.client}`,
		`● Username          : ${settings.username}`,
		`● 密码来源           : ${settings.useSecretStorage ? 'SecretStorage(钥匙串)' : 'settings.json'}`,
		`● 密码已解析         : ${password ? '✅ 是' : '❌ 否'}`,
		`● systemType        : ${settings.systemType}`,
		`● HTTP MCP          : ${settings.httpEnabled ? `http://${settings.httpHost}:${settings.httpPort}/mcp` : 'disabled (MCP unavailable)'}`,
		`● 服务器入口         : ${serverJs} (${fs.existsSync(serverJs) ? '存在' : '缺失'})`,
		`● env 文件           : ${effectiveEnvPath} (${envExists ? '存在' : '不存在'})`,
		`● 启动参数           : ${launchTransport} --env-path "${effectiveEnvPath}" --system-type ${settings.systemType} --exposition ${settings.exposition}`,
		'',
		'---- env 内容(密码打码) ----',
		envContent,
		'',
		'---- 诊断 ----',
		...(issues.length ? issues : ['✅ 配置看起来完整']),
		'==============================',
	].join('\n');

	const channel = vscode.window.createOutputChannel('dnova-abap-mcp');
	channel.clear();
	channel.append(report);
	channel.show();
	logger.info('ABAP ADT MCP config report:\n' + report);
}
