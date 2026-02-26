/* global Terminal, FitAddon, marked, hljs */

(function () {
  "use strict";

  // =========================================================================
  //  DOM References
  // =========================================================================

  var chatMessages = document.getElementById("chat-messages");
  var welcomeState = document.getElementById("welcome-state");
  var promptChips = document.getElementById("prompt-chips");
  var skillBadges = document.getElementById("skill-badges");
  var terminalSection = document.getElementById("terminal-section");
  var terminalToggle = document.getElementById("terminal-toggle");
  var terminalContainer = document.getElementById("terminal-container");
  var fileTreeEl = document.getElementById("file-tree");
  var filePanel = document.getElementById("file-panel");
  var filePreview = document.getElementById("file-preview");
  var previewContent = document.getElementById("preview-content");
  var previewFilename = document.getElementById("preview-filename");
  var previewClose = document.getElementById("preview-close");
  var imageModal = document.getElementById("image-modal");
  var modalImage = document.getElementById("modal-image");
  var modalClose = document.getElementById("modal-close");
  var chatForm = document.getElementById("chat-form");
  var chatInput = document.getElementById("chat-input");
  var sendBtn = document.getElementById("send-btn");
  var statusBadge = document.getElementById("status-badge");
  var header = document.getElementById("header");

  // =========================================================================
  //  Markdown Configuration
  // =========================================================================

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // =========================================================================
  //  xterm.js Setup
  // =========================================================================

  var fitAddon = new FitAddon.FitAddon();
  var term = new Terminal({
    theme: {
      background: "#111114",
      foreground: "#fafafa",
      cursor: "#fafafa",
      selectionBackground: "rgba(139,92,246,0.25)",
    },
    fontFamily: '"Fira Code", "SF Mono", "Cascadia Code", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    scrollback: 10000,
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
  });

  term.loadAddon(fitAddon);
  term.open(terminalContainer);

  // Terminal starts collapsed — defer fit until visible
  function fitTerminalIfVisible() {
    if (!terminalSection.classList.contains("terminal-section--collapsed")) {
      try { fitAddon.fit(); } catch (_) { /* ignore if not visible */ }
    }
  }

  window.addEventListener("resize", fitTerminalIfVisible);

  // =========================================================================
  //  State
  // =========================================================================

  var isStreaming = false;
  var FILE_POLL_MS = 3000;
  var filePollingTimer = null;
  var ws = null;

  // Streaming text accumulation
  var currentAgentText = "";
  var currentAgentEl = null;
  var renderTimer = null;
  var RENDER_DEBOUNCE_MS = 80;

  // File tree change detection
  var previousFilePaths = new Set();

  // Currently active tool message for status updates
  var currentToolEl = null;

  // Track active file for preview highlighting
  var activeFilePath = null;

  // =========================================================================
  //  Status Badge
  // =========================================================================

  function setStatus(status) {
    statusBadge.textContent = status;
    statusBadge.className = "badge badge--" + status;
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (enabled) chatInput.focus();
  }

  // =========================================================================
  //  Welcome State
  // =========================================================================

  var welcomeVisible = true;

  function hideWelcome() {
    if (!welcomeVisible) return;
    welcomeVisible = false;
    welcomeState.style.display = "none";
    chatMessages.style.display = "";
  }

  function fetchAgentInfo() {
    fetch("/api/info")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.name) {
          var titleEl = welcomeState.querySelector(".welcome-subtitle");
          if (titleEl) titleEl.textContent = data.name;
        }
        if (data.skills && data.skills.length > 0) {
          skillBadges.innerHTML = "";
          data.skills.forEach(function (skill) {
            var badge = document.createElement("span");
            badge.className = "skill-badge";
            badge.innerHTML = '<span class="skill-icon">&#9881;</span> ' + escapeHtml(skill.name);
            skillBadges.appendChild(badge);
          });
        }
      })
      .catch(function () { /* silent */ });
  }

  // =========================================================================
  //  Prompt Chips
  // =========================================================================

  promptChips.addEventListener("click", function (e) {
    var chip = e.target.closest(".prompt-chip");
    if (!chip) return;
    var prompt = chip.getAttribute("data-prompt");
    if (prompt) {
      chatInput.value = prompt;
      sendMessage(prompt);
      chatInput.value = "";
    }
  });

  // =========================================================================
  //  Chat Message Rendering
  // =========================================================================

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function highlightCodeBlocks(container) {
    var blocks = container.querySelectorAll("pre code");
    blocks.forEach(function (block) {
      hljs.highlightElement(block);
    });
  }

  function makeImagesClickable(container) {
    var images = container.querySelectorAll("img");
    images.forEach(function (img) {
      if (!img.classList.contains("chat-image")) {
        img.classList.add("chat-image");
      }
      img.style.cursor = "pointer";
      img.addEventListener("click", function () {
        openImageModal(img.src);
      });
    });
  }

  /** Append a user message bubble */
  function addUserMessage(text) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--user";
    msg.innerHTML = '<div class="message-content">' + escapeHtml(text) + "</div>";
    chatMessages.appendChild(msg);
    scrollToBottom();
  }

  /** Create and append a new agent message block; returns the content element */
  function createAgentMessage() {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--agent";
    var content = document.createElement("div");
    content.className = "message-content streaming-cursor";
    msg.appendChild(content);
    chatMessages.appendChild(msg);
    scrollToBottom();
    return content;
  }

  /** Render accumulated markdown text into the current agent element */
  function renderAgentText(final) {
    if (!currentAgentEl) return;
    currentAgentEl.innerHTML = marked.parse(currentAgentText);
    highlightCodeBlocks(currentAgentEl);
    makeImagesClickable(currentAgentEl);
    detectAndInsertImages(currentAgentEl, currentAgentText);
    if (final) {
      currentAgentEl.classList.remove("streaming-cursor");
    }
    scrollToBottom();
  }

  /** Schedule a debounced re-render of accumulated text */
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderAgentText(false);
    }, RENDER_DEBOUNCE_MS);
  }

  /** Show thinking indicator */
  function showThinkingIndicator() {
    hideWelcome();
    removeThinkingIndicator();
    var el = document.createElement("div");
    el.id = "thinking-msg";
    el.className = "thinking-indicator";
    el.innerHTML =
      '<span class="dot"></span>' +
      '<span class="dot"></span>' +
      '<span class="dot"></span>' +
      '<span class="thinking-label">Thinking...</span>';
    chatMessages.appendChild(el);
    scrollToBottom();
  }

  function removeThinkingIndicator() {
    var el = document.getElementById("thinking-msg");
    if (el) el.remove();
  }

  /** Add a tool call message block */
  function addToolCallMessage(toolName) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--tool";

    var wrapper = document.createElement("div");
    wrapper.className = "message-content";

    var headerEl = document.createElement("div");
    headerEl.className = "tool-header";
    headerEl.innerHTML =
      '<span class="tool-icon">&#9881;</span>' +
      '<span class="tool-name">' + escapeHtml(toolName) + "</span>" +
      '<span class="tool-status">running...</span>' +
      '<span class="tool-chevron">&#9656;</span>';

    var body = document.createElement("div");
    body.className = "tool-body";

    headerEl.addEventListener("click", function () {
      var chevron = headerEl.querySelector(".tool-chevron");
      if (body.classList.contains("tool-body--open")) {
        body.classList.remove("tool-body--open");
        chevron.classList.remove("tool-chevron--open");
      } else {
        body.classList.add("tool-body--open");
        chevron.classList.add("tool-chevron--open");
      }
    });

    wrapper.appendChild(headerEl);
    wrapper.appendChild(body);
    msg.appendChild(wrapper);
    chatMessages.appendChild(msg);
    scrollToBottom();

    currentToolEl = msg;
    return msg;
  }

  /** Update tool status in the most recent tool message */
  function updateToolStatus(isError) {
    if (!currentToolEl) return;
    var statusEl = currentToolEl.querySelector(".tool-status");
    if (!statusEl) return;
    if (isError) {
      statusEl.textContent = "error";
      statusEl.className = "tool-status tool-status--error";
    } else {
      statusEl.textContent = "done";
      statusEl.className = "tool-status tool-status--success";
    }
  }

  /** Add an error message */
  function addErrorMessage(text) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--error";
    msg.innerHTML = '<div class="message-content">Error: ' + escapeHtml(text) + "</div>";
    chatMessages.appendChild(msg);
    scrollToBottom();
  }

  // =========================================================================
  //  Inline Image Detection
  // =========================================================================

  var IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp)$/i;
  var WORKSPACE_PATH_RE = /(?:\/workspace\/|(?:^|\s))([^\s]+\.(png|jpg|jpeg|gif|svg|webp))/gi;

  var MIME_MAP = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  };
  function extToMime(ext) { return MIME_MAP[ext] || "image/png"; }

  function detectAndInsertImages(container, rawText) {
    WORKSPACE_PATH_RE.lastIndex = 0;
    var matches = [];
    var match;
    while ((match = WORKSPACE_PATH_RE.exec(rawText)) !== null) {
      var filePath = match[1];
      // Normalize: remove leading /workspace/ if present
      var relative = filePath.replace(/^\/workspace\//, "");
      if (matches.indexOf(relative) === -1) {
        matches.push(relative);
      }
    }

    matches.forEach(function (relPath) {
      // Check if image already inserted
      if (container.querySelector('img[data-path="' + relPath + '"]')) return;

      fetch("/api/file-content/" + encodeURIComponent(relPath))
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || data.type !== "image" || !data.base64) return;
          var src = "data:" + extToMime(data.ext || ".png") + ";base64," + data.base64;
          var img = document.createElement("img");
          img.className = "chat-image";
          img.setAttribute("data-path", relPath);
          img.alt = relPath;
          img.src = src;
          img.addEventListener("click", function () { openImageModal(src); });
          container.appendChild(img);
        })
        .catch(function () { /* ignore missing images */ });
    });
  }

  // =========================================================================
  //  Image Modal
  // =========================================================================

  function openImageModal(src) {
    modalImage.src = src;
    imageModal.style.display = "flex";
    imageModal.classList.add("image-modal--open");
  }

  function closeImageModal() {
    imageModal.classList.remove("image-modal--open");
    imageModal.style.display = "none";
    modalImage.src = "";
  }

  modalClose.addEventListener("click", closeImageModal);
  imageModal.addEventListener("click", function (e) {
    if (e.target === imageModal) closeImageModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeImageModal();
  });

  // =========================================================================
  //  File Tree
  // =========================================================================

  var FILE_ICON_MAP = {
    ".py": { icon: "\uD83D\uDC0D", cls: "ft-icon--py" },       // snake
    ".js": { icon: "\u2B21", cls: "ft-icon--js" },              // hexagon
    ".ts": { icon: "\u2B21", cls: "ft-icon--ts" },
    ".json": { icon: "{}", cls: "ft-icon--json" },
    ".md": { icon: "\u270E", cls: "ft-icon--md" },              // pencil
    ".csv": { icon: "\u2637", cls: "ft-icon--csv" },            // trigram
    ".html": { icon: "\u2039\u203A", cls: "ft-icon--html" },    // angle brackets
    ".css": { icon: "#", cls: "ft-icon--css" },
    ".png": { icon: "\u25A3", cls: "ft-icon--png" },            // filled square
    ".jpg": { icon: "\u25A3", cls: "ft-icon--jpg" },
    ".jpeg": { icon: "\u25A3", cls: "ft-icon--jpg" },
    ".gif": { icon: "\u25A3", cls: "ft-icon--gif" },
    ".svg": { icon: "\u25C7", cls: "ft-icon--svg" },            // diamond
    ".yaml": { icon: "\u2699", cls: "ft-icon--yaml" },
    ".yml": { icon: "\u2699", cls: "ft-icon--yml" },
    ".txt": { icon: "\u2261", cls: "ft-icon--default" },
  };

  function getFileIcon(name, isDir) {
    if (isDir) return { icon: "\u25B8", cls: "ft-icon--dir" };
    var ext = name.lastIndexOf(".") !== -1 ? name.substring(name.lastIndexOf(".")) : "";
    return FILE_ICON_MAP[ext.toLowerCase()] || { icon: "\u2022", cls: "ft-icon--default" };
  }

  function collectPaths(entries, set) {
    entries.forEach(function (entry) {
      set.add(entry.path);
      if (entry.children) collectPaths(entry.children, set);
    });
  }

  function renderFileTree(entries, parentEl, depth, newPaths) {
    var sorted = entries.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(function (entry) {
      var item = document.createElement("div");
      item.className = "ft-item";
      if (newPaths.has(entry.path)) {
        item.classList.add("ft-item--new");
      }
      if (entry.path === activeFilePath) {
        item.classList.add("ft-item--active");
      }

      var indent = document.createElement("span");
      indent.className = "ft-indent";
      indent.style.width = depth * 16 + "px";
      item.appendChild(indent);

      var fi = getFileIcon(entry.name, entry.type === "directory");
      var icon = document.createElement("span");
      icon.className = "ft-icon " + fi.cls;
      icon.textContent = fi.icon;
      item.appendChild(icon);

      var nameSpan = document.createElement("span");
      nameSpan.className = "ft-name";
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      if (entry.type === "file") {
        item.addEventListener("click", function () {
          openFilePreview(entry.path, entry.name);
        });
      }

      parentEl.appendChild(item);

      if (entry.children && entry.children.length > 0) {
        renderFileTree(entry.children, parentEl, depth + 1, newPaths);
      }
    });
  }

  function refreshFileTree() {
    fetch("/api/files")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.entries) return;

        // Detect new files
        var currentPaths = new Set();
        collectPaths(data.entries, currentPaths);

        var newPaths = new Set();
        if (previousFilePaths.size > 0) {
          currentPaths.forEach(function (p) {
            if (!previousFilePaths.has(p)) newPaths.add(p);
          });
        }
        previousFilePaths = currentPaths;

        fileTreeEl.innerHTML = "";
        if (data.entries.length > 0) {
          renderFileTree(data.entries, fileTreeEl, 0, newPaths);
        } else {
          var empty = document.createElement("div");
          empty.className = "ft-item";
          empty.style.color = "var(--text-muted)";
          empty.textContent = "(empty)";
          fileTreeEl.appendChild(empty);
        }
      })
      .catch(function () { /* silent retry on next poll */ });
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

  // =========================================================================
  //  File Preview Panel
  // =========================================================================

  var IMAGE_EXT_SET = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

  function getExtension(name) {
    var idx = name.lastIndexOf(".");
    return idx !== -1 ? name.substring(idx).toLowerCase() : "";
  }

  var LANG_MAP = {
    ".js": "javascript", ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript",
    ".py": "python", ".json": "json", ".html": "html", ".css": "css", ".md": "markdown",
    ".sh": "bash", ".yml": "yaml", ".yaml": "yaml", ".xml": "xml", ".sql": "sql",
    ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp",
  };
  function extToLang(ext) { return LANG_MAP[ext] || ""; }

  function openFilePreview(filePath, fileName) {
    activeFilePath = filePath;
    previewFilename.textContent = fileName;
    previewContent.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Loading...</div>';
    filePreview.style.display = "";

    // Strip /workspace/ prefix for the API path
    var relative = filePath.replace(/^\/workspace\//, "");
    var ext = getExtension(fileName);

    fetch("/api/file-content/" + encodeURIComponent(relative))
      .then(function (res) {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(function (data) {
        previewContent.innerHTML = "";
        if (data.type === "image" && data.base64) {
          var src = "data:" + extToMime(data.ext || ext) + ";base64," + data.base64;
          var img = document.createElement("img");
          img.src = src;
          img.style.maxWidth = "100%";
          img.style.borderRadius = "var(--radius)";
          img.style.cursor = "pointer";
          img.addEventListener("click", function () { openImageModal(src); });
          previewContent.appendChild(img);
        } else {
          var text = data.content || "";
          var pre = document.createElement("pre");
          var code = document.createElement("code");
          var lang = extToLang(data.ext || ext);
          if (lang) code.className = "language-" + lang;
          code.textContent = text;
          pre.appendChild(code);
          previewContent.appendChild(pre);
          hljs.highlightElement(code);
        }
      })
      .catch(function () {
        previewContent.innerHTML = '<div style="color:var(--red);padding:12px;">Failed to load file.</div>';
      });

    // Refresh tree to update active state
    refreshFileTree();
  }

  function closeFilePreview() {
    filePreview.style.display = "none";
    activeFilePath = null;
    refreshFileTree();
  }

  previewClose.addEventListener("click", closeFilePreview);

  // =========================================================================
  //  Terminal Panel (Collapsible)
  // =========================================================================

  // Start collapsed
  terminalSection.classList.add("terminal-section--collapsed");

  function toggleTerminal() {
    var isCollapsed = terminalSection.classList.toggle("terminal-section--collapsed");
    terminalToggle.setAttribute("aria-expanded", String(!isCollapsed));
    if (!isCollapsed) {
      // Just expanded — fit the terminal
      setTimeout(function () { fitAddon.fit(); }, 50);
    }
  }

  function expandTerminal() {
    if (terminalSection.classList.contains("terminal-section--collapsed")) {
      terminalSection.classList.remove("terminal-section--collapsed");
      terminalToggle.setAttribute("aria-expanded", "true");
      setTimeout(function () { fitAddon.fit(); }, 50);
    }
  }

  terminalToggle.addEventListener("click", toggleTerminal);

  // =========================================================================
  //  Chat Input (Auto-expand Textarea)
  // =========================================================================

  var INPUT_LINE_HEIGHT = 21; // ~14px font * 1.5 line-height
  var INPUT_MAX_ROWS = 4;

  chatInput.addEventListener("input", function () {
    chatInput.style.height = "auto";
    var maxH = INPUT_LINE_HEIGHT * INPUT_MAX_ROWS + 20; // 20px for padding
    chatInput.style.height = Math.min(chatInput.scrollHeight, maxH) + "px";
  });

  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  // =========================================================================
  //  Chat Submission
  // =========================================================================

  function sendMessage(text) {
    if (!text || isStreaming) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addErrorMessage("Not connected to agent.");
      return;
    }

    isStreaming = true;
    setStatus("running");
    setInputEnabled(false);

    addUserMessage(text);

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
    chatInput.style.height = "auto";
    sendMessage(text);
  });

  // =========================================================================
  //  Agent Event Handling (WebSocket)
  // =========================================================================

  function handleAgentEvent(event) {
    switch (event.type) {
      case "response.created":
        setStatus("running");
        showThinkingIndicator();
        break;

      case "response.output_text.delta":
        removeThinkingIndicator();
        if (!currentAgentEl) {
          currentAgentText = "";
          currentAgentEl = createAgentMessage();
        }
        currentAgentText += event.delta;
        scheduleRender();
        break;

      case "response.output_text.done":
        removeThinkingIndicator();
        if (currentAgentEl) {
          // Use the final full text if provided, else keep accumulated
          if (event.text) currentAgentText = event.text;
          if (renderTimer) {
            clearTimeout(renderTimer);
            renderTimer = null;
          }
          renderAgentText(true);
        }
        // Reset for next output segment
        currentAgentEl = null;
        currentAgentText = "";
        break;

      case "response.tool_call.created":
        removeThinkingIndicator();
        // Finalize any in-progress agent text
        if (currentAgentEl) {
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          renderAgentText(true);
          currentAgentEl = null;
          currentAgentText = "";
        }
        var toolName = (event.toolCall && event.toolCall.name) || "tool";
        addToolCallMessage(toolName);
        expandTerminal();
        break;

      case "response.tool_call.done":
        var isError = event.result && event.result.isError;
        updateToolStatus(isError);
        if (isError && event.result.output) {
          // Write error into the tool body
          if (currentToolEl) {
            var body = currentToolEl.querySelector(".tool-body");
            if (body) {
              body.textContent = typeof event.result.output === 'string' ? event.result.output : JSON.stringify(event.result.output, null, 2);
              body.classList.add("tool-body--open");
              var chevron = currentToolEl.querySelector(".tool-chevron");
              if (chevron) chevron.classList.add("tool-chevron--open");
            }
          }
        }
        currentToolEl = null;
        break;

      case "tool_execution_update":
        if (event.chunk) {
          term.write(event.chunk);
        }
        break;

      case "response.completed":
        removeThinkingIndicator();
        // Finalize any pending agent text
        if (currentAgentEl) {
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          renderAgentText(true);
          currentAgentEl = null;
          currentAgentText = "";
        }
        setStatus("idle");
        setInputEnabled(true);
        isStreaming = false;
        refreshFileTree();
        break;

      case "response.error":
        removeThinkingIndicator();
        if (currentAgentEl) {
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          renderAgentText(true);
          currentAgentEl = null;
          currentAgentText = "";
        }
        addErrorMessage(event.error || "Unknown error");
        setStatus("error");
        setInputEnabled(true);
        isStreaming = false;
        break;

      case "files_changed":
        refreshFileTree();
        break;
    }
  }

  // =========================================================================
  //  WebSocket Connection
  // =========================================================================

  var disconnectedShown = false;

  function connectWebSocket() {
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    var url = protocol + "//" + window.location.host + "/ws";
    ws = new WebSocket(url);

    ws.onopen = function () {
      disconnectedShown = false;
      setStatus("idle");
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
        disconnectedShown = true;
      }
      setStatus("idle");
      setInputEnabled(true);
      isStreaming = false;
      // Reconnect after delay
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  // =========================================================================
  //  Init
  // =========================================================================

  fetchAgentInfo();
  startFilePolling();
  connectWebSocket();
})();
