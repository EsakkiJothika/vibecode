import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgenticIdeApi,
  BackendStatus,
  FileMenuAction,
  FileContents,
  FileSummary,
  ImagePreview,
  TextMatch,
  WorkspaceEntry,
  WorkspaceInfo,
} from '../shared/api';

const api: AgenticIdeApi = {
  selectWorkspace: () =>
    ipcRenderer.invoke('agentic-ide:select-workspace') as Promise<
      WorkspaceInfo | undefined
    >,
  selectFile: () =>
    ipcRenderer.invoke('agentic-ide:select-file') as Promise<string | undefined>,
  selectSavePath: (defaultPath) =>
    ipcRenderer.invoke(
      'agentic-ide:select-save-path',
      defaultPath,
    ) as Promise<string | undefined>,
  revealPath: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:reveal-path',
      workspacePath,
      relativePath,
    ) as Promise<void>,
  quit: () => ipcRenderer.send('agentic-ide:quit'),
  onFileMenuAction: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, action: FileMenuAction) =>
      callback(action);
    ipcRenderer.on('agentic-ide:file-menu-action', listener);
    return () => ipcRenderer.removeListener('agentic-ide:file-menu-action', listener);
  },
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
  searchText: (workspacePath, query, caseSensitive, directory) =>
    ipcRenderer.invoke(
      'agentic-ide:search-text',
      workspacePath,
      query,
      caseSensitive,
      directory,
    ) as Promise<TextMatch[]>,
  readFile: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:read-file',
      workspacePath,
      relativePath,
    ) as Promise<FileContents>,
  writeFile: (workspacePath, relativePath, content, allowCreate = false) =>
    ipcRenderer.invoke(
      'agentic-ide:write-file',
      workspacePath,
      relativePath,
      content,
      allowCreate,
    ) as Promise<FileContents>,
  createDirectory: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:create-directory',
      workspacePath,
      relativePath,
    ) as Promise<void>,
  renamePath: (workspacePath, relativePath, newRelativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:rename-path',
      workspacePath,
      relativePath,
      newRelativePath,
    ) as Promise<void>,
  deletePath: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:delete-path',
      workspacePath,
      relativePath,
    ) as Promise<void>,
  readImage: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      'agentic-ide:read-image',
      workspacePath,
      relativePath,
    ) as Promise<ImagePreview>,
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
