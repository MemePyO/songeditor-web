"use strict";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

const $ = (id) => document.getElementById(id);

const state = {
  ready: false,
  bridge: null,
  pyodide: null,
  blockNames: [],
  groupNames: "",
  syncing: false,
  template: null,   // { name, builtin, blocks }
  groups: null,     // { name, builtin }
  builtinTemplateB64: "",
  builtinGroupsText: "",
};

const ui = {
  songName: $("song-name"),
  lineCount: $("line-count"),
  arrangement: $("arrangement"),
  btnOpen: $("btn-open"),
  btnImport: $("btn-import"),
  btnSave: $("btn-save"),
  btnSingle: $("btn-single"),
  btnTemplate: $("btn-template"),
  btnGroupsFile: $("btn-groups-file"),
  btnResetFiles: $("btn-reset-files"),
  fileTemplate: $("file-template"),
  fileGroups: $("file-groups"),
  fileInfo: $("file-info"),
  btnDownloadGroups: $("btn-download-groups"),
  fileOpen: $("file-open"),
  translateGrid: $("translate-grid"),
  singleNumbers: $("single-numbers"),
  singleText: $("single-text"),
  groupNames: $("group-names"),
  btnSaveGroups: $("btn-save-groups"),
  status: $("status"),
  tabs: document.querySelectorAll(".tab"),
  tabContents: document.querySelectorAll(".tab-content"),
};

function setStatus(msg) {
  ui.status.textContent = msg;
}

// ---------------------------------------------------------
// SONG DATABASE (localStorage) — mirrors desktop "Melodii"
// ---------------------------------------------------------
const SONG_DB_KEY = "songeditor.songs.v1";

function readSongDB() {
  try {
    const raw = localStorage.getItem(SONG_DB_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    console.warn("Song DB read failed", e);
    return {};
  }
}

function writeSongDB(db) {
  try {
    localStorage.setItem(SONG_DB_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    console.warn("Song DB write failed", e);
    return false;
  }
}

function listSongNames() {
  return Object.keys(readSongDB()).sort((a, b) => a.localeCompare(b));
}

function saveSongToDB(title, songTexts) {
  if (!title) return false;
  const db = readSongDB();
  const clean = {};
  for (const k of Object.keys(songTexts)) {
    if (k !== "_title") clean[k] = songTexts[k];
  }
  db[title] = { texts: clean, savedAt: Date.now() };
  return writeSongDB(db);
}

function loadSongFromDB(title) {
  const db = readSongDB();
  if (db[title]) return { title, texts: db[title].texts };
  const lower = title.toLowerCase();
  const found = Object.keys(db).find((k) => k.toLowerCase() === lower);
  if (!found) return null;
  return { title: found, texts: db[found].texts };
}

function refreshSongAutocomplete() {
  const dl = document.getElementById("song-names");
  if (!dl) return;
  const names = listSongNames();
  dl.innerHTML = "";
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n;
    dl.appendChild(opt);
  }
}

// ---------------------------------------------------------
// PROPRESENTER FILES (Template.pro / GroupNames.txt)
// Remembered in localStorage so a chosen file survives reloads.
// ---------------------------------------------------------
const STORAGE = {
  template: "songeditor.template.v1",
  groups: "songeditor.groupnames.v1",
};

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("Storage read failed for " + key, e);
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("Storage write failed for " + key, e);
    return false;
  }
}

function clearStored(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn("Storage remove failed for " + key, e);
  }
}

function bytesToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// localStorage holds roughly 5 MB of text; base64 inflates by ~33%.
const MAX_REMEMBER_B64 = 3500000;

function rememberTemplate(name, b64) {
  if (b64.length > MAX_REMEMBER_B64) return false;
  return writeStored(STORAGE.template, { name, b64, savedAt: Date.now() });
}

function rememberGroups(name, text) {
  if (text.length > MAX_REMEMBER_B64) return false;
  return writeStored(STORAGE.groups, { name, text, savedAt: Date.now() });
}

function refreshFileInfo() {
  if (!ui.fileInfo) return;
  const t = state.template;
  const g = state.groups;
  const tLabel = t
    ? `${t.name}${t.builtin ? " (built-in)" : ""} · ${t.blocks} block${t.blocks === 1 ? "" : "s"}`
    : "…";
  const gLabel = g ? `${g.name}${g.builtin ? " (built-in)" : ""}` : "…";
  ui.fileInfo.textContent = `Template: ${tLabel}   ·   Groups: ${gLabel}`;
}

