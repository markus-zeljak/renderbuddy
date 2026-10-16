// RenderBuddy for Cavalry
// One-click image exports, native video, and PNG sequence + ffmpeg video.
//
// PNG --> Video renders a PNG sequence and encodes it with ffmpeg (BT.709 tags).
// Player and display colour handling can vary.
//
// Install: Help or Scripts > Show Scripts Folder, then copy this file there.
// Open Scripts > RenderBuddy. Close and reopen the panel after an update.
// PNG --> Video requires ffmpeg (brew install ffmpeg); images and native video do not.
// See README.md for setup and custom FFmpeg path instructions.
//
// Buttons act on the ACTIVE composition. Existing files are overwritten.
//   Images (current frame): PNG, WEBP, SVG  -> <Comp>.png
//   Save: [x] Save to Downloads (off = Project Renders folder), optional Subfolder (e.g. V1.0.0) for everything
//   Video: native MP4, QuickTime ProRes 4444, and WebM (playback range).
//   PNG --> Video (playback range -> PNG sequence -> ffmpeg):
//     MP4   -> Renders/<Comp>.mp4                 (MP4 button produces mp4 files only)
//     WEBM  -> Renders/Web/<Comp>.webm            (WEBM button produces webm files only)
//     Resolution scale: slider 25–200 %, typed values have no upper limit.
//     [x] Additional size (slider, px wide)  -> Renders/Sizes/<Comp>__1280w.mp4        (Web/Sizes for webm)
//     [x] Compressed (slider, CRF 18–40)     -> Renders/Compressed/<Comp>__compressed-40crf.mp4
//                                    both    -> Renders/Sizes/Compressed/<Comp>__1280w-compressed-40crf.mp4
//     [x] Delete PNG sequence when done  (sequence renders to a local temp folder; nothing appears in Renders)
//         unchecked: sequence stays at Renders/<Comp>/
//
// Target: Cavalry 2.8.0 / macOS. Render Queue Item attribute ids used:
//   fileName, filePath, padding, frameRange (int2), frameRangeMode (0 Comp, 1 Playback, 2 Custom),
//   resolutionScale, postRenderExpression, generator (renderPNG | renderWebP | renderSVG | ...)

var SCRIPT_NAME = "RenderBuddy";
var VERSION = "0.7.0";
var PREF_KEY = "RenderBuddy_prefs";
var DEBUG = false; // true = dump render item attributes to the console after setup

// ---------------------------------------------------------------- prefs
var prefs = {
    saveToDownloads: true,  // off = Renders folder of the Project
    subfolder: "",          // optional subfolder under Renders / Downloads, e.g. "V1.0.0"
    resScale: 100,          // slider 25..200 %, numeric entry has no upper limit
    extra: true, extraWidth: 1280,   // additional size (px wide)
    compressed: false, crf: 40,      // 18..40
    deleteSeq: true
};
if (api.hasPreferenceObject(PREF_KEY)) {
    var saved = api.getPreferenceObject(PREF_KEY);
    for (var k in saved) prefs[k] = saved[k];
}
function savePrefs() { api.setPreferenceObject(PREF_KEY, prefs); }

// ---------------------------------------------------------------- helpers
function log(msg) { console.log("[" + SCRIPT_NAME + "] " + msg); }
function warn(msg) { console.warn("[" + SCRIPT_NAME + "] " + msg); }
function fail(msg) { warn(msg); try { new ui.Modal().showMessage(SCRIPT_NAME + "\n\n" + msg); } catch (e) {} }

function findFFmpeg() {
    var home = api.getHomeFolder();
    var candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        home + "/bin/ffmpeg",
        home + "/.local/bin/ffmpeg"
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (api.filePathExists(candidates[i])) return candidates[i];
    }
    return "";
}

