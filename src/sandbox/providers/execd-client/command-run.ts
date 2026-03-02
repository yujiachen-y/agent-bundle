import type { CommandRunResponse } from "./types.js";

type CommandRunRequest = {
  cmd: string;
  cwd?: string;
  timeout?: number;
};

type SseEvent = {
  event: string;
  data: string;
};

type StreamingState = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  finalResult: CommandRunResponse | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCommandRunResponse(value: unknown): value is CommandRunResponse {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.stdout === "string"
    && typeof value.stderr === "string"
    && typeof value.exitCode === "number"
  );
}

function parseJsonData(data: string): unknown {
  const trimmed = data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseSseEventBlock(block: string): SseEvent | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  });

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function takeEventBlocks(buffer: string): {
  blocks: string[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  if (normalized.endsWith("\n\n")) {
    return {
      blocks: parts.filter((part) => part.trim().length > 0),
      rest: "",
    };
  }

  const rest = parts.pop() ?? "";
  return {
    blocks: parts.filter((part) => part.trim().length > 0),
    rest,
  };
}

function appendStreamChunk(
  state: StreamingState,
  streamName: "stdout" | "stderr",
  chunk: string,
  onChunk?: (chunk: string) => void,
): void {
  if (chunk.length === 0) {
    return;
  }

  if (streamName === "stdout") {
    state.stdout += chunk;
  } else {
    state.stderr += chunk;
  }
  onChunk?.(chunk);
}

function applyJsonPayload(
  payload: unknown,
  state: StreamingState,
  onChunk?: (chunk: string) => void,
): void {
  if (isCommandRunResponse(payload)) {
    state.finalResult = payload;
    return;
  }

  if (!isObject(payload)) {
    return;
  }

  if (typeof payload.exitCode === "number") {
    state.exitCode = payload.exitCode;
  }

  if (payload.type === "stdout" && typeof payload.chunk === "string") {
    appendStreamChunk(state, "stdout", payload.chunk, onChunk);
    return;
  }

  if (payload.type === "stderr" && typeof payload.chunk === "string") {
    appendStreamChunk(state, "stderr", payload.chunk, onChunk);
  }
}

function applySseEvent(
  event: SseEvent,
  state: StreamingState,
  onChunk?: (chunk: string) => void,
): void {
  const eventName = event.event.toLowerCase();

  if (eventName === "stdout") {
    appendStreamChunk(state, "stdout", event.data, onChunk);
    return;
  }

  if (eventName === "stderr") {
    appendStreamChunk(state, "stderr", event.data, onChunk);
    return;
  }

  const payload = parseJsonData(event.data);
  applyJsonPayload(payload, state, onChunk);
}

function toCommandRunResult(state: StreamingState, url: string): CommandRunResponse {
  if (state.finalResult) {
    return state.finalResult;
  }

  if (state.exitCode === null) {
    throw new Error(`SSE stream from ${url} closed without an exitCode.`);
  }

  return {
    stdout: state.stdout,
    stderr: state.stderr,
    exitCode: state.exitCode,
  };
}

async function parseStreamingResponse(
  url: string,
  response: Response,
  onChunk?: (chunk: string) => void,
): Promise<CommandRunResponse> {
  if (!response.body) {
    throw new Error(`SSE stream from ${url} has no response body.`);
  }

  const state: StreamingState = {
    stdout: "",
    stderr: "",
    exitCode: null,
    finalResult: null,
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    buffer += decoder.decode(chunk.value, { stream: true });
    const { blocks, rest } = takeEventBlocks(buffer);
    buffer = rest;

    blocks.forEach((block) => {
      const event = parseSseEventBlock(block);
      if (event) {
        applySseEvent(event, state, onChunk);
      }
    });
  }

  buffer += decoder.decode();
  const { blocks } = takeEventBlocks(`${buffer}\n\n`);
  blocks.forEach((block) => {
    const event = parseSseEventBlock(block);
    if (event) {
      applySseEvent(event, state, onChunk);
    }
  });

  return toCommandRunResult(state, url);
}

function parseJsonResponse(url: string, bodyText: string): CommandRunResponse {
  const payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  if (!isCommandRunResponse(payload)) {
    throw new Error(`Invalid command response from ${url}.`);
  }

  return payload;
}

function toCommandPayload(request: CommandRunRequest): string {
  return JSON.stringify(request);
}

export async function requestCommandRun(
  url: string,
  request: CommandRunRequest,
  onChunk?: (chunk: string) => void,
): Promise<CommandRunResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream, application/json",
    },
    body: toCommandPayload(request),
  });

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`HTTP ${response.status} ${url}: ${bodyText}`);
  }

  if (contentType.includes("text/event-stream")) {
    return await parseStreamingResponse(url, response, onChunk);
  }

  const bodyText = await response.text();
  const result = parseJsonResponse(url, bodyText);
  if (result.stdout.length > 0) {
    onChunk?.(result.stdout);
  }
  if (result.stderr.length > 0) {
    onChunk?.(result.stderr);
  }

  return result;
}