// Swap the template in the running Python runtime, keeping typed text where
// the block names still exist.
function applyTemplateB64(b64) {
  if (!state.ready) return { ok: false, error: "still loading" };
  const r = JSON.parse(state.bridge.setTemplate(b64));
  if (!r.ok) return r;
  const typed = {};
  for (const n of state.blockNames) {
    const ta = document.getElementById("ta-" + n);
    if (ta) typed[n] = ta.value;
  }
  state.blockNames = r.names;
  buildTranslateGrid();
  for (const n of r.names) {
    const ta = document.getElementById("ta-" + n);
    if (ta && typed[n] !== undefined) ta.value = typed[n];
  }
  updateNumbers();
  syncSingleFromTranslate();
  return r;
}

function applyGroupNamesText(text) {
  if (!state.ready) return { ok: false, error: "still loading" };
  const r = JSON.parse(state.bridge.setGroups(text));
  if (!r.ok) return r;
  loadGroupNames(r.labels.join("\n"));
  return r;
}

function downloadBlob(b64, filename, mime) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseSongTexts() {
  const result = {};
  for (const name of state.blockNames) {
    const ta = document.getElementById("ta-" + name);
    if (ta) {
      result[name] = ta.value.split("\n");
    }
  }
  return result;
}

function setSongTexts(data) {
  for (const name of state.blockNames) {
    const ta = document.getElementById("ta-" + name);
    if (ta) {
      ta.value = (data[name] || []).join("\n");
    }
  }
  syncSingleFromTranslate();
  updateNumbers();
}

function updateNumbers() {
  // Get max line count across all blocks
  let maxLen = 0;
  for (const name of state.blockNames) {
    const ta = document.getElementById("ta-" + name);
    if (ta) {
      const lines = ta.value.split("\n");
      if (lines.length > maxLen) maxLen = lines.length;
    }
  }
  // Also single view
  const singleLines = ui.singleText.value.split("\n");
  if (singleLines.length > maxLen) maxLen = singleLines.length;

  const nums = Array.from({ length: maxLen }, (_, i) => i + 1).join("\n");
  document.querySelectorAll(".col-numbers").forEach((el) => {
    el.textContent = nums;
  });
  // refresh highlight overlay sizing
  if (typeof refreshHighlight === "function") refreshHighlight();
}

function syncSingleFromTranslate() {
  if (state.syncing) return;
  state.syncing = true;
  const firstName = state.blockNames[0];
  const ta = document.getElementById("ta-" + firstName);
  if (ta) {
    ui.singleText.value = ta.value;
  }
  state.syncing = false;
}

function syncTranslateFromSingle() {
  if (state.syncing) return;
  state.syncing = true;
  const firstName = state.blockNames[0];
  const ta = document.getElementById("ta-" + firstName);
  if (ta) {
    ta.value = ui.singleText.value;
  }
  state.syncing = false;
  updateNumbers();
}

function buildTranslateGrid() {
  ui.translateGrid.innerHTML = "";
  // Number column
  const numCol = document.createElement("div");
  numCol.className = "col-numbers";
  numCol.id = "translate-numbers";
  ui.translateGrid.appendChild(numCol);

  for (const name of state.blockNames) {
    const col = document.createElement("div");
    col.className = "col-text";
    const label = document.createElement("label");
    label.textContent = name;
    col.appendChild(label);
    const ta = document.createElement("textarea");
    ta.id = "ta-" + name;
    ta.spellcheck = false;
    ta.addEventListener("input", () => {
      if (name === state.blockNames[0]) syncSingleFromTranslate();
      updateNumbers();
    });
    col.appendChild(ta);
    ui.translateGrid.appendChild(col);
  }
}

function loadGroupNames(text) {
  ui.groupNames.value = text;
  state.groupNames = text;
}

function switchTab(tabName) {
  ui.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  ui.tabContents.forEach((c) => c.classList.toggle("active", c.id === "tab-" + tabName));
  if (tabName === "single") {
    syncSingleFromTranslate();
    updateNumbers();
  }
}

