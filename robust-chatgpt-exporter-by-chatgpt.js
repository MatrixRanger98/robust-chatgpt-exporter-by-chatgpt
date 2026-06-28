// ── ChatGPT Conversation Exporter ────────────────────────────────────
// Paste this into your browser console while on chatgpt.com
// It will export all conversations as individual JSON + Markdown + HTML files, plus attachments, organized into folders when supported.
// ─────────────────────────────────────────────────────────────────────

(async () => {
  const API = "/backend-api";
  const PAGE_SIZE = 100;
  const DELAY = 1200;
  const DEVICE_ID = crypto.randomUUID();

  // Top-level export layout. All conversations are grouped by file type here.
  // export-root/
  //   markdown/<conversation>.md
  //   html/<conversation>.html
  //   json/<conversation>.json
  //   files/<conversation>/<attachments>
  const EXPORT_DIRS = {
    markdown: "markdown",
    html: "html",
    json: "json",
    files: "files",
  };

  const HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Oai-Device-Id": DEVICE_ID,
    "Oai-Language": "en-US",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let exportRootDir = null;
  let usingFileSystemAccess = false;

  // ── UI overlay ──────────────────────────────────────────────────────

  const overlay = document.createElement("div");
  overlay.id = "chatgpt-exporter-overlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;
      display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
      <div style="background:#1e293b;border-radius:16px;padding:40px;max-width:500px;width:90%;color:#e2e8f0;box-shadow:0 25px 50px rgba(0,0,0,0.4)">
        <h2 style="margin:0 0 8px;font-size:20px;color:#f8fafc">ChatGPT Exporter</h2>
        <p id="cge-status" style="color:#94a3b8;font-size:14px;margin:0 0 20px">Starting...</p>
        <div style="width:100%;height:8px;background:#334155;border-radius:4px;overflow:hidden;margin-bottom:8px">
          <div id="cge-bar" style="height:100%;background:#3b82f6;border-radius:4px;transition:width 0.3s;width:0%"></div>
        </div>
        <p id="cge-detail" style="color:#64748b;font-size:13px;margin:0 0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></p>
        <p id="cge-counters" style="color:#cbd5e1;font-size:13px;margin:0 0 12px;line-height:1.5">Success: 0 | Failed: 0 | Files: 0/0</p>
        <button id="cge-start-button" style="display:none;margin:0 0 12px;padding:10px 14px;border:0;border-radius:8px;background:#3b82f6;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer">Choose Export Folder & Start</button>
        <div id="cge-log" style="height:140px;overflow:auto;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#94a3b8;white-space:pre-wrap"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const ui = {
    status: overlay.querySelector("#cge-status"),
    bar: overlay.querySelector("#cge-bar"),
    detail: overlay.querySelector("#cge-detail"),
    counters: overlay.querySelector("#cge-counters"),
    startButton: overlay.querySelector("#cge-start-button"),
    logBox: overlay.querySelector("#cge-log"),
    stats: {
      convOk: 0,
      convFail: 0,
      convSkipped: 0,
      filesOk: 0,
      filesFail: 0,
      downloadsTriggered: 0,
      downloadsFailed: 0,
    },
    set(status, pct, detail) {
      if (status) this.status.textContent = status;
      if (pct != null) this.bar.style.width = pct + "%";
      if (detail) this.detail.textContent = detail;
      this.updateCounters();
    },
    updateCounters() {
      const s = this.stats;
      this.counters.textContent =
        `Conversations: ${s.convOk} successful, ${s.convFail} failed, ${s.convSkipped} skipped | ` +
        `Attachments: ${s.filesOk} successful, ${s.filesFail} failed | ` +
        `Files saved/downloads triggered: ${s.downloadsTriggered}, failed: ${s.downloadsFailed}`;
    },
    log(message) {
      const stamp = new Date().toLocaleTimeString();
      this.logBox.textContent += `[${stamp}] ${message}
`;
      this.logBox.scrollTop = this.logBox.scrollHeight;
      this.updateCounters();
    },
    done(msg) {
      this.status.textContent = msg;
      this.bar.style.width = "100%";
      this.bar.style.background = "#22c55e";
      this.detail.textContent = "You can close this overlay by clicking anywhere.";
      this.updateCounters();
      overlay.querySelector("div").style.cursor = "pointer";
      overlay.addEventListener("click", () => overlay.remove());
    },
    error(msg) {
      this.status.textContent = msg;
      this.bar.style.background = "#ef4444";
      this.detail.textContent = "Click anywhere to close.";
      this.updateCounters();
      overlay.addEventListener("click", () => overlay.remove());
    },
  };


  async function waitForFolderSelectionFromUser() {
    return new Promise((resolve, reject) => {
      if (!("showDirectoryPicker" in window)) {
        const err = new Error("This browser does not support folder writing. Use Chrome or Edge desktop and run the script on chatgpt.com.");
        ui.error(err.message);
        reject(err);
        return;
      }

      const button = ui.startButton;
      button.style.display = "inline-block";
      button.disabled = false;
      button.textContent = "Choose Export Folder & Start";
      ui.set("Ready to start", 0, "Click the button below, then choose the export root folder.");
      ui.log("Waiting for your click. Chrome requires a direct user gesture before opening the folder picker.");

      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Opening folder picker...";
        try {
          await chooseExportFolder();
          button.style.display = "none";
          resolve();
        } catch (err) {
          button.disabled = false;
          button.textContent = "Choose Export Folder & Start";
          ui.error(`Folder selection failed: ${err.message}`);
          reject(err);
        }
      }, { once: true });
    });
  }

  await waitForFolderSelectionFromUser();

  // ── Get token ───────────────────────────────────────────────────────

  ui.set("Getting session token...");
  let token;
  try {
    const session = await fetch("/api/auth/session").then((r) => r.json());
    token = session.accessToken;
    if (!token) throw new Error("No accessToken in session");
  } catch (e) {
    ui.error("Failed to get session token. Are you logged in?");
    return;
  }

  // ── API helper ──────────────────────────────────────────────────────

  const MAX_RETRIES = 8;
  const BASE_RETRY_DELAY = 2000;      // 2 seconds
  const MAX_RETRY_DELAY = 60000;      // 60 seconds

  function parseRetryAfter(resp) {
    const value = resp.headers.get("retry-after");
    if (!value) return null;

    // Retry-After can be seconds.
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }

    // Or an HTTP date.
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }

    return null;
  }

  function retryDelay(attempt, resp) {
    const retryAfter = resp ? parseRetryAfter(resp) : null;
    if (retryAfter != null) return retryAfter;

    // Exponential backoff with jitter.
    const exponential = Math.min(
      MAX_RETRY_DELAY,
      BASE_RETRY_DELAY * Math.pow(2, attempt)
    );

    const jitter = Math.floor(Math.random() * 1000);
    return exponential + jitter;
  }

  async function fetchWithRetry(url, options = {}, label = url) {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(url, options);

        if (resp.status === 429) {
          if (attempt === MAX_RETRIES) {
            throw new Error(`HTTP 429 after ${MAX_RETRIES} retries: ${label}`);
          }

          const delay = retryDelay(attempt, resp);
          ui.set(
            `Rate limited. Waiting ${Math.ceil(delay / 1000)}s before retrying...`,
            null,
            label
          );
          await sleep(delay);
          continue;
        }

        // Retry transient server errors too.
        if ([500, 502, 503, 504].includes(resp.status)) {
          if (attempt === MAX_RETRIES) {
            throw new Error(`HTTP ${resp.status} after ${MAX_RETRIES} retries: ${label}`);
          }

          const delay = retryDelay(attempt, resp);
          ui.set(
            `Server busy. Waiting ${Math.ceil(delay / 1000)}s before retrying...`,
            null,
            label
          );
          await sleep(delay);
          continue;
        }

        return resp;
      } catch (err) {
        lastError = err;

        if (attempt === MAX_RETRIES) {
          throw lastError;
        }

        const delay = retryDelay(attempt, null);
        ui.set(
          `Request failed. Waiting ${Math.ceil(delay / 1000)}s before retrying...`,
          null,
          label
        );
        await sleep(delay);
      }
    }

    throw lastError || new Error(`Failed request: ${label}`);
  }

  async function apiGet(path) {
    const url = `${API}/${path}`;
    const resp = await fetchWithRetry(
      url,
      {
        headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      },
      path
    );

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function apiFetchBinary(url) {
    const resp = await fetchWithRetry(url, {}, url);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = new Uint8Array(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "";
    return { data, contentType };
  }

  function safePathPart(name) {
    return sanitize(String(name || "untitled"));
  }

  function safeRelativePath(path) {
    return String(path)
      .split("/")
      .filter(Boolean)
      .map(safePathPart)
      .join("/");
  }

  async function ensureTopLevelFolders() {
    if (!usingFileSystemAccess || !exportRootDir) return;
    for (const dirName of Object.values(EXPORT_DIRS)) {
      await exportRootDir.getDirectoryHandle(dirName, { create: true });
    }
  }

  async function chooseExportFolder() {
    if (!("showDirectoryPicker" in window)) {
      throw new Error("This browser does not support folder writing. Use Chrome or Edge desktop and run the script on chatgpt.com.");
    }

    ui.set("Choose an export folder...", null, "Required: the script will create top-level markdown, html, json, and files folders inside it.");
    exportRootDir = await window.showDirectoryPicker({ mode: "readwrite" });
    usingFileSystemAccess = true;
    await ensureTopLevelFolders();
    ui.log("Folder selected. Files will be written into top-level markdown, html, json, and files folders.");
  }


  async function fileExistsInFolder(relativePath) {
    if (!usingFileSystemAccess || !exportRootDir) return false;

    const cleanPath = safeRelativePath(relativePath);
    const parts = cleanPath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return false;

    try {
      let dir = exportRootDir;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: false });
      }
      await dir.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async function conversationAlreadyExported(fname) {
    if (!usingFileSystemAccess || !exportRootDir) return false;

    // Treat a conversation as already exported only when all three core files exist.
    // Attachments are not checked here because old conversations may have no attachments,
    // and checking every attachment would require fetching the conversation again.
    const corePaths = [
      `${EXPORT_DIRS.json}/${fname}.json`,
      `${EXPORT_DIRS.markdown}/${fname}.md`,
      `${EXPORT_DIRS.html}/${fname}.html`,
    ];

    for (const path of corePaths) {
      if (!(await fileExistsInFolder(path))) return false;
    }

    return true;
  }

  async function writeFileToFolder(relativePath, data, mimeType = "application/octet-stream") {
    const cleanPath = safeRelativePath(relativePath);
    const parts = cleanPath.split("/").filter(Boolean);
    const fileName = parts.pop();

    if (!fileName) {
      ui.stats.downloadsFailed++;
      ui.log(`File write FAILED: ${relativePath} (empty filename)`);
      return false;
    }

    try {
      let dir = exportRootDir;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }

      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      const blob = data instanceof Blob
        ? data
        : new Blob([data], { type: mimeType });
      await writable.write(blob);
      await writable.close();

      ui.stats.downloadsTriggered++;
      ui.log(`File written: ${cleanPath}`);
      return true;
    } catch (e) {
      ui.stats.downloadsFailed++;
      ui.log(`File write FAILED: ${cleanPath} (${e.message})`);
      return false;
    }
  }

  function triggerDownload(relativePath, data, mimeType = "application/octet-stream") {
    const cleanPath = safeRelativePath(relativePath);

    try {
      const blob = data instanceof Blob
        ? data
        : new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = cleanPath;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      ui.stats.downloadsTriggered++;
      ui.log(`Download triggered: ${cleanPath}`);
      return true;
    } catch (e) {
      ui.stats.downloadsFailed++;
      ui.log(`Download trigger FAILED: ${cleanPath} (${e.message})`);
      return false;
    }
  }

  async function saveFile(relativePath, data, mimeType = "application/octet-stream") {
    if (!usingFileSystemAccess || !exportRootDir) {
      throw new Error("No export folder selected. Folder organization requires Chrome/Edge folder access.");
    }
    return writeFileToFolder(relativePath, data, mimeType);
  }

  const MIME_TO_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/svg+xml": ".svg", "application/pdf": ".pdf",
    "text/plain": ".txt", "text/html": ".html", "text/csv": ".csv",
    "application/json": ".json", "application/zip": ".zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };

  // ── File references ─────────────────────────────────────────────────

  function extractFileReferences(convo) {
    const refs = [];
    const seen = new Set();
    const mapping = convo.mapping || {};

    for (const node of Object.values(mapping)) {
      const msg = node.message;
      if (!msg) continue;

      if (msg.content?.parts) {
        for (const part of msg.content.parts) {
          if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
            const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
            if (match && !seen.has(match[1])) {
              seen.add(match[1]);
              refs.push({
                fileId: match[1],
                filename: part.metadata?.dalle?.prompt ? "dalle_image.png" : "image.png",
                type: "image",
              });
            }
          }
        }
      }

      if (msg.metadata?.attachments) {
        for (const att of msg.metadata.attachments) {
          if (att.id && !seen.has(att.id)) {
            seen.add(att.id);
            refs.push({ fileId: att.id, filename: att.name || "attachment", type: "attachment" });
          }
        }
      }

      if (msg.metadata?.citations) {
        for (const cit of msg.metadata.citations) {
          const fileId = cit.metadata?.file_id || cit.file_id;
          const title = cit.metadata?.title || cit.title || "citation";
          if (fileId && !seen.has(fileId)) {
            seen.add(fileId);
            refs.push({ fileId, filename: title, type: "citation" });
          }
        }
      }
    }
    return refs;
  }

  async function downloadFile(fileId, fallbackName) {
    const meta = await apiGet(`files/download/${fileId}`);
    if (!meta.download_url) throw new Error("No download_url");
    const { data, contentType } = await apiFetchBinary(meta.download_url);
    let filename = meta.file_name || fallbackName || fileId;
    // Add extension from content-type if missing
    if (!filename.includes(".") && contentType) {
      const mime = contentType.split(";")[0].trim();
      const ext = MIME_TO_EXT[mime];
      if (ext) filename += ext;
    }
    return { filename, data };
  }

  function deduplicateFilename(name, usedNames) {
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 1;
    while (usedNames.has(`${base}_${i}${ext}`)) i++;
    const deduped = `${base}_${i}${ext}`;
    usedNames.add(deduped);
    return deduped;
  }

  function sanitize(name) {
    return String(name || "untitled")
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._ ]+|[._ ]+$/g, "")
      .slice(0, 80) || "untitled";
  }

  function stripCitations(str) {
    return str.replace(/\u3010[^\u3011]*\u3011/g, "");
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Fetch conversation list ─────────────────────────────────────────

  const LIST_EMPTY_PAGE_RETRIES = 3;
  const LIST_MAX_PAGES = 10000;
  const listFetchLog = [];

  function recordListFetch(message) {
    listFetchLog.push(message);
    ui.log(message);
  }

  async function fetchAllConversations() {
    const conversations = [];
    const seen = new Set();
    let offset = 0;
    let page = 0;
    let emptyAttemptsAtCurrentOffset = 0;
    let latestTotal = null;

    while (page < LIST_MAX_PAGES) {
      const label = latestTotal == null
        ? `Fetching conversation list... loaded ${conversations.length}`
        : `Fetching conversation list... loaded ${conversations.length}/${latestTotal}`;
      ui.set(label, null, `offset=${offset}, page=${page + 1}`);

      const data = await apiGet(`conversations?offset=${offset}&limit=${PAGE_SIZE}`);
      const items = Array.isArray(data.items) ? data.items : [];

      if (typeof data.total === "number") {
        // Treat total as a progress hint only. Do not use it as a hard stop,
        // because stale or transient totals can make the export miss later pages.
        latestTotal = latestTotal == null ? data.total : Math.max(latestTotal, data.total);
      }

      if (!items.length) {
        emptyAttemptsAtCurrentOffset++;
        recordListFetch(
          `Conversation list empty page at offset=${offset}; attempt ${emptyAttemptsAtCurrentOffset}/${LIST_EMPTY_PAGE_RETRIES}; ` +
          `loaded=${conversations.length}${latestTotal == null ? "" : `, reported_total=${latestTotal}`}`
        );

        if (emptyAttemptsAtCurrentOffset < LIST_EMPTY_PAGE_RETRIES) {
          await sleep(DELAY * 2);
          continue;
        }

        recordListFetch(`Stopping conversation list fetch after ${LIST_EMPTY_PAGE_RETRIES} empty responses at offset=${offset}.`);
        break;
      }

      emptyAttemptsAtCurrentOffset = 0;
      page++;

      let added = 0;
      let duplicates = 0;
      for (const item of items) {
        if (item && item.id) {
          if (seen.has(item.id)) {
            duplicates++;
          } else {
            seen.add(item.id);
            conversations.push(item);
            added++;
          }
        }
      }

      recordListFetch(
        `Conversation list page ${page}: offset=${offset}, items=${items.length}, added=${added}, ` +
        `duplicates=${duplicates}, unique_loaded=${conversations.length}` +
        `${latestTotal == null ? "" : `, reported_total=${latestTotal}`}`
      );

      offset += PAGE_SIZE;
      await sleep(DELAY);
    }

    if (page >= LIST_MAX_PAGES) {
      recordListFetch(`Stopped conversation list fetch because LIST_MAX_PAGES=${LIST_MAX_PAGES} was reached.`);
    }

    return conversations;
  }

  ui.set("Fetching conversation list...");
  let conversations = [];
  try {
    conversations = await fetchAllConversations();
  } catch (e) {
    ui.error(`Failed to fetch conversations: ${e.message}`);
    return;
  }

  if (!conversations.length) {
    ui.done("No conversations found.");
    return;
  }

  ui.set(`Found ${conversations.length} conversations. Starting export...`);

  // ── Download/write conversations + files one by one ─────────────────

  let failed = 0;
  let totalFiles = 0;
  let failedFiles = 0;
  const total = conversations.length;
  const allConvos = conversations.map(({ id, title }) => ({
    fname: `${sanitize(title || "Untitled")}_${id.slice(0, 8)}`,
    title: title || "Untitled",
  }));
  const runLog = [];

  ui.log("Starting one-by-one export into top-level markdown, html, json, and files folders.");

  for (let i = 0; i < total; i++) {
    const { id: cid, title: rawTitle } = conversations[i];
    const title = rawTitle || "Untitled";
    const fname = `${sanitize(title)}_${cid.slice(0, 8)}`;
    const pct = Math.round(((i + 1) / total) * 100);

    ui.set(`Processing ${i + 1} of ${total} (${pct}%)`, pct, title);

    if (await conversationAlreadyExported(fname)) {
      ui.stats.convSkipped++;
      ui.log(`Conversation skipped, already exported: ${title}`);
      runLog.push(`SKIPPED existing conversation: ${title} (${cid})`);
      await sleep(DELAY);
      continue;
    }

    try {
      const convo = await apiGet(`conversation/${cid}`);
      const jsonStr = JSON.stringify(convo, null, 2);

      // Extract and download file references first, so Markdown/HTML can link to the same filenames.
      const fileRefs = extractFileReferences(convo);
      const fileMap = {};
      const usedNames = new Set();

      for (const ref of fileRefs) {
        totalFiles++;
        try {
          ui.set(`Downloading attachment ${totalFiles}...`, pct, ref.filename || ref.fileId);
          const { filename: dlName, data } = await downloadFile(ref.fileId, ref.filename);
          const actualName = deduplicateFilename(safePathPart(dlName || ref.filename || ref.fileId), usedNames);
          const attachmentPath = `${EXPORT_DIRS.files}/${fname}/${actualName}`;
          const linkPath = `${"../" + EXPORT_DIRS.files}/${fname}/${actualName}`;
          const ok = await saveFile(attachmentPath, data);
          if (ok) {
            ui.stats.filesOk++;
            fileMap[ref.fileId] = linkPath;
            runLog.push(`OK attachment: ${attachmentPath}`);
          } else {
            failedFiles++;
            ui.stats.filesFail++;
            runLog.push(`FAILED attachment save/download trigger: ${attachmentPath}`);
          }
          await sleep(DELAY);
        } catch (e) {
          failedFiles++;
          ui.stats.filesFail++;
          ui.log(`Attachment FAILED: ${ref.filename || ref.fileId} (${e.message})`);
          runLog.push(`FAILED attachment: ${ref.filename || ref.fileId} (${e.message})`);
        }
      }

      const mdStr = toMarkdown(convo, fileMap);
      const htmlStr = toHtml(convo, fileMap, allConvos, fname);

      await saveFile(`${EXPORT_DIRS.json}/${fname}.json`, jsonStr, "application/json");
      await sleep(DELAY);
      await saveFile(`${EXPORT_DIRS.markdown}/${fname}.md`, mdStr, "text/markdown");
      await sleep(DELAY);
      await saveFile(`${EXPORT_DIRS.html}/${fname}.html`, htmlStr, "text/html");
      await sleep(DELAY);

      ui.stats.convOk++;
      ui.log(`Conversation successful: ${title}`);
      runLog.push(`OK conversation: ${title} (${cid})`);
    } catch (e) {
      failed++;
      ui.stats.convFail++;
      ui.log(`Conversation FAILED: ${title} (${e.message})`);
      runLog.push(`FAILED conversation: ${title} (${cid}) (${e.message})`);
    }

    await sleep(DELAY);
  }

  // Download a plain-text run log as the final individual file, not a ZIP.
  const succeeded = total - failed;
  const logText = [
    "ChatGPT Exporter run log",
    `Finished: ${new Date().toISOString()}`,
    `Conversations successful: ${succeeded}/${total}`,
    `Conversations failed: ${failed}`,
    `Conversations skipped: ${ui.stats.convSkipped}`,
    `Attachments successful: ${totalFiles - failedFiles}/${totalFiles}`,
    `Attachments failed: ${failedFiles}`,
    `Files saved/downloads triggered: ${ui.stats.downloadsTriggered}`,
    `File save/download trigger failures: ${ui.stats.downloadsFailed}`,
    "",
    "Conversation list fetch log",
    ...listFetchLog,
    "",
    "Export log",
    ...runLog,
  ].join("\n");
  await saveFile("chatgpt-export-log.txt", logText, "text/plain");

  let doneMsg = `Done! Exported ${succeeded}/${total} conversations one by one.`;
  if (ui.stats.convSkipped) doneMsg += ` ${ui.stats.convSkipped} skipped because they already existed.`;
  if (failed) doneMsg += ` (${failed} failed)`;
  if (totalFiles) doneMsg += ` ${totalFiles - failedFiles}/${totalFiles} attachments downloaded.`;
  doneMsg += ` ${ui.stats.downloadsTriggered} files written.`;
  ui.done(doneMsg);

  // ── Markdown converter ──────────────────────────────────────────────

  function encodeMarkdownUrl(path) {
    // encodeURI keeps path separators but does not encode #, parentheses, etc.
    // Those characters can break Markdown link parsing, so encode them explicitly.
    return encodeURI(path)
      .replace(/#/g, "%23")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
  }

  function escapeMarkdownLinkText(text) {
    return String(text || "attachment")
      .replace(/\\/g, "\\\\")
      .replace(/\]/g, "\\]")
      .replace(/\[/g, "\\[");
  }

  function toMarkdown(convo, fileMap = {}) {
    const title = convo.title || "Untitled";
    const ct = convo.create_time;
    let dateStr = "";
    if (ct) dateStr = new Date(ct * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

    const lines = [`# ${title}`, ""];
    if (dateStr) lines.push(`*${dateStr}*\n`);

    const mapping = convo.mapping || {};
    const rootId = Object.keys(mapping).find((k) => mapping[k].parent == null);

    if (rootId) {
      const queue = [rootId];
      while (queue.length) {
        const nid = queue.shift();
        const node = mapping[nid] || {};
        const msg = node.message;
        if (msg?.content?.parts) {
          const role = msg.author?.role || "unknown";
          // Skip system, tool, and non-text assistant messages from markdown
          if (role === "system" || role === "tool") { queue.push(...(node.children || [])); continue; }
          const contentType = msg.content?.content_type || "text";
          if (role === "assistant" && contentType !== "text") { queue.push(...(node.children || [])); continue; }
          const textParts = [];

          for (const part of msg.content.parts) {
            if (typeof part === "string") {
              textParts.push(part);
            } else if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
              const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
              if (match && fileMap[match[1]]) {
                textParts.push(`![image](${encodeMarkdownUrl(fileMap[match[1]])})`);
              } else {
                textParts.push("[image]");
              }
            } else {
              textParts.push(JSON.stringify(part));
            }
          }

          if (msg.metadata?.attachments) {
            for (const att of msg.metadata.attachments) {
              if (att.id && fileMap[att.id]) {
                const displayName = escapeMarkdownLinkText(att.name || "attachment");
                textParts.push(`\n📎 [${displayName}](${encodeMarkdownUrl(fileMap[att.id])})`);
              }
            }
          }

          const text = stripCitations(textParts.join("\n")).trim();
          if (text) {
            lines.push(`## ${role.charAt(0).toUpperCase() + role.slice(1)}\n\n${text}\n`);
          }
        }
        queue.push(...(node.children || []));
      }
    }

    return lines.join("\n");
  }

  // ── HTML converter ──────────────────────────────────────────────────

  function toHtml(convo, fileMap = {}, allConversations = [], currentFname = "") {
    const title = escapeHtml(convo.title || "Untitled");
    const ct = convo.create_time;
    let dateStr = "";
    if (ct) dateStr = new Date(ct * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

    const messages = [];
    const mapping = convo.mapping || {};
    const rootId = Object.keys(mapping).find((k) => mapping[k].parent == null);

    if (rootId) {
      const queue = [rootId];
      while (queue.length) {
        const nid = queue.shift();
        const node = mapping[nid] || {};
        const msg = node.message;
        if (msg?.content?.parts) {
          const role = msg.author?.role || "unknown";
          const contentType = msg.content?.content_type || "text";
          if (role === "system") { queue.push(...(node.children || [])); continue; }

          const isInternal = role === "tool" ||
            (role === "assistant" && contentType !== "text") ||
            (role === "user" && contentType === "user_editable_context");

          const textParts = [];
          const imageParts = [];

          for (const part of msg.content.parts) {
            if (typeof part === "string") {
              textParts.push(part);
            } else if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
              const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
              if (match && fileMap[match[1]]) imageParts.push(fileMap[match[1]]);
            }
          }

          const attachments = [];
          if (msg.metadata?.attachments) {
            for (const att of msg.metadata.attachments) {
              if (att.id && fileMap[att.id]) {
                attachments.push({ name: att.name || "attachment", path: fileMap[att.id] });
              }
            }
          }

          const text = stripCitations(textParts.join("\n")).trim();
          if (text || imageParts.length || attachments.length) {
            messages.push({ role, text, images: imageParts, attachments, isInternal, contentType });
          }
        }
        queue.push(...(node.children || []));
      }
    }

    const LOGO = '<svg viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835A9.964 9.964 0 0 0 18.306.5a10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.516 3.35 10.078 10.078 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813ZM22.498 37.886a7.474 7.474 0 0 1-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.944a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.496ZM6.392 31.006a7.471 7.471 0 0 1-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.744ZM4.297 13.62A7.469 7.469 0 0 1 8.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.944a.12.12 0 0 1-.114.012L7.044 23.86a7.504 7.504 0 0 1-2.747-10.24Zm27.658 6.437-9.724-5.615 3.367-1.943a.121.121 0 0 1 .114-.012l8.048 4.648a7.498 7.498 0 0 1-1.158 13.528V21.36a1.293 1.293 0 0 0-.647-1.132v-.17Zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.763Zm-21.063 6.929-3.367-1.944a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756 6.94 6.94 0 0 0-.236.134l-7.965 4.6a1.294 1.294 0 0 0-.654 1.132l-.006 11.225Zm1.829-3.943 4.33-2.501 4.332 2.5v5l-4.331 2.5-4.331-2.5V18Z" fill="currentColor"/></svg>';

    const INTERNAL_LABELS = {
      multimodal_text: "File context", code: "Code", execution_output: "Output",
      computer_output: "Output", tether_browsing_display: "Web browsing",
      system_error: "Error", text: "Tool output",
    };

    const messagesHtml = messages.map((m) => {
      if (m.isInternal) {
        const label = INTERNAL_LABELS[m.contentType] || "Internal context";
        const b64 = btoa(unescape(encodeURIComponent(m.text)));
        return `<details class="thinking"><summary>${label}</summary><div class="thinking-content md-content" dir="auto" data-md="${b64}"></div></details>`;
      }

      const roleClass = m.role === "user" ? "user" : "assistant";
      let content = "";

      if (m.role === "user") {
        content = `<div class="bubble" dir="auto">${escapeHtml(m.text).replace(/\n/g, "<br>")}</div>`;
      } else {
        const b64 = btoa(unescape(encodeURIComponent(m.text)));
        content = `<div class="avatar">${LOGO}</div><div class="content"><div class="md-content" dir="auto" data-md="${b64}"></div></div>`;
      }

      if (m.images.length) {
        content += `<div class="images">${m.images.map((s) => `<a href="${escapeHtml(encodeURI(s))}" target="_blank"><img src="${escapeHtml(encodeURI(s))}" alt="image" loading="lazy"></a>`).join("")}</div>`;
      }
      if (m.attachments.length) {
        content += `<div class="attachments">${m.attachments.map((a) => `<a class="attachment" href="${escapeHtml(encodeURI(a.path))}" target="_blank"><span class="att-icon">📎</span><span class="att-name">${escapeHtml(a.name)}</span></a>`).join("")}</div>`;
      }

      return `<div class="message ${roleClass}">${content}</div>`;
    }).join("\n");

    const sidebarItems = allConversations.map((c) => {
      const cls = c.fname === currentFname ? "sidebar-item active" : "sidebar-item";
      return `<a class="${cls}" href="${escapeHtml(encodeURI(c.fname + ".html"))}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</a>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release/build/styles/github-dark.min.css">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: #ffffff; color: #0d0d0d;
    line-height: 1.65; font-size: 16px;
    display: flex; height: 100vh;
  }
  .sidebar {
    width: 260px; min-width: 260px; height: 100vh;
    background: #f9f9f9; border-right: 1px solid #e5e5e5;
    overflow-y: auto; padding: 16px 0;
    flex-shrink: 0; position: sticky; top: 0;
  }
  .sidebar-header {
    padding: 8px 16px 16px; font-size: 14px; font-weight: 600;
    color: #6b6b6b; border-bottom: 1px solid #e5e5e5; margin-bottom: 8px;
  }
  .sidebar-item {
    display: block; padding: 8px 16px; font-size: 13px;
    color: #0d0d0d; text-decoration: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border-radius: 8px; margin: 2px 8px;
  }
  .sidebar-item:hover { background: #ececec; }
  .sidebar-item.active { background: #e5e5e5; font-weight: 600; }
  .sidebar-toggle {
    display: none; position: fixed; top: 12px; left: 12px; z-index: 100;
    background: #f4f4f4; border: 1px solid #e5e5e5; border-radius: 8px;
    width: 36px; height: 36px; cursor: pointer;
    align-items: center; justify-content: center; font-size: 20px;
  }
  @media (max-width: 768px) {
    .sidebar {
      position: fixed; left: -280px; z-index: 99;
      transition: left 0.2s; box-shadow: 2px 0 8px rgba(0,0,0,0.1);
    }
    .sidebar.open { left: 0; }
    .sidebar-toggle { display: flex; }
    .main { margin-left: 0 !important; }
  }
  .main { flex: 1; overflow-y: auto; }
  .header {
    max-width: 768px; margin: 0 auto; padding: 32px 24px 16px;
    border-bottom: 1px solid #e5e5e5;
  }
  .header h1 { font-size: 22px; font-weight: 600; }
  .header .date { font-size: 13px; color: #6b6b6b; margin-top: 4px; }
  .chat { max-width: 768px; margin: 0 auto; padding: 24px; }
  .message { margin-bottom: 24px; }
  .message.user { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .message.user .bubble {
    background: #f4f4f4; border-radius: 18px; padding: 10px 16px;
    max-width: 85%; white-space: pre-wrap; word-break: break-word;
  }
  .message.user .images { width: 100%; display: flex; justify-content: flex-end; }
  .message.assistant { display: flex; gap: 12px; align-items: flex-start; }
  .message.assistant .avatar {
    width: 28px; height: 28px; border-radius: 50%;
    background: #00a67e; color: #fff;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; margin-top: 2px;
  }
  .message.assistant .content { flex: 1; min-width: 0; }
  .message.assistant .content h1,
  .message.assistant .content h2,
  .message.assistant .content h3 { margin: 16px 0 8px; font-weight: 600; }
  .message.assistant .content h1 { font-size: 20px; }
  .message.assistant .content h2 { font-size: 18px; }
  .message.assistant .content h3 { font-size: 16px; }
  .message.assistant .content p { margin: 8px 0; }
  .message.assistant .content ul,
  .message.assistant .content ol { margin: 8px 0; padding-left: 24px; }
  .message.assistant .content li { margin: 4px 0; }
  .message.assistant .content a { color: #1a7f64; }
  .message.assistant .content code {
    background: #f0f0f0; border-radius: 4px; padding: 2px 5px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 14px;
  }
  .message.assistant .content pre { margin: 12px 0; border-radius: 8px; overflow: hidden; }
  .message.assistant .content pre code {
    display: block; background: #0d0d0d; color: #f8f8f2;
    padding: 16px; overflow-x: auto; border-radius: 0;
    font-size: 13px; line-height: 1.5;
  }
  .code-block { position: relative; }
  .code-block .copy-btn {
    position: absolute; top: 8px; right: 8px;
    background: #333; border: none; color: #999; cursor: pointer;
    font-size: 12px; padding: 4px 10px; border-radius: 4px;
    opacity: 0; transition: opacity 0.2s;
  }
  .code-block:hover .copy-btn { opacity: 1; }
  .code-block .copy-btn:hover { color: #fff; background: #555; }
  .images img { max-width: 100%; border-radius: 8px; margin: 4px 0; display: block; cursor: pointer; }
  .images img:hover { opacity: 0.9; }
  .message.user .images img { max-width: 300px; }
  .attachments { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
  .attachment {
    display: inline-flex; align-items: center; gap: 8px;
    background: #f4f4f4; border: 1px solid #e5e5e5; border-radius: 8px;
    padding: 8px 12px; text-decoration: none; color: #0d0d0d; font-size: 14px;
  }
  .attachment:hover { background: #ececec; }
  .att-icon { font-size: 16px; }
  .att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }

  .thinking {
    margin-bottom: 24px; border-left: 3px solid #d4d4d4;
    padding-left: 16px; font-size: 14px;
  }
  .thinking summary {
    color: #8e8e8e; font-style: italic; cursor: pointer;
    padding: 4px 0; user-select: none;
  }
  .thinking summary:hover { color: #555; }
  .thinking-content {
    color: #6b6b6b; padding: 8px 0; font-style: italic;
  }
  .thinking-content p, .thinking-content li { color: #6b6b6b; }
  .thinking-content pre code { opacity: 0.7; }
  .thinking-content h1, .thinking-content h2, .thinking-content h3 {
    color: #6b6b6b; font-size: 15px;
  }
</style>
</head>
<body>
<button class="sidebar-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">&#9776;</button>
<nav class="sidebar">
  <div class="sidebar-header">Conversations</div>
  ${sidebarItems}
</nav>
<div class="main">
  <div class="header">
    <h1>${title}</h1>
    ${dateStr ? `<div class="date">${dateStr}</div>` : ""}
  </div>
  <div class="chat">
  ${messagesHtml}
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release/build/highlight.min.js"><\/script>
<script>
document.addEventListener('DOMContentLoaded', () => {
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });

  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    const highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value;
    return '<div class="code-block"><button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.querySelector(\\'code\\').textContent);this.textContent=\\'Copied!\\';setTimeout(()=>this.textContent=\\'Copy\\',1500)">Copy</button>'
      + '<pre><code class="hljs">' + highlighted + '</code></pre></div>';
  };
  marked.use({ renderer });

  document.querySelectorAll('.md-content').forEach(el => {
    const md = decodeURIComponent(escape(atob(el.dataset.md)));
    el.innerHTML = marked.parse(md);
  });

  const active = document.querySelector('.sidebar-item.active');
  if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
});
<\/script>
</body>
</html>`;
  }


})();
