import Editor from '@monaco-editor/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type {
  BackendStatus,
  FileMenuAction,
  FileSummary,
  SearchMatch,
  WorkspaceEntry,
  WorkspaceInfo,
} from '../shared/api';

type Activity = 'explorer' | 'search' | 'source-control' | 'agent';
type SearchMode = 'files' | 'text';
type BottomTab = 'terminal' | 'problems';
type ContextMenuAction =
  | 'open'
  | 'preview'
  | 'summarize'
  | 'ask-agent'
  | 'attach'
  | 'new-file'
  | 'new-folder'
  | 'find'
  | 'reveal'
  | 'copy-path'
  | 'copy-relative-path'
  | 'rename'
  | 'delete';

interface OpenFile {
  path: string;
  content: string;
  savedContent: string | null;
  isNew: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children: TreeNode[];
}

interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal';
  onResize(delta: number): void;
}

export function App(): ReactNode {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    state: 'idle',
    message: 'Python backend starts when you choose a workspace.',
  });
  const [activity, setActivity] = useState<Activity>('explorer');
  const [treeCollapseVersion, setTreeCollapseVersion] = useState(0);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('files');
  const [searchDirectory, setSearchDirectory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(true);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [textResults, setTextResults] = useState<SearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [summary, setSummary] = useState<FileSummary | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: 'user' | 'agent' | 'error'; text: string }>
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAttachment, setChatAttachment] = useState<{
    path: string;
    content: string;
    truncated: boolean;
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    path: string;
    dataUrl: string;
  } | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>('problems');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(260);
  const [agentWidth, setAgentWidth] = useState(320);
  const [panelHeight, setPanelHeight] = useState(170);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [nextUntitledNumber, setNextUntitledNumber] = useState(1);

  const activeFile = openFiles.find((file) => file.path === activePath);
  const hasUnsavedChanges = openFiles.some(
    (file) => file.content !== file.savedContent,
  );
  const activeFileIsDirty =
    !!activeFile && activeFile.content !== activeFile.savedContent;
  const tree = useMemo(() => createTree(entries), [entries]);

  useEffect(() => {
    let mounted = true;
    void window.agenticIDE.getBackendStatus().then((status) => {
      if (mounted) setBackendStatus(status);
    });
    const unsubscribe = window.agenticIDE.onBackendStatus((status) => {
      if (mounted) setBackendStatus(status);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const reloadFiles = useCallback(async (selected: WorkspaceInfo) => {
    setFilesLoading(true);
    setError(null);
    try {
      setEntries(await window.agenticIDE.listFiles(selected.path));
    } catch (reason) {
      setError(errorMessage(reason));
      setEntries([]);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const chooseWorkspace = useCallback(async () => {
    if (
      hasUnsavedChanges &&
      !window.confirm('Discard unsaved changes before opening another workspace?')
    ) {
      return;
    }
    setError(null);
    try {
      const selected = await window.agenticIDE.selectWorkspace();
      if (!selected) return;
      setWorkspace(selected);
      setEntries([]);
      setOpenFiles([]);
      setActivePath(null);
      setSummary(null);
      setSearchQuery('');
      setSearchDirectory(null);
      await reloadFiles(selected);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [hasUnsavedChanges, reloadFiles]);

  const openFile = useCallback(
    async (relativePath: string) => {
      if (!workspace) return;
      const existing = openFiles.find((file) => file.path === relativePath);
      if (existing) {
        setActivePath(relativePath);
        setSummary(null);
        return;
      }
      setError(null);
      try {
        const opened = await window.agenticIDE.readFile(
          workspace.path,
          relativePath,
        );
        setOpenFiles((current) => [
          ...current,
          { ...opened, savedContent: opened.content, isNew: false },
        ]);
        setActivePath(opened.path);
        setSummary(null);
      } catch (reason) {
        setError(errorMessage(reason));
      }
    },
    [openFiles, workspace],
  );

  const runSearch = useCallback(async () => {
    if (!workspace || !searchQuery.trim()) return;
    setSearchLoading(true);
    setError(null);
    setFileResults([]);
    setTextResults([]);
    try {
      if (searchMode === 'files') {
        setFileResults(
          await window.agenticIDE.searchFiles(workspace.path, searchQuery),
        );
      } else {
        setTextResults(
          await window.agenticIDE.searchText(
            workspace.path,
            searchQuery,
            searchCaseSensitive,
            searchDirectory ?? undefined,
          ),
        );
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSearchLoading(false);
    }
  }, [searchCaseSensitive, searchDirectory, searchMode, searchQuery, workspace]);

  const summarizeFile = useCallback(async (relativePath: string) => {
    if (!workspace) {
      setError('Open a workspace folder before requesting a file summary.');
      return;
    }
    setError(null);
    try {
      setSummary(
        await window.agenticIDE.summarizeFile(workspace.path, relativePath),
      );
      setActivity('agent');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [workspace]);

  const summarizeActiveFile = useCallback(async () => {
    if (!workspace || !activePath) {
      setError('Open a file before requesting its summary.');
      return;
    }
    await summarizeFile(activePath);
  }, [activePath, summarizeFile, workspace]);

  const previewImage = useCallback(async (relativePath: string) => {
    if (!workspace) return;
    setError(null);
    try {
      const preview = await window.agenticIDE.readImage(workspace.path, relativePath);
      setImagePreview({ path: preview.path, dataUrl: preview.data_url });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [workspace]);

  const attachFileToChat = useCallback(async (relativePath: string): Promise<boolean> => {
    if (!workspace) return false;
    setError(null);
    try {
      const file = await window.agenticIDE.readFile(workspace.path, relativePath);
      const maxContextCharacters = 16_000;
      setChatAttachment({
        path: file.path,
        content: file.content.slice(0, maxContextCharacters),
        truncated: file.content.length > maxContextCharacters,
      });
      setSummary(null);
      setActivity('agent');
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    }
  }, [workspace]);

  const prepareFileQuestion = useCallback(async (relativePath: string) => {
    if (await attachFileToChat(relativePath)) {
      setChatInput('Explain what this file does.');
    }
  }, [attachFileToChat]);

  const createFolder = useCallback(async (parentPath: string) => {
    if (!workspace) return;
    const suggestedPath = parentPath
      ? `${parentPath}/New Folder`
      : 'New Folder';
    const enteredPath = window.prompt('New folder path (relative to workspace):', suggestedPath);
    if (!enteredPath) return;
    const relativePath = enteredPath.trim().replace(/\\/g, '/');
    if (
      !relativePath ||
      relativePath.startsWith('/') ||
      relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      setError('Enter a valid folder path inside the selected workspace.');
      return;
    }
    try {
      await window.agenticIDE.createDirectory(workspace.path, relativePath);
      await reloadFiles(workspace);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [reloadFiles, workspace]);

  const renameWorkspacePath = useCallback(async (relativePath: string) => {
    if (!workspace) return;
    const currentName = relativePath.split(/[\\/]/).pop() ?? relativePath;
    const newName = window.prompt('Rename to:', currentName)?.trim();
    if (!newName || newName === currentName) return;
    if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
      setError('Enter a name without path separators.');
      return;
    }
    const parentPath = parentDirectory(relativePath);
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    try {
      await window.agenticIDE.renamePath(workspace.path, relativePath, newPath);
      const isWithinRenamedDirectory = (path: string) =>
        path === relativePath || path.startsWith(`${relativePath}/`);
      setOpenFiles((files) =>
        files.map((file) =>
          isWithinRenamedDirectory(file.path)
            ? { ...file, path: `${newPath}${file.path.slice(relativePath.length)}` }
            : file,
        ),
      );
      setActivePath((path) =>
        path && isWithinRenamedDirectory(path)
          ? `${newPath}${path.slice(relativePath.length)}`
          : path,
      );
      setChatAttachment((attachment) =>
        attachment && isWithinRenamedDirectory(attachment.path)
          ? { ...attachment, path: `${newPath}${attachment.path.slice(relativePath.length)}` }
          : attachment,
      );
      setSummary(null);
      await reloadFiles(workspace);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [reloadFiles, workspace]);

  const deleteWorkspacePath = useCallback(async (relativePath: string, isDirectory: boolean) => {
    if (!workspace) return;
    const matchesDeletedPath = (path: string) =>
      path === relativePath || (isDirectory && path.startsWith(`${relativePath}/`));
    const dirtyFiles = openFiles.filter(
      (file) => matchesDeletedPath(file.path) && file.content !== file.savedContent,
    );
    const warning = isDirectory
      ? `Permanently delete "${relativePath}" and all of its contents?`
      : `Permanently delete "${relativePath}"?`;
    const dirtyWarning = dirtyFiles.length
      ? `\n\n${dirtyFiles.length} open file(s) have unsaved changes. Those changes will be discarded.`
      : '';
    if (!window.confirm(`${warning}${dirtyWarning}`)) return;
    try {
      await window.agenticIDE.deletePath(workspace.path, relativePath);
      const remaining = openFiles.filter((file) => !matchesDeletedPath(file.path));
      setOpenFiles(remaining);
      if (activePath && matchesDeletedPath(activePath)) {
        setActivePath(remaining.at(-1)?.path ?? null);
      }
      if (chatAttachment && matchesDeletedPath(chatAttachment.path)) {
        setChatAttachment(null);
      }
      setSummary(null);
      await reloadFiles(workspace);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [activePath, chatAttachment, openFiles, reloadFiles, workspace]);

  const findInFolder = useCallback((relativePath: string, isDirectory: boolean) => {
    setSearchDirectory(isDirectory ? relativePath : parentDirectory(relativePath));
    setSearchMode('text');
    setSearchQuery('');
    setTextResults([]);
    setActivity('search');
  }, []);

  const copyWorkspacePath = useCallback(async (relativePath: string, absolute: boolean) => {
    if (!workspace) return;
    const path = absolute
      ? `${workspace.path.replace(/[\\/]$/, '')}\\${relativePath.replace(/[\\/]/g, '\\')}`
      : relativePath;
    try {
      await navigator.clipboard.writeText(path);
      setSaveMessage(`Copied ${absolute ? 'path' : 'relative path'}: ${relativePath}`);
    } catch (reason) {
      setError(`Could not copy path: ${errorMessage(reason)}`);
    }
  }, [workspace]);

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    setChatInput('');
    const attachment = chatAttachment;
    const userMessage = attachment
      ? `${prompt}\n\nAttached file: ${attachment.path}${attachment.truncated ? ' (first 16,000 characters)' : ''}`
      : prompt;
    const modelPrompt = attachment
      ? `${prompt}\n\nFile context (${attachment.path}${attachment.truncated ? ', truncated to the first 16,000 characters' : ''}):\n${attachment.content}`
      : prompt;
    setChatAttachment(null);
    setChatMessages((messages) => [...messages, { role: 'user', text: userMessage }]);
    setChatLoading(true);
    try {
      const response = await window.agenticIDE.askAgent(modelPrompt);
      setChatMessages((messages) => [...messages, { role: 'agent', text: response }]);
    } catch (reason) {
      setChatMessages((messages) => [
        ...messages,
        { role: 'error', text: errorMessage(reason) },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatAttachment, chatInput]);

  const updateEditor = (value: string | undefined) => {
    if (!activePath || value === undefined) return;
    setSaveMessage('');
    setError(null);
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === activePath ? { ...file, content: value } : file,
      ),
    );
  };

  const saveFile = useCallback(
    async (file: OpenFile, saveAs = false): Promise<boolean> => {
      if (!workspace || savingFile) return false;
      if (!saveAs && !file.isNew && file.content === file.savedContent) {
        return true;
      }

      let destinationPath = file.path;
      const createFile = saveAs || file.isNew;
      if (createFile) {
        let selectedPath: string | undefined;
        try {
          selectedPath = await window.agenticIDE.selectSavePath(
            file.path,
          );
        } catch (reason) {
          setError(errorMessage(reason));
          return false;
        }
        if (!selectedPath) return false;
        destinationPath = selectedPath;
      }
      if (
        openFiles.some(
          (openFile) =>
            openFile.path === destinationPath && openFile.path !== file.path,
        )
      ) {
        setError(`${destinationPath} is already open in another editor tab.`);
        return false;
      }

      const content = file.content;
      setSaveMessage('');
      setSavingFile(true);
      setError(null);
      try {
        await window.agenticIDE.writeFile(
          workspace.path,
          destinationPath,
          content,
          createFile,
        );
        setOpenFiles((files) =>
          files.map((openFile) =>
            openFile.path === file.path
              ? {
                  ...openFile,
                  path: destinationPath,
                  savedContent: content,
                  isNew: false,
                }
              : openFile,
          ),
        );
        if (activePath === file.path) setActivePath(destinationPath);
        setSaveMessage(`Saved ${destinationPath}`);
        if (destinationPath !== file.path) void reloadFiles(workspace);
        return true;
      } catch (reason) {
        setError(errorMessage(reason));
        return false;
      } finally {
        setSavingFile(false);
      }
    },
    [activePath, openFiles, reloadFiles, savingFile, workspace],
  );

  const saveActiveFile = useCallback(async (saveAs = false) => {
    if (!activeFile || (!activeFileIsDirty && !saveAs)) return;
    await saveFile(activeFile, saveAs);
  }, [activeFile, activeFileIsDirty, saveFile]);

  const saveAllFiles = useCallback(async () => {
    const unsavedFiles = openFiles.filter(
      (file) => file.isNew || file.content !== file.savedContent,
    );
    for (const file of unsavedFiles) {
      const saved = await saveFile(file);
      if (!saved) break;
    }
  }, [openFiles, saveFile]);

  const createUntitledFile = useCallback((parentPath = '') => {
    let number = nextUntitledNumber;
    let path = parentPath
      ? `${parentPath}/Untitled-${number}.txt`
      : `Untitled-${number}.txt`;
    while (
      entries.some((entry) => entry.path === path) ||
      openFiles.some((file) => file.path === path)
    ) {
      number += 1;
      path = parentPath
        ? `${parentPath}/Untitled-${number}.txt`
        : `Untitled-${number}.txt`;
    }
    setNextUntitledNumber(number + 1);
    setOpenFiles((files) => [
      ...files,
      { path, content: '', savedContent: null, isNew: true },
    ]);
    setActivePath(path);
    setSaveMessage('');
    setError(null);
  }, [entries, nextUntitledNumber, openFiles]);

  const closeActiveFile = useCallback(() => {
    if (!activeFile) return;
    if (
      activeFileIsDirty &&
      !window.confirm(`Discard unsaved changes to ${activeFile.path}?`)
    ) {
      return;
    }
    const remaining = openFiles.filter((file) => file.path !== activeFile.path);
    setOpenFiles(remaining);
    setActivePath(remaining.at(-1)?.path ?? null);
    setSaveMessage('');
  }, [activeFile, activeFileIsDirty, openFiles]);

  const handleContextAction = useCallback(
    async (
      relativePath: string,
      kind: TreeNode['kind'],
      action: ContextMenuAction,
    ) => {
      if (!workspace) return;
      const isDirectory = kind === 'directory';
      const parentPath = isDirectory ? relativePath : parentDirectory(relativePath);
      try {
        switch (action) {
          case 'open':
            await openFile(relativePath);
            break;
          case 'preview':
            await previewImage(relativePath);
            break;
          case 'summarize':
            await summarizeFile(relativePath);
            break;
          case 'ask-agent':
            await prepareFileQuestion(relativePath);
            break;
          case 'attach':
            await attachFileToChat(relativePath);
            break;
          case 'new-file':
            createUntitledFile(parentPath);
            break;
          case 'new-folder':
            await createFolder(parentPath);
            break;
          case 'find':
            findInFolder(relativePath, isDirectory);
            break;
          case 'reveal':
            await window.agenticIDE.revealPath(workspace.path, relativePath);
            break;
          case 'copy-path':
            await copyWorkspacePath(relativePath, true);
            break;
          case 'copy-relative-path':
            await copyWorkspacePath(relativePath, false);
            break;
          case 'rename':
            await renameWorkspacePath(relativePath);
            break;
          case 'delete':
            await deleteWorkspacePath(relativePath, isDirectory);
            break;
        }
      } catch (reason) {
        setError(errorMessage(reason));
      }
    },
    [
      attachFileToChat,
      copyWorkspacePath,
      createFolder,
      createUntitledFile,
      deleteWorkspacePath,
      findInFolder,
      openFile,
      prepareFileQuestion,
      previewImage,
      renameWorkspacePath,
      summarizeFile,
      workspace,
    ],
  );

  const runFileMenuAction = useCallback(
    async (action: FileMenuAction) => {
      try {
        switch (action) {
          case 'new-file':
            createUntitledFile();
            break;
          case 'new-folder':
            await createFolder('');
            break;
          case 'open-file': {
            if (!workspace) {
              setError('Open a workspace folder before opening a file.');
              return;
            }
            const selectedPath = await window.agenticIDE.selectFile();
            if (selectedPath) await openFile(selectedPath);
            break;
          }
          case 'open-folder':
            await chooseWorkspace();
            break;
          case 'refresh-explorer':
            if (workspace) await reloadFiles(workspace);
            break;
          case 'collapse-folders':
            setTreeCollapseVersion((version) => version + 1);
            break;
          case 'save':
            await saveActiveFile();
            break;
          case 'save-as':
            await saveActiveFile(true);
            break;
          case 'save-all':
            await saveAllFiles();
            break;
          case 'close-editor':
            closeActiveFile();
            break;
          case 'exit':
            if (
              hasUnsavedChanges &&
              !window.confirm('Exit vibeCode and discard unsaved changes?')
            ) {
              return;
            }
            window.agenticIDE.quit();
            break;
        }
      } catch (reason) {
        setError(errorMessage(reason));
      }
    },
    [
      chooseWorkspace,
      closeActiveFile,
      createUntitledFile,
      createFolder,
      hasUnsavedChanges,
      openFile,
      reloadFiles,
      saveActiveFile,
      saveAllFiles,
      workspace,
    ],
  );

  const menuActionHandler = useRef(runFileMenuAction);
  useEffect(() => {
    menuActionHandler.current = runFileMenuAction;
  }, [runFileMenuAction]);

  useEffect(() => {
    return window.agenticIDE.onFileMenuAction((action) => {
      void menuActionHandler.current(action);
    });
  }, []);

  return (
    <div
      className="ide"
      style={
        {
          '--explorer-width': `${explorerWidth}px`,
          '--agent-width': `${agentWidth}px`,
          '--panel-height': bottomOpen ? `${panelHeight}px` : '0px',
        } as CSSProperties
      }
    >
      <header className="titlebar">
        <div className="brand-mark">A</div>
        <span className="brand-name">vibeCode</span>
        <span className="title-divider" />
        <span className="title-workspace">
          {workspace?.name ?? 'No workspace open'}
        </span>
        <div className="title-actions">
          {workspace && (
            <button className="title-button" onClick={() => void reloadFiles(workspace)}>
              Refresh
            </button>
          )}
          <button className="title-button primary" onClick={() => void chooseWorkspace()}>
            {workspace ? 'Change folder' : 'Open folder'}
          </button>
        </div>
      </header>

      <main className="workbench">
        <nav className="activity-bar" aria-label="Primary navigation">
          <ActivityButton icon="▤" label="Explorer" selected={activity === 'explorer'} onClick={() => setActivity('explorer')} />
          <ActivityButton icon="⌕" label="Search" selected={activity === 'search'} onClick={() => {
            setSearchDirectory(null);
            setActivity('search');
          }} />
          <ActivityButton icon="⑂" label="Source Control" selected={activity === 'source-control'} onClick={() => setActivity('source-control')} />
          <div className="activity-spacer" />
          <ActivityButton icon="✦" label="Agent" selected={activity === 'agent'} onClick={() => setActivity('agent')} />
        </nav>

        <aside className="explorer-pane">
          <div className="pane-heading">
            <span>{activityTitle(activity)}</span>
            {workspace && activity === 'explorer' && (
              <div className="explorer-toolbar">
                <button
                  className="explorer-toolbar-button"
                  title="New File (Ctrl+N)"
                  aria-label="New File"
                  onClick={() => createUntitledFile()}
                >
                  <span aria-hidden="true">▤<b>+</b></span>
                </button>
                <button
                  className="explorer-toolbar-button"
                  title="New Folder (Ctrl+Shift+N)"
                  aria-label="New Folder"
                  onClick={() => void createFolder('')}
                >
                  <span aria-hidden="true">▰<b>+</b></span>
                </button>
                <button
                  className="explorer-toolbar-button"
                  title="Reload Explorer (Ctrl+R)"
                  aria-label="Reload Explorer"
                  disabled={filesLoading}
                  onClick={() => void reloadFiles(workspace)}
                >
                  <span aria-hidden="true">↻</span>
                </button>
                <button
                  className="explorer-toolbar-button"
                  title="Collapse All Folders (Ctrl+Alt+0)"
                  aria-label="Collapse All Folders"
                  onClick={() => setTreeCollapseVersion((version) => version + 1)}
                >
                  <span aria-hidden="true">⊟</span>
                </button>
              </div>
            )}
          </div>
          <div className="explorer-scroll">
            {activity === 'explorer' && (
              <>
                {!workspace ? (
                  <EmptySidebar
                    title="No folder open"
                    text="Choose a project folder to browse files in the IDE."
                    action="Open folder"
                    onAction={() => void chooseWorkspace()}
                  />
                ) : (
                  <>
                    <div className="section-label">{workspace.name.toUpperCase()}</div>
                    {filesLoading ? (
                      <div className="muted-message">Loading workspace…</div>
                    ) : (
                      <FileTree
                        nodes={tree}
                        collapseVersion={treeCollapseVersion}
                        onAction={handleContextAction}
                      />
                    )}
                  </>
                )}
              </>
            )}
            {activity === 'search' && (
              <SearchSidebar
                mode={searchMode}
                query={searchQuery}
                caseSensitive={searchCaseSensitive}
                files={fileResults}
                matches={textResults}
                loading={searchLoading}
                hasWorkspace={workspace !== null}
                directory={searchDirectory}
                onModeChange={setSearchMode}
                onQueryChange={setSearchQuery}
                onCaseSensitiveChange={setSearchCaseSensitive}
                onSearch={() => void runSearch()}
                onOpen={openFile}
                onClearDirectory={() => setSearchDirectory(null)}
              />
            )}
            {activity === 'source-control' && (
              <EmptySidebar
                title="Source Control"
                text="Git changes and version-control actions will be added in a later milestone."
              />
            )}
            {activity === 'agent' && (
              <EmptySidebar
                title="Agent tools"
                text="Open a file to get a local, non-LLM overview. Chat uses the configured model when available."
                action={activePath ? 'Summarize open file' : undefined}
                onAction={summarizeActiveFile}
              />
            )}
          </div>
        </aside>
        <ResizeHandle
          orientation="vertical"
          onResize={(delta) =>
            setExplorerWidth((width) => clamp(width + delta, 190, 440))
          }
        />

        <section className="center-pane">
          <div className="editor-tabs">
            <div className="tabs-list">
              {openFiles.map((file) => (
                <div
                  className={`editor-tab ${file.path === activePath ? 'active' : ''}`}
                  key={file.path}
                >
                  <button onClick={() => setActivePath(file.path)}>
                    <span className="file-glyph">{fileGlyph(file.path)}</span>
                    {file.path.split(/[\\/]/).pop()}
                    {file.content !== file.savedContent && (
                      <span className="unsaved-indicator" aria-label="Unsaved changes">●</span>
                    )}
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`Close ${file.path}`}
                    onClick={() => {
                      if (
                        file.content !== file.savedContent &&
                        !window.confirm(`Discard unsaved changes to ${file.path}?`)
                      ) {
                        return;
                      }
                      const remaining = openFiles.filter((item) => item.path !== file.path);
                      setOpenFiles(remaining);
                      if (activePath === file.path) {
                        setActivePath(remaining.at(-1)?.path ?? null);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="editor-action"
              disabled={!activeFileIsDirty || savingFile}
              onClick={() => void saveActiveFile()}
              title="Save changes (Ctrl+S)"
            >
              {savingFile ? 'Saving…' : 'Save'}
            </button>
            <span className="save-status" role="status">
              {activeFileIsDirty ? 'Unsaved changes' : saveMessage}
            </span>
            <button
              className="editor-action"
              disabled={!activePath}
              onClick={() => void summarizeActiveFile()}
              title="Basic, non-LLM file overview"
            >
              Summarize
            </button>
          </div>

          <div className="editor-content">
            {error && (
              <div className="inline-error" role="alert">
                <span>{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss error">×</button>
              </div>
            )}
            {activeFile ? (
              <Editor
                height="100%"
                path={activeFile.path}
                language={languageForPath(activeFile.path)}
                theme="vs-dark"
                value={activeFile.content}
                onChange={updateEditor}
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'Cascadia Code, Consolas, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'off',
                  padding: { top: 12 },
                  renderLineHighlight: 'gutter',
                }}
              />
            ) : workspace ? (
              <Welcome
                title={workspace.name}
                subtitle="Select a file from Explorer to read it in the editor."
                action="Open another folder"
                onAction={() => void chooseWorkspace()}
              />
            ) : (
              <Welcome
                title="Your workspace, your IDE"
                subtitle="Open a project folder to explore, search, read, and summarize files. Workspace code is never executed."
                action="Open folder"
                onAction={() => void chooseWorkspace()}
              />
            )}
          </div>

          <ResizeHandle
            orientation="horizontal"
            onResize={(delta) =>
              setPanelHeight((height) => clamp(height - delta, 100, 360))
            }
          />
          <section className={`bottom-panel ${bottomOpen ? '' : 'collapsed'}`}>
            <div className="bottom-tabs">
              <button
                className={bottomTab === 'problems' ? 'selected' : ''}
                onClick={() => {
                  setBottomTab('problems');
                  setBottomOpen(true);
                }}
              >
                Problems <span className="count-pill">0</span>
              </button>
              <button
                className={bottomTab === 'terminal' ? 'selected' : ''}
                onClick={() => {
                  setBottomTab('terminal');
                  setBottomOpen(true);
                }}
              >
                Terminal
              </button>
              <div className="bottom-spacer" />
              <button
                className="icon-button"
                title={bottomOpen ? 'Hide panel' : 'Show panel'}
                onClick={() => setBottomOpen((open) => !open)}
              >
                {bottomOpen ? '⌄' : '⌃'}
              </button>
            </div>
            {bottomOpen && (
              <div className={`panel-content ${bottomTab === 'terminal' ? 'terminal-placeholder' : ''}`}>
                {bottomTab === 'problems' ? (
                  <span>No problems have been reported.</span>
                ) : (
                  <span>
                    Terminal execution is disabled in this milestone. Opening or
                    analyzing source files never runs them.
                  </span>
                )}
              </div>
            )}
          </section>
        </section>

        <ResizeHandle
          orientation="vertical"
          onResize={(delta) =>
            setAgentWidth((width) => clamp(width - delta, 270, 520))
          }
        />
        <aside className="agent-pane">
          <div className="agent-heading">
            <span className="agent-spark">✦</span>
            <strong>Agent</strong>
            <span className={`connection-dot ${backendStatus.state}`} title={backendStatus.message} />
            <span className="agent-heading-status">
              {backendStatus.state === 'ready'
                ? 'Ready'
                : backendStatus.state === 'starting'
                  ? 'Starting'
                  : backendStatus.state === 'idle'
                    ? 'Idle'
                    : 'Offline'}
            </span>
          </div>
          {summary ? (
            <SummaryCard summary={summary} onDismiss={() => setSummary(null)} />
          ) : (
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-hero-icon">✦</div>
                  <h2>Build with your agent</h2>
                  <p>Ask a question or open a file summary. Your project files are only read when you request an action.</p>
                  {activePath && (
                    <button className="suggestion" onClick={() => void summarizeActiveFile()}>
                      <span>▤</span> Summarize <strong>{activePath.split(/[\\/]/).pop()}</strong>
                    </button>
                  )}
                </div>
              ) : (
                chatMessages.map((message, index) => (
                  <div className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
                    <div className="chat-message-role">
                      {message.role === 'user' ? 'You' : message.role === 'agent' ? 'Agent' : 'Request failed'}
                    </div>
                    <div className="chat-message-text">{message.text}</div>
                  </div>
                ))
              )}
              {chatLoading && <div className="loading-message"><span className="spinner" /> Waiting for model response…</div>}
            </div>
          )}
          <div className="chat-composer">
            {chatAttachment && (
              <div className="chat-attachment">
                <span title={chatAttachment.path}>
                  Attached: {chatAttachment.path}
                  {chatAttachment.truncated ? ' (truncated)' : ''}
                </span>
                <button
                  className="icon-button"
                  onClick={() => setChatAttachment(null)}
                  aria-label="Remove chat attachment"
                >
                  ×
                </button>
                <small>File text is included only when you send this message.</small>
              </div>
            )}
            {backendStatus.state !== 'ready' && (
              <div
                className="backend-notice"
                title={backendStatus.message}
                role={backendStatus.state === 'unavailable' ? 'alert' : undefined}
              >
                {backendStatus.message}
              </div>
            )}
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
              placeholder="Message your agent…"
              maxLength={4000}
              aria-label="Message your agent"
            />
            <div className="composer-footer">
              <span>Sent to configured model only · Enter to send</span>
              <button
                className="send-button"
                disabled={!chatInput.trim() || chatLoading}
                onClick={() => void sendChat()}
                title="Send message to configured model"
              >
                ↑
              </button>
            </div>
          </div>
        </aside>
      </main>

      <footer className="statusbar">
        <div className="status-left">
          <span className={`status-led ${backendStatus.state}`} title={backendStatus.message} />
          <span title={backendStatus.message}>
            {backendStatus.state === 'ready'
              ? 'Python backend ready'
              : backendStatus.state === 'starting'
                ? 'Starting backend'
                : backendStatus.state === 'idle'
                  ? 'Backend idle'
                  : 'Backend offline'}
          </span>
          {workspace && (
            <>
              <span className="status-separator">›</span>
              <span className="workspace-path">{workspace.path}</span>
            </>
          )}
        </div>
        <div className="status-right">
          <span>Language agnostic</span>
          {activePath && <span>{activePath.split(/[\\/]/).pop()}</span>}
          <button onClick={() => setBottomOpen((open) => !open)}>Panel</button>
        </div>
      </footer>
      {imagePreview && (
        <ImagePreviewDialog
          path={imagePreview.path}
          dataUrl={imagePreview.dataUrl}
          onClose={() => setImagePreview(null)}
        />
      )}
    </div>
  );
}

function ActivityButton(props: {
  icon: string;
  label: string;
  selected: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      className={`activity-button ${props.selected ? 'selected' : ''}`}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <span>{props.icon}</span>
    </button>
  );
}

function EmptySidebar(props: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}): ReactNode {
  return (
    <div className="sidebar-empty">
      <div className="sidebar-empty-symbol">◇</div>
      <strong>{props.title}</strong>
      <p>{props.text}</p>
      {props.action && props.onAction && (
        <button className="small-action" onClick={props.onAction}>{props.action}</button>
      )}
    </div>
  );
}

function Welcome(props: {
  title: string;
  subtitle: string;
  action: string;
  onAction(): void;
}): ReactNode {
  return (
    <div className="welcome">
      <div className="welcome-logo">A</div>
      <div className="welcome-eyebrow">VIBECODE</div>
      <h1>{props.title}</h1>
      <p>{props.subtitle}</p>
      <button className="welcome-button" onClick={props.onAction}>{props.action}</button>
      <div className="welcome-footnote">Standalone workspace · Local-first exploration</div>
    </div>
  );
}

function SearchSidebar(props: {
  mode: SearchMode;
  query: string;
  caseSensitive: boolean;
  files: string[];
  matches: SearchMatch[];
  loading: boolean;
  hasWorkspace: boolean;
  directory: string | null;
  onModeChange(mode: SearchMode): void;
  onQueryChange(query: string): void;
  onCaseSensitiveChange(value: boolean): void;
  onSearch(): void;
  onOpen(path: string): void;
  onClearDirectory(): void;
}): ReactNode {
  return (
    <div className="search-sidebar">
      {!props.hasWorkspace && <div className="muted-message">Open a folder to search.</div>}
      {props.directory && (
        <div className="search-scope">
          <span title={props.directory}>In {props.directory}</span>
          <button onClick={props.onClearDirectory} aria-label="Clear search folder">×</button>
        </div>
      )}
      <div className="search-input-wrap">
        <span>⌕</span>
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onSearch();
          }}
          placeholder={props.mode === 'files' ? 'Search file names' : 'Search in files'}
          disabled={!props.hasWorkspace}
        />
        <button disabled={!props.hasWorkspace || props.loading} onClick={props.onSearch}>↵</button>
      </div>
      <div className="search-mode">
        <button className={props.mode === 'files' ? 'active' : ''} onClick={() => props.onModeChange('files')}>Files</button>
        <button className={props.mode === 'text' ? 'active' : ''} onClick={() => props.onModeChange('text')}>Text</button>
        {props.mode === 'text' && (
          <label title="Match case">
            <input
              type="checkbox"
              checked={props.caseSensitive}
              onChange={(event) => props.onCaseSensitiveChange(event.target.checked)}
            />
            Aa
          </label>
        )}
      </div>
      <div className="results-label">
        {props.loading ? 'Searching…' : `${props.mode === 'files' ? props.files.length : props.matches.length} results`}
      </div>
      <div className="search-results">
        {props.mode === 'files'
          ? props.files.map((path) => (
              <button className="search-result" key={path} onClick={() => props.onOpen(path)}>
                <span className="file-glyph">{fileGlyph(path)}</span><span>{path}</span>
              </button>
            ))
          : props.matches.map((match, index) => (
              <button className="search-result match" key={`${match.path}:${match.line}:${index}`} onClick={() => props.onOpen(match.path)}>
                <strong>{match.path}:{match.line}</strong><span>{match.text.trim()}</span>
              </button>
            ))}
      </div>
    </div>
  );
}

function FileTree(props: {
  nodes: TreeNode[];
  collapseVersion: number;
  onAction(path: string, kind: TreeNode['kind'], action: ContextMenuAction): void;
}): ReactNode {
  return (
    <div className="file-tree">
      {props.nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          collapseVersion={props.collapseVersion}
          onAction={props.onAction}
        />
      ))}
    </div>
  );
}

function FileTreeNode(props: {
  node: TreeNode;
  depth: number;
  collapseVersion: number;
  onAction(path: string, kind: TreeNode['kind'], action: ContextMenuAction): void;
}): ReactNode {
  const [expanded, setExpanded] = useState(props.depth === 0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const previousCollapseVersion = useRef(props.collapseVersion);

  useEffect(() => {
    if (previousCollapseVersion.current !== props.collapseVersion) {
      previousCollapseVersion.current = props.collapseVersion;
      setExpanded(false);
    }
  }, [props.collapseVersion]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [contextMenu]);

  const menuItems: Array<{
    label: string;
    action?: ContextMenuAction;
    disabled?: boolean;
    title?: string;
    separator?: boolean;
  }> = [
    ...(props.node.kind === 'file'
      ? [
          { label: 'Open', action: 'open' as const },
          {
            label: 'Open in Image Preview',
            action: 'preview' as const,
            disabled: !isPreviewableImage(props.node.path),
            title: isPreviewableImage(props.node.path)
              ? undefined
              : 'Image preview supports common image file types.',
          },
          { label: 'Summarize File', action: 'summarize' as const },
          { label: 'Ask Agent: Explain This File', action: 'ask-agent' as const },
          { label: 'Attach File to Agent Chat', action: 'attach' as const },
          { label: '', separator: true },
        ]
      : []),
    { label: 'New File…', action: 'new-file' },
    { label: 'New Folder…', action: 'new-folder' },
    { label: 'Find in Folder…', action: 'find' },
    { label: '', separator: true },
    { label: 'Reveal in File Explorer', action: 'reveal' },
    { label: 'Copy Path', action: 'copy-path' },
    { label: 'Copy Relative Path', action: 'copy-relative-path' },
    { label: '', separator: true },
    { label: 'Rename…', action: 'rename' },
    { label: 'Delete', action: 'delete' },
    { label: '', separator: true },
    {
      label: 'Cut',
      disabled: true,
      title: 'Moving files with the clipboard is not implemented yet.',
    },
    {
      label: 'Copy',
      disabled: true,
      title: 'Copying files with the clipboard is not implemented yet.',
    },
    {
      label: 'Paste',
      disabled: true,
      title: 'Pasting files is not implemented yet.',
    },
    {
      label: 'Add Folder to Agent Chat',
      disabled: true,
      title: 'Attach individual text files to chat; folder attachments are not available.',
    },
    { label: '', separator: true },
    {
      label: 'Open in Integrated Terminal',
      disabled: true,
      title: 'Terminal execution is not implemented yet.',
    },
    {
      label: 'Run Tests',
      disabled: true,
      title: 'Test discovery and execution are not implemented yet.',
    },
    { label: 'Debug Tests', disabled: true, title: 'Debugging is not implemented yet.' },
    {
      label: 'Run Tests with Coverage',
      disabled: true,
      title: 'Test coverage is not implemented yet.',
    },
    {
      label: 'Share',
      disabled: true,
      title: 'Sharing is not implemented yet.',
    },
  ];

  if (props.node.kind === 'directory') {
    return (
      <>
        <button
          className="tree-row directory"
          style={{ paddingLeft: 8 + props.depth * 14 }}
          onClick={() => setExpanded((value) => !value)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({
              x: Math.min(event.clientX, window.innerWidth - 210),
              y: Math.min(event.clientY, window.innerHeight - 480),
            });
          }}
          aria-expanded={expanded}
        >
          <span className={`tree-chevron ${expanded ? 'expanded' : ''}`}>›</span>
          <span className="tree-icon">{expanded ? '▾' : '▸'}</span>
          <span>{props.node.name}</span>
        </button>
        {expanded && props.node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={props.depth + 1}
            collapseVersion={props.collapseVersion}
            onAction={props.onAction}
          />
        ))}
        {contextMenu && (
          <ContextMenu
            name={props.node.name}
            items={menuItems}
            position={contextMenu}
            onSelect={(action) => {
              setContextMenu(null);
              props.onAction(props.node.path, props.node.kind, action);
            }}
          />
        )}
        </>
    );
  }
  return (
    <>
      <button
        className="tree-row file"
        style={{ paddingLeft: 25 + props.depth * 14 }}
        onClick={() => props.onAction(props.node.path, 'file', 'open')}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
            x: Math.min(event.clientX, window.innerWidth - 210),
            y: Math.min(event.clientY, window.innerHeight - 480),
          });
        }}
      >
        <span className="file-glyph">{fileGlyph(props.node.path)}</span>
        <span>{props.node.name}</span>
      </button>
      {contextMenu && (
        <ContextMenu
          name={props.node.name}
          items={menuItems}
          position={contextMenu}
          onSelect={(action) => {
            setContextMenu(null);
            props.onAction(props.node.path, 'file', action);
          }}
        />
      )}
    </>
  );
}

function ContextMenu(props: {
  name: string;
  items: Array<{
    label: string;
    action?: ContextMenuAction;
    disabled?: boolean;
    title?: string;
    separator?: boolean;
  }>;
  position: { x: number; y: number };
  onSelect(action: ContextMenuAction): void;
}): ReactNode {
  return (
    <div
      className="file-context-menu"
      role="menu"
      aria-label={`Actions for ${props.name}`}
      style={{ left: Math.max(4, props.position.x), top: Math.max(4, props.position.y) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.items.map((item, index) =>
        item.separator ? (
          <div className="file-context-separator" key={`separator-${index}`} />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.action) props.onSelect(item.action);
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

function ImagePreviewDialog(props: {
  path: string;
  dataUrl: string;
  onClose(): void;
}): ReactNode {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [props.onClose]);

  return (
    <div
      className="image-preview-backdrop"
      role="presentation"
      onClick={props.onClose}
    >
      <section
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Image preview: ${props.path}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span title={props.path}>{props.path}</span>
          <button className="icon-button" onClick={props.onClose} aria-label="Close image preview">×</button>
        </header>
        <img src={props.dataUrl} alt={`Preview of ${props.path}`} />
      </section>
    </div>
  );
}

function SummaryCard(props: {
  summary: FileSummary;
  onDismiss(): void;
}): ReactNode {
  return (
    <div className="summary-card">
      <div className="summary-heading">
        <div>
          <span className="agent-spark">✦</span>
          <strong>File overview</strong>
        </div>
        <button className="icon-button" onClick={props.onDismiss} aria-label="Close file overview">×</button>
      </div>
      <div className="summary-path">{props.summary.path}</div>
      <div className="summary-stats">
        <div><strong>{props.summary.lines}</strong><span>lines</span></div>
        <div><strong>{props.summary.words}</strong><span>words</span></div>
        <div><strong>{props.summary.characters}</strong><span>characters</span></div>
      </div>
      <div className="summary-note">{props.summary.note}</div>
      <div className="summary-preview-title">Non-empty line preview</div>
      <pre>{props.summary.preview.length ? props.summary.preview.join('\n') : '(empty file)'}</pre>
    </div>
  );
}

function ResizeHandle(props: ResizeHandleProps): ReactNode {
  const pointer = useRef<number | null>(null);
  const previous = useRef(0);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointer.current = event.pointerId;
    previous.current =
      props.orientation === 'vertical' ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return;
    const current =
      props.orientation === 'vertical' ? event.clientX : event.clientY;
    props.onResize(current - previous.current);
    previous.current = current;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current === event.pointerId) pointer.current = null;
  };

  return (
    <div
      className={`resize-handle ${props.orientation}`}
      role="separator"
      aria-orientation={props.orientation}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
    />
  );
}

function createTree(entries: WorkspaceEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodes = new Map<string, TreeNode>();

  for (const entry of entries) {
    const parts = entry.path.split(/[\\/]/).filter(Boolean);
    let parent = root;
    let currentPath = '';
    parts.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let node = nodes.get(currentPath);
      if (!node) {
        node = {
          name,
          path: currentPath,
          kind:
            index < parts.length - 1 ? 'directory' : entry.kind,
          children: [],
        };
        nodes.set(currentPath, node);
        parent.push(node);
      }
      parent = node.children;
    });
  }

  const sortNodes = (items: TreeNode[]) => {
    items.sort(
      (left, right) =>
        Number(right.kind === 'directory') - Number(left.kind === 'directory') ||
        left.name.localeCompare(right.name),
    );
    items.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root);
  return root;
}

function activityTitle(activity: Activity): string {
  switch (activity) {
    case 'explorer':
      return 'EXPLORER';
    case 'search':
      return 'SEARCH';
    case 'source-control':
      return 'SOURCE CONTROL';
    case 'agent':
      return 'AGENT';
  }
}

function fileGlyph(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase();
  if (['ts', 'tsx', 'js', 'jsx'].includes(extension ?? '')) return '◈';
  if (['py'].includes(extension ?? '')) return '◆';
  if (['json', 'toml', 'yaml', 'yml'].includes(extension ?? '')) return '{}';
  if (['md', 'txt'].includes(extension ?? '')) return '≡';
  if (['html', 'xml'].includes(extension ?? '')) return '◇';
  if (['css', 'scss'].includes(extension ?? '')) return '#';
  return '·';
}

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase();
  const languages: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    php: 'php',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'shell',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'typescript',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension ?? ''] ?? 'plaintext';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function isPreviewableImage(path: string): boolean {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
