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
};

const ui = {
  songName: $("song-name"),
  lineCount: $("line-count"),
  arrangement: $("arrangement"),
  btnOpen: $("btn-open"),
  btnSave: $("btn-save"),
  btnSingle: $("btn-single"),
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
    const templateB64 = btoa(String.fromCharCode(...new Uint8Array(templateBuf)));
    const groupNamesText = await (await fetch("GroupNames.txt")).text();

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
               "split_slides_json"):
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
    };

    // Get text block names
    const namesResult = JSON.parse(state.bridge.getTextBlockNames());
    if (!namesResult.ok) throw new Error(namesResult.error);
    state.blockNames = namesResult.names;

    // Get group names
    const groupsResult = JSON.parse(state.bridge.getGroupNames());
    if (groupsResult.ok) {
       loadGroupNames(groupsResult.labels.join("\n"));
    }

    // Build UI
    buildTranslateGrid();
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
  setStatus("Saved! Downloaded " + title + ".pro and " + title + ".json");
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

// Save group names
ui.btnSaveGroups.addEventListener("click", () => {
  downloadText(ui.groupNames.value, "GroupNames.txt", "text/plain");
  setStatus("GroupNames.txt downloaded — replace the file in your folder");
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
document.addEventListener("DOMContentLoaded", boot);
