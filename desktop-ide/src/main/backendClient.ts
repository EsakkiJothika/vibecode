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

const MAX_STDERR_LENGTH = 8000;

export class BackendClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private startupPromise: Promise<void> | undefined;
  private backendReady = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail = '';
  private spawnFailure: string | undefined;
  private status: BackendStatus = {
    state: 'idle',
    message: 'Python backend starts when you choose a workspace.',
  };

  constructor(
    private readonly backendRoot: string,
    private readonly pythonExecutable: string,
    private readonly onStatus: (status: BackendStatus) => void,
    private readonly startupTimeoutMs = 10000,
  ) {}

  start(): Promise<void> {
    return this.ensureStarted();
  }

  getStatus(): BackendStatus {
    return this.status;
  }

  async request<T>(
    payload: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<T> {
    await this.ensureStarted();
    return this.sendRequest<T>(payload, timeoutMs);
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.backendReady = false;
    this.rejectPending(new Error('Python backend stopped.'));
    if (child && child.exitCode === null && !child.killed) {
      child.kill();
    }
  }

  private ensureStarted(): Promise<void> {
    const child = this.child;
    if (
      child &&
      this.backendReady &&
      !child.killed &&
      child.exitCode === null
    ) {
      return Promise.resolve();
    }
    if (this.startupPromise) {
      return this.startupPromise;
    }
    if (child) {
      return Promise.reject(
        new Error(this.status.message || 'Python backend is shutting down.'),
      );
    }

    this.setStatus({ state: 'starting', message: 'Starting Python backend…' });
    this.stderrTail = '';
    this.spawnFailure = undefined;
    const startup = this.startBackend();
    this.startupPromise = startup;
    void startup.then(
      () => {
        if (this.startupPromise === startup) this.startupPromise = undefined;
      },
      () => {
        if (this.startupPromise === startup) this.startupPromise = undefined;
      },
    );
    return startup;
  }

  private async startBackend(): Promise<void> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        this.pythonExecutable,
        ['-u', '-m', 'agent.bridge'],
        {
          cwd: this.backendRoot,
          env: { ...process.env, PYTHONUTF8: '1' },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      const message = this.describeSpawnError(error);
      this.setUnavailable(message);
      throw new Error(message);
    }

    this.child = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-MAX_STDERR_LENGTH);
    });
    const output = createInterface({ input: child.stdout });
    output.on('line', (line) => this.handleResponse(line));
    child.on('error', (error) => {
      this.spawnFailure = this.describeSpawnError(error);
      if (this.child === child) {
        this.setUnavailable(this.spawnFailure);
        this.rejectPending(new Error(this.spawnFailure));
      }
    });
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.backendReady = false;
      const message = this.spawnFailure ?? this.describeExit(code, signal);
      this.rejectPending(new Error(message));
      this.setUnavailable(message);
    });

    try {
      await this.waitForSpawn(child);
      const health = await this.sendRequest<{ status: string }>(
        { operation: 'health' },
        this.startupTimeoutMs,
      );
      if (health.status !== 'ready') {
        throw new Error('Python backend health check returned an invalid status.');
      }
      if (this.child !== child || child.exitCode !== null) {
        throw new Error('Python backend exited during its health check.');
      }
      this.backendReady = true;
      this.setStatus({ state: 'ready', message: 'Python backend ready' });
    } catch (error) {
      const message =
        this.status.state === 'unavailable'
          ? this.status.message
          : this.withStderr(errorMessage(error));
      this.setUnavailable(message);
      if (this.child === child && child.exitCode === null && !child.killed) {
        child.kill();
      }
      throw new Error(message);
    }
  }

  private waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Python backend did not start within ${this.startupTimeoutMs / 1000} seconds.`,
          ),
        );
      }, this.startupTimeoutMs);
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new Error(this.describeSpawnError(error)));
      };
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(new Error(this.spawnFailure ?? this.describeExit(code, signal)));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.removeListener('spawn', onSpawn);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
      child.once('close', onClose);
    });
  }

  private sendRequest<T>(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || !child.stdin.writable) {
      return Promise.reject(
        new Error(this.status.message || 'Python backend is not available.'),
      );
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
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(
            new Error(`Could not send request to Python backend: ${error.message}`),
          );
        }
      });
    });
  }

  private handleResponse(line: string): void {
    let response: BackendResponse;
    try {
      response = JSON.parse(line) as BackendResponse;
    } catch {
      const message = this.withStderr(
        'Python backend returned invalid protocol data.',
      );
      this.setUnavailable(message);
      this.rejectPending(new Error(message));
      this.child?.kill();
      return;
    }

    if (!Number.isInteger(response.id)) {
      const message = this.withStderr(
        'Python backend response did not contain a valid request id.',
      );
      this.setUnavailable(message);
      this.rejectPending(new Error(message));
      this.child?.kill();
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
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

  private describeSpawnError(error: unknown): string {
    const detail = errorMessage(error);
    if (detail.includes('ENOENT')) {
      return `Could not find Python executable "${this.pythonExecutable}". Install Python, add it to PATH, or set AGENTIC_IDE_PYTHON to its absolute path.`;
    }
    return `Could not start Python executable "${this.pythonExecutable}": ${detail}`;
  }

  private describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    const exit = signal
      ? `signal ${signal}`
      : `code ${code === null ? 'unknown' : code}`;
    return this.withStderr(
      `Python backend exited with ${exit}. Check the Python executable and backend project path.`,
    );
  }

  private withStderr(message: string): string {
    const detail = this.stderrTail.trim();
    return detail ? `${message}\nPython stderr: ${detail}` : message;
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
