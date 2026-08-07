import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import {
  CRISPER_WHISPER_MODEL_BY_MODE,
  type EnabledTranscriptionMode,
} from './transcription-modes.js';

const DEFAULT_WORKER_PATH = fileURLToPath(
  new URL('../../scripts/crisperwhisper_worker.py', import.meta.url)
);
const MAX_STDERR_CHARS = 8_000;

export function isAudioMimeType(mimeType: string): boolean {
  return (mimeType.split(';')[0] || '').trim().toLowerCase().startsWith('audio/');
}

export interface TranscribeAudioOptions {
  audioPath: string;
  mode: EnabledTranscriptionMode;
  language: string;
}

interface WorkerRequest extends TranscribeAudioOptions {
  id: number;
  model: string;
}

interface WorkerResponse {
  id: number;
  text?: string;
  error?: string;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface LocalTranscriberOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Persistent JSON-lines client for the Python inference worker. Keeping one
 * worker alive avoids reloading a multi-gigabyte model for every voice note.
 */
export class LocalTranscriber {
  private worker: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private stderrTail = '';
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly options: LocalTranscriberOptions) {}

  async transcribe(opts: TranscribeAudioOptions): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const request: WorkerRequest = {
      id,
      audioPath: opts.audioPath,
      mode: opts.mode,
      language: opts.language,
      model: CRISPER_WHISPER_MODEL_BY_MODE[opts.mode],
    };

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Local transcription timed out after ${this.options.timeoutMs}ms`));
        this.stop('Transcription worker stopped after a timeout');
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      worker.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(new Error(`Could not send work to local transcription process: ${error.message}`));
      });
    });
  }

  stop(reason = 'Local transcription worker stopped'): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker && !worker.killed) worker.kill('SIGTERM');
    this.rejectPending(new Error(reason));
    this.stdoutBuffer = '';
    this.stderrTail = '';
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed) return this.worker;

    const worker = spawn(this.options.command, this.options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.worker = worker;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (chunk: string) => this.handleStdout(chunk));

    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-MAX_STDERR_CHARS);
    });

    worker.once('error', (error) => {
      this.handleWorkerStopped(worker, `Local transcription worker failed to start: ${error.message}`);
    });
    worker.once('exit', (code, signal) => {
      const detail = this.stderrTail.trim();
      const suffix = detail ? `\n${detail}` : '';
      this.handleWorkerStopped(
        worker,
        `Local transcription worker exited (code=${String(code)}, signal=${String(signal)})${suffix}`
      );
    });

    return worker;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleResponseLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.stop(`Local transcription worker returned invalid output: ${line.slice(0, 500)}`);
      return;
    }

    if (!Number.isInteger(response.id)) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve((response.text ?? '').trim());
    }
  }

  private handleWorkerStopped(worker: ChildProcessWithoutNullStreams, message: string): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.rejectPending(new Error(message));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const localTranscriber = new LocalTranscriber({
  command: config.crisperWhisperPython,
  args: ['-u', DEFAULT_WORKER_PATH],
  timeoutMs: config.crisperWhisperTimeoutMs,
  env: {
    OMP_NUM_THREADS: String(config.crisperWhisperCpuThreads),
    MKL_NUM_THREADS: String(config.crisperWhisperCpuThreads),
    OPENBLAS_NUM_THREADS: String(config.crisperWhisperCpuThreads),
    NUMEXPR_NUM_THREADS: String(config.crisperWhisperCpuThreads),
    VECLIB_MAXIMUM_THREADS: String(config.crisperWhisperCpuThreads),
    TOKENIZERS_PARALLELISM: 'false',
    CUDA_VISIBLE_DEVICES: '',
    HF_HOME: config.crisperWhisperCacheDir,
    HF_HUB_DISABLE_TELEMETRY: '1',
    CRISPERWHISPER_COMPUTE_TYPE: config.crisperWhisperComputeType,
    CRISPERWHISPER_CPU_THREADS: String(config.crisperWhisperCpuThreads),
  },
});

export function transcribeAudio(opts: TranscribeAudioOptions): Promise<string> {
  return localTranscriber.transcribe(opts);
}

export function stopTranscriptionWorker(): void {
  localTranscriber.stop();
}
