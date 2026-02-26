/* global marked, hljs */

(function () {
  "use strict";

  // -- DOM References --
  var chatMessages = document.getElementById("chat-messages");
  var welcomeState = document.getElementById("welcome-state");
  var promptChips = document.getElementById("prompt-chips");
  var skillBadges = document.getElementById("skill-badges");
  var fileTreeEl = document.getElementById("file-tree");
  var filePanel = document.getElementById("file-panel");
  var previewArea = document.getElementById("preview-area");
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
  var menuToggle = document.getElementById("menu-toggle");
  var panelOverlay = document.querySelector(".panel-overlay");
  // --  Markdown Configuration
  marked.setOptions({ breaks: true, gfm: true });

  // --  State
  var isStreaming = false;
  var FILE_POLL_MS = 3000;
  var filePollingTimer = null;
  var ws = null;

  // Streaming text accumulation
  var currentAgentText = "";
  var currentAgentEl = null;
  var renderTimer = null;
  var RENDER_DEBOUNCE_MS = 80;

  // File tree state
  var previousFilePaths = new Set();
  var expandedDirs = new Set(); // tracks expanded directories
  var expandedDirsInitialized = false;

  // Currently active tool message for status updates
  var currentToolEl = null;

  // Track active file for preview highlighting
  var activeFilePath = null;

  // Welcome state
  var welcomeVisible = true;

  // --  Workspace View Helpers
  function showPreview() {
    previewArea.style.display = "";
    welcomeState.style.display = "none";
  }

  function showWelcomeOrHide() {
    previewArea.style.display = "none";
    welcomeState.style.display = welcomeVisible ? "" : "none";
  }

  // --  Hamburger Menu (Mobile File Tree Toggle)
  function openFilePanel() {
    filePanel.classList.add("panel--open");
    panelOverlay.classList.add("panel-overlay--visible");
  }

  function closeFilePanel() {
    filePanel.classList.remove("panel--open");
    panelOverlay.classList.remove("panel-overlay--visible");
  }

  menuToggle.addEventListener("click", function () {
    if (filePanel.classList.contains("panel--open")) {
      closeFilePanel();
    } else {
      openFilePanel();
    }
  });

  panelOverlay.addEventListener("click", closeFilePanel);

  // --  Status Badge
  function setStatus(status) {
    statusBadge.textContent = status;
    statusBadge.className = "badge badge--" + status;
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (enabled) chatInput.focus();
  }

  // --  Welcome State
  function hideWelcome() {
    if (!welcomeVisible) return;
    welcomeVisible = false;
    welcomeState.style.display = "none";
  }

  function fetchAgentInfo() {
    fetch("/api/info")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.name) {
          var titleEl = document.getElementById("welcome-agent-name");
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

  // --  Prompt Chips
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

  // --  Chat Message Rendering
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

  function addCopyButtons(container) {
    container.querySelectorAll('pre code').forEach(function(block) {
      var pre = block.parentElement;
      if (pre.querySelector('.code-copy-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.innerHTML = '\u2398';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(block.textContent).then(function() {
          btn.classList.add('code-copy-btn--copied');
          btn.innerHTML = '\u2713';
          setTimeout(function() {
            btn.classList.remove('code-copy-btn--copied');
            btn.innerHTML = '\u2398';
          }, 2000);
        });
      });
      pre.appendChild(btn);
    });
  }

  function addUserMessage(text) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--user";
    msg.innerHTML = '<div class="message-content">' + escapeHtml(text) + "</div>";
    chatMessages.appendChild(msg);
    scrollToBottom();
  }

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

  function renderAgentText(final) {
    if (!currentAgentEl) return;
    currentAgentEl.innerHTML = marked.parse(currentAgentText);
    highlightCodeBlocks(currentAgentEl);
    addCopyButtons(currentAgentEl);
    makeImagesClickable(currentAgentEl);
    detectAndInsertImages(currentAgentEl, currentAgentText);
    if (final) {
      currentAgentEl.classList.remove("streaming-cursor");
    }
    scrollToBottom();
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderAgentText(false);
    }, RENDER_DEBOUNCE_MS);
  }

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

  function addToolCallMessage(toolName) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--tool";

    var wrapper = document.createElement("div");
    wrapper.className = "message-content";

    var headerEl = document.createElement("div");
    headerEl.className = "tool-header";
    headerEl.setAttribute('role', 'button');
    headerEl.setAttribute('tabindex', '0');
    headerEl.setAttribute('aria-expanded', 'false');
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
      headerEl.setAttribute('aria-expanded', body.classList.contains('tool-body--open') ? 'true' : 'false');
    });

    headerEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        headerEl.click();
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

  function addErrorMessage(text) {
    hideWelcome();
    var msg = document.createElement("div");
    msg.className = "message message--error";
    msg.innerHTML = '<div class="message-content">Error: ' + escapeHtml(text) + "</div>";
    chatMessages.appendChild(msg);
    scrollToBottom();
  }

  // --  Inline Image Detection
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
      var relative = filePath.replace(/^\/workspace\//, "");
      if (matches.indexOf(relative) === -1) {
        matches.push(relative);
      }
    }

    matches.forEach(function (relPath) {
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

  // --  Image Modal
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

  // --  File Tree
  var FILE_ICON_MAP = {
    ".py": { icon: "\uD83D\uDC0D", cls: "ft-icon--py" },
    ".js": { icon: "\u2B21", cls: "ft-icon--js" },
    ".ts": { icon: "\u2B21", cls: "ft-icon--ts" },
    ".json": { icon: "{}", cls: "ft-icon--json" },
    ".md": { icon: "\u270E", cls: "ft-icon--md" },
    ".csv": { icon: "\u2637", cls: "ft-icon--csv" },
    ".html": { icon: "\u2039\u203A", cls: "ft-icon--html" },
    ".css": { icon: "#", cls: "ft-icon--css" },
    ".png": { icon: "\u25A3", cls: "ft-icon--png" },
    ".jpg": { icon: "\u25A3", cls: "ft-icon--jpg" },
    ".jpeg": { icon: "\u25A3", cls: "ft-icon--jpg" },
    ".gif": { icon: "\u25A3", cls: "ft-icon--gif" },
    ".svg": { icon: "\u25C7", cls: "ft-icon--svg" },
    ".yaml": { icon: "\u2699", cls: "ft-icon--yaml" },
    ".yml": { icon: "\u2699", cls: "ft-icon--yml" },
    ".txt": { icon: "\u2261", cls: "ft-icon--default" },
  };

  function getFileIcon(name, isDir) {
    if (isDir) return { icon: "\u25B6", cls: "ft-icon--dir" };
    var ext = name.lastIndexOf(".") !== -1 ? name.substring(name.lastIndexOf(".")) : "";
    return FILE_ICON_MAP[ext.toLowerCase()] || { icon: "\u2022", cls: "ft-icon--default" };
  }

  function collectPaths(entries, set) {
    entries.forEach(function (entry) {
      set.add(entry.path);
      if (entry.children) collectPaths(entry.children, set);
    });
  }

  function collectDirPaths(entries, set) {
    entries.forEach(function (entry) {
      if (entry.type === "directory") {
        set.add(entry.path);
        if (entry.children) collectDirPaths(entry.children, set);
      }
    });
  }

  function renderFileTree(entries, parentEl, depth, newPaths) {
    var sorted = entries.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(function (entry) {
      var isDir = entry.type === "directory";
      var isExpanded = isDir && expandedDirs.has(entry.path);

      var item = document.createElement("div");
      item.className = "ft-item";
      if (newPaths.has(entry.path)) item.classList.add("ft-item--new");
      if (entry.path === activeFilePath) item.classList.add("ft-item--active");

      var indent = document.createElement("span");
      indent.className = "ft-indent";
      indent.style.width = depth * 16 + "px";
      item.appendChild(indent);

      if (isDir) {
        // Chevron for expand/collapse
        var chevron = document.createElement("span");
        chevron.className = "ft-icon--dir-chevron";
        chevron.textContent = "\u25B8";
        if (isExpanded) chevron.classList.add("expanded");
        item.appendChild(chevron);
      }

      var fi = getFileIcon(entry.name, isDir);
      var icon = document.createElement("span");
      icon.className = "ft-icon " + fi.cls;
      icon.textContent = isDir ? "\uD83D\uDCC1" : fi.icon;
      item.appendChild(icon);

      var nameSpan = document.createElement("span");
      nameSpan.className = "ft-name";
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      if (isDir) {
        item.addEventListener("click", function () {
          if (expandedDirs.has(entry.path)) {
            expandedDirs.delete(entry.path);
          } else {
            expandedDirs.add(entry.path);
          }
          refreshFileTreeUI();
        });
      } else {
        item.addEventListener("click", function () {
          openFilePreview(entry.path, entry.name);
        });
      }

      parentEl.appendChild(item);

      // Render children only if expanded
      if (isDir && isExpanded && entry.children && entry.children.length > 0) {
        renderFileTree(entry.children, parentEl, depth + 1, newPaths);
      }
    });
  }

  // Cache the last fetched entries for UI-only refreshes
  var lastFileEntries = null;
  var lastNewPaths = new Set();

  function refreshFileTreeUI() {
    if (!lastFileEntries) return;
    fileTreeEl.innerHTML = "";
    if (lastFileEntries.length > 0) {
      renderFileTree(lastFileEntries, fileTreeEl, 0, lastNewPaths);
    } else {
      var empty = document.createElement("div");
      empty.className = "ft-item";
      empty.style.color = "var(--text-muted)";
      empty.textContent = "(empty)";
      fileTreeEl.appendChild(empty);
    }
  }

  function refreshFileTree() {
    fetch("/api/files")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.entries) return;

        var currentPaths = new Set();
        collectPaths(data.entries, currentPaths);

        var newPaths = new Set();
        if (previousFilePaths.size > 0) {
          currentPaths.forEach(function (p) {
            if (!previousFilePaths.has(p)) newPaths.add(p);
          });
        }
        previousFilePaths = currentPaths;

        // Initialize expanded dirs: expand all on first load
        if (!expandedDirsInitialized) {
          expandedDirsInitialized = true;
          collectDirPaths(data.entries, expandedDirs);
        }

        lastFileEntries = data.entries;
        lastNewPaths = newPaths;
        refreshFileTreeUI();
      })
      .catch(function () { /* silent retry */ });
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

  // --  File Preview (in Workspace)
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
    previewArea.setAttribute("data-file-path", filePath);
    previewFilename.textContent = fileName;
    previewContent.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Loading...</div>';

    showPreview();

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

    refreshFileTree();
  }

  function closeFilePreview() {
    activeFilePath = null;
    showWelcomeOrHide();
    refreshFileTree();
  }

  previewClose.addEventListener("click", closeFilePreview);

  // --  Chat Input (Auto-expand Textarea)
  var INPUT_LINE_HEIGHT = 21;
  var INPUT_MAX_ROWS = 4;

  chatInput.addEventListener("input", function () {
    chatInput.style.height = "auto";
    var maxH = INPUT_LINE_HEIGHT * INPUT_MAX_ROWS + 20;
    chatInput.style.height = Math.min(chatInput.scrollHeight, maxH) + "px";
  });

  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  // --  Chat Submission
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

  // --  Agent Event Handling (WebSocket)
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
          if (event.text) currentAgentText = event.text;
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          renderAgentText(true);
        }
        currentAgentEl = null;
        currentAgentText = "";
        break;

      case "response.tool_call.created":
        removeThinkingIndicator();
        if (currentAgentEl) {
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          renderAgentText(true);
          currentAgentEl = null;
          currentAgentText = "";
        }
        var toolName = (event.toolCall && event.toolCall.name) || "tool";
        addToolCallMessage(toolName);
        break;

      case "response.tool_call.done":
        var isError = event.result && event.result.isError;
        updateToolStatus(isError);
        if (isError && event.result.output) {
          if (currentToolEl) {
            var body = currentToolEl.querySelector(".tool-body");
            if (body) {
              body.textContent = typeof event.result.output === "string"
                ? event.result.output
                : JSON.stringify(event.result.output, null, 2);
              body.classList.add("tool-body--open");
              var chevron = currentToolEl.querySelector(".tool-chevron");
              if (chevron) chevron.classList.add("tool-chevron--open");
            }
          }
        }
        currentToolEl = null;
        break;

      case "response.completed":
        removeThinkingIndicator();
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

  // --  WebSocket Connection
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
      } catch (_) { /* ignore */ }
    };

    ws.onclose = function () {
      if (!disconnectedShown) {
        disconnectedShown = true;
      }
      setStatus("idle");
      setInputEnabled(true);
      isStreaming = false;
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = function () { /* onclose fires after */ };
  }

  // --  Keyboard Shortcuts
  document.addEventListener('keydown', function(e) {
    // Escape closes file preview
    if (e.key === 'Escape' && activeFilePath) {
      closeFilePreview();
      return;
    }
    // Cmd/Ctrl + K focuses chat input
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      chatInput.focus();
      return;
    }
  });

  // --  Init
  window.addEventListener("files-changed", refreshFileTree);
  fetchAgentInfo();
  startFilePolling();
  connectWebSocket();
})();
