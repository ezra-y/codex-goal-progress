import type { GoalProgressUiPreference, GoalProgressViewModel } from "../../contracts/src/index.js";

export interface ViewModelPublisherSink {
  clear(): Promise<void>;
  handleDisconnect?(code: string): Promise<void> | void;
  publish(viewModel: GoalProgressViewModel): Promise<void>;
  recoverVisibleThreadId?(): Promise<string | undefined>;
  setUiPreference?(uiPreference: GoalProgressUiPreference): Promise<void>;
  close?(): Promise<void> | void;
}

function viewModelFingerprint(viewModel: GoalProgressViewModel): string {
  return JSON.stringify(viewModel);
}

export class ViewModelPublisher {
  #sink: ViewModelPublisherSink | undefined;
  #currentThreadId: string | undefined;
  #latestViewModel: GoalProgressViewModel | undefined;
  #latestFingerprint: string | undefined;
  #deliveredFingerprint: string | undefined;
  #clearRequired = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(sink?: ViewModelPublisherSink) {
    this.#sink = sink;
  }

  get currentThreadId(): string | undefined {
    return this.#currentThreadId;
  }

  get currentRevision(): number | undefined {
    return this.#latestViewModel?.revision;
  }

  get deliveryCurrent(): boolean {
    return (
      this.#latestFingerprint !== undefined &&
      this.#latestFingerprint === this.#deliveredFingerprint
    );
  }

  get visibleThreadAwarenessAvailable(): boolean {
    return this.#sink?.recoverVisibleThreadId !== undefined;
  }

  async initialize(): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#sink) {
        return;
      }
      this.#clearRequired = true;
      await this.#clearSink();
    });
  }

  async recoverVisibleThreadId(): Promise<string | undefined> {
    let recovered: string | undefined;
    await this.#enqueue(async () => {
      try {
        recovered = await this.#sink?.recoverVisibleThreadId?.();
      } catch {
        recovered = undefined;
      }
    });
    return recovered;
  }

  async markDeliveryStale(): Promise<void> {
    return this.#enqueue(async () => {
      this.#deliveredFingerprint = undefined;
    });
  }

  async handleDisconnect(code: string): Promise<void> {
    return this.#enqueue(async () => {
      this.#deliveredFingerprint = undefined;
      await this.#sink?.handleDisconnect?.(code);
    });
  }

  async activateThread(threadId: string): Promise<void> {
    return this.#enqueue(async () => {
      if (!threadId) {
        throw new Error("GOAL_PROGRESS_PUBLISHER_THREAD_REQUIRED");
      }
      if (threadId === this.#currentThreadId) {
        return;
      }
      const hadCurrentThread = this.#currentThreadId !== undefined;
      this.#latestViewModel = undefined;
      this.#latestFingerprint = undefined;
      this.#deliveredFingerprint = undefined;
      this.#clearRequired = hadCurrentThread;
      if (hadCurrentThread) {
        await this.#clearSink();
      }
      this.#currentThreadId = threadId;
    });
  }

  async publish(threadId: string, viewModel: GoalProgressViewModel): Promise<void> {
    return this.#enqueue(async () => {
      if (threadId !== this.#currentThreadId) {
        return;
      }
      const fingerprint = viewModelFingerprint(viewModel);
      this.#latestViewModel = viewModel;
      this.#latestFingerprint = fingerprint;
      if (!this.#sink || fingerprint === this.#deliveredFingerprint) {
        return;
      }
      if (this.#clearRequired) {
        await this.#clearSink();
      }
      if (!this.#sink || this.#clearRequired) {
        return;
      }
      try {
        await this.#sink.publish(viewModel);
        this.#deliveredFingerprint = fingerprint;
      } catch {
        this.#deliveredFingerprint = undefined;
      }
    });
  }

  async setSink(sink?: ViewModelPublisherSink): Promise<void> {
    return this.#enqueue(async () => {
      this.#sink = sink;
      this.#deliveredFingerprint = undefined;
      if (!sink) {
        return;
      }
      this.#clearRequired = true;
      await this.#clearSink();
      if (!this.#clearRequired && this.#latestViewModel && this.#latestFingerprint) {
        try {
          await sink.publish(this.#latestViewModel);
          this.#deliveredFingerprint = this.#latestFingerprint;
        } catch {
          this.#deliveredFingerprint = undefined;
        }
      }
    });
  }

  async setUiPreference(uiPreference: GoalProgressUiPreference): Promise<void> {
    return this.#enqueue(async () => {
      try {
        await this.#sink?.setUiPreference?.(uiPreference);
      } catch {
        // UI preference transport cannot block Store or MCP.
      }
    });
  }

  async clear(threadId: string): Promise<void> {
    return this.#enqueue(async () => {
      if (threadId !== this.#currentThreadId) {
        return;
      }
      this.#latestViewModel = undefined;
      this.#latestFingerprint = undefined;
      this.#deliveredFingerprint = undefined;
      this.#clearRequired = true;
      await this.#clearSink();
    });
  }

  async close(): Promise<void> {
    return this.#enqueue(async () => {
      const sink = this.#sink;
      this.#sink = undefined;
      this.#deliveredFingerprint = undefined;
      try {
        await sink?.close?.();
      } catch {
        // Renderer transport shutdown cannot block Helper shutdown.
      }
    });
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #clearSink(): Promise<void> {
    if (!this.#sink) {
      return;
    }
    try {
      await this.#sink.clear();
      this.#clearRequired = false;
    } catch {
      this.#clearRequired = true;
    }
  }
}
