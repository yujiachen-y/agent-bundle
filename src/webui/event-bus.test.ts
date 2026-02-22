import { describe, expect, it, vi } from "vitest";

import type { WebUIEvent } from "./event-bus.js";
import { WebUIEventBus } from "./event-bus.js";

describe("WebUIEventBus", () => {
  it("delivers emitted events to subscribers", () => {
    const bus = new WebUIEventBus();
    const received: WebUIEvent[] = [];
    bus.subscribe((event) => received.push(event));

    const event: WebUIEvent = { type: "files_changed" };
    bus.emit(event);

    expect(received).toEqual([event]);
    bus.dispose();
  });

  it("supports multiple subscribers", () => {
    const bus = new WebUIEventBus();
    const a: WebUIEvent[] = [];
    const b: WebUIEvent[] = [];
    bus.subscribe((event) => a.push(event));
    bus.subscribe((event) => b.push(event));

    bus.emit({ type: "files_changed" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    bus.dispose();
  });

  it("unsubscribe stops delivery", () => {
    const bus = new WebUIEventBus();
    const received: WebUIEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.emit({ type: "files_changed" });
    unsubscribe();
    bus.emit({ type: "files_changed" });

    expect(received).toHaveLength(1);
    bus.dispose();
  });

  it("listenerCount returns active subscriber count", () => {
    const bus = new WebUIEventBus();
    expect(bus.listenerCount()).toBe(0);

    const unsub1 = bus.subscribe(() => {});
    const unsub2 = bus.subscribe(() => {});
    expect(bus.listenerCount()).toBe(2);

    unsub1();
    expect(bus.listenerCount()).toBe(1);

    unsub2();
    expect(bus.listenerCount()).toBe(0);
    bus.dispose();
  });

  it("dispose removes all subscribers", () => {
    const bus = new WebUIEventBus();
    bus.subscribe(() => {});
    bus.subscribe(() => {});

    bus.dispose();
    expect(bus.listenerCount()).toBe(0);
  });

  it("delivers agent_event payloads", () => {
    const bus = new WebUIEventBus();
    const received: WebUIEvent[] = [];
    bus.subscribe((event) => received.push(event));

    const event: WebUIEvent = {
      type: "agent_event",
      event: { type: "response.output_text.delta", delta: "hello" },
    };
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
    bus.dispose();
  });

  it("handles rapid emission without dropping events", () => {
    const bus = new WebUIEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    for (let i = 0; i < 50; i++) {
      bus.emit({ type: "files_changed" });
    }

    expect(listener).toHaveBeenCalledTimes(50);
    bus.dispose();
  });
});
