import * as vscode from 'vscode';

export type AgentAction =
  | 'agenticIde.listWorkspaceFiles'
  | 'agenticIde.searchCodebase'
  | 'agenticIde.readSelectedFile'
  | 'agenticIde.summarizeSelectedFile'
  | 'agenticIde.openAgentChat';

class ExplorerItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    command?: AgentAction,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = command ? 'agentAction' : 'workspaceInfo';
    if (command) {
      this.command = {
        command,
        title: label,
      };
    }
  }
}

export class AgentExplorerProvider
  implements vscode.TreeDataProvider<ExplorerItem>
{
  private readonly changeEmitter = new vscode.EventEmitter<
    ExplorerItem | undefined
  >();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(item: ExplorerItem): vscode.TreeItem {
    return item;
  }

  getChildren(): ExplorerItem[] {
    const workspaceName =
      vscode.workspace.workspaceFolders?.[0]?.name ?? 'No folder open';
    const workspaceDescription = vscode.workspace.workspaceFolders?.length
      ? `${vscode.workspace.workspaceFolders.length} workspace folder(s)`
      : 'Open a folder to get started';

    return [
      new ExplorerItem(
        workspaceName,
        workspaceDescription,
        vscode.workspace.workspaceFolders ? 'folder-opened' : 'folder',
      ),
      new ExplorerItem(
        'List Workspace Files',
        'Preview',
        'list-tree',
        'agenticIde.listWorkspaceFiles',
      ),
      new ExplorerItem(
        'Search Codebase',
        'Preview',
        'search',
        'agenticIde.searchCodebase',
      ),
      new ExplorerItem(
        'Read Selected File',
        'Available',
        'file-text',
        'agenticIde.readSelectedFile',
      ),
      new ExplorerItem(
        'Summarize Selected File',
        'Preview',
        'comment-discussion',
        'agenticIde.summarizeSelectedFile',
      ),
      new ExplorerItem(
        'Open Agent Chat',
        'Preview',
        'comment',
        'agenticIde.openAgentChat',
      ),
    ];
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
