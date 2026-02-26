/* File Upload & Download — companion to app.js */
(function () {
  "use strict";

  // ── Toast helper ──
  function showToast(message, isError) {
    var toast = document.createElement("div");
    toast.className = "ft-toast" + (isError ? " ft-toast--error" : "");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
  }

  // ── Upload button in file-panel header ──
  var panelHeader = document.querySelector("#file-panel .panel-header");
  if (!panelHeader) return;

  var uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.multiple = true;
  uploadInput.style.display = "none";
  panelHeader.appendChild(uploadInput);

  var uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "ft-upload-btn";
  uploadBtn.setAttribute("aria-label", "Upload files");
  uploadBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  panelHeader.appendChild(uploadBtn);

  uploadBtn.addEventListener("click", function () { uploadInput.click(); });

  function uploadFiles(files) {
    Array.from(files).forEach(function (file) {
      var form = new FormData();
      form.append("file", file);
      fetch("/api/file-upload", { method: "POST", body: form })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast("Uploaded " + file.name, false);
            window.dispatchEvent(new CustomEvent("files-changed"));
          } else {
            showToast(data.error || "Upload failed", true);
          }
        })
        .catch(function () { showToast("Upload failed", true); });
    });
  }

  uploadInput.addEventListener("change", function () {
    if (uploadInput.files && uploadInput.files.length) {
      uploadFiles(uploadInput.files);
      uploadInput.value = "";
    }
  });

  // ── Drag-and-drop on file tree ──
  var fileTree = document.getElementById("file-tree");
  if (fileTree) {
    fileTree.addEventListener("dragover", function (e) {
      e.preventDefault();
      fileTree.classList.add("ft-drag-over");
    });
    fileTree.addEventListener("dragleave", function (e) {
      if (!fileTree.contains(e.relatedTarget)) {
        fileTree.classList.remove("ft-drag-over");
      }
    });
    fileTree.addEventListener("drop", function (e) {
      e.preventDefault();
      fileTree.classList.remove("ft-drag-over");
      if (e.dataTransfer && e.dataTransfer.files.length) {
        uploadFiles(e.dataTransfer.files);
      }
    });
  }

  // ── Download button in preview header ──
  var previewHeader = document.querySelector("#file-preview .panel-header");
  if (!previewHeader) return;

  var downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "ft-download-btn";
  downloadBtn.setAttribute("aria-label", "Download file");
  downloadBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  // Insert before the close button
  var closeBtn = document.getElementById("preview-close");
  previewHeader.insertBefore(downloadBtn, closeBtn);

  downloadBtn.addEventListener("click", function () {
    var filePreview = document.getElementById("file-preview");
    var filePath = filePreview ? filePreview.getAttribute("data-file-path") : null;
    if (!filePath) return;
    var a = document.createElement("a");
    a.href = "/api/file-download?path=" + encodeURIComponent(filePath);
    a.download = filePath.split("/").pop() || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
})();
