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
  FileSummary,
  SearchMatch,
  WorkspaceEntry,
  WorkspaceInfo,
} from '../shared/api';

type Activity = 'explorer' | 'search' | 'source-control' | 'agent';
type SearchMode = 'files' | 'text';
type BottomTab = 'terminal' | 'problems';

interface OpenFile {
  path: string;
  content: string;
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
    state: 'starting',
    message: 'Checking Python backend…',
  });
  const [activity, setActivity] = useState<Activity>('explorer');
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('files');
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
  const [bottomTab, setBottomTab] = useState<BottomTab>('problems');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(260);
  const [agentWidth, setAgentWidth] = useState(320);
  const [panelHeight, setPanelHeight] = useState(170);
  const [error, setError] = useState<string | null>(null);

  const activeFile = openFiles.find((file) => file.path === activePath);
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
      await reloadFiles(selected);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [reloadFiles]);

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
        setOpenFiles((current) => [...current, opened]);
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
          ),
        );
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSearchLoading(false);
    }
  }, [searchCaseSensitive, searchMode, searchQuery, workspace]);

  const summarizeActiveFile = useCallback(async () => {
    if (!workspace || !activePath) {
      setError('Open a file before requesting its summary.');
      return;
    }
    setError(null);
    try {
      setSummary(
        await window.agenticIDE.summarizeFile(workspace.path, activePath),
      );
      setActivity('agent');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [activePath, workspace]);

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    setChatInput('');
    setChatMessages((messages) => [...messages, { role: 'user', text: prompt }]);
    setChatLoading(true);
    try {
      const response = await window.agenticIDE.askAgent(prompt);
      setChatMessages((messages) => [...messages, { role: 'agent', text: response }]);
    } catch (reason) {
      setChatMessages((messages) => [
        ...messages,
        { role: 'error', text: errorMessage(reason) },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput]);

  const updateEditor = (value: string | undefined) => {
    if (!activePath || value === undefined) return;
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === activePath ? { ...file, content: value } : file,
      ),
    );
  };

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
        <span className="brand-name">Agentic IDE</span>
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
          <ActivityButton icon="⌕" label="Search" selected={activity === 'search'} onClick={() => setActivity('search')} />
          <ActivityButton icon="⑂" label="Source Control" selected={activity === 'source-control'} onClick={() => setActivity('source-control')} />
          <div className="activity-spacer" />
          <ActivityButton icon="✦" label="Agent" selected={activity === 'agent'} onClick={() => setActivity('agent')} />
        </nav>

        <aside className="explorer-pane">
          <div className="pane-heading">
            <span>{activityTitle(activity)}</span>
            {workspace && activity === 'explorer' && (
              <button className="icon-button" title="Refresh files" onClick={() => void reloadFiles(workspace)}>↻</button>
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
                      <FileTree nodes={tree} onOpen={openFile} />
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
                onModeChange={setSearchMode}
                onQueryChange={setSearchQuery}
                onCaseSensitiveChange={setSearchCaseSensitive}
                onSearch={() => void runSearch()}
                onOpen={openFile}
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
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`Close ${file.path}`}
                    onClick={() => {
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
                  readOnly: true,
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
              {backendStatus.state === 'ready' ? 'Ready' : backendStatus.state === 'starting' ? 'Starting' : 'Offline'}
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
            {backendStatus.state !== 'ready' && (
              <div className="backend-notice" title={backendStatus.message}>
                Python backend unavailable or starting. Check configuration.
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
          <span className={`status-led ${backendStatus.state}`} />
          <span>{backendStatus.state === 'ready' ? 'Python backend ready' : backendStatus.state === 'starting' ? 'Starting backend' : 'Backend offline'}</span>
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
      <div className="welcome-eyebrow">AGENTIC IDE</div>
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
  onModeChange(mode: SearchMode): void;
  onQueryChange(query: string): void;
  onCaseSensitiveChange(value: boolean): void;
  onSearch(): void;
  onOpen(path: string): void;
}): ReactNode {
  return (
    <div className="search-sidebar">
      {!props.hasWorkspace && <div className="muted-message">Open a folder to search.</div>}
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
  onOpen(path: string): void;
}): ReactNode {
  return (
    <div className="file-tree">
      {props.nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

function FileTreeNode(props: {
  node: TreeNode;
  depth: number;
  onOpen(path: string): void;
}): ReactNode {
  const [expanded, setExpanded] = useState(props.depth === 0);
  if (props.node.kind === 'directory') {
    return (
      <>
        <button
          className="tree-row directory"
          style={{ paddingLeft: 8 + props.depth * 14 }}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className={`tree-chevron ${expanded ? 'expanded' : ''}`}>›</span>
          <span className="tree-icon">{expanded ? '▾' : '▸'}</span>
          <span>{props.node.name}</span>
        </button>
        {expanded && props.node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={props.depth + 1} onOpen={props.onOpen} />
        ))}
      </>
    );
  }
  return (
    <button
      className="tree-row file"
      style={{ paddingLeft: 25 + props.depth * 14 }}
      onClick={() => props.onOpen(props.node.path)}
    >
      <span className="file-glyph">{fileGlyph(props.node.path)}</span>
      <span>{props.node.name}</span>
    </button>
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
