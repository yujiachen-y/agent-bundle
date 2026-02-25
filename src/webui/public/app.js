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
  var activityBar = document.getElementById("activity-bar");
  var activityText = document.getElementById("activity-text");
  var welcomeCard = document.getElementById("welcome-card");
  var previewPanel = document.getElementById("preview-panel");
  var previewFilename = document.getElementById("preview-filename");
  var previewContent = document.getElementById("preview-content");
  var previewClose = document.getElementById("preview-close");
  var completionCard = document.getElementById("completion-card");

  // ─── Welcome card ───
  // Hide terminal initially when welcome card is shown
  if (welcomeCard) {
    termContainer.style.display = "none";
  }

  function hideWelcomeCard() {
    if (!welcomeCard) return;
    welcomeCard.classList.add("hidden");
    termContainer.style.display = "";
    setTimeout(function () {
      if (welcomeCard && welcomeCard.parentNode) {
        welcomeCard.parentNode.removeChild(welcomeCard);
      }
      welcomeCard = null;
      fitAddon.fit();
    }, 300);
  }

  document.querySelectorAll(".prompt-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var prompt = chip.getAttribute("data-prompt");
      if (!prompt) return;
      chatInput.value = prompt;
      hideWelcomeCard();
      sendMessage(prompt);
    });
  });

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

  // ─── Activity bar ───
  var activityHideTimer = null;

  function showActivity(text) {
    if (activityHideTimer) { clearTimeout(activityHideTimer); activityHideTimer = null; }
    activityText.textContent = text;
    activityBar.classList.remove("hidden");
  }

  function hideActivity(delay) {
    if (delay) {
      activityHideTimer = setTimeout(function () {
        activityBar.classList.add("hidden");
        activityHideTimer = null;
      }, delay);
    } else {
      activityBar.classList.add("hidden");
    }
  }

  // ─── Command panel refs ───
  var commandPanel = document.getElementById("command-panel");
  var commandList = document.getElementById("command-list");

  // ─── State ───
  var isStreaming = false;
  var FILE_POLL_MS = 3000;
  var filePollingTimer = null;
  var ws = null;
  var previousFilePaths = {};
  var collapsedDirs = {};
  var activeFilePath = null;
  var availableCommands = [];

  // ─── Status badge ───
  function setStatus(status) {
    statusBadge.textContent = status;
    statusBadge.className = "badge badge--" + status;
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  // ─── File type helpers ───
  function getFileExt(name) {
    var dot = name.lastIndexOf(".");
    return dot >= 0 ? name.substring(dot).toLowerCase() : "";
  }

  function getFileIcon(name, type) {
    if (type === "directory") return { text: "\u25B8", cls: "ft-icon--dir" };
    var ext = getFileExt(name);
    switch (ext) {
      case ".py":   return { text: "Py", cls: "ft-icon--py" };
      case ".png": case ".jpg": case ".jpeg": case ".gif": case ".svg": case ".webp":
        return { text: "Im", cls: "ft-icon--img" };
      case ".csv": case ".xlsx": case ".xls": case ".tsv":
        return { text: "Tb", cls: "ft-icon--data" };
      case ".md": case ".txt": case ".log":
        return { text: "Tx", cls: "ft-icon--text" };
      case ".json":
        return { text: "{}", cls: "ft-icon--json" };
      default:
        return { text: "\u2022", cls: "ft-icon--default" };
    }
  }

  function isImageExt(ext) {
    return [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].indexOf(ext) >= 0;
  }

  function isTextExt(ext) {
    return [".py", ".js", ".ts", ".md", ".txt", ".csv", ".json", ".yaml", ".yml",
      ".html", ".css", ".sh", ".sql", ".log", ".xml", ".tsv", ".toml", ".cfg",
      ".ini", ".env", ".r", ".rb", ".java", ".c", ".cpp", ".h", ".go", ".rs"].indexOf(ext) >= 0;
  }

  // ─── Collect all file paths from tree (for diff detection) ───
  function collectPaths(entries, result) {
    entries.forEach(function (entry) {
      result[entry.path] = true;
      if (entry.children) collectPaths(entry.children, result);
    });
    return result;
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
      if (entry.path === activeFilePath) item.classList.add("ft-item--active");

      // Highlight new files
      if (!previousFilePaths[entry.path] && entry.type !== "directory") {
        item.classList.add("ft-item--new");
      }

      var indent = document.createElement("span");
      indent.className = "ft-indent";
      indent.style.width = depth * 16 + "px";
      item.appendChild(indent);

      var iconInfo = getFileIcon(entry.name, entry.type);
      var icon = document.createElement("span");
      icon.className = "ft-icon " + iconInfo.cls;
      icon.textContent = iconInfo.text;
      item.appendChild(icon);

      var name = document.createElement("span");
      name.className = "ft-name";
      name.textContent = entry.name;
      item.appendChild(name);

      parentEl.appendChild(item);

      if (entry.type === "directory") {
        var isCollapsed = collapsedDirs[entry.path] === true;
        icon.classList.add(isCollapsed ? "collapsed" : "expanded");

        var childContainer = document.createElement("div");
        childContainer.className = "ft-children" + (isCollapsed ? " collapsed" : "");

        // Click to toggle directory
        item.addEventListener("click", function (e) {
          e.stopPropagation();
          collapsedDirs[entry.path] = !collapsedDirs[entry.path];
          if (collapsedDirs[entry.path]) {
            icon.classList.remove("expanded");
            icon.classList.add("collapsed");
            childContainer.classList.add("collapsed");
          } else {
            icon.classList.remove("collapsed");
            icon.classList.add("expanded");
            childContainer.classList.remove("collapsed");
          }
        });

        if (entry.children && entry.children.length > 0) {
          renderFileTree(entry.children, childContainer, depth + 1);
        }
        parentEl.appendChild(childContainer);
      } else {
        // Click to open preview
        item.addEventListener("click", function (e) {
          e.stopPropagation();
          openPreview(entry.path, entry.name);
          // Update active state
          document.querySelectorAll(".ft-item--active").forEach(function (el) {
            el.classList.remove("ft-item--active");
          });
          item.classList.add("ft-item--active");
        });
      }
    });
  }

  function refreshFileTree() {
    fetch("/api/files")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        fileTree.innerHTML = "";
        if (data.entries && data.entries.length > 0) {
          var newPaths = collectPaths(data.entries, {});
          renderFileTree(data.entries, fileTree, 0);
          previousFilePaths = newPaths;
        } else {
          var empty = document.createElement("div");
          empty.className = "ft-item";
          empty.style.color = "var(--text-subtle)";
          empty.style.cursor = "default";
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

  // ─── Preview Panel ───
  function openPreview(filePath, fileName) {
    activeFilePath = filePath;
    previewFilename.textContent = fileName || filePath;
    previewContent.innerHTML = '<div style="color: var(--text-subtle); padding: 20px; text-align: center;">Loading...</div>';
    previewPanel.classList.remove("hidden");

    // On mobile, switch to preview tab
    if (window.innerWidth <= 720) {
      switchMobileTab("preview");
    }

    fetch("/api/file-content" + filePath)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        previewContent.innerHTML = "";

        if (data.error) {
          previewContent.innerHTML = '<div style="color: var(--red); padding: 20px;">' + data.error + '</div>';
          return;
        }

        if (data.type === "image") {
          var img = document.createElement("img");
          img.className = "preview-image";
          img.src = "data:image/" + data.ext.replace(".", "") + ";base64," + data.base64;
          img.alt = fileName;
          previewContent.appendChild(img);
        } else if (data.type === "text") {
          if (data.ext === ".md") {
            var mdDiv = document.createElement("div");
            mdDiv.className = "preview-markdown";
            mdDiv.innerHTML = marked.parse(data.content);
            mdDiv.querySelectorAll("pre code").forEach(function(block) {
              hljs.highlightElement(block);
            });
            previewContent.appendChild(mdDiv);
          } else {
            var pre = document.createElement("pre");
            var code = document.createElement("code");
            var langMap = {".py":"python",".js":"javascript",".ts":"typescript",".json":"json",".yaml":"yaml",".yml":"yaml",".sh":"bash",".html":"xml",".css":"css",".sql":"sql"};
            var lang = langMap[data.ext];
            if (lang) code.className = "language-" + lang;
            code.textContent = data.content;
            pre.className = "preview-code";
            pre.appendChild(code);
            if (typeof hljs !== "undefined") hljs.highlightElement(code);
            previewContent.appendChild(pre);
          }
        } else {
          var link = document.createElement("div");
          link.className = "preview-download";
          link.textContent = "Download " + fileName;
          previewContent.appendChild(link);
        }
      })
      .catch(function () {
        previewContent.innerHTML = '<div style="color: var(--red); padding: 20px;">Failed to load file</div>';
      });
  }

  function closePreview() {
    previewPanel.classList.add("hidden");
    activeFilePath = null;
    document.querySelectorAll(".ft-item--active").forEach(function (el) {
      el.classList.remove("ft-item--active");
    });
  }

  previewClose.addEventListener("click", closePreview);

  // ─── Completion Card ───
  function showCompletionCard() {
    fetch("/api/files")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.entries || data.entries.length === 0) return;

        var files = flattenFiles(data.entries);
        if (files.length === 0) return;

        completionCard.classList.remove("hidden");
        completionCard.innerHTML = "";

        // Header
        var header = document.createElement("div");
        header.className = "completion-header";
        var title = document.createElement("span");
        title.className = "completion-title";
        title.textContent = "\u2713 Analysis Complete";
        header.appendChild(title);
        var closeBtn = document.createElement("button");
        closeBtn.className = "completion-close";
        closeBtn.textContent = "\u00D7";
        closeBtn.addEventListener("click", function () {
          completionCard.classList.add("hidden");
        });
        header.appendChild(closeBtn);
        completionCard.appendChild(header);

        // File chips
        var fileList = document.createElement("div");
        fileList.className = "completion-files";
        var imageFiles = [];
        files.forEach(function (f) {
          var chip = document.createElement("div");
          chip.className = "completion-file";
          var iconInfo = getFileIcon(f.name, "file");
          var chipIcon = document.createElement("span");
          chipIcon.className = "completion-file-icon " + iconInfo.cls;
          chipIcon.textContent = iconInfo.text;
          chip.appendChild(chipIcon);
          var chipName = document.createElement("span");
          chipName.textContent = f.name;
          chip.appendChild(chipName);
          chip.addEventListener("click", function () {
            openPreview(f.path, f.name);
          });
          fileList.appendChild(chip);

          var ext = getFileExt(f.name);
          if (isImageExt(ext)) imageFiles.push(f);
        });
        completionCard.appendChild(fileList);

        // Image thumbnails
        if (imageFiles.length > 0) {
          var thumbContainer = document.createElement("div");
          thumbContainer.className = "completion-thumbnails";
          imageFiles.slice(0, 3).forEach(function (f) {
            fetch("/api/file-content" + f.path)
              .then(function (res) { return res.json(); })
              .then(function (imgData) {
                if (imgData.type !== "image") return;
                var thumb = document.createElement("img");
                thumb.className = "completion-thumb";
                thumb.src = "data:image/" + imgData.ext.replace(".", "") + ";base64," + imgData.base64;
                thumb.alt = f.name;
                thumb.addEventListener("click", function () {
                  openPreview(f.path, f.name);
                });
                thumbContainer.appendChild(thumb);
              })
              .catch(function () { /* skip thumbnail */ });
          });
          completionCard.appendChild(thumbContainer);
        }
      })
      .catch(function () { /* skip completion card on error */ });
  }

  function hideCompletionCard() {
    completionCard.classList.add("hidden");
    completionCard.innerHTML = "";
  }

  function flattenFiles(entries) {
    var result = [];
    entries.forEach(function (entry) {
      if (entry.type === "file") result.push(entry);
      if (entry.children) result = result.concat(flattenFiles(entry.children));
    });
    return result;
  }

  // ─── Mobile Tabs ───
  var mobileTabs = document.querySelectorAll(".mobile-tab");
  var filePanel = document.getElementById("file-panel");
  var mainPanel = document.getElementById("main-panel");

  function switchMobileTab(tabName) {
    mobileTabs.forEach(function (tab) {
      if (tab.getAttribute("data-tab") === tabName) {
        tab.classList.add("mobile-tab--active");
      } else {
        tab.classList.remove("mobile-tab--active");
      }
    });

    // Reset all panels
    filePanel.classList.remove("mobile-visible");
    mainPanel.classList.remove("mobile-hidden");
    previewPanel.classList.remove("mobile-visible");

    if (tabName === "files") {
      filePanel.classList.add("mobile-visible");
      mainPanel.classList.add("mobile-hidden");
      previewPanel.classList.add("hidden");
    } else if (tabName === "preview") {
      mainPanel.classList.add("mobile-hidden");
      previewPanel.classList.add("mobile-visible");
      previewPanel.classList.remove("hidden");
    } else {
      // terminal (default)
      previewPanel.classList.add("hidden");
    }

    // Re-fit terminal when switching to it
    if (tabName === "terminal") {
      setTimeout(function () { fitAddon.fit(); }, 50);
    }
  }

  mobileTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      switchMobileTab(tab.getAttribute("data-tab"));
    });
  });

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
        if (event.type === "commands") {
          availableCommands = event.commands || [];
          renderCommandPanel(availableCommands);
          return;
        }
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

  // ─── Command panel ───
  function renderCommandPanel(commands) {
    if (!commandPanel || !commandList) return;
    if (!commands || commands.length === 0) {
      commandPanel.style.display = "none";
      return;
    }
    commandPanel.style.display = "";
    commandList.innerHTML = "";
    commands.forEach(function (cmd) {
      var item = document.createElement("div");
      item.className = "cmd-item";
      item.title = cmd.description || cmd.name;

      var name = document.createElement("span");
      name.className = "cmd-name";
      name.textContent = "/" + cmd.name;
      item.appendChild(name);

      if (cmd.description) {
        var desc = document.createElement("span");
        desc.className = "cmd-desc";
        desc.textContent = cmd.description;
        item.appendChild(desc);
      }

      item.addEventListener("click", function () {
        triggerCommand(cmd);
      });
      commandList.appendChild(item);
    });
  }

  function triggerCommand(cmd) {
    if (isStreaming) return;
    if (cmd.argumentHint) {
      var args = prompt("Arguments for /" + cmd.name + " (" + cmd.argumentHint + "):");
      if (args === null) return;
      sendCommand(cmd.name, args);
    } else {
      sendCommand(cmd.name, "");
    }
  }

  function sendCommand(name, args) {
    if (isStreaming) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      term.writeln("\x1b[31mNot connected to agent.\x1b[0m");
      return;
    }
    isStreaming = true;
    setStatus("running");
    setInputEnabled(false);
    term.writeln("\x1b[36m> /" + name + (args ? " " + args : "") + "\x1b[0m\n");
    ws.send(JSON.stringify({ type: "command", name: name, args: args }));
  }

  // ─── Agent event handling ───
  function handleAgentEvent(event) {
    switch (event.type) {
      case "response.created":
        setStatus("running");
        showActivity("Thinking...");
        hideCompletionCard();
        break;

      case "response.output_text.delta":
        term.write(event.delta);
        break;
      case "response.output_text.done":
        break;
      case "response.tool_call.created":
        showActivity("Running " + event.toolCall.name + "...");
        term.writeln("\n\x1b[90m\u250C\u2500 " + event.toolCall.name + " \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\x1b[0m");
        term.writeln("\x1b[90m\u2502 \u23F3 Running in sandbox...                    \u2502\x1b[0m");
        break;

      case "response.tool_call.done":
        if (event.result && event.result.isError) {
          showActivity("\u2717 " + (event.toolCall ? event.toolCall.name : "tool") + " failed");
          term.writeln("\x1b[31m\u2502 \u2717 " + String(event.result.output) + "\x1b[0m");
          term.writeln("\x1b[90m\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\x1b[0m");
        } else {
          showActivity("\u2713 " + (event.toolCall ? event.toolCall.name : "tool") + " complete");
          term.writeln("\x1b[32m\u2502 \u2713 Done                                      \u2502\x1b[0m");
          term.writeln("\x1b[90m\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\x1b[0m");
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
        showActivity("\u2713 Complete");
        hideActivity(3000);
        showCompletionCard();
        break;

      case "response.error":
        term.writeln("\n\x1b[31mError: " + event.error + "\x1b[0m\n");
        setStatus("error");
        setInputEnabled(true);
        isStreaming = false;
        hideActivity(0);
        break;

      case "command_error":
        term.writeln("\x1b[31mCommand error: " + (event.error || "Unknown error") + "\x1b[0m\n");
        setStatus("idle"); setInputEnabled(true); isStreaming = false;
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

    hideWelcomeCard();
    isStreaming = true;
    setStatus("running");
    setInputEnabled(false);

    term.writeln("\x1b[44m\x1b[37m  YOU  \x1b[0m \x1b[1m" + text + "\x1b[0m\n");

    ws.send(JSON.stringify({
      type: "chat",
      input: [{ role: "user", content: text }],
    }));
  }

  function submitChat() {
    var text = chatInput.value.trim();
    if (text.length === 0) return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendMessage(text);
  }

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    submitChat();
  });

  // Enter sends, Shift+Enter inserts newline
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener("input", function () {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // ─── Init ───
  startFilePolling();
  connectWebSocket();
})();
