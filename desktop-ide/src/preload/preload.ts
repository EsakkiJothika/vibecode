import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgenticIdeApi,
  BackendStatus,
  FileContents,
  FileSummary,
  TextMatch,
  WorkspaceEntry,
  WorkspaceInfo,
} from '../shared/api';

const api: AgenticIdeApi = {
  selectWorkspace: () =>
    ipcRenderer.invoke('agentic-ide:select-workspace') as Promise<
      WorkspaceInfo | undefined
    >,
  getBackendStatus: () =>
    ipcRenderer.invoke('agentic-ide:backend-status') as Promise<BackendStatus>,
  onBackendStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: BackendStatus) =>
      callback(status);
    ipcRenderer.on('agentic-ide:backend-status', listener);
    return () => ipcRenderer.removeListener('agentic-ide:backend-status', listener);
  },
  listFiles: (workspacePath) =>
    ipcRenderer.invoke(
      'agentic-ide:list-files',
      workspacePath,
    ) as Promise<WorkspaceEntry[]>,
  searchFiles: (workspacePath, query) =>
    ipcRenderer.invoke(
      'agentic-ide:search-files',
      workspacePath,
      query,
    ) as Promise<string[]>,
  searchText: (workspacePath, query, caseSensitive) =>
    ipcRenderer.invoke(
      'agentic-ide:search-text',
      workspacePath,
      query,
      caseSensitive,
    ) as Promise<TextMatch[]>,
  readFile: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:read-file',
      workspacePath,
      relativePath,
    ) as Promise<FileContents>,
  summarizeFile: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:summarize-file',
      workspacePath,
      relativePath,
    ) as Promise<FileSummary>,
  askAgent: (prompt) =>
    ipcRenderer.invoke('agentic-ide:chat', prompt) as Promise<string>,
};

contextBridge.exposeInMainWorld('agenticIDE', api);
