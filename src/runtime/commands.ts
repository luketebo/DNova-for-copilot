import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { createAbapAgentGuide, removeAbapAgentGuide } from './agentGuide';
import { configureAbapAdtMcp, runStartupCheck, setAbapAdtPassword, showAbapAdtMcpConfig } from './mcp';

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('dnova-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('dnova-copilot.openRequestDumpsFolder', () =>
			openRequestDumpsFolder(context),
		),
		vscode.commands.registerCommand('dnova-copilot.getApiKey', () =>
			vscode.commands.executeCommand('dnova-copilot.setApiKey'),
		),
		vscode.commands.registerCommand('dnova-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'dnova-copilot'),
		),
		vscode.commands.registerCommand('dnova-copilot.setAbapAdtPassword', () =>
			setAbapAdtPassword(context),
		),
		vscode.commands.registerCommand('dnova-copilot.configureAbapAdtMcp', () =>
			configureAbapAdtMcp(context),
		),
		vscode.commands.registerCommand('dnova-copilot.showAbapAdtMcpConfig', () =>
			showAbapAdtMcpConfig(context),
		),
		vscode.commands.registerCommand('dnova-copilot.checkAbapAdtMcp', () =>
			runStartupCheck(context, true),
		),
		vscode.commands.registerCommand('dnova-copilot.createAbapAgentGuide', () =>
			createAbapAgentGuide(),
		),
		vscode.commands.registerCommand('dnova-copilot.removeAbapAgentGuide', () =>
			removeAbapAgentGuide(),
		),
	);
}

async function openRequestDumpsFolder(context: vscode.ExtensionContext): Promise<void> {
	try {
		const root = await ensureRequestDumpRoot(context.globalStorageUri);
		logger.info(`Opening request dumps folder: ${root.toString(true)}`);
		await vscode.commands.executeCommand('revealFileInOS', root);
	} catch (error) {
		logger.warn('Failed to open request dumps folder', error);
		void vscode.window.showErrorMessage(t('extension.openRequestDumpsFolderFailed'));
	}
}