async function boot() {
  setStatus("Loading Python runtime…");
  try {
    await loadScript(PYODIDE_BASE + "pyodide.js");
    const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
    state.pyodide = pyodide;
    setStatus("Installing protobuf…");
    await pyodide.loadPackage("protobuf");
    setStatus("Loading app files…");
    // Fetch Python files
    const files = [
      "presentation_pb2.py", "action_pb2.py", "alignmentGuide_pb2.py",
      "background_pb2.py", "basicTypes_pb2.py", "cue_pb2.py",
      "digitalAudio_pb2.py", "effects_pb2.py", "graphicsData_pb2.py",
      "groups_pb2.py", "hotKey_pb2.py", "input_pb2.py", "layers_pb2.py",
      "messages_pb2.py", "presentationSlide_pb2.py", "propSlide_pb2.py",
      "rvtimestamp_pb2.py", "slide_pb2.py", "stage_pb2.py",
      "templateIdentification_pb2.py", "timers_pb2.py",
      "SongEditorPro7Generic.py", "single_export.py", "web_bridge.py",
    ];
    setStatus("Downloading app modules...");
    const results = await Promise.all(files.map(f => fetch(f).then(r => r.text())));
    const codes = {};
    files.forEach((f, i) => { codes[f] = results[i]; });

    // Fetch Template.pro and GroupNames.txt as binary/text
    const templateResp = await fetch("Template.pro");
    const templateBuf = await templateResp.arrayBuffer();
    const templateB64 = bytesToB64(new Uint8Array(templateBuf));
    const groupNamesText = await (await fetch("GroupNames.txt")).text();
    state.builtinTemplateB64 = templateB64;
    state.builtinGroupsText = groupNamesText;

    // Write files to Pyodide FS
    pyodide.FS.writeFile("Template.pro", new Uint8Array(templateBuf));
    pyodide.FS.writeFile("GroupNames.txt", groupNamesText);

    // Load modules
    pyodide.runPython(`
import sys, types, os

def _load_module(name, code):
    mod = types.ModuleType(name)
    mod.__file__ = name + ".py"
    exec(compile(code, name + ".py", "exec"), mod.__dict__)
    sys.modules[name] = mod
    return mod

def _init(codes):
    # Load modules with dependency resolution via retry passes.
    # (Protobuf-generated modules import each other; alphabetical order fails.)
    pending = dict(codes)
    loaded = set()
    progress = True
    errors = {}
    while pending and progress:
        progress = False
        to_remove = []
        for name, code in list(pending.items()):
            try:
                _load_module(name.replace(".py", ""), code)
                to_remove.append(name)
                loaded.add(name)
                progress = True
                if name in errors:
                    del errors[name]
            except Exception as e:
                errors[name] = str(e)
        for name in to_remove:
            del pending[name]
    if pending:
        detail = "; ".join(sorted(name + " => " + errors.get(name, "?") for name in pending))
        raise RuntimeError("Stuck modules: " + detail)
    import web_bridge
    g = globals()
    for fn in ("get_text_block_names_json", "get_group_names_json",
               "generate_pro_json", "generate_single_pro_json",
               "split_slides_json", "set_template_b64_json",
               "set_group_names_json"):
        g[fn] = getattr(web_bridge, fn)
`);
    const init = pyodide.globals.get("_init");
    const pyCodes = pyodide.toPy(codes);
    init(pyCodes);
    init.destroy();

    // Get bridge functions
    state.bridge = {
      getTextBlockNames: pyodide.globals.get("get_text_block_names_json"),
      getGroupNames: pyodide.globals.get("get_group_names_json"),
      generatePro: pyodide.globals.get("generate_pro_json"),
      generateSingle: pyodide.globals.get("generate_single_pro_json"),
      splitSlides: pyodide.globals.get("split_slides_json"),
      setTemplate: pyodide.globals.get("set_template_b64_json"),
      setGroups: pyodide.globals.get("set_group_names_json"),
    };

    // Text block names: a remembered template wins over the built-in one.
    let blockNames = null;
    const savedTemplate = readStored(STORAGE.template);
    if (savedTemplate && savedTemplate.b64) {
      const applied = JSON.parse(state.bridge.setTemplate(savedTemplate.b64));
      if (applied.ok) {
        blockNames = applied.names;
        state.template = {
          name: savedTemplate.name || "Template.pro",
          builtin: false,
          blocks: applied.names.length,
        };
      } else {
        clearStored(STORAGE.template);
        console.warn("Remembered template rejected:", applied.error);
      }
    }
    if (!blockNames) {
      const namesResult = JSON.parse(state.bridge.getTextBlockNames());
      if (!namesResult.ok) throw new Error(namesResult.error);
      blockNames = namesResult.names;
      state.template = {
        name: "Template.pro",
        builtin: true,
        blocks: blockNames.length,
      };
    }
    state.blockNames = blockNames;

    // Group names: remembered labels win over the built-in file.
    const savedGroups = readStored(STORAGE.groups);
    let groupsApplied = false;
    if (savedGroups && savedGroups.text) {
      const applied = JSON.parse(state.bridge.setGroups(savedGroups.text));
      if (applied.ok) {
        loadGroupNames(applied.labels.join("\n"));
        state.groups = {
          name: savedGroups.name || "GroupNames.txt",
          builtin: false,
        };
        groupsApplied = true;
      } else {
        clearStored(STORAGE.groups);
        console.warn("Remembered group names rejected:", applied.error);
      }
    }
    if (!groupsApplied) {
      const groupsResult = JSON.parse(state.bridge.getGroupNames());
      if (groupsResult.ok) {
        loadGroupNames(groupsResult.labels.join("\n"));
      }
      state.groups = { name: "GroupNames.txt", builtin: true };
    }

    // Build UI
    buildTranslateGrid();
    refreshSongAutocomplete();
    refreshFileInfo();
    state.ready = true;
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    setStatus("Load failed: " + err.message);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Cannot download " + src));
    document.head.appendChild(s);
  });
}

