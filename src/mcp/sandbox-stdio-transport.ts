import { deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import type { SandboxIO, SpawnedProcess } from "../sandbox/types.js";

export type SandboxStdioTransportOptions = {
  sandbox: SandboxIO;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type StreamReaderResult = {
  rest: string;
  lines: string[];
};

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function readLines(buffer: string): StreamReaderResult {
  const lines: string[] = [];
  let remaining = buffer;

  for (;;) {
    const newline = remaining.indexOf("\n");
    if (newline < 0) {
      break;
    }

    const line = remaining.slice(0, newline).replace(/\r$/, "");
    remaining = remaining.slice(newline + 1);
    if (line.length > 0) {
      lines.push(line);
    }
  }

  return { rest: remaining, lines };
}

function closeWriter(writer: WritableStreamDefaultWriter<Uint8Array> | null): void {
  if (writer === null) {
    return;
  }

  try {
    writer.releaseLock();
  } catch {
    // Writer lock might already be released.
  }
}

export class SandboxStdioTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private process: SpawnedProcess | null = null;
  private stdinWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private stdoutReaderTask: Promise<void> | null = null;
  private stderrReaderTask: Promise<void> | null = null;
  private isClosed = false;
  private isClosing = false;

  public constructor(private readonly options: SandboxStdioTransportOptions) {}

  public async start(): Promise<void> {
    if (this.process !== null) {
      throw new Error("SandboxStdioTransport already started.");
    }

    this.process = await this.options.sandbox.spawn(
      this.options.command,
      this.options.args ?? [],
      {
        cwd: this.options.cwd,
        env: this.options.env,
      },
    );

    this.stdinWriter = this.process.stdin.getWriter();
    this.stdoutReaderTask = this.consumeStdout(this.process.stdout);
    this.stderrReaderTask = this.consumeStderr(this.process.stderr);
    void this.watchExit(this.process);
  }

  public async send(message: JSONRPCMessage): Promise<void> {
    const writer = this.stdinWriter;
    if (!writer) {
      throw new Error("SandboxStdioTransport is not connected.");
    }

    const payload = this.encoder.encode(serializeMessage(message));
    await writer.write(payload);
  }

  public async close(): Promise<void> {
    if (this.isClosed || this.isClosing) {
      return;
    }

    this.isClosing = true;
    const process = this.process;
    const writer = this.stdinWriter;

    try {
      if (writer) {
        await writer.close();
      }
    } catch {
      // Process may already be closing.
    } finally {
      closeWriter(writer);
      this.stdinWriter = null;
    }

    try {
      await process?.kill("SIGTERM");
    } catch {
      // Best effort.
    }

    await Promise.allSettled([
      process?.exited ?? Promise.resolve(0),
      this.stdoutReaderTask ?? Promise.resolve(),
      this.stderrReaderTask ?? Promise.resolve(),
    ]);

    this.finalizeClose();
  }

  private finalizeClose(): void {
    if (this.isClosed) {
      return;
    }

    closeWriter(this.stdinWriter);
    this.stdinWriter = null;
    this.process = null;
    this.isClosed = true;
    this.onclose?.();
  }

  private async watchExit(process: SpawnedProcess): Promise<void> {
    try {
      const exitCode = await process.exited;
      if (exitCode !== 0 && !this.isClosing) {
        this.onerror?.(new Error(`MCP stdio process exited with code ${exitCode}.`));
      }
    } catch (error) {
      if (!this.isClosing) {
        this.onerror?.(toError(error));
      }
    } finally {
      this.finalizeClose();
    }
  }

  private async consumeStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += this.decoder.decode(value, { stream: true });
        const parsed = readLines(buffer);
        buffer = parsed.rest;
        parsed.lines.forEach((line) => {
          try {
            this.onmessage?.(deserializeMessage(line));
          } catch (error) {
            this.onerror?.(toError(error));
          }
        });
      }

      buffer += this.decoder.decode();
      if (buffer.trim().length > 0) {
        try {
          this.onmessage?.(deserializeMessage(buffer.trim()));
        } catch (error) {
          this.onerror?.(toError(error));
        }
      }
    } catch (error) {
      if (!this.isClosing) {
        this.onerror?.(toError(error));
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async consumeStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true }).trim();
        if (text.length > 0) {
          this.onerror?.(new Error(`MCP stdio stderr: ${text}`));
        }
      }

      const trailing = decoder.decode().trim();
      if (trailing.length > 0) {
        this.onerror?.(new Error(`MCP stdio stderr: ${trailing}`));
      }
    } catch (error) {
      if (!this.isClosing) {
        this.onerror?.(toError(error));
      }
    } finally {
      reader.releaseLock();
    }
  }
}
