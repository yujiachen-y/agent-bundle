import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { toErrorMessage } from "../error.js";

type RequestInitWithDuplex = RequestInit & {
  duplex?: "half";
};

export type StartHttpServerInput = {
  appFetch: (request: Request) => Response | Promise<Response>;
  handleUpgrade?: (request: IncomingMessage, socket: unknown, head: Buffer) => void;
  port: number;
  stderr: NodeJS.WritableStream;
};

export type StartedHttpServer = {
  port: number;
  close: () => Promise<void>;
};

function hasRequestBody(method: string | undefined): boolean {
  return method !== undefined && method !== "GET" && method !== "HEAD";
}

function toFetchRequest(request: IncomingMessage): Request {
  const origin = typeof request.headers.host === "string"
    ? `http://${request.headers.host}`
    : "http://127.0.0.1";
  const url = new URL(request.url ?? "/", origin);
  const headers = new Headers();

  Object.entries(request.headers).forEach(([name, value]) => {
    if (typeof value === "string") {
      headers.set(name, value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        headers.append(name, entry);
      });
    }
  });

  const init: RequestInitWithDuplex = {
    method: request.method,
    headers,
  };

  if (hasRequestBody(request.method)) {
    init.body = request as unknown as BodyInit;
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function writeFetchResponse(response: Response, output: ServerResponse): Promise<void> {
  response.headers.forEach((value, key) => {
    output.setHeader(key, value);
  });
  output.statusCode = response.status;

  if (!response.body) {
    output.end();
    return;
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      output.write(Buffer.from(value));
    }
  }

  output.end();
}

async function closeNodeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (!error) {
        resolveClose();
        return;
      }

      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ERR_SERVER_NOT_RUNNING") {
        resolveClose();
        return;
      }

      rejectClose(error);
    });
  });
}

export async function startHttpServer(input: StartHttpServerInput): Promise<StartedHttpServer> {
  const server = createHttpServer((request, response) => {
    const fetchRequest = toFetchRequest(request);
    void Promise.resolve(input.appFetch(fetchRequest))
      .then(async (fetchResponse) => {
        await writeFetchResponse(fetchResponse, response);
      })
      .catch((error) => {
        input.stderr.write(`[serve] request handling failed: ${toErrorMessage(error)}\n`);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("content-type", "text/plain; charset=utf-8");
        }
        response.end("Internal Server Error");
      });
  });

  if (input.handleUpgrade) {
    server.on("upgrade", input.handleUpgrade);
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(input.port);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeNodeServer(server);
    throw new Error("Failed to resolve serve port from HTTP server address.");
  }

  return {
    port: address.port,
    close: async () => {
      await closeNodeServer(server);
    },
  };
}