// Tab switching
ui.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// Open JSON file
ui.btnOpen.addEventListener("click", () => ui.fileOpen.click());
ui.fileOpen.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      setSongTexts(data);
      if (data._title) ui.songName.value = data._title;
      setStatus("Opened: " + file.name);
    } catch (err) {
      setStatus("Error opening file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// Save .pro + .json
ui.btnSave.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  const songTexts = parseSongTexts();
  const title = ui.songName.value.trim() || "song";
  songTexts._title = title;
  // Save JSON
  downloadText(JSON.stringify(songTexts, null, 2), title + ".json", "application/json");
  // Generate .pro
  const r = JSON.parse(state.bridge.generatePro(
    JSON.stringify(songTexts), ui.lineCount.value, ui.arrangement.value));
  if (!r.ok) { setStatus("Save failed: " + r.error); return; }
  downloadBlob(r.b64, r.filename.replace("song.pro", title + ".pro"), r.mime);
  // Save to the local song database (autocomplete + Import Saved)
  const stored = saveSongToDB(title, songTexts);
  refreshSongAutocomplete();
  setStatus(
    "Saved! Downloaded " + title + ".pro and " + title + ".json" +
    (stored ? " · saved to this browser" : " · browser storage unavailable")
  );
});

// Import a song saved in this browser's song database
ui.btnImport.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  const title = ui.songName.value.trim();
  if (!title) { setStatus("Type or pick a song name to import."); return; }
  const found = loadSongFromDB(title);
  if (!found) { setStatus("No saved song named '" + title + "' in this browser."); return; }
  ui.songName.value = found.title;
  setSongTexts(found.texts);
  setStatus("Imported: " + found.title);
});

// Download as Single
ui.btnSingle.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  const songTexts = parseSongTexts();
  const title = ui.songName.value.trim() || "song";
  const r = JSON.parse(state.bridge.generateSingle(
    JSON.stringify(songTexts), ui.lineCount.value, ui.arrangement.value));
  if (!r.ok) { setStatus("Export failed: " + r.error); return; }
  downloadBlob(r.b64, title + " (Single).pro", r.mime);
  // Also save JSON
  const singleData = {};
  singleData[state.blockNames[0]] = songTexts[state.blockNames[0]];
  singleData._title = title + " (Single)";
  downloadText(JSON.stringify(singleData, null, 2), title + " (Single).json", "application/json");
  setStatus("Downloaded " + title + " (Single).pro");
});

// ---------------------------------------------------------
// CHOOSE TEMPLATE / GROUP NAMES FILES
// ---------------------------------------------------------
ui.btnTemplate.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  ui.fileTemplate.click();
});

