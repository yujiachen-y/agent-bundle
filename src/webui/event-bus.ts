import { EventEmitter } from "node:events";

import type { ResponseEvent } from "../agent-loop/types.js";

export type WebUIEvent =
  | { type: "agent_event"; event: ResponseEvent }
  | { type: "files_changed" };

export type WebUIEventListener = (event: WebUIEvent) => void;

const CHANNEL = "webui";

export class WebUIEventBus {
  private readonly emitter = new EventEmitter();

  public constructor() {
    this.emitter.setMaxListeners(100);
  }

  public subscribe(listener: WebUIEventListener): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => {
      this.emitter.removeListener(CHANNEL, listener);
    };
  }

  public emit(event: WebUIEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  public listenerCount(): number {
    return this.emitter.listenerCount(CHANNEL);
  }

  public dispose(): void {
    this.emitter.removeAllListeners(CHANNEL);
  }
}
