export type BackendStatus =
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

export interface FileSummary {
  path: string;
  lines: number;
  characters: number;
  words: number;
  preview: string[];
  note: string;
}

export interface AgenticIdeApi {
  selectWorkspace(): Promise<WorkspaceInfo | undefined>;
  getBackendStatus(): Promise<BackendStatus>;
  onBackendStatus(callback: (status: BackendStatus) => void): () => void;
  listFiles(workspacePath: string): Promise<WorkspaceEntry[]>;
  searchFiles(workspacePath: string, query: string): Promise<string[]>;
  searchText(
    workspacePath: string,
    query: string,
    caseSensitive: boolean,
  ): Promise<TextMatch[]>;
  readFile(workspacePath: string, relativePath: string): Promise<FileContents>;
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
