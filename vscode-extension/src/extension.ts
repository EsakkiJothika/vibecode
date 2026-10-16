import * as vscode from 'vscode';
import { isAbsolute, relative, sep } from 'node:path';

import { AgentChatViewProvider } from './agentChatView';
import { AgentExplorerProvider } from './agentExplorer';

export function activate(context: vscode.ExtensionContext): void {
  const explorer = new AgentExplorerProvider();
  const chat = new AgentChatViewProvider();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  status.text = '$(plug) Agent: UI preview';
  status.tooltip =
    'Agentic IDE UI is active. Python backend is not connected.';
  status.show();

  context.subscriptions.push(
    status,
    explorer,
    chat,
    vscode.window.registerTreeDataProvider('agenticIde.explorer', explorer),
    vscode.window.registerWebviewViewProvider('agenticIde.chat', chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => explorer.refresh()),
    vscode.commands.registerCommand('agenticIde.refreshExplorer', () =>
      explorer.refresh(),
    ),
    vscode.commands.registerCommand('agenticIde.listWorkspaceFiles', () => {
      if (!hasWorkspace(chat)) {
        return;
      }
      void chat.showResult(
        'List Workspace Files',
        'Preview only: workspace file listing will be provided by the Python backend in a later milestone.',
        true,
      );
    }),
    vscode.commands.registerCommand('agenticIde.searchCodebase', async () => {
      if (!hasWorkspace(chat)) {
        return;
      }
      const query = await vscode.window.showInputBox({
        prompt: 'Text to search for in the workspace',
        placeHolder: 'Enter search text',
        ignoreFocusOut: true,
      });
      if (query === undefined) {
        return;
      }
      void chat.showResult(
        'Search Codebase',
        `Preview only: search for "${query}" is not connected to the Python backend yet.`,
        true,
      );
    }),
    vscode.commands.registerCommand('agenticIde.readSelectedFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isInWorkspace(editor.document.uri)) {
        void vscode.window.showWarningMessage(
          'Open a file from the current workspace before using Read Selected File.',
        );
        return;
      }
      const selection = editor.document.getText(editor.selection);
      const content = selection || editor.document.getText();
      const truncated = content.length > 12000;
      const displayedContent = truncated
        ? `${content.slice(0, 12000)}\n\n[Content truncated in preview.]`
        : content;
      void chat.showResult(
        `Read ${vscode.workspace.asRelativePath(editor.document.uri)}`,
        `${displayedContent}\n\nRead locally from the active VS Code editor; content was not sent to a model.`,
      );
    }),
    vscode.commands.registerCommand(
      'agenticIde.summarizeSelectedFile',
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isInWorkspace(editor.document.uri)) {
          void vscode.window.showWarningMessage(
            'Open a file from the current workspace before requesting a summary.',
          );
          return;
        }
        void chat.showResult(
          'Summarize Selected File',
          'Preview only: file summarization is not implemented or sent to a model in this milestone.',
          true,
        );
      },
    ),
    vscode.commands.registerCommand('agenticIde.openAgentChat', async () => {
      await vscode.commands.executeCommand('agenticIde.chat.focus');
    }),
  );
}

export function deactivate(): void {}

function hasWorkspace(chat: AgentChatViewProvider): boolean {
  if (vscode.workspace.workspaceFolders?.length) {
    return true;
  }
  void chat.showError(
    'Workspace required',
    'Open a workspace folder to use this Agentic IDE action.',
  );
  return false;
}

function isInWorkspace(uri: vscode.Uri): boolean {
  return (
    vscode.workspace.workspaceFolders?.some((folder) => {
      const pathFromWorkspace = relative(folder.uri.fsPath, uri.fsPath);
      return (
        pathFromWorkspace === '' ||
        (pathFromWorkspace !== '..' &&
          !pathFromWorkspace.startsWith(`..${sep}`) &&
          !isAbsolute(pathFromWorkspace))
      );
    }) ?? false
  );
}
