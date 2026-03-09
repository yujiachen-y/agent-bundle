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
  var attachBtn = document.getElementById("attach-btn");
  var chatFileInput = document.getElementById("chat-file-input");
  var chatAttachments = document.getElementById("chat-attachments");
  var statusBadge = document.getElementById("status-badge");
  var clearContextBtn = document.getElementById("clear-context-btn");
  var clearModalOverlay = document.getElementById("clear-modal-overlay");
  var clearWorkspaceCheckbox = document.getElementById("clear-workspace-checkbox");
  var clearModalCancel = document.getElementById("clear-modal-cancel");
  var clearModalConfirm = document.getElementById("clear-modal-confirm");
  var menuToggle = document.getElementById("menu-toggle");
  var panelOverlay = document.querySelector(".panel-overlay");
  // --  Markdown Configuration
  marked.setOptions({ breaks: true, gfm: true });

  // --  State
  var isStreaming = false;
  var FILE_POLL_MS = 3000;
  var filePollingTimer = null;
  var ws = null;

  // Browse mode: "workspace" | "sandbox"
  var browseMode = "workspace";
  var sandboxBrowsePath = "/";

  // Transcript state
  var transcriptEvents = [];
  var activeWorkspaceTab = "workspace";

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

  // Pending chat attachments
  var pendingFiles = [];

  // Track active file for preview highlighting
  var activeFilePath = null;

  // Welcome state
  var welcomeVisible = true;

  // Workspace state machine: "welcome" | "empty-no-files" | "empty-with-files" | "preview"
  var workspaceState = "welcome";

  // --  Workspace View Helpers
  var emptyNoFiles = document.getElementById("empty-no-files");
  var emptyWithFiles = document.getElementById("empty-with-files");
  var fileCardGrid = document.getElementById("file-card-grid");

  function setWorkspaceState(newState) {
    workspaceState = newState;
    var map = { "welcome": welcomeState, "empty-no-files": emptyNoFiles, "empty-with-files": emptyWithFiles, "preview": previewArea };
    [welcomeState, emptyNoFiles, emptyWithFiles, previewArea].forEach(function(el) { el.style.display = "none"; });
    if (map[newState]) map[newState].style.display = "";
    if (newState === "empty-with-files") renderFileCards();
  }

  function showPreview() {
    setWorkspaceState("preview");
  }

  function showWelcomeOrHide() {
    if (previousFilePaths.size > 0) setWorkspaceState("empty-with-files");
    else if (workspaceState === "preview") setWorkspaceState("empty-no-files");
    else setWorkspaceState(workspaceState === "welcome" ? "welcome" : "empty-no-files");
  }

  // --  Hamburger Menu (Mobile File Tree Toggle)
  function openFilePanel() { filePanel.classList.add("panel--open"); panelOverlay.classList.add("panel-overlay--visible"); }
  function closeFilePanel() { filePanel.classList.remove("panel--open"); panelOverlay.classList.remove("panel-overlay--visible"); }

  menuToggle.addEventListener("click", function () {
    filePanel.classList.contains("panel--open") ? closeFilePanel() : openFilePanel();
  });

  panelOverlay.addEventListener("click", closeFilePanel);

  // --  Status Badge
  function setStatus(s) { statusBadge.textContent = s; statusBadge.className = "badge badge--" + s; }
  function setClearContextEnabled(en) {
    if (!clearContextBtn) return;
    clearContextBtn.disabled = !en;
  }

  function setInputEnabled(en) {
    chatInput.disabled = !en;
    sendBtn.disabled = !en;
    if (attachBtn) attachBtn.disabled = !en;
    setClearContextEnabled(en || !isStreaming);
    if (en) chatInput.focus();
  }

  function showToast(message, isError) {
    if (
      window.FileTransferUI &&
      typeof window.FileTransferUI.showToast === "function"
    ) {
      window.FileTransferUI.showToast(message, isError);
      return;
    }

    var toast = document.createElement("div");
    toast.className = "ft-toast" + (isError ? " ft-toast--error" : "");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
  }

  // --  Welcome State
  function hideWelcome() {
    if (workspaceState === "welcome") setWorkspaceState("empty-no-files");
    welcomeVisible = false;
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

  // Empty state suggestion clicks
  if (emptyNoFiles) {
    emptyNoFiles.addEventListener("click", function(e) {
      var suggestion = e.target.closest(".workspace-empty-suggestion");
      if (!suggestion) return;
      var prompt = suggestion.getAttribute("data-prompt");
      if (prompt) { chatInput.value = prompt; sendMessage(prompt); chatInput.value = ""; }
    });
  }

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
    container.querySelectorAll("pre code").forEach(function (block) { hljs.highlightElement(block); });
  }

  function makeImagesClickable(container) {
    container.querySelectorAll("img").forEach(function (img) {
      if (!img.classList.contains("chat-image")) img.classList.add("chat-image");
      img.style.cursor = "pointer";
      img.addEventListener("click", function () { openImageModal(img.src); });
    });
  }

  function addCopyButtons(container) {
    container.querySelectorAll('pre code').forEach(function(block) {
      var pre = block.parentElement;
      if (pre.querySelector('.code-copy-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'code-copy-btn'; btn.setAttribute('aria-label', 'Copy code'); btn.innerHTML = '\u2398';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(block.textContent).then(function() {
          btn.classList.add('code-copy-btn--copied'); btn.innerHTML = '\u2713';
          setTimeout(function() { btn.classList.remove('code-copy-btn--copied'); btn.innerHTML = '\u2398'; }, 2000);
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
    highlightCodeBlocks(currentAgentEl); addCopyButtons(currentAgentEl);
    makeImagesClickable(currentAgentEl); detectAndInsertImages(currentAgentEl, currentAgentText);
    if (final) currentAgentEl.classList.remove("streaming-cursor");
    scrollToBottom();
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () { renderTimer = null; renderAgentText(false); }, RENDER_DEBOUNCE_MS);
  }

  function showThinkingIndicator() {
    hideWelcome(); removeThinkingIndicator();
    var el = document.createElement("div");
    el.id = "thinking-msg"; el.className = "thinking-indicator";
    el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="thinking-label">Thinking...</span>';
    chatMessages.appendChild(el); scrollToBottom();
  }

  function removeThinkingIndicator() { var el = document.getElementById("thinking-msg"); if (el) el.remove(); }

  function addToolCallMessage(toolName, toolInput) {
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

    // Show command inline in header for Bash tools
    var command = toolInput && toolInput.command;
    var headerLabel = escapeHtml(toolName);
    if (command) {
      var shortCmd = command.length > 80 ? command.slice(0, 80) + "…" : command;
      headerLabel += ' <span class="tool-command-preview">' + escapeHtml(shortCmd) + "</span>";
    }

    headerEl.innerHTML =
      '<span class="tool-icon">&#9881;</span>' +
      '<span class="tool-name">' + headerLabel + "</span>" +
      '<span class="tool-status">running...</span>' +
      '<span class="tool-chevron">&#9656;</span>';

    var body = document.createElement("div");
    body.className = "tool-body";

    // Pre-populate body with the full command if available
    if (command) {
      var cmdEl = document.createElement("div");
      cmdEl.className = "tool-command";
      cmdEl.textContent = "$ " + command;
      body.appendChild(cmdEl);
    }

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
    statusEl.textContent = isError ? "error" : "done";
    statusEl.className = "tool-status tool-status--" + (isError ? "error" : "success");
  }

  function addErrorMessage(text) {
    hideWelcome();
    var msg = document.createElement("div"); msg.className = "message message--error";
    msg.innerHTML = '<div class="message-content">Error: ' + escapeHtml(text) + "</div>";
    chatMessages.appendChild(msg); scrollToBottom();
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
  function openImageModal(src) { modalImage.src = src; imageModal.style.display = "flex"; imageModal.classList.add("image-modal--open"); }
  function closeImageModal() { imageModal.classList.remove("image-modal--open"); imageModal.style.display = "none"; modalImage.src = ""; }
  modalClose.addEventListener("click", closeImageModal);
  imageModal.addEventListener("click", function (e) { if (e.target === imageModal) closeImageModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (isClearModalOpen()) {
      e.stopImmediatePropagation();
      closeClearModal();
      return;
    }
    if (imageModal.classList.contains("image-modal--open")) {
      e.stopImmediatePropagation();
    }
    closeImageModal();
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

  // -- File Cards (workspace empty-with-files state)
  var lastRenderedCardPaths = "";
  function renderFileCards() {
    if (!fileCardGrid || !lastFileEntries) return;
    var files = [];
    (function collect(entries) {
      entries.forEach(function(e) { if (e.type === "file") files.push(e); else if (e.children) collect(e.children); });
    })(lastFileEntries);
    files.reverse();
    var top8 = files.slice(0, 8);
    var cardKey = top8.map(function(f) { return f.path; }).join("\n");
    if (cardKey === lastRenderedCardPaths) return;
    lastRenderedCardPaths = cardKey;
    fileCardGrid.innerHTML = "";
    top8.forEach(function(file, index) {
      var card = document.createElement("div");
      card.className = "file-card";
      if (lastNewPaths.has(file.path)) card.classList.add("file-card--new");
      card.style.animationDelay = (index * 50) + "ms";
      var nameEl = document.createElement("div");
      nameEl.className = "file-card-name";
      nameEl.textContent = file.name;
      card.appendChild(nameEl);
      var ext = getExtension(file.name);
      var pEl = document.createElement("div");
      pEl.className = "file-card-preview";
      if (IMAGE_EXT_SET.has(ext)) { pEl.innerHTML = '<span style="color:var(--pink);">Image file</span>'; }
      else { var fi = getFileIcon(file.name, false); pEl.innerHTML = '<span>' + fi.icon + ' ' + escapeHtml(ext || 'file') + '</span>'; }
      card.appendChild(pEl);
      card.addEventListener("click", function() { openFilePreview(file.path, file.name); });
      fileCardGrid.appendChild(card);
    });
  }

  function refreshFileTree() {
    var url = browseMode === "sandbox"
      ? "/api/sandbox-files?path=" + encodeURIComponent(sandboxBrowsePath)
      : "/api/files";
    fetch(url)
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

        // Transition from empty-no-files to empty-with-files when files appear
        if (workspaceState === "empty-no-files" && currentPaths.size > 0) {
          setWorkspaceState("empty-with-files");
        } else if (workspaceState === "empty-with-files") {
          renderFileCards();
        }
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

  function renderUnsupportedPreview(filePath, fileName, message) {
    var container = document.createElement("div");
    container.className = "unsupported-preview";

    var title = document.createElement("h3");
    title.className = "unsupported-preview-title";
    title.textContent = "Preview unavailable";
    container.appendChild(title);

    var description = document.createElement("p");
    description.className = "unsupported-preview-description";
    description.textContent = message || "This file type cannot be previewed in the browser.";
    container.appendChild(description);

    var meta = document.createElement("p");
    meta.className = "unsupported-preview-meta";
    meta.textContent = "File: " + fileName;
    container.appendChild(meta);

    var action = document.createElement("a");
    action.className = "unsupported-preview-action";
    var dlEndpoint = browseMode === "sandbox" ? "/api/sandbox-file-download" : "/api/file-download";
    action.href = dlEndpoint + "?path=" + encodeURIComponent(filePath);
    action.download = fileName || "file";
    action.textContent = "Download file";
    container.appendChild(action);

    previewContent.appendChild(container);
  }

  function openFilePreview(filePath, fileName) {
    activeFilePath = filePath;
    previewArea.setAttribute("data-file-path", filePath);
    previewFilename.textContent = fileName;

    // Render breadcrumb path
    var breadcrumb = document.getElementById("preview-breadcrumb");
    if (breadcrumb) {
      breadcrumb.innerHTML = "";
      var displayPath = browseMode === "sandbox" ? filePath : filePath.replace(/^\/workspace\//, "");
      var parts = displayPath.replace(/^\//, "").split("/");
      parts.forEach(function(part, i) {
        var span = document.createElement("span");
        if (i < parts.length - 1) {
          span.className = "preview-breadcrumb-segment";
          span.textContent = part;
          breadcrumb.appendChild(span);
          var sep = document.createElement("span");
          sep.className = "preview-breadcrumb-separator";
          sep.textContent = "\u203A";
          breadcrumb.appendChild(sep);
        } else {
          span.className = "preview-breadcrumb-current";
          span.id = "preview-filename";
          span.textContent = part;
          breadcrumb.appendChild(span);
        }
      });
    }

    previewContent.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Loading...</div>';

    showPreview();

    var ext = getExtension(fileName);
    var contentUrl = browseMode === "sandbox"
      ? "/api/sandbox-file-content" + filePath
      : "/api/file-content/" + encodeURIComponent(filePath.replace(/^\/workspace\//, ""));

    fetch(contentUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(function (data) {
        previewContent.innerHTML = "";
        if (data.type === "pdf" && data.base64) {
          var pdfSrc = "data:application/pdf;base64," + data.base64;
          var iframe = document.createElement("iframe");
          iframe.src = pdfSrc;
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.style.minHeight = "600px";
          iframe.style.border = "none";
          iframe.style.borderRadius = "var(--radius)";
          previewContent.appendChild(iframe);
        } else if (data.type === "image" && data.base64) {
          var src = "data:" + extToMime(data.ext || ext) + ";base64," + data.base64;
          var img = document.createElement("img");
          img.src = src;
          img.style.maxWidth = "100%";
          img.style.borderRadius = "var(--radius)";
          img.style.cursor = "pointer";
          img.addEventListener("click", function () { openImageModal(src); });
          previewContent.appendChild(img);
        } else if (data.type === "unsupported") {
          renderUnsupportedPreview(filePath, fileName, data.message);
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

  function createPendingFile(file) {
    return {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10),
      file: file,
      status: "pending",
    };
  }

  function isDuplicatePendingFile(file) {
    return pendingFiles.some(function (pending) {
      return (
        pending.file.name === file.name &&
        pending.file.size === file.size &&
        pending.file.lastModified === file.lastModified
      );
    });
  }

  function renderChatAttachments() {
    if (!chatAttachments) return;

    chatAttachments.innerHTML = "";
    if (pendingFiles.length === 0) {
      chatAttachments.style.display = "none";
      return;
    }

    chatAttachments.style.display = "flex";
    pendingFiles.forEach(function (pending) {
      var chip = document.createElement("div");
      chip.className = "chat-attachment-chip";
      chip.setAttribute("data-id", pending.id);
      if (pending.status === "uploading") chip.classList.add("chat-attachment-chip--uploading");
      if (pending.status === "error") chip.classList.add("chat-attachment-chip--error");

      var name = document.createElement("span");
      name.className = "chat-attachment-name";
      name.textContent = pending.file.name;
      chip.appendChild(name);

      if (pending.status === "uploading") {
        var spinner = document.createElement("span");
        spinner.className = "chat-attachment-spinner";
        spinner.setAttribute("aria-hidden", "true");
        chip.appendChild(spinner);
      } else {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chat-attachment-remove";
        remove.setAttribute("aria-label", "Remove attachment");
        remove.innerHTML = "&times;";
        chip.appendChild(remove);
      }

      chatAttachments.appendChild(chip);
    });
  }

  function addPendingFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    Array.from(fileList).forEach(function (file) {
      if (!isDuplicatePendingFile(file)) {
        pendingFiles.push(createPendingFile(file));
      }
    });
    renderChatAttachments();
  }

  function uploadPendingFiles() {
    if (pendingFiles.length === 0) {
      return Promise.resolve({ uploadedPaths: [], failedFiles: [] });
    }

    pendingFiles.forEach(function (pending) {
      pending.status = "uploading";
    });
    renderChatAttachments();

    var uploadTasks = pendingFiles.map(function (pending) {
      var form = new FormData();
      form.append("file", pending.file);
      return fetch("/api/file-upload", { method: "POST", body: form })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || !data.ok || typeof data.path !== "string") {
              return { ok: false };
            }
            return { ok: true, path: data.path };
          });
        })
        .catch(function () {
          return { ok: false };
        });
    });

    return Promise.allSettled(uploadTasks).then(function (results) {
      var uploadedPaths = [];
      var failedFiles = [];

      results.forEach(function (result, index) {
        var pending = pendingFiles[index];
        if (!pending) return;

        if (result.status === "fulfilled" && result.value.ok && result.value.path) {
          pending.status = "uploaded";
          uploadedPaths.push(result.value.path);
          return;
        }

        pending.status = "error";
        failedFiles.push(pending.file.name);
      });

      renderChatAttachments();
      return { uploadedPaths: uploadedPaths, failedFiles: failedFiles };
    });
  }

  function buildOutgoingMessage(text, uploadedPaths) {
    if (!uploadedPaths || uploadedPaths.length === 0) return text;
    var prefixed = uploadedPaths.map(function (p) { return "[Uploaded: " + p + "]"; }).join("\n");
    return text ? prefixed + "\n\n" + text : prefixed;
  }

  function sendMessage(text) {
    var trimmedText = (text || "").trim();
    if ((trimmedText.length === 0 && pendingFiles.length === 0) || isStreaming) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addErrorMessage("Not connected to agent.");
      return;
    }

    isStreaming = true;
    setStatus("running");
    setInputEnabled(false);

    var uploadPromise = pendingFiles.length > 0
      ? uploadPendingFiles()
      : Promise.resolve({ uploadedPaths: [], failedFiles: [] });
    uploadPromise
      .then(function (uploadResult) {
        var uploadedPaths = uploadResult.uploadedPaths;
        var failedFiles = uploadResult.failedFiles;

        if (failedFiles.length > 0) {
          showToast("Some uploads failed: " + failedFiles.join(", "), true);
        }

        pendingFiles = pendingFiles.filter(function (pending) {
          return pending.status !== "uploaded";
        });
        pendingFiles.forEach(function (pending) {
          if (pending.status === "error") pending.status = "pending";
        });
        renderChatAttachments();

        var outgoingText = buildOutgoingMessage(trimmedText, uploadedPaths);
        if (!outgoingText) {
          if (failedFiles.length > 0) {
            throw new Error("All selected files failed to upload.");
          }
          throw new Error("Message is empty.");
        }

        addUserMessage(outgoingText);
        ws.send(JSON.stringify({
          type: "chat",
          input: [{ role: "user", content: outgoingText }],
        }));
      })
      .catch(function (error) {
        isStreaming = false;
        setStatus("idle");
        setInputEnabled(true);
        showToast(error instanceof Error ? error.message : "Upload failed.", true);
      });
  }

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (text.length === 0 && pendingFiles.length === 0) return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendMessage(text);
  });

  if (attachBtn && chatFileInput) {
    attachBtn.addEventListener("click", function () {
      if (isStreaming) return;
      chatFileInput.click();
    });

    chatFileInput.addEventListener("change", function () {
      addPendingFiles(chatFileInput.files);
      chatFileInput.value = "";
    });
  }

  if (chatAttachments) {
    chatAttachments.addEventListener("click", function (e) {
      var removeBtn = e.target.closest(".chat-attachment-remove");
      if (!removeBtn) return;
      var chip = removeBtn.closest(".chat-attachment-chip");
      if (!chip) return;
      var id = chip.getAttribute("data-id");
      pendingFiles = pendingFiles.filter(function (pending) { return pending.id !== id; });
      renderChatAttachments();
    });
  }

  var inputWrapper = chatForm.querySelector(".input-wrapper");
  if (inputWrapper) {
    inputWrapper.addEventListener("dragover", function (e) {
      e.preventDefault();
      inputWrapper.classList.add("input-wrapper--drag-over");
    });
    inputWrapper.addEventListener("dragleave", function (e) {
      if (!inputWrapper.contains(e.relatedTarget)) {
        inputWrapper.classList.remove("input-wrapper--drag-over");
      }
    });
    inputWrapper.addEventListener("drop", function (e) {
      e.preventDefault();
      inputWrapper.classList.remove("input-wrapper--drag-over");
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        addPendingFiles(e.dataTransfer.files);
      }
    });
  }

  function isClearModalOpen() {
    return !!(clearModalOverlay && clearModalOverlay.style.display !== "none");
  }

  function closeClearModal() {
    if (!clearModalOverlay) return;
    clearModalOverlay.style.display = "none";
    if (clearWorkspaceCheckbox) clearWorkspaceCheckbox.checked = false;
  }

  function resetUiAfterContextClear(clearWorkspace) {
    chatMessages.innerHTML = "";
    removeThinkingIndicator();
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    currentAgentText = "";
    currentAgentEl = null;
    currentToolEl = null;
    isStreaming = false;
    setStatus("idle");
    setInputEnabled(true);
    setWorkspaceState("welcome");
    welcomeVisible = true;
    activeFilePath = null;
    previewArea.removeAttribute("data-file-path");
    chatInput.value = "";
    chatInput.style.height = "auto";
    pendingFiles = [];
    renderChatAttachments();
    fetchAgentInfo();

    if (clearWorkspace) {
      previousFilePaths = new Set();
      lastFileEntries = [];
      lastNewPaths = new Set();
      refreshFileTreeUI();
    }
  }

  function confirmClearContext() {
    if (isStreaming || !clearModalConfirm || !clearModalCancel) return;

    var clearWorkspace = !!(clearWorkspaceCheckbox && clearWorkspaceCheckbox.checked);
    clearModalConfirm.disabled = true;
    clearModalCancel.disabled = true;

    fetch("/api/clear-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearWorkspace: clearWorkspace }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body.ok) {
            throw new Error(body.error || "Failed to clear context.");
          }
          resetUiAfterContextClear(clearWorkspace);
          closeClearModal();
          showToast("Context cleared.", false);
        });
      })
      .catch(function (error) {
        showToast(error instanceof Error ? error.message : "Failed to clear context.", true);
      })
      .finally(function () {
        clearModalConfirm.disabled = false;
        clearModalCancel.disabled = false;
      });
  }

  if (clearContextBtn && clearModalOverlay && clearModalCancel && clearModalConfirm) {
    clearContextBtn.addEventListener("click", function () {
      if (isStreaming) return;
      clearModalOverlay.style.display = "flex";
    });
    clearModalCancel.addEventListener("click", closeClearModal);
    clearModalConfirm.addEventListener("click", confirmClearContext);
    clearModalOverlay.addEventListener("click", function (e) {
      if (e.target === clearModalOverlay) closeClearModal();
    });
  }

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
        var toolInput = event.toolCall && event.toolCall.input;
        addToolCallMessage(toolName, toolInput);
        break;

      case "tool_execution_update":
        if (currentToolEl && event.chunk) {
          var body = currentToolEl.querySelector(".tool-body");
          if (body) {
            var outputEl = body.querySelector(".tool-output");
            if (!outputEl) {
              outputEl = document.createElement("div");
              outputEl.className = "tool-output";
              body.appendChild(outputEl);
            }
            outputEl.textContent += event.chunk;
            if (!body.classList.contains("tool-body--open")) {
              body.classList.add("tool-body--open");
              var chevron = currentToolEl.querySelector(".tool-chevron");
              if (chevron) chevron.classList.add("tool-chevron--open");
              var header = currentToolEl.querySelector(".tool-header");
              if (header) header.setAttribute("aria-expanded", "true");
            }
            scrollToBottom();
          }
        }
        break;

      case "response.tool_call.done":
        var isError = event.result && event.result.isError;
        updateToolStatus(isError);
        if (currentToolEl && event.result && event.result.output) {
          var body = currentToolEl.querySelector(".tool-body");
          if (body) {
            // If no streaming output was received, show the final result
            var outputEl = body.querySelector(".tool-output");
            if (!outputEl) {
              outputEl = document.createElement("div");
              outputEl.className = "tool-output";
              body.appendChild(outputEl);
            }
            if (!outputEl.textContent) {
              outputEl.textContent = typeof event.result.output === "string"
                ? event.result.output
                : JSON.stringify(event.result.output, null, 2);
            }
            if (isError) {
              body.classList.add("tool-body--open");
              var chevron = currentToolEl.querySelector(".tool-chevron");
              if (chevron) chevron.classList.add("tool-chevron--open");
              var header = currentToolEl.querySelector(".tool-header");
              if (header) header.setAttribute("aria-expanded", "true");
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

        // Auto-open highest priority new file
        var newFiles = [];
        if (previousFilePaths.size > 0) {
          var nowPaths = new Set();
          collectPaths(lastFileEntries || [], nowPaths);
          nowPaths.forEach(function(p) { if (!previousFilePaths.has(p)) newFiles.push(p); });
        }
        if (newFiles.length > 0) {
          newFiles.sort(function(a, b) {
            var ea = getExtension(a), eb = getExtension(b);
            return (IMAGE_EXT_SET.has(ea) ? 0 : ea === ".md" ? 1 : 2) - (IMAGE_EXT_SET.has(eb) ? 0 : eb === ".md" ? 1 : 2);
          });
          openFilePreview(newFiles[0], newFiles[0].split("/").pop());
        }
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
        if (event.type && event.type.startsWith("response.") || event.type === "tool_execution_update") {
          transcriptEvents.push(event);
        }
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

  // --  Browse Mode Toggle
  var browseModeToggle = document.getElementById("browse-mode-toggle");
  var browseModeLabel = document.getElementById("browse-mode-label");
  var sandboxBreadcrumbEl = document.getElementById("sandbox-breadcrumb");

  function updateBrowseModeUI() {
    if (browseModeLabel) {
      browseModeLabel.textContent = browseMode === "sandbox" ? "/ (sandbox)" : "/workspace";
    }
    if (sandboxBreadcrumbEl) {
      if (browseMode === "sandbox" && sandboxBrowsePath !== "/") {
        sandboxBreadcrumbEl.style.display = "";
        sandboxBreadcrumbEl.innerHTML = "";
        var parts = sandboxBrowsePath.replace(/^\//, "").split("/").filter(Boolean);
        var rootLink = document.createElement("span");
        rootLink.className = "sandbox-crumb sandbox-crumb--link";
        rootLink.textContent = "/";
        rootLink.addEventListener("click", function() {
          sandboxBrowsePath = "/";
          expandedDirsInitialized = false;
          expandedDirs = new Set();
          updateBrowseModeUI();
          refreshFileTree();
        });
        sandboxBreadcrumbEl.appendChild(rootLink);
        var cumulative = "";
        parts.forEach(function(part) {
          cumulative += "/" + part;
          var sep = document.createElement("span");
          sep.className = "sandbox-crumb-sep";
          sep.textContent = "\u203A";
          sandboxBreadcrumbEl.appendChild(sep);
          var link = document.createElement("span");
          link.className = "sandbox-crumb sandbox-crumb--link";
          link.textContent = part;
          var target = cumulative;
          link.addEventListener("click", function() {
            sandboxBrowsePath = target;
            expandedDirsInitialized = false;
            expandedDirs = new Set();
            updateBrowseModeUI();
            refreshFileTree();
          });
          sandboxBreadcrumbEl.appendChild(link);
        });
      } else {
        sandboxBreadcrumbEl.style.display = "none";
      }
    }
  }

  if (browseModeToggle) {
    browseModeToggle.addEventListener("click", function() {
      browseMode = browseMode === "workspace" ? "sandbox" : "workspace";
      sandboxBrowsePath = "/";
      expandedDirsInitialized = false;
      expandedDirs = new Set();
      previousFilePaths = new Set();
      lastFileEntries = null;
      updateBrowseModeUI();
      refreshFileTree();
    });
  }

  // --  Workspace Tab Switching
  var workspaceContent = document.getElementById("workspace-content");
  var transcriptPanel = document.getElementById("transcript-panel");
  var workspaceTabs = document.querySelectorAll(".workspace-tab");

  workspaceTabs.forEach(function(tab) {
    tab.addEventListener("click", function() {
      var target = tab.getAttribute("data-tab");
      if (target === activeWorkspaceTab) return;
      activeWorkspaceTab = target;
      workspaceTabs.forEach(function(t) { t.classList.remove("workspace-tab--active"); });
      tab.classList.add("workspace-tab--active");
      if (target === "transcript") {
        workspaceContent.style.display = "none";
        transcriptPanel.style.display = "";
        refreshTranscript();
      } else {
        workspaceContent.style.display = "";
        transcriptPanel.style.display = "none";
      }
    });
  });

  // --  Transcript Panel
  var transcriptList = document.getElementById("transcript-list");
  var transcriptRefreshBtn = document.getElementById("transcript-refresh");
  var transcriptCopyBtn = document.getElementById("transcript-copy");
  var transcriptClearBtn = document.getElementById("transcript-clear");

  function refreshTranscript() {
    fetch("/api/transcript")
      .then(function(res) { return res.json(); })
      .then(function(data) {
        renderTranscriptHistory(data.history || [], data.systemPrompt || "");
      })
      .catch(function() {
        if (transcriptList) transcriptList.innerHTML = '<div class="transcript-empty">Failed to load transcript.</div>';
      });
  }

  function renderTranscriptHistory(history, systemPrompt) {
    if (!transcriptList) return;
    transcriptList.innerHTML = "";

    if (systemPrompt) {
      var sysEntry = document.createElement("div");
      sysEntry.className = "transcript-entry transcript-entry--system";
      var sysHeader = document.createElement("div");
      sysHeader.className = "transcript-entry-header";
      var sysBadge = document.createElement("span");
      sysBadge.className = "transcript-role-badge transcript-role--system";
      sysBadge.textContent = "SYSTEM PROMPT";
      sysHeader.appendChild(sysBadge);
      sysEntry.appendChild(sysHeader);
      var sysContent = document.createElement("div");
      sysContent.className = "transcript-entry-content";
      var sysText = document.createElement("div");
      sysText.className = "transcript-text";
      sysText.textContent = systemPrompt;
      sysContent.appendChild(sysText);
      sysEntry.appendChild(sysContent);
      transcriptList.appendChild(sysEntry);
    }

    if (!history || history.length === 0) {
      if (!systemPrompt) {
        transcriptList.innerHTML = '<div class="transcript-empty">No conversation history yet.</div>';
      }
      return;
    }
    history.forEach(function(msg, index) {
      var entry = document.createElement("div");
      entry.className = "transcript-entry transcript-entry--" + msg.role;

      var header = document.createElement("div");
      header.className = "transcript-entry-header";
      var badge = document.createElement("span");
      badge.className = "transcript-role-badge transcript-role--" + msg.role;
      badge.textContent = msg.role.toUpperCase();
      header.appendChild(badge);
      var indexSpan = document.createElement("span");
      indexSpan.className = "transcript-index";
      indexSpan.textContent = "#" + index;
      header.appendChild(indexSpan);
      entry.appendChild(header);

      var content = document.createElement("div");
      content.className = "transcript-entry-content";

      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        if (msg.content) {
          var textBlock = document.createElement("div");
          textBlock.className = "transcript-text";
          textBlock.textContent = msg.content.length > 500 ? msg.content.slice(0, 500) + "..." : msg.content;
          content.appendChild(textBlock);
        }
        msg.tool_calls.forEach(function(tc) {
          var toolBlock = document.createElement("div");
          toolBlock.className = "transcript-tool-call";
          var toolHeader = document.createElement("div");
          toolHeader.className = "transcript-tool-header";
          toolHeader.textContent = "Tool: " + tc.name;
          toolBlock.appendChild(toolHeader);
          var toolInput = document.createElement("pre");
          toolInput.className = "transcript-tool-input";
          toolInput.textContent = JSON.stringify(tc.input, null, 2);
          toolInput.style.display = "none";
          toolBlock.appendChild(toolInput);
          toolHeader.style.cursor = "pointer";
          toolHeader.addEventListener("click", function() {
            toolInput.style.display = toolInput.style.display === "none" ? "" : "none";
          });
          content.appendChild(toolBlock);
        });
      } else if (msg.role === "tool" && msg.tool_results) {
        msg.tool_results.forEach(function(tr) {
          var resultBlock = document.createElement("div");
          resultBlock.className = "transcript-tool-result";
          var resultHeader = document.createElement("div");
          resultHeader.className = "transcript-tool-header";
          resultHeader.textContent = "Result" + (tr.isError ? " (ERROR)" : "") + " [" + tr.toolCallId + "]";
          resultBlock.appendChild(resultHeader);
          var resultBody = document.createElement("pre");
          resultBody.className = "transcript-tool-input";
          var outputText = typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output, null, 2);
          resultBody.textContent = outputText.length > 2000 ? outputText.slice(0, 2000) + "..." : outputText;
          resultBody.style.display = "none";
          resultBlock.appendChild(resultBody);
          resultHeader.style.cursor = "pointer";
          resultHeader.addEventListener("click", function() {
            resultBody.style.display = resultBody.style.display === "none" ? "" : "none";
          });
          if (tr.isError) resultBlock.classList.add("transcript-tool-result--error");
          content.appendChild(resultBlock);
        });
      } else {
        var textEl = document.createElement("div");
        textEl.className = "transcript-text";
        var text = msg.content || "";
        textEl.textContent = text.length > 1000 ? text.slice(0, 1000) + "..." : text;
        content.appendChild(textEl);
      }

      entry.appendChild(content);
      transcriptList.appendChild(entry);
    });

    // Also show accumulated event count
    if (transcriptEvents.length > 0) {
      var eventsSection = document.createElement("div");
      eventsSection.className = "transcript-events-summary";
      eventsSection.textContent = transcriptEvents.length + " streaming events captured this session";
      transcriptList.appendChild(eventsSection);
    }

    transcriptList.scrollTop = transcriptList.scrollHeight;
  }

  if (transcriptRefreshBtn) {
    transcriptRefreshBtn.addEventListener("click", refreshTranscript);
  }
  if (transcriptCopyBtn) {
    transcriptCopyBtn.addEventListener("click", function() {
      fetch("/api/transcript")
        .then(function(res) { return res.json(); })
        .then(function(data) {
          return fetch("/api/transcript/events").then(function(res) { return res.json(); }).then(function(evtData) {
            var combined = { history: data.history, events: evtData.events };
            navigator.clipboard.writeText(JSON.stringify(combined, null, 2)).then(function() {
              showToast("Transcript copied to clipboard.", false);
            });
          });
        })
        .catch(function() { showToast("Failed to copy transcript.", true); });
    });
  }
  if (transcriptClearBtn) {
    transcriptClearBtn.addEventListener("click", function() {
      fetch("/api/transcript/clear", { method: "POST" })
        .then(function() {
          transcriptEvents = [];
          refreshTranscript();
          showToast("Transcript events cleared.", false);
        })
        .catch(function() { showToast("Failed to clear transcript.", true); });
    });
  }

  // --  Init
  window.addEventListener("files-changed", refreshFileTree);
  fetchAgentInfo();
  startFilePolling();
  connectWebSocket();
})();
