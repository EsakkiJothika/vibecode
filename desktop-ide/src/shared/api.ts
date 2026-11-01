export type BackendStatus =
  | { state: 'idle'; message: string }
  | { state: 'starting'; message: string }
  | { state: 'ready'; message: string }
  | { state: 'unavailable'; message: string };

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface WorkspaceEntry {
  path: string;
  kind: 'file' | 'directory';
}

export interface TextMatch {
  path: string;
  line: number;
  text: string;
}

export type SearchMatch = TextMatch;

export interface FileContents {
  path: string;
  content: string;
}

export interface ImagePreview {
  path: string;
  data_url: string;
}

export interface FileSummary {
  path: string;
  lines: number;
  characters: number;
  words: number;
  preview: string[];
  note: string;
}

export type FileMenuAction =
  | 'new-file'
  | 'new-folder'
  | 'open-file'
  | 'open-folder'
  | 'refresh-explorer'
  | 'collapse-folders'
  | 'save'
  | 'save-as'
  | 'save-all'
  | 'close-editor'
  | 'exit';

export interface AgenticIdeApi {
  selectWorkspace(): Promise<WorkspaceInfo | undefined>;
  selectFile(): Promise<string | undefined>;
  selectSavePath(defaultPath?: string): Promise<string | undefined>;
  revealPath(workspacePath: string, relativePath: string): Promise<void>;
  quit(): void;
  onFileMenuAction(callback: (action: FileMenuAction) => void): () => void;
  getBackendStatus(): Promise<BackendStatus>;
  onBackendStatus(callback: (status: BackendStatus) => void): () => void;
  listFiles(workspacePath: string): Promise<WorkspaceEntry[]>;
  searchFiles(workspacePath: string, query: string): Promise<string[]>;
  searchText(
    workspacePath: string,
    query: string,
    caseSensitive: boolean,
    directory?: string,
  ): Promise<TextMatch[]>;
  readFile(workspacePath: string, relativePath: string): Promise<FileContents>;
  writeFile(
    workspacePath: string,
    relativePath: string,
    content: string,
    allowCreate?: boolean,
  ): Promise<FileContents>;
  createDirectory(workspacePath: string, relativePath: string): Promise<void>;
  renamePath(
    workspacePath: string,
    relativePath: string,
    newRelativePath: string,
  ): Promise<void>;
  deletePath(workspacePath: string, relativePath: string): Promise<void>;
  readImage(workspacePath: string, relativePath: string): Promise<ImagePreview>;
  summarizeFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<FileSummary>;
  askAgent(prompt: string): Promise<string>;
}

declare global {
  interface Window {
    agenticIDE: AgenticIdeApi;
  }
}