ui.fileTemplate.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToB64(bytes);
    const r = applyTemplateB64(b64);
    if (!r.ok) {
      setStatus("Template rejected: " + r.error);
      return;
    }
    const remembered = rememberTemplate(file.name, b64);
    state.template = { name: file.name, builtin: false, blocks: r.names.length };
    refreshFileInfo();
    setStatus(
      `Template: ${file.name} · ${r.names.length} text block(s): ${r.names.join(", ")}` +
      (remembered ? " · remembered in this browser" : " · too large to remember (active until reload)")
    );
  } catch (err) {
    setStatus("Could not read template: " + err.message);
  }
});

ui.btnGroupsFile.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  ui.fileGroups.click();
});

ui.fileGroups.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const r = applyGroupNamesText(text);
    if (!r.ok) {
      setStatus("Group names rejected: " + r.error);
      return;
    }
    const remembered = rememberGroups(file.name, text);
    state.groups = { name: file.name, builtin: false };
    refreshFileInfo();
    setStatus(
      `Group names: ${file.name} · ${r.labels.length} label(s)` +
      (remembered ? " · remembered in this browser" : " · too large to remember (active until reload)")
    );
  } catch (err) {
    setStatus("Could not read group names: " + err.message);
  }
});

ui.btnResetFiles.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  clearStored(STORAGE.template);
  clearStored(STORAGE.groups);
  const t = applyTemplateB64(state.builtinTemplateB64);
  if (!t.ok) { setStatus("Reset failed: " + t.error); return; }
  const g = applyGroupNamesText(state.builtinGroupsText);
  if (!g.ok) { setStatus("Reset failed: " + g.error); return; }
  state.template = { name: "Template.pro", builtin: true, blocks: t.names.length };
  state.groups = { name: "GroupNames.txt", builtin: true };
  refreshFileInfo();
  setStatus("Back to the built-in Template.pro and GroupNames.txt");
});

// Save group names
ui.btnSaveGroups.addEventListener("click", () => {
  if (!state.ready) { setStatus("Still loading…"); return; }
  const r = applyGroupNamesText(ui.groupNames.value);
  if (!r.ok) { setStatus("Group names rejected: " + r.error); return; }
  const remembered = rememberGroups("GroupNames.txt (edited)", ui.groupNames.value);
  state.groups = { name: "GroupNames.txt (edited)", builtin: false };
  refreshFileInfo();
  setStatus(
    `Group names applied · ${r.labels.length} label(s)` +
    (remembered ? " · remembered in this browser" : " · too large to remember (active until reload)")
  );
});

ui.btnDownloadGroups.addEventListener("click", () => {
  downloadText(ui.groupNames.value, "GroupNames.txt", "text/plain");
  setStatus("GroupNames.txt downloaded");
});

// Single view sync
ui.singleText.addEventListener("input", () => {
  syncTranslateFromSingle();
});

// Tab switching
function switchTab(name) {
  ui.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  ui.tabContents.forEach((c) => c.classList.toggle("active", c.id === "tab-" + name));
  if (name === "single") {
    syncSingleFromTranslate();
    updateNumbers();
  }
}

// ---------------------------------------------------------
// HOVER HIGHLIGHT + SCROLL SYNC (row correspondence)
// ---------------------------------------------------------
let hoveredLine = -1; // 0-based visual line index

function getLineHeight(el) {
  const cs = window.getComputedStyle(el);
  let lh = parseFloat(cs.lineHeight);
  if (isNaN(lh)) {
    const fs = parseFloat(cs.fontSize) || 13;
    lh = fs * 1.5;
  }
  return lh;
}

function getPaddingTop(el) {
  const cs = window.getComputedStyle(el);
  return parseFloat(cs.paddingTop) || 0;
}

function ensureHighlightBars() {
  document.querySelectorAll(".editor-grid .col-numbers, .editor-grid .col-text").forEach((col) => {
    if (!col.querySelector(":scope > .hover-bar")) {
      const bar = document.createElement("div");
      bar.className = "hover-bar";
      col.appendChild(bar);
    }
  });
  // single view
  document.querySelectorAll(".single-grid .col-numbers, .single-grid .col-text").forEach((col) => {
    if (!col.querySelector(":scope > .hover-bar")) {
      const bar = document.createElement("div");
      bar.className = "hover-bar";
      col.appendChild(bar);
    }
  });
}

