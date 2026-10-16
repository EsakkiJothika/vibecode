import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { BackendClient } from './backendClient';
import type { BackendStatus } from '../shared/api';

let mainWindow: BrowserWindow | undefined;
let backend: BackendClient | undefined;
let selectedWorkspace: string | undefined;
let lastBackendStatus: BackendStatus = {
  state: 'starting',
  message: 'Starting Python backend…',
};

function getBackendRoot(): string {
  const configuredRoot = process.env.AGENTIC_IDE_BACKEND_ROOT;
  const root = resolve(
    configuredRoot ?? (app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), '..')),
  );
  if (!existsSync(join(root, 'agent', 'bridge.py'))) {
    throw new Error(
      'Python backend was not found. Set AGENTIC_IDE_BACKEND_ROOT to the project directory.',
    );
  }
  return root;
}

function getPythonExecutable(backendRoot: string): string {
  const configuredPython = process.env.AGENTIC_IDE_PYTHON;
  if (configuredPython) {
    if (!isAbsolute(configuredPython) || !existsSync(configuredPython)) {
      throw new Error(
        'AGENTIC_IDE_PYTHON must be an existing absolute path to a Python executable.',
      );
    }
    return configuredPython;
  }

  const virtualEnvironmentPython = join(
    backendRoot,
    '.venv',
    'Scripts',
    'python.exe',
  );
  return existsSync(virtualEnvironmentPython)
    ? virtualEnvironmentPython
    : 'python';
}

function publishBackendStatus(status: BackendStatus): void {
  lastBackendStatus = status;
  mainWindow?.webContents.send('agentic-ide:backend-status', status);
}

function registerIpcHandlers(): void {
  ipcMain.handle('agentic-ide:select-workspace', async () => {
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Workspace Folder',
      properties: ['openDirectory'],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return undefined;
    }

    const chosenPath = resolve(selection.filePaths[0]);
    if (!existsSync(chosenPath)) {
      throw new Error('The selected workspace folder is no longer available.');
    }
    const result = await requireBackend().request<{ path: string }>({
      operation: 'validate-workspace',
      workspace: chosenPath,
    });
    selectedWorkspace = result.path;
    return { path: result.path, name: basename(result.path) };
  });

  ipcMain.handle('agentic-ide:backend-status', () => lastBackendStatus);
  ipcMain.handle('agentic-ide:list-files', async (_event, workspacePath: unknown) => {
    const workspace = requireSelectedWorkspace(workspacePath);
    return requireBackend().request({
      operation: 'list-files',
      workspace,
    });
  });
  ipcMain.handle(
    'agentic-ide:search-files',
    async (_event, workspacePath: unknown, query: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      if (typeof query !== 'string' || query.length > 1000) {
        throw new Error('File search text must be at most 1000 characters.');
      }
      return requireBackend().request({
        operation: 'search-files',
        workspace,
        query,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:search-text',
    async (
      _event,
      workspacePath: unknown,
      query: unknown,
      caseSensitive: unknown,
    ) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      if (typeof query !== 'string' || query.length > 1000) {
        throw new Error('Search text must be at most 1000 characters.');
      }
      if (typeof caseSensitive !== 'boolean') {
        throw new Error('Search case-sensitivity must be a boolean.');
      }
      return requireBackend().request({
        operation: 'search-text',
        workspace,
        query,
        case_sensitive: caseSensitive,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:read-file',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      return requireBackend().request({
        operation: 'read-file',
        workspace,
        path: filePath,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:summarize-file',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      return requireBackend().request({
        operation: 'summarize-file',
        workspace,
        path: filePath,
      });
    },
  );
  ipcMain.handle('agentic-ide:chat', async (_event, prompt: unknown) => {
    if (typeof prompt !== 'string' || prompt.length > 4000) {
      throw new Error('Chat prompt must be at most 4000 characters.');
    }
    const result = await requireBackend().request<{ text: string }>(
      { operation: 'chat', prompt },
      120000,
    );
    return result.text;
  });
}

function requireBackend(): BackendClient {
  if (!backend) {
    throw new Error('Python backend has not been initialized.');
  }
  return backend;
}

function requireSelectedWorkspace(candidate: unknown): string {
  if (!selectedWorkspace) {
    throw new Error('Choose a workspace folder first.');
  }
  if (
    typeof candidate !== 'string' ||
    normalize(resolve(candidate)).toLocaleLowerCase() !==
      normalize(selectedWorkspace).toLocaleLowerCase()
  ) {
    throw new Error('Workspace requests must use the folder selected in the IDE.');
  }
  return selectedWorkspace;
}

function requireRelativePath(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('Choose a file from the workspace.');
  }
  const normalized = normalize(candidate);
  if (
    isAbsolute(candidate) ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new Error('File path must stay inside the selected workspace.');
  }
  return candidate;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#111318',
    title: 'Agentic IDE',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('agentic-ide:backend-status', lastBackendStatus);
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  try {
    const backendRoot = getBackendRoot();
    const python = getPythonExecutable(backendRoot);
    backend = new BackendClient(backendRoot, python, publishBackendStatus);
    backend.start();
  } catch (error) {
    publishBackendStatus({
      state: 'unavailable',
      message: error instanceof Error ? error.message : 'Python backend unavailable.',
    });
  }

  registerIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  backend?.stop();
});
