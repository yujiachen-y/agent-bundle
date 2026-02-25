/* global Terminal, FitAddon */

(function () {
  "use strict";

  // ─── DOM refs ───
  var termContainer = document.getElementById("terminal-container");
  var chatForm = document.getElementById("chat-form");
  var chatInput = document.getElementById("chat-input");
  var sendBtn = document.getElementById("send-btn");
  var fileTree = document.getElementById("file-tree");
  var statusBadge = document.getElementById("status-badge");

  // ─── xterm.js setup ───
  var fitAddon = new FitAddon.FitAddon();
  var term = new Terminal({
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      selectionBackground: "rgba(122, 162, 247, 0.25)",
    },
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    scrollback: 10000,
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
  });

  term.loadAddon(fitAddon);
  term.open(termContainer);
  fitAddon.fit();

  window.addEventListener("resize", function () {
    fitAddon.fit();
  });

  term.writeln("\x1b[90m─── agent-bundle WebUI ───\x1b[0m\n");

  // ─── State ───
  var isStreaming = false;
  var FILE_POLL_MS = 3000;
  var filePollingTimer = null;
  var ws = null;

  // ─── Status badge ───
  function setStatus(status) {
    statusBadge.textContent = status;
    statusBadge.className = "badge badge--" + status;
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  // ─── File tree ───
  function renderFileTree(entries, parentEl, depth) {
    var sorted = entries.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(function (entry) {
      var item = document.createElement("div");
      item.className = "ft-item";

      var indent = document.createElement("span");
      indent.className = "ft-indent";
      indent.style.width = depth * 16 + "px";
      item.appendChild(indent);

      var icon = document.createElement("span");
      icon.className = "ft-icon" + (entry.type === "directory" ? " ft-icon--dir" : "");
      icon.textContent = entry.type === "directory" ? "\u25B8" : "\u2022";
      item.appendChild(icon);

      var name = document.createElement("span");
      name.className = "ft-name";
      name.textContent = entry.name;
      item.appendChild(name);

      parentEl.appendChild(item);

      if (entry.children && entry.children.length > 0) {
        renderFileTree(entry.children, parentEl, depth + 1);
      }
    });
  }

  function refreshFileTree() {
    fetch("/api/files")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        fileTree.innerHTML = "";
        if (data.entries && data.entries.length > 0) {
          renderFileTree(data.entries, fileTree, 0);
        } else {
          var empty = document.createElement("div");
          empty.className = "ft-item";
          empty.style.color = "var(--text-subtle)";
          empty.textContent = "(empty)";
          fileTree.appendChild(empty);
        }
      })
      .catch(function () {
        // Silently retry on next poll
      });
  }

  function startFilePolling() {
    refreshFileTree();
    filePollingTimer = setInterval(refreshFileTree, FILE_POLL_MS);
  }

  function stopFilePolling() {
    if (filePollingTimer !== null) {
      clearInterval(filePollingTimer);
      filePollingTimer = null;
    }
  }

  // ─── WebSocket ───
  var disconnectedShown = false;

  function connectWebSocket() {
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    var url = protocol + "//" + window.location.host + "/ws";
    ws = new WebSocket(url);

    ws.onopen = function () {
      if (disconnectedShown) {
        term.writeln("\x1b[32mReconnected.\x1b[0m\n");
      } else {
        term.writeln("\x1b[32mConnected to agent.\x1b[0m\n");
      }
      disconnectedShown = false;
    };

    ws.onmessage = function (msg) {
      try {
        var event = JSON.parse(msg.data);
        handleAgentEvent(event);
      } catch (_) {
        // ignore malformed messages
      }
    };

    ws.onclose = function () {
      if (!disconnectedShown) {
        term.writeln("\n\x1b[33mDisconnected.\x1b[0m");
        disconnectedShown = true;
      }
      setStatus("idle");
      setInputEnabled(true);
      isStreaming = false;
      // Attempt reconnect after delay
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  // ─── Agent event handling ───
  function handleAgentEvent(event) {
    switch (event.type) {
      case "response.created":
        setStatus("running");
        break;

      case "response.output_text.delta":
        term.write(event.delta);
        break;

      case "response.output_text.done":
        // final text already streamed via deltas
        break;

      case "response.tool_call.created":
        term.writeln("\n\x1b[90m[tool: " + event.toolCall.name + "] running...\x1b[0m");
        break;

      case "response.tool_call.done":
        if (event.result && event.result.isError) {
          term.writeln("\x1b[31m[tool error] " + String(event.result.output) + "\x1b[0m");
        } else {
          term.writeln("\x1b[90m[tool: done]\x1b[0m");
        }
        break;

      case "tool_execution_update":
        term.write("\x1b[90m" + event.chunk + "\x1b[0m");
        break;

      case "response.completed":
        term.writeln("\n");
        setStatus("idle");
        setInputEnabled(true);
        isStreaming = false;
        refreshFileTree();
        break;

      case "response.error":
        term.writeln("\n\x1b[31mError: " + event.error + "\x1b[0m\n");
        setStatus("error");
        setInputEnabled(true);
        isStreaming = false;
        break;

      case "files_changed":
        refreshFileTree();
        break;
    }
  }

  // ─── Chat submission ───
  function sendMessage(text) {
    if (!text || isStreaming) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      term.writeln("\x1b[31mNot connected to agent.\x1b[0m");
      return;
    }

    isStreaming = true;
    setStatus("running");
    setInputEnabled(false);

    term.writeln("\x1b[36m> " + text + "\x1b[0m\n");

    ws.send(JSON.stringify({
      type: "chat",
      input: [{ role: "user", content: text }],
    }));
  }

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (text.length === 0) return;
    chatInput.value = "";
    sendMessage(text);
  });

  // ─── Init ───
  startFilePolling();
  connectWebSocket();
})();