function refreshHighlight() {
  ensureHighlightBars();
  document.querySelectorAll(".hover-bar").forEach((bar) => {
    const col = bar.parentElement;
    const lineH = getLineHeight(col.querySelector("textarea") || col);
    const pt = getPaddingTop(col);
    if (hoveredLine < 0) {
      bar.classList.remove("visible");
    } else {
      bar.classList.add("visible");
      const top = pt + hoveredLine * lineH - (col.scrollTop || 0);
      bar.style.top = top + "px";
      bar.style.height = lineH + "px";
    }
  });
}

function computeHoveredLine(el, evt) {
  const rect = el.getBoundingClientRect();
  const lineH = getLineHeight(el.tagName === "TEXTAREA" ? el : (el.querySelector("textarea") || el));
  // For textarea, account for scrollTop
  const scrollTop = el.scrollTop || 0;
  const pt = getPaddingTop(el);
  const y = evt.clientY - rect.top + scrollTop - pt;
  const idx = Math.floor(y / lineH);
  // clamp to number of lines
  const text = (el.tagName === "TEXTAREA") ? el.value : (el.textContent || "");
  const lines = text.split("\n");
  const maxIdx = Math.max(0, lines.length - 1);
  return Math.max(0, Math.min(idx, maxIdx));
}

function attachHighlightHandlers() {
  // translate view
  const grid = document.getElementById("translate-grid");
  if (grid) {
    grid.querySelectorAll(".col-numbers, .col-text textarea").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const target = (el.tagName === "TEXTAREA") ? el : el;
        hoveredLine = computeHoveredLine(target, e);
        refreshHighlight();
      });
      el.addEventListener("mouseleave", () => {
        hoveredLine = -1;
        refreshHighlight();
      });
      if (el.tagName === "TEXTAREA") {
        el.addEventListener("scroll", () => refreshHighlight());
      } else {
        el.addEventListener("scroll", () => refreshHighlight());
      }
    });
  }
  // single view
  const singleTa = document.getElementById("single-text");
  const singleNums = document.getElementById("single-numbers");
  [singleTa, singleNums].forEach((el) => {
    if (!el) return;
    el.addEventListener("mousemove", (e) => {
      hoveredLine = computeHoveredLine(el.tagName === "TEXTAREA" ? el : el, e);
      refreshHighlight();
    });
    el.addEventListener("mouseleave", () => {
      hoveredLine = -1;
      refreshHighlight();
    });
    el.addEventListener("scroll", () => refreshHighlight());
  });
}

// Scroll sync across columns
function syncScroll(source) {
  const cols = [];
  const grid = document.getElementById("translate-grid");
  if (grid) {
    grid.querySelectorAll(".col-numbers, .col-text textarea").forEach((el) => cols.push(el));
  }
  const st = source.scrollTop;
  cols.forEach((el) => {
    if (el !== source) el.scrollTop = st;
  });
  refreshHighlight();
}

function attachScrollSync() {
  const grid = document.getElementById("translate-grid");
  if (grid) {
    grid.querySelectorAll(".col-numbers, .col-text textarea").forEach((el) => {
      el.addEventListener("scroll", () => syncScroll(el));
    });
  }
  const singleTa = document.getElementById("single-text");
  const singleNums = document.getElementById("single-numbers");
  [singleTa, singleNums].forEach((el) => {
    if (!el) return;
    el.addEventListener("scroll", () => {
      const other = el === singleTa ? singleNums : singleTa;
      if (other) other.scrollTop = el.scrollTop;
      refreshHighlight();
    });
  });
}

// Wrap buildTranslateGrid to attach handlers after render
const _origBuildTranslateGrid = buildTranslateGrid;
buildTranslateGrid = function() {
  _origBuildTranslateGrid();
  // attach after DOM update
  setTimeout(() => {
    ensureHighlightBars();
    attachHighlightHandlers();
    attachScrollSync();
  }, 0);
};

// Also handle single view tab switch
const _origSwitchTab = switchTab;
// (switchTab defined later; patch after load via DOMContentLoaded? Instead patch at end of boot not needed.)


// Init
document.addEventListener("DOMContentLoaded", () => {
  refreshSongAutocomplete();
  boot();
});

// Register the service worker for offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}
