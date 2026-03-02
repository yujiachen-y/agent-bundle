import { spawn as spawnChild } from 'node:child_process';

import WebSocket, { WebSocketServer } from 'ws';

function sendEvent(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function destroyUpgradeSocket(socket, statusCode, statusText) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function parseSpawnRequest(requestUrl, resolveSandboxPath, defaultCwd) {
  const url = new URL(requestUrl || '/', 'http://localhost');
  if (url.pathname !== '/process/spawn') {
    return null;
  }

  const cmd = url.searchParams.get('cmd');
  if (typeof cmd !== 'string' || cmd.trim() === '') {
    throw new Error('cmd is required');
  }

  const args = url.searchParams.getAll('args');
  const requestedCwd = url.searchParams.get('cwd');
  const cwd = requestedCwd
    ? resolveSandboxPath(requestedCwd, defaultCwd)
    : defaultCwd;

  return { cmd, args, cwd };
}

function parseClientMessage(raw) {
  const text = toRawText(raw);
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('invalid spawn message');
  }

  return parsed;
}

function toRawText(raw) {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof Buffer) {
    return raw.toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }
  return Buffer.from(raw).toString('utf8');
}

function bindProcessOutput(socket, child) {
  child.stdout.on('data', (chunk) => {
    sendEvent(socket, { type: 'stdout', data: chunk.toString('utf8') });
  });
  child.stderr.on('data', (chunk) => {
    sendEvent(socket, { type: 'stderr', data: chunk.toString('utf8') });
  });
}

function bindProcessLifecycle(socket, child) {
  child.on('error', (error) => {
    sendEvent(socket, { type: 'error', message: error.message });
  });
  child.on('close', (code, signal) => {
    sendEvent(socket, {
      type: 'exit',
      code: typeof code === 'number' ? code : null,
      signal: typeof signal === 'string' ? signal : null,
    });
  });
}

function bindSocketMessages(socket, child) {
  socket.on('message', (raw) => {
    try {
      const message = parseClientMessage(raw);
      if (message.type === 'stdin' && typeof message.data === 'string') {
        child.stdin.write(message.data);
        return;
      }
      if (message.type === 'stdin-close') {
        child.stdin.end();
        return;
      }
      if (message.type === 'kill') {
        const signal = typeof message.signal === 'string' ? message.signal : 'SIGTERM';
        child.kill(signal);
        return;
      }

      throw new Error('unsupported spawn message type');
    } catch (error) {
      sendEvent(socket, {
        type: 'error',
        message: error instanceof Error ? error.message : 'invalid spawn message',
      });
    }
  });
}

function bindSocketClose(socket, child) {
  socket.on('close', () => {
    if (child.exitCode !== null) {
      return;
    }

    child.kill('SIGTERM');
  });
}

function handleSpawnConnection(socket, request, resolveSandboxPath, defaultCwd) {
  try {
    const spawnRequest = parseSpawnRequest(request.url, resolveSandboxPath, defaultCwd);
    if (spawnRequest === null) {
      socket.close();
      return;
    }

    const child = spawnChild(spawnRequest.cmd, spawnRequest.args, {
      cwd: spawnRequest.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    bindProcessOutput(socket, child);
    bindProcessLifecycle(socket, child);
    bindSocketMessages(socket, child);
    bindSocketClose(socket, child);

    if (typeof child.pid === 'number') {
      sendEvent(socket, { type: 'spawn', pid: child.pid });
      return;
    }

    sendEvent(socket, {
      type: 'error',
      message: `Failed to spawn "${spawnRequest.cmd}": process has no pid`,
    });
  } catch (error) {
    sendEvent(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : 'failed to start process',
    });
  }
}

export function registerSpawnWebSocket(input) {
  const { server, resolveSandboxPath, defaultCwd } = input;
  const socketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const spawnRequest = parseSpawnRequest(request.url, resolveSandboxPath, defaultCwd);
      if (spawnRequest === null) {
        destroyUpgradeSocket(socket, 404, 'Not Found');
        return;
      }
    } catch {
      destroyUpgradeSocket(socket, 400, 'Bad Request');
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (ws) => {
      socketServer.emit('connection', ws, request);
    });
  });

  socketServer.on('connection', (socket, request) => {
    handleSpawnConnection(socket, request, resolveSandboxPath, defaultCwd);
  });
}