function safeName(name) {
    return String(name).replace(/[<>:"\/\\|?*]/g, "").trim() || "Untitled";
}
function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function jsQuote(s) { return JSON.stringify(String(s)); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function pad5(n) { return ("00000" + n).slice(-5); }
function fileToken(name) { return String(name).replace(/[^A-Za-z0-9._-]/g, "_"); }
function clamp(v, lo, hi) { v = Math.round(Number(v) || lo); return Math.max(lo, Math.min(hi, v)); }
function resolutionScale(v) {
    v = Number(v);
    return isFinite(v) ? Math.max(25, Math.round(v)) : 100;
}
function evenWidth(w) { return Math.max(2, Math.floor(clamp(w, 16, 7680) / 2) * 2); }

function activeCompInfo() {
    var comp = api.getActiveComp();
    if (!comp) return null;
    var info = { id: comp, name: safeName(api.getNiceName(comp)) };
    try { info.fps = Number(api.get(comp, "fps")) || 25; } catch (e) { info.fps = 25; }
    try { info.playStart = Number(api.get(comp, "playbackStart")); } catch (e) { info.playStart = 0; }
    try { info.playEnd = Number(api.get(comp, "playbackEnd")); } catch (e) { info.playEnd = 0; }
    return info;
}

function findOrCreateItem(compId, niceName) {
    var items = api.getRenderQueueItems();
    for (var i = 0; i < items.length; i++) {
        try {
            if (api.getNiceName(items[i]) !== niceName) continue;
            var owner = JSON.parse(api.get(items[i], "userData") || "{}");
            if (owner.renderBuddyComp === compId) return items[i];
        } catch (e) {}
    }
    var id = api.addRenderQueueItem(compId);
    api.set(id, { niceName: niceName, userData: JSON.stringify({ renderBuddyComp: compId }) });
    return id;
}

function dumpItem(itemId) {
    if (!DEBUG) return;
    var attrs = api.getAttributes(itemId);
    var keep = ["fileName", "filePath", "padding", "frameRange", "frameRangeMode", "postRenderExpression", "generator", "generator.alpha", "resolutionScale"];
    for (var i = 0; i < attrs.length; i++) {
        if (keep.indexOf(attrs[i]) < 0) continue;
        try { log("  item." + attrs[i] + " = " + JSON.stringify(api.get(itemId, attrs[i]))); } catch (e) {}
    }
}

function writeText(path, content) {
    var ok = false;
    try { ok = api.writeToFile(path, content, true); } catch (e) { warn("writeToFile threw: " + e); }
    if (api.filePathExists(path)) return true;
    warn("writeToFile failed for " + path + " (returned " + ok + ")");
    return false;
}

// Write a shell script, trying several extensions (Cavalry may restrict writeToFile by file type).
function writeScript(basePath, content) {
    var exts = [".sh", ".txt", ".js"];
    for (var i = 0; i < exts.length; i++) {
        var p = basePath + exts[i];
        if (api.filePathExists(p)) api.deleteFilePath(p);
        if (writeText(p, content)) return p;
    }
    return "";
}

function workDir() {
    var d = api.getTempFolder() + "/RenderBuddy";
    if (!api.filePathExists(d)) api.makeFolder(d);
    if (!api.filePathExists(d)) { warn("work folder missing: " + d); return api.getTempFolder(); }
    return d;
}

var shellCounter = 0;
function runShell(snippet, detached) {
    var path = writeScript(workDir() + "/cmd_" + (++shellCounter) + "_" + Date.now(), "#!/bin/sh\n" + snippet + "\n");
    if (!path) return { error: "could not write helper script" };
    if (detached) { api.runDetachedProcess("/bin/sh", [path]); return { output: "" }; }
    var r = api.runProcess("/bin/sh", [path]);
    api.deleteFilePath(path);
    return r || {};
}

function ensureFolder(path) {
    if (api.filePathExists(path)) return true;
    try { api.makeFolder(path); } catch (e) { warn("makeFolder threw: " + e); }
    if (api.filePathExists(path)) return true;
    var r = runShell("mkdir -p " + shQuote(path), false);
    if (r && r.error) warn("mkdir: " + r.error);
    return api.filePathExists(path);
}

function renderRoot() {
    var root = api.getRenderPath();
    if (root) return root;
    if (prefs.renderRoot && api.filePathExists(prefs.renderRoot)) return prefs.renderRoot;
    var chosen = ui.chooseFolderPath(api.getHomeFolder());
    if (chosen) { prefs.renderRoot = chosen; savePrefs(); }
    return chosen;
}

// Append the optional subfolder (e.g. "V1.0.0") to a base folder. Nested paths like "a/b" are allowed.
// Where everything is saved: Downloads or Renders, plus the optional subfolder.
function outputBase() {
    var base = prefs.saveToDownloads ? api.getDownloadsFolder() : renderRoot();
    return base ? withSubfolder(base) : "";
}

function withSubfolder(base) {
    var sub = String(prefs.subfolder || "").replace(/[<>:"\\|?*]/g, "").replace(/^[\/\s]+|[\/\s]+$/g, "").trim();
    return sub ? base + "/" + sub : base;
}

function listMatching(dir, re) {
    var out = [];
    if (!api.filePathExists(dir)) return out;
    var files = api.listDirectory(dir);
    for (var i = 0; i < files.length; i++) if (re.test(files[i])) out.push(files[i]);
    return out;
}

function moveFile(src, dst) {
    var r = runShell("mv -f " + shQuote(src) + " " + shQuote(dst), false);
    if (r && r.error) { warn("mv: " + r.error); return false; }
    return api.filePathExists(dst);
}

// ---------------------------------------------------------------- image buttons
// Find the file Cavalry just wrote: exact expected name first, otherwise the newest file in the folder
// starting with the temporary base name (or any file of that type modified since the render started).
function findRenderedImage(dir, tmpBase, frame, ext, since) {
    var exact = dir + "/" + tmpBase + "." + pad5(frame) + "." + ext;
    if (api.filePathExists(exact)) return exact;
    var files = api.filePathExists(dir) ? api.listDirectory(dir) : [];
    var best = "", bestTime = 0;
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var name = f.substring(f.lastIndexOf("/") + 1);
        if (name.toLowerCase().slice(-(ext.length + 1)) !== "." + ext.toLowerCase()) continue;
        var t = 0;
        try { t = api.getFileModifiedDate(f); } catch (e) {}
        var isTmp = name.indexOf(tmpBase) === 0;
        if (!isTmp && t < since - 2000) continue;
        if (isTmp) t += 1e12;   // prefer temp-named files
        if (t > bestTime) { bestTime = t; best = f; }
    }
    return best;
}

var IMAGE_FORMATS = {
    PNG:  { generator: "renderPNG",  ext: "png"  },
    WEBP: { generator: "renderWebP", ext: "webp" },
    SVG:  { generator: "renderSVG",  ext: "svg"  }
};

function renderImage(fmtKey) {
    var comp = activeCompInfo();
    if (!comp) { fail("No active composition."); return; }
    var fmt = IMAGE_FORMATS[fmtKey];
    var frame = api.getFrame();
    var outDir = outputBase();
    if (!outDir) { fail("No output folder available."); return; }
    if (!ensureFolder(outDir)) { fail("Could not create folder: " + outDir); return; }
    var tmpBase = "_rb_" + fmtKey.toLowerCase() + "_" + comp.name;   // temporary name per format, renamed afterwards (drops the frame number)
    var started = Date.now();

    var item = findOrCreateItem(comp.id, SCRIPT_NAME + ": " + comp.name + " " + fmtKey);
    api.setGenerator(item, "generator", fmt.generator);
    api.set(item, {
        fileName: tmpBase,
        filePath: outDir,
        padding: 5,
        frameRangeMode: 2,          // Custom...
        postRenderExpression: ""
    });
    try { api.set(item, { ensureUniqueNames: false }); } catch (e) {}
    try { api.set(item, { frameRange: [frame, frame] }); }
    catch (e) { api.set(item, { "frameRange.x": frame, "frameRange.y": frame }); }
    dumpItem(item);

    log("Rendering " + fmtKey + " frame " + frame + " of '" + comp.name + "'");
    api.render(item);

    var src = findRenderedImage(outDir, tmpBase, frame, fmt.ext, started);
    if (!src) {
        var listing = api.filePathExists(outDir) ? api.listDirectory(outDir) : [];
        warn("folder listing: " + JSON.stringify(listing));
        fail("Render finished but no " + fmt.ext + " found in " + outDir);
        return;
    }
    var dst = outDir + "/" + comp.name + "." + fmt.ext;   // overwrite if it exists
    if (!moveFile(src, dst)) { fail("Could not rename " + src); return; }
    log(fmtKey + " → " + dst);
}

// ---------------------------------------------------------------- native video buttons
var VIDEO_FORMATS = {
    mp4:       { generator: "renderMP4",       ext: "mp4",  label: "MP4" },
    quicktime: { generator: "renderQuicktime", ext: "mov",  label: "Quicktime (4444)" },
    webm:      { generator: "renderWebM",      ext: "webm", label: "WEBM" }
};

function renderNativeVideo(kind) {
    var comp = activeCompInfo();
    if (!comp) { fail("No active composition."); return; }
    var fmt = VIDEO_FORMATS[kind];
    if (!fmt) { fail("Unknown video format: " + kind); return; }
    var outDir = outputBase();
    if (!outDir) { fail("No output folder available."); return; }
    if (!ensureFolder(outDir)) { fail("Could not create folder: " + outDir); return; }

    // Separate queue items prevent native exports from inheriting a PNG encode hook.
    var item = findOrCreateItem(comp.id, SCRIPT_NAME + ": " + comp.name + " Native " + fmt.label);
    api.setGenerator(item, "generator", fmt.generator);
    api.set(item, {
        fileName: comp.name,
        filePath: outDir,
        frameRangeMode: 1,          // Playback Start/End
        resolutionScale: 100,      // native video uses the composition's resolution
        ensureUniqueNames: false,
        postRenderExpression: ""
    });
    if (kind === "quicktime") {
        api.set(item, {
            "generator.codec": 2,        // ProRes
            "generator.proResCodec": 4,  // 4444
            "generator.bitDepth": 1      // Up to 12-bit
        });
    }
    dumpItem(item);
    log("Rendering native " + fmt.label + " of '" + comp.name + "' to " + outDir);
    api.render(item);
    log(fmt.label + " render finished. Output folder: " + outDir);
}

// ---------------------------------------------------------------- PNG --> Video buttons
function buildEncodeScript(o) {
    // o: ffmpeg, seqDir, name, fps, kind ("mp4"|"webm"), extra, extraWidth, compressed, crf, deleteSeq, root, expected, logFile
    var FF = shQuote(o.ffmpeg);
    var GLOB = shQuote(o.seqDir + "/" + o.name + ".*.png");
    var LOG = shQuote(o.logFile);
    var W = evenWidth(o.extraWidth);
    var CRF = clamp(o.crf, 18, 40);
    // Even dimensions (libx264 refuses odd sizes), full bt709 tagging (matrix + primaries + transfer), 4:2:0.
    var EVEN = '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv420p"';
    var COLOR = "-colorspace bt709 -color_primaries bt709 -color_trc bt709";
    var SCALE = "-vf scale=" + W + ":-2";
    var X264 = "-c:v libx264 -preset slow";
    var VP9 = "-c:v libvpx-vp9 -preset slow";
    var FAST = "-movflags +faststart";
    var IN = "-framerate " + o.fps + " -pattern_type glob -i " + GLOB;
    var SIZE = "__" + W + "w";
    var COMP = "__compressed-" + CRF + "crf";
    var BOTH = "__" + W + "w-compressed-" + CRF + "crf";

    var isMp4 = o.kind === "mp4";
    var ext = isMp4 ? "mp4" : "webm";
    var R = isMp4 ? o.root : o.root + "/Web";
    var dirs = {};
    function out(sub, suffix) { var d = sub ? R + "/" + sub : R; dirs[d] = true; return shQuote(d + "/" + o.name + suffix + "." + ext); }
    function enc(input, extra) {
        return FF + " -y " + input + " " + (isMp4 ? X264 : VP9) + " " + extra + (isMp4 ? " -c:a copy " + FAST : " -b:v 0") + " ";
    }

    var full = out("", "");
    var lines = [];
    lines.push(FF + " -y " + IN + " " + (isMp4 ? X264 : VP9) + " -crf 18 " + (isMp4 ? "" : "-b:v 0 ") + EVEN + " " + COLOR + (isMp4 ? " " + FAST : "") + " " + full);
    if (o.extra)
        lines.push(enc("-i " + full, SCALE + " -crf 18") + out("Sizes", SIZE));
    if (o.compressed) {
        lines.push(enc("-i " + full, "-crf " + CRF) + out("Compressed", COMP));
        if (o.extra)
            lines.push(enc("-i " + full, SCALE + " -crf " + CRF) + out("Sizes/Compressed", BOTH));
    }

    var L = [];
    L.push("#!/bin/sh");
    L.push("# generated by " + SCRIPT_NAME + " " + VERSION + " on " + new Date().toISOString());
    L.push("exec >" + LOG + " 2>&1");
    L.push("set -e");
    L.push("notify() { osascript -e 'display notification \"'\"$1\"'\" with title \"" + SCRIPT_NAME + "\"' >/dev/null 2>&1 || true; }");
    L.push("on_exit() { rc=$?; [ $rc -eq 0 ] || notify \"Encode FAILED for " + o.name + " (see encode log)\"; }");
    L.push("trap on_exit EXIT");
    L.push("cd " + shQuote(o.seqDir));
    L.push("COUNT=$(ls " + shQuote(o.seqDir) + "/" + shQuote(o.name) + ".*.png 2>/dev/null | wc -l | tr -d ' ')");
    L.push("echo \"frames found: $COUNT (expected " + o.expected + ")\"");
    L.push('[ "$COUNT" -gt 0 ] || { echo "no frames"; exit 1; }');
    for (var d in dirs) L.push("mkdir -p " + shQuote(d));
    L = L.concat(lines);
    L.push("notify \"" + o.name + "." + ext + " ready\"");
    L.push("open -R " + full + " || true");
    L.push("echo done");
    if (o.deleteSeq) {
        L.push("rm -f " + shQuote(o.seqDir) + "/" + shQuote(o.name) + ".*.png");
        L.push("cd " + shQuote(o.root) + " && rmdir " + shQuote(o.seqDir) + " 2>/dev/null || true");
    }
    return L.join("\n") + "\n";
}

function clearOldFrames(seqDir, name) {
    var files = listMatching(seqDir, new RegExp("/" + escapeRe(name) + "\\.\\d+\\.png$"));
    for (var i = 0; i < files.length; i++) api.deleteFilePath(files[i]);
    return files.length;
}

var pendingCheck = null;

function renderPngVideo(kind) {
    var comp = activeCompInfo();
    if (!comp) { fail("No active composition."); return; }
    log("--- " + kind.toUpperCase() + " for '" + comp.name + "' fps=" + comp.fps + " range=" + comp.playStart + "-" + comp.playEnd + " scale=" + prefs.resScale + "%");
    var ffmpeg = findFFmpeg();
    if (!ffmpeg) { fail("ffmpeg not found. Install it with Homebrew: brew install ffmpeg"); return; }
    var root = outputBase();
    if (!root) { fail("No output folder available."); return; }
    if (!ensureFolder(root)) { fail("Could not create folder: " + root); return; }

    var deleteSeq = deleteBox.getValue();
    var wd = workDir();
    var seqDir = deleteSeq ? wd + "/seq_" + fileToken(comp.name) : root + "/" + comp.name;
    if (!ensureFolder(seqDir)) { fail("Could not create folder: " + seqDir); return; }
    var removed = clearOldFrames(seqDir, comp.name);
    if (removed) log("removed " + removed + " old frame(s) from " + seqDir);

    var logFile = wd + "/" + fileToken(comp.name) + ".encode.log";
    if (api.filePathExists(logFile)) api.deleteFilePath(logFile);
    var script = buildEncodeScript({
        ffmpeg: ffmpeg, seqDir: seqDir, name: comp.name, fps: comp.fps, kind: kind,
        extra: extraBox.getValue(), extraWidth: prefs.extraWidth,
        compressed: compressedBox.getValue(), crf: prefs.crf,
        deleteSeq: deleteSeq, root: root, expected: (comp.playEnd - comp.playStart + 1), logFile: logFile
    });
    var encodeSh = writeScript(wd + "/" + fileToken(comp.name) + ".encode", script);
    if (!encodeSh) { fail("Could not write encode script in " + wd); return; }

    var item = findOrCreateItem(comp.id, SCRIPT_NAME + ": " + comp.name + " " + kind.toUpperCase());
    api.setGenerator(item, "generator", "renderPNG");
    api.set(item, {
        fileName: comp.name,
        filePath: seqDir,
        padding: 5,
        frameRangeMode: 1,          // Playback Start/End
        resolutionScale: resolutionScale(prefs.resScale)
    });
    try { api.set(item, { postRenderExpression: "api.runDetachedProcess('/bin/sh', [" + jsQuote(encodeSh) + "]);" }); }
    catch (e) { warn("could not set postRenderExpression: " + e); }
    try { api.set(item, { "generator.alpha": false }); } catch (e) {}
    dumpItem(item);

    log("Rendering PNG sequence to " + seqDir);
    api.render(item);

    var frames = listMatching(seqDir, new RegExp("/" + escapeRe(comp.name) + "\\.\\d+\\.png$")).length;
    if (!frames) { fail("Render produced no PNG frames in " + seqDir + " (check the Render Manager)."); return; }
    log(frames + " frames rendered. Encoding " + comp.name + "." + kind + " in the background (notification when ready).");

    if (pendingCheck) pendingCheck.stop();
    var checks = 0;
    var cb = { onTimeout: function () {
        checks++;
        if (api.filePathExists(logFile)) { pendingCheck.stop(); return; }
        if (checks >= 3) {
            pendingCheck.stop();
            warn("post-render hook did not start ffmpeg; launching the encode script directly.");
            api.runDetachedProcess("/bin/sh", [encodeSh]);
        }
    } };
    pendingCheck = new api.Timer(cb);
    pendingCheck.setInterval(1500);
    pendingCheck.setRepeating(true);
    pendingCheck.start();
}

// ---------------------------------------------------------------- UI
ui.setTitle(SCRIPT_NAME);
ui.setMinimumWidth(360);
ui.addMenuItem({ name: SCRIPT_NAME + " v" + VERSION, enabled: false });
ui.showContextMenuOnRightClick();

var FIELD_W = 64;
var LABEL_W = 230;

function makeButton(label, tip, fn) {
    var b = new ui.Button(label);
    b.setToolTip(tip);
    b.setMinimumHeight(28);
    b.onClick = function () { try { fn(); } catch (e) { fail(String(e)); } };
    return b;
}

function makeLabel(text, width) {
    var label = new ui.Label(text);
    label.setFontSize(13);
    label.setMinimumWidth(width || LABEL_W);   // wide enough that labels never wrap
    return label;
}

function prefCheckbox(key, tip) {
    var box = new ui.Checkbox(!!prefs[key]);
    box.onValueChanged = function () { prefs[key] = box.getValue(); savePrefs(); };
    if (tip) box.setToolTip(tip);
    return box;
}

function checkRow(key, text, tip) {
    var row = new ui.HLayout();
    row.setSpaceBetween(6);
    var box = prefCheckbox(key, tip);
    var label = makeLabel(text);
    if (tip) label.setToolTip(tip);
    row.add(box, label);
    row.addStretch();
    return { box: box, row: row };
}

// Option block:
//   line 1: [checkbox?] title ........ [value field]
//   line 2: [slider]
// Field and slider are kept in sync; value stored in prefs[key].
function optionBlock(opts) {
    // softMax limits only the slider. The numeric field and stored value stay unbounded.
    prefs[opts.key] = opts.softMax ? resolutionScale(prefs[opts.key]) : clamp(prefs[opts.key], opts.min, opts.max);
    var block = new ui.VLayout();
    block.setSpaceBetween(3);

    var line1 = new ui.HLayout();
    line1.setSpaceBetween(6);
    var box = null;
    if (opts.checkKey) { box = prefCheckbox(opts.checkKey, opts.tip); line1.add(box); }
    var title = makeLabel(opts.title + (opts.suffix ? " (" + opts.suffix + ")" : ""));
    if (opts.tip) title.setToolTip(opts.tip);
    var field = new ui.NumericField(prefs[opts.key]);
    field.setType(0);               // integer
    field.setMin(opts.min);
    if (!opts.softMax) field.setMax(opts.max);
    field.setFixedWidth(FIELD_W);
    line1.add(title);
    line1.addStretch();
    line1.add(field);

    var slider = new ui.Slider();
    slider.setRange(opts.min, opts.max);
    slider.setValue(clamp(prefs[opts.key], opts.min, opts.max));

    var syncing = false;
    function apply(v, fromSlider) {
        if (syncing) return;
        syncing = true;
        try {
            v = opts.softMax ? resolutionScale(v) : clamp(v, opts.min, opts.max);
            prefs[opts.key] = v;
            if (field.getValue() !== v) field.setValue(v);
            var sliderValue = clamp(v, opts.min, opts.max);
            if (slider.getValue() !== sliderValue) slider.setValue(sliderValue);
            savePrefs();
        } finally { syncing = false; }
    }
    slider.onValueChanged = function () { apply(slider.getValue(), true); };
    field.onValueChanged = function () { apply(field.getValue(), false); };

    block.add(line1, slider);
    return { box: box, slider: slider, field: field, block: block };
}

var root = new ui.VLayout();
root.setSpaceBetween(6);
root.setMargins(8, 8, 8, 8);

root.addSeparator("Images");
var imgRow = new ui.HLayout();
imgRow.add(makeButton("PNG",  "Render the current frame as PNG",  function () { renderImage("PNG"); }));
imgRow.add(makeButton("WEBP", "Render the current frame as WebP", function () { renderImage("WEBP"); }));
imgRow.add(makeButton("SVG",  "Render the current frame as SVG",  function () { renderImage("SVG"); }));
root.add(imgRow);

root.addSeparator("Video");
var nativeVidRow = new ui.HLayout();
nativeVidRow.add(makeButton("MP4", "Render the playback range with Cavalry's native MP4 exporter", function () { renderNativeVideo("mp4"); }));
nativeVidRow.add(makeButton("Quicktime (4444)", "Render the playback range as native QuickTime ProRes 4444", function () { renderNativeVideo("quicktime"); }));
nativeVidRow.add(makeButton("WEBM", "Render the playback range with Cavalry's native WebM exporter", function () { renderNativeVideo("webm"); }));
root.add(nativeVidRow);

root.addSeparator("PNG --> Video");
var vidRow = new ui.HLayout();
vidRow.add(makeButton("MP4",  "PNG sequence → H.264 MP4 (crf 18, bt709)", function () { renderPngVideo("mp4"); }));
vidRow.add(makeButton("WEBM", "PNG sequence → VP9 WebM (crf 18, bt709) into Web/", function () { renderPngVideo("webm"); }));
root.add(vidRow);
root.addSpacing(4);

var resOpt = optionBlock({ key: "resScale", min: 25, max: 200, softMax: true, title: "Resolution scale", suffix: "%",
    tip: "PNG sequence resolution scale. Drag from 25–200%; type a larger value for higher resolution." });
root.add(resOpt.block);
root.addSpacing(8);

var extraOpt = optionBlock({ checkKey: "extra", key: "extraWidth", min: 240, max: 2560, title: "Additional size", suffix: "px wide",
    tip: "Also encode a version of this width into Sizes/ (height follows the aspect ratio)" });
root.add(extraOpt.block);
root.addSpacing(8);

var crfOpt = optionBlock({ checkKey: "compressed", key: "crf", min: 18, max: 40, title: "Compressed", suffix: "CRF",
    tip: "Also encode compressed versions into Compressed/. 18 = highest quality, 40 = smallest file" });
root.add(crfOpt.block);
root.addSpacing(8);

var deleteOpt = checkRow("deleteSeq", "Delete PNG sequence when done", "Unchecked: keep the frames at <output>/<Comp>/");
root.add(deleteOpt.row);

root.addSeparator("Save");
var downloadsOpt = checkRow("saveToDownloads", "Save to Downloads", "Unchecked: save into the Project's Renders folder");
root.add(downloadsOpt.row);
var subRow = new ui.HLayout();
subRow.setSpaceBetween(6);
var subLabel = makeLabel("Subfolder", 70);
subLabel.setToolTip("Optional folder that everything is saved into, e.g. V1.0.0");
var subEdit = new ui.LineEdit();
subEdit.setPlaceholder("e.g. V1.0.0 (optional)");
subEdit.setText(prefs.subfolder || "");
subEdit.onValueChanged = function () { prefs.subfolder = subEdit.getText(); savePrefs(); };
subRow.add(subLabel, subEdit);
root.add(subRow);
root.addStretch();

var extraBox = extraOpt.box, compressedBox = crfOpt.box, deleteBox = deleteOpt.box, downloadsBox = downloadsOpt.box;

var container = new ui.Container();
container.setLayout(root);
ui.add(container);
ui.show();

log("v" + VERSION + " loaded.");
