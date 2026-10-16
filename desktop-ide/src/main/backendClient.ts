import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { BackendStatus } from '../shared/api';

interface BackendResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export class BackendClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private status: BackendStatus = {
    state: 'starting',
    message: 'Starting Python backend…',
  };

  constructor(
    private readonly backendRoot: string,
    private readonly pythonExecutable: string,
    private readonly onStatus: (status: BackendStatus) => void,
  ) {}

  start(): void {
    if (this.child) {
      return;
    }
    try {
      this.child = spawn(
        this.pythonExecutable,
        ['-u', '-m', 'agent.bridge'],
        {
          cwd: this.backendRoot,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      this.setUnavailable(errorMessage(error));
      return;
    }

    const child = this.child;
    child.stderr.resume();
    const output = createInterface({ input: child.stdout });
    output.on('line', (line) => this.handleResponse(line));
    child.on('error', (error) => {
      this.setUnavailable(`Could not start Python backend: ${error.message}`);
    });
    child.on('close', (code) => {
      this.child = undefined;
      this.rejectPending(
        new Error(`Python backend exited${code === null ? '' : ` (${code})`}.`),
      );
      if (this.status.state !== 'unavailable') {
        this.setUnavailable('Python backend stopped.');
      }
    });
    this.request<{ status: string }>({ operation: 'health' })
      .then(() => {
        this.setStatus({ state: 'ready', message: 'Python backend ready' });
      })
      .catch((error: unknown) => this.setUnavailable(errorMessage(error)));
  }

  getStatus(): BackendStatus {
    return this.status;
  }

  request<T>(payload: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error('Python backend is not available.'));
    }

    const id = this.nextRequestId++;
    const line = JSON.stringify({ ...payload, id });
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Python backend request timed out.'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      child.stdin.write(`${line}\n`, 'utf8', (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(id);
            pending.reject(new Error('Could not send request to Python backend.'));
          }
        }
      });
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
    this.rejectPending(new Error('Python backend stopped.'));
  }

  private handleResponse(line: string): void {
    let response: BackendResponse;
    try {
      response = JSON.parse(line) as BackendResponse;
    } catch {
      this.setUnavailable('Python backend returned invalid protocol data.');
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(
        new Error(response.error?.message ?? 'Python backend request failed.'),
      );
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setUnavailable(message: string): void {
    this.setStatus({ state: 'unavailable', message });
  }

  private setStatus(status: BackendStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown backend error.';
}
