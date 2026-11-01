import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { Buffer } from 'node:buffer';
import { existsSync, statSync } from 'node:fs';
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';

import { BackendClient } from './backendClient';
import type { BackendStatus, FileMenuAction } from '../shared/api';

let mainWindow: BrowserWindow | undefined;
let backend: BackendClient | undefined;
let selectedWorkspace: string | undefined;
let lastBackendStatus: BackendStatus = {
  state: 'idle',
  message: 'Python backend starts when you choose a workspace.',
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

function publishFileMenuAction(action: FileMenuAction): void {
  mainWindow?.webContents.send('agentic-ide:file-menu-action', action);
}

function installApplicationMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'New Text File',
          accelerator: 'CmdOrCtrl+N',
          click: () => publishFileMenuAction('new-file'),
        },
        {
          label: 'New Folder…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => publishFileMenuAction('new-folder'),
        },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => publishFileMenuAction('open-file'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => publishFileMenuAction('open-folder'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => publishFileMenuAction('save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => publishFileMenuAction('save-as'),
        },
        {
          label: 'Save All',
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => publishFileMenuAction('save-all'),
        },
        { type: 'separator' },
        {
          label: 'Close Editor',
          accelerator: 'CmdOrCtrl+W',
          click: () => publishFileMenuAction('close-editor'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => publishFileMenuAction('exit'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Explorer',
          accelerator: 'CmdOrCtrl+R',
          click: () => publishFileMenuAction('refresh-explorer'),
        },
        {
          label: 'Collapse All Folders',
          accelerator: 'CmdOrCtrl+Alt+0',
          click: () => publishFileMenuAction('collapse-folders'),
        },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
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

  ipcMain.handle('agentic-ide:select-file', async () => {
    const workspace = requireSelectedWorkspace(selectedWorkspace);
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open File',
      defaultPath: workspace,
      properties: ['openFile'],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return undefined;
    }
    return toWorkspaceRelativePath(selection.filePaths[0], workspace);
  });

  ipcMain.handle(
    'agentic-ide:reveal-path',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      const result = await requireBackend().request<{ path: string }>({
        operation: 'resolve-path',
        workspace,
        path: filePath,
      });
      if (statSync(result.path).isDirectory()) {
        const error = await shell.openPath(result.path);
        if (error) throw new Error(`Could not open this location: ${error}`);
      } else {
        shell.showItemInFolder(result.path);
      }
    },
  );

  ipcMain.handle(
    'agentic-ide:select-save-path',
    async (_event, defaultRelativePath: unknown) => {
      const workspace = requireSelectedWorkspace(selectedWorkspace);
      let defaultPath = workspace;
      if (defaultRelativePath !== undefined) {
        defaultPath = join(
          workspace,
          requireRelativePath(defaultRelativePath),
        );
      }
      const selection = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save File',
        defaultPath,
      });
      if (selection.canceled || !selection.filePath) {
        return undefined;
      }
      return toWorkspaceRelativePath(selection.filePath, workspace);
    },
  );

  ipcMain.on('agentic-ide:quit', () => app.quit());
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
      directory: unknown,
    ) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      if (typeof query !== 'string' || query.length > 1000) {
        throw new Error('Search text must be at most 1000 characters.');
      }
      if (typeof caseSensitive !== 'boolean') {
        throw new Error('Search case-sensitivity must be a boolean.');
      }
      if (
        directory !== undefined &&
        (typeof directory !== 'string' || directory.length > 1000)
      ) {
        throw new Error('Search folder must be a relative workspace path.');
      }
      return requireBackend().request({
        operation: 'search-text',
        workspace,
        query,
        case_sensitive: caseSensitive,
        ...(directory ? { directory } : {}),
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
    'agentic-ide:write-file',
    async (
      _event,
      workspacePath: unknown,
      relativePath: unknown,
      content: unknown,
      allowCreate: unknown,
    ) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      if (typeof content !== 'string') {
        throw new Error('File content must be text.');
      }
      if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
        throw new Error('Edited file exceeds the 1 MiB size limit.');
      }
      if (typeof allowCreate !== 'boolean') {
        throw new Error('File creation permission must be a boolean.');
      }
      return requireBackend().request({
        operation: 'write-file',
        workspace,
        path: filePath,
        content,
        allow_create: allowCreate,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:create-directory',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const directoryPath = requireRelativePath(relativePath);
      await requireBackend().request({
        operation: 'create-directory',
        workspace,
        path: directoryPath,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:rename-path',
    async (
      _event,
      workspacePath: unknown,
      relativePath: unknown,
      newRelativePath: unknown,
    ) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const sourcePath = requireRelativePath(relativePath);
      const destinationPath = requireRelativePath(newRelativePath);
      await requireBackend().request({
        operation: 'rename-path',
        workspace,
        path: sourcePath,
        new_path: destinationPath,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:delete-path',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      await requireBackend().request({
        operation: 'delete-path',
        workspace,
        path: filePath,
      });
    },
  );
  ipcMain.handle(
    'agentic-ide:read-image',
    async (_event, workspacePath: unknown, relativePath: unknown) => {
      const workspace = requireSelectedWorkspace(workspacePath);
      const filePath = requireRelativePath(relativePath);
      return requireBackend().request({
        operation: 'read-image',
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
    if (typeof prompt !== 'string' || prompt.length > 24000) {
      throw new Error('Chat prompt and attached file text must be at most 24000 characters.');
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

function toWorkspaceRelativePath(filePath: string, workspace: string): string {
  const workspaceRelativePath = relative(resolve(workspace), resolve(filePath));
  if (
    !workspaceRelativePath ||
    workspaceRelativePath === '..' ||
    workspaceRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(workspaceRelativePath)
  ) {
    throw new Error('File operations must stay inside the selected workspace.');
  }
  return workspaceRelativePath;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#111318',
    title: 'vibeCode',
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
  installApplicationMenu();
  try {
    const backendRoot = getBackendRoot();
    const python = getPythonExecutable(backendRoot);
    backend = new BackendClient(backendRoot, python, publishBackendStatus);
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
