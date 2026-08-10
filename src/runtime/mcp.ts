import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
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
const MCP_SERVER_LABEL = 'DTT ABAP ADT';
const MCP_SERVER_VERSION = '8.13.0';
const SECRET_PASSWORD_KEY = 'dnova.mcp.abapAdt.password';
const RELATIVE_SERVER_JS = path.join(
	'node_modules',
	'@mcp-abap-adt',
	'core',
	'bin',
	'mcp-abap-adt.js',
);

interface AbapAdtSettings {
	enabled: boolean;
	url: string;
	client: string;
	username: string;
	password: string;
	language: string;
	systemType: string;
	authType: string;
	useSecretStorage: boolean;
	envPath: string;
}

function readSettings(): AbapAdtSettings {
	const cfg = vscode.workspace.getConfiguration('dnova-copilot.mcp.abapAdt');
	return {
		enabled: cfg.get<boolean>('enabled', true),
		url: cfg.get<string>('url', ''),
		client: cfg.get<string>('client', ''),
		username: cfg.get<string>('username', ''),
		password: cfg.get<string>('password', ''),
		language: cfg.get<string>('language', ''),
		systemType: cfg.get<string>('systemType', 'onprem'),
		authType: cfg.get<string>('authType', 'basic'),
		useSecretStorage: cfg.get<boolean>('useSecretStorage', false),
		envPath: cfg.get<string>('envPath', ''),
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
		title: 'DTT ABAP ADT MCP',
		prompt: 'Enter the SAP password',
		ignoreFocusOut: true,
	});
	if (password === undefined) {
		return; // cancelled
	}
	await context.secrets.store(SECRET_PASSWORD_KEY, password);
	void vscode.window.showInformationMessage('DTT ABAP ADT MCP: SAP password saved.');
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

	const disposable = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
		onDidChangeMcpServerDefinitions: definitionsChanged.event,
		provideMcpServerDefinitions: (): vscode.McpServerDefinition[] => {
			const settings = readSettings();
			if (!settings.enabled) {
				return [];
			}

			const serverJs = path.join(context.extensionPath, RELATIVE_SERVER_JS);
			const args = ['--transport=stdio'];
			const envPath = settings.envPath || getGeneratedEnvPath(context);
			if (envPath) {
				args.push('--env-path', envPath, '--system-type', settings.systemType);
			}

			if (fs.existsSync(serverJs)) {
				// Bundled server — launch with Node so we control the runtime version.
				return [
					new vscode.McpStdioServerDefinition(
						MCP_SERVER_LABEL,
						resolveNodeExecutable(),
						[serverJs, ...args],
						undefined,
						MCP_SERVER_VERSION,
					),
				];
			}

			// Fallback: use a globally installed `mcp-abap-adt` command.
			return [
				new vscode.McpStdioServerDefinition(
					MCP_SERVER_LABEL,
					'mcp-abap-adt',
					args,
					undefined,
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
			definitionsChanged.fire();
		} catch (error) {
			logger.warn('ABAP ADT MCP: failed to regenerate .env on config change', error);
		}
	});

	context.subscriptions.push(disposable, definitionsChanged, configListener);
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

/** Build the `mcp.json` server entry that launches the bundled ABAP ADT server. */
async function buildMcpServerEntry(
	context: vscode.ExtensionContext,
	settings: AbapAdtSettings,
): Promise<{ command: string; args: string[] }> {
	const node = resolveNodeExecutable();
	const serverJs = path.join(context.extensionPath, RELATIVE_SERVER_JS);
	const args = [serverJs, '--transport=stdio'];
	// The v2 server only reads a `.env` file (or a service key), never process
	// env vars — always point it at a `.env` file.
	const envPath = settings.envPath
		? settings.envPath
		: await ensureGeneratedEnvFile(context, settings);
	if (envPath) {
		args.push('--env-path', envPath, '--system-type', settings.systemType);
	}
	return { command: node, args };
}

/**
 * Command handler — writes the ABAP ADT MCP server into `mcp.json`.
 * Defaults to the user-level (global) file so it applies to every workspace;
 * the user can choose the current workspace instead.
 */
export async function configureAbapAdtMcp(context: vscode.ExtensionContext): Promise<void> {
	const settings = readSettings();
	const serverJs = path.join(context.extensionPath, RELATIVE_SERVER_JS);
	if (!fs.existsSync(serverJs)) {
		void vscode.window.showErrorMessage(
			'Bundled DTT ABAP ADT MCP server not found. Please reinstall the extension.',
		);
		return;
	}

	const targets = [
		{
			label: 'Global (all workspaces)',
			description: 'Write to the user mcp.json — available in every workspace',
			value: 'global',
		},
		{
			label: 'Current workspace only',
			description: 'Write to .vscode/mcp.json in this workspace',
			value: 'workspace',
		},
	];
	const chosen = await vscode.window.showQuickPick(targets, {
		placeHolder: 'Where should the DTT ABAP ADT MCP server be configured?',
	});
	if (!chosen) {
		return;
	}

	const entry = await buildMcpServerEntry(context, settings);
	const serverConfig: Record<string, unknown> = {
		type: 'stdio',
		command: entry.command,
		args: entry.args,
		enabled: settings.enabled,
	};

	let fileUri: vscode.Uri | undefined;
	let filePath: string | undefined;
	if (chosen.value === 'global') {
		filePath = getUserMcpJsonPath();
		fileUri = filePath ? vscode.Uri.file(filePath) : undefined;
	} else {
		fileUri = getWorkspaceMcpJsonPath();
		filePath = fileUri?.fsPath;
	}

	if (!fileUri || !filePath) {
		void vscode.window.showErrorMessage('Could not determine a target mcp.json location.');
		return;
	}

	try {
		let config: McpJsonFile = {};
		if (fs.existsSync(filePath)) {
			config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as McpJsonFile;
		}
		config.servers = config.servers ?? {};
		config.servers['mcp-abap-adt'] = serverConfig;

		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');

		void vscode.window.showInformationMessage(
			`DTT ABAP ADT MCP configured in ${filePath}. Manage it with the "MCP: List Servers" command or the Extensions view.`,
		);
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Failed to write mcp.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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

	const serverJs = path.join(context.extensionPath, RELATIVE_SERVER_JS);
	const report = [
		'==== DTT ABAP ADT MCP 配置状态 ====',
		`● enabled           : ${settings.enabled}`,
		`● SAP URL           : ${settings.url || '(未配置)'}`,
		`● Client            : ${settings.client}`,
		`● Username          : ${settings.username}`,
		`● 密码来源           : ${settings.useSecretStorage ? 'SecretStorage(钥匙串)' : 'settings.json'}`,
		`● 密码已解析         : ${password ? '✅ 是' : '❌ 否'}`,
		`● systemType        : ${settings.systemType}`,
		`● 服务器入口         : ${serverJs} (${fs.existsSync(serverJs) ? '存在' : '缺失'})`,
		`● env 文件           : ${effectiveEnvPath} (${envExists ? '存在' : '不存在'})`,
		`● 启动参数           : --transport=stdio --env-path "${effectiveEnvPath}" --system-type ${settings.systemType}`,
		'',
		'---- env 内容(密码打码) ----',
		envContent,
		'',
		'---- 诊断 ----',
		...(issues.length ? issues : ['✅ 配置看起来完整']),
		'==============================',
	].join('\n');

	const channel = vscode.window.createOutputChannel('DTT ABAP ADT MCP');
	channel.clear();
	channel.append(report);
	channel.show();
	logger.info('ABAP ADT MCP config report:\n' + report);
}
