const references = Object.values(
  import.meta.glob("../docs/reference/*.webp", {
    eager: true,
    query: "?url",
    import: "default",
  }),
);
import {
  phantom,
  project,
  slice,
  voxelMesh,
  volumeStats,
  obj,
  stl,
  validateViews,
} from "./volume.js";
import { createViewer } from "./viewer.js";
const $ = (s) => document.querySelector(s),
  esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const tabs = [
  "Dashboard",
  "X-Ray Import",
  "Calibration",
  "Segmentation",
  "Reconstruction",
  "Analysis",
  "Reports",
  "Settings",
];
const icons = ["⌂", "▱", "⊕", "◈", "⬡", "▥", "▤", "⚙"];
let n = 40,
  spacing = 0.75,
  threshold = 0.48,
  viewCount = 24,
  dataset = "Synthetic ankle-like phantom",
  source = "Synthetic phantom",
  volume = phantom(n),
  views = project(
    volume,
    n,
    Array.from({ length: viewCount }, (_, i) => (i * 180) / viewCount),
  ),
  page = "Dashboard",
  plane = "Axial",
  sliceIndex = 20,
  projectionIndex = 0,
  display = "mesh",
  section = false,
  cut = 0,
  measuring = false,
  viewer = null,
  mesh = null,
  busy = false,
  worker = null,
  progress = 0,
  seconds = 0,
  history = [],
  reports = [],
  studySearch = "";
try {
  const saved = JSON.parse(localStorage.getItem("xray-meta-v1"));
  if (
    saved &&
    Array.isArray(saved.history) &&
    saved.history.length <= 30 &&
    saved.history.every(
      (h) =>
        typeof h.name === "string" &&
        h.name.length < 100 &&
        typeof h.date === "string" &&
        Number.isFinite(h.volume) &&
        h.volume >= 0 &&
        Number.isInteger(h.views) &&
        h.views >= 6 &&
        h.views <= 90 &&
        Number.isFinite(h.seconds) &&
        h.seconds >= 0 &&
        ["Synthetic phantom", "Imported raster projections"].includes(h.source),
    )
  )
    history = saved.history;
  if (
    Array.isArray(saved?.reports) &&
    saved.reports.length <= 50 &&
    saved.reports.every(
      (r) =>
        typeof r.name === "string" &&
        r.name.length < 100 &&
        typeof r.date === "string",
    )
  )
    reports = saved.reports;
} catch {}
const card = (title, body, cls = "") =>
  `<section class="card ${cls}"><h3>${title}<span>•••</span></h3><div class="body">${body}</div></section>`;
const button = (title, action, cls = "") =>
  `<button data-action="${action}" class="${cls}">${title}</button>`;
const toast = (m) => {
  $("#toast").textContent = m;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 3800);
};
const stat = () => volumeStats(volume, n, threshold, spacing);
function meta() {
  try {
    localStorage.setItem("xray-meta-v1", JSON.stringify({ history, reports }));
  } catch {
    toast("Metadata could not be saved. Download a workspace backup.");
  }
}
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function metrics() {
  const s = stat();
  return `<div class="metrics">${[
    ["▱", "Projection views", views.length, "Parallel beam · 0–180°"],
    [
      "⬡",
      "Occupied volume",
      (s.volumeMM3 / 1000).toFixed(2) + " cm³",
      `${n} × ${n} × ${n} voxels`,
    ],
    [
      "◈",
      "Surface triangles",
      mesh ? mesh.positions.length / 9 : "—",
      "Exposed voxel faces",
    ],
    ["⊕", "Voxel spacing", spacing + " mm", "User supplied · isotropic"],
    [
      "◷",
      "Compute time",
      seconds ? seconds.toFixed(2) + " s" : "Not run",
      source,
    ],
  ]
    .map(
      ([icon, label, value, sub]) =>
        `<div class="metric"><span>${icon}</span><div><small>${label}</small><strong>${value}</strong><p>${sub}</p></div></div>`,
    )
    .join("")}</div>`;
}
function projections() {
  return `<div class="projection-grid">${Array.from({ length: 6 }, (_, i) => {
    const k = (projectionIndex + i) % views.length;
    return `<div><canvas class="projection" data-view="${k}" width="${n}" height="${n}"></canvas><span>${views[k].angle.toFixed(1)}°</span></div>`;
  }).join(
    "",
  )}</div><div class="toolbar"><button data-action="previous">‹</button><input id="projection" type="range" min="0" max="${views.length - 1}" value="${projectionIndex}" aria-label="Projection view"><span>View ${projectionIndex + 1} / ${views.length}</span><button data-action="next">›</button></div>`;
}
function viewport() {
  return `<div id="viewport"><div class="viewport-label">${esc(source)}<br><small>Drag to orbit · wheel to zoom</small></div></div><div class="toolbar"><label>Display <select id="display"><option value="mesh">Mesh surface</option><option value="points">Point cloud</option><option value="wireframe">Wireframe</option></select></label><label><input id="section" type="checkbox" ${section ? "checked" : ""}> Section</label><input id="cut" type="range" min="-1" max="1" step=".05" value="${cut}" aria-label="Section plane"><button data-action="measure" aria-pressed="${measuring}">Measure</button>${button("Reset view", "reset-view")}${button("PNG", "png")}</div><p id="measurement" class="muted">${measuring ? "Click two mesh surface points. Distances use the user-supplied voxel spacing." : "Mesh units follow your voxel spacing. This is not a calibrated medical model."}</p>`;
}
function slices() {
  return `<div class="toolbar tabs">${["Axial", "Coronal", "Sagittal"].map((v) => `<button data-plane="${v}" class="${plane === v ? "active" : ""}">${v}</button>`).join("")}</div><canvas id="slice-canvas" width="${n}" height="${n}" aria-label="${plane} volume slice"></canvas><div class="toolbar"><span id="slice-label">Slice ${sliceIndex + 1} / ${n}</span><input id="slice" aria-label="Slice index" type="range" min="0" max="${n - 1}" value="${sliceIndex}"></div>`;
}
function studyTable() {
  return `<div class="toolbar"><input id="study-search" placeholder="Search study history" aria-label="Search study history" value="${esc(studySearch)}"></div><div id="study-rows">${studyRows()}</div>`;
}
function studyRows() {
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Study</th><th>Views</th><th>Occupied volume</th><th>Processing</th><th>Source</th></tr></thead><tbody>${
    history
      .filter((h) => h.name.toLowerCase().includes(studySearch.toLowerCase()))
      .map(
        (h) =>
          `<tr><td>${esc(h.date)}</td><td>${esc(h.name)}</td><td>${h.views}</td><td>${h.volume.toFixed(2)} cm³</td><td>${Number(h.seconds).toFixed(2)} s</td><td>${esc(h.source)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6">Run a reconstruction to create a study record.</td></tr>'
  }</tbody></table></div>`;
}
function dashboard() {
  return `${metrics()}<div class="columns dominant">${card("Projection Views (parallel-beam input)", projections())}${card("3D Reconstruction · Surface Preview", viewport())}</div><div class="columns three">${card("Cross-sectional Preview", slices())}${card("Dimensional summary", dimensionTable())}${card("Workspace pipeline", `<div class="pipeline-list"><p><i>✓</i> ${views.length} projections available</p><p><i>✓</i> ${n}³ volume initialized</p><p><i>✓</i> Threshold surface generated</p><p><i>→</i> Reconstruct to evaluate input views</p></div>${button("Open reconstruction →", "open-reconstruction", "primary")}<p class="notice">The initial model is a generated synthetic volume. It is not reconstructed from the reference screenshots.</p>`)}</div>${card("Recent Studies / Scan Sessions", studyTable())}`;
}
function imports() {
  return `${metrics()}<div class="columns"><div>${card("Import X-ray Projections", `<div class="drop" id="drop"><span>☁</span><h2>Drop projection images here</h2><p>PNG, JPEG, WebP · 6–90 views<br>Detector columns × axial rows</p>${button("Browse Files", "upload", "primary")}</div><p class="muted">Images are resampled to ${n} × ${n}. Angles are assigned evenly over 180° in filename order and can be edited below. Imported pixels are treated as line integrals; no DICOM or CT metadata is read.</p>`)}${card("Dataset Metadata", `<label>Dataset name<input id="dataset-name" value="${esc(dataset)}" maxlength="80"></label><p>Source: ${esc(source)}</p><p>Grid: ${n}³ · ${views.length} views</p>${button("Load synthetic sample", "sample")}`)}</div>${card("Imported Projections", `<div class="import-grid">${views.map((v, i) => `<div><canvas class="projection" data-view="${i}" width="${n}" height="${n}"></canvas><label>Angle ° <input data-angle="${i}" type="number" min="0" max="179.99" step=".01" value="${v.angle.toFixed(2)}" aria-label="Projection ${i + 1} angle"></label></div>`).join("")}</div>`)}</div>`;
}
function dimensionTable() {
  const s = stat();
  return `<table><thead><tr><th>Measurement</th><th>Value</th></tr></thead><tbody>${s.boundsMM.map((v, i) => `<tr><td>${["X", "Y", "Z"][i]} occupied extent</td><td>${v.toFixed(2)} mm</td></tr>`).join("")}<tr><td>Occupied voxels</td><td>${s.occupied.toLocaleString()}</td></tr><tr><td>Voxel volume estimate</td><td>${(s.volumeMM3 / 1000).toFixed(3)} cm³</td></tr><tr><td>Threshold</td><td>${threshold.toFixed(2)}</td></tr></tbody></table><p class="muted">Axis-aligned bounds and voxel occupancy, not anatomical measurements or validated accuracy.</p>`;
}
function calibration() {
  return `<div class="columns">${card("Voxel scale & acquisition assumptions", `<p>Set the isotropic voxel spacing supplied by your acquisition setup. This prototype does not automatically estimate geometry or detect calibration markers.</p><label>Voxel spacing (mm)<input id="spacing" type="number" min=".01" max="10" step=".01" value="${spacing}"></label><p class="notice">Only parallel-beam projections with a shared rotation axis are supported. Cone-beam images require a different geometry model.</p><h4>Coordinate system</h4><p>X/Y: reconstruction plane. Z: axial row / slice. Projection angles rotate around Z.</p>`)}${card("Current scale analysis", dimensionTable())}</div>`;
}
function segmentation() {
  return `<div class="columns"><div>${card("Segmentation Result · Intensity Threshold", `<canvas id="segmentation" width="${n}" height="${n}"></canvas><div class="toolbar"><label>Threshold <input id="threshold" type="range" min=".05" max=".95" step=".01" value="${threshold}"><span id="threshold-value">${threshold}</span></label></div><p class="muted">A global intensity mask, not automated bone recognition.</p>`)}${card("Volume slice", slices())}</div><div>${card("Processing Pipeline", `<div class="pipeline-grid">${["Original", "Threshold", "Edges"].map((v) => `<div><canvas class="filter-preview" data-filter="${v}" width="${n}" height="${n}"></canvas><p>${v}</p></div>`).join("")}</div><p>Sobel edges and thresholding operate on the selected reconstructed slice. No landmark detector or segmentation confidence is fabricated.</p>`)}${card("Mask statistics", dimensionTable())}${card("Next step", `${button("Inspect mesh surface", "open-reconstruction", "primary")}<p>Adjusting the threshold regenerates the exposed-voxel surface and updates bounds and occupied volume.</p>`)}</div></div>`;
}
function reconstruction() {
  return `${metrics()}<div class="reconstruction-layout"><div>${card("Slice Stack (current volume)", slices())}${card("Input Projection", `<canvas class="projection large" data-view="${projectionIndex}" width="${n}" height="${n}"></canvas>`)}</div>${card("3D Reconstruction (Mesh + Point Cloud)", viewport())}<div>${card("Reconstruction Parameters", `<label>Method<select disabled><option>Filtered backprojection (Ram-Lak)</option></select></label><label>Sample grid<select id="grid">${[24, 32, 40, 48, 64].map((v) => `<option ${v === n ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Synthetic projection count<input id="view-count" type="number" min="6" max="90" value="${viewCount}"></label><label>Voxel size (mm)<input id="spacing" type="number" min=".01" max="10" step=".01" value="${spacing}"></label><label>Surface threshold<input id="threshold" type="range" min=".05" max=".95" step=".01" value="${threshold}"><span id="threshold-value">${threshold}</span></label><div class="stack">${button("▶ Reconstruct current views", "reconstruct", "primary")}${button("Generate & reconstruct phantom", "phantom")}${button("Cancel job", "cancel")}</div><div id="progress-state" aria-live="polite">${busy ? "Computing…" : "Ready"}</div><progress id="progress" max="1" value="${progress}"></progress><p class="muted">CPU Web Worker · grid 16–64³ · 6–90 views. Cancelling keeps the previous volume.</p>`)}${card("Export surface", `<div class="stack">${button("Export STL", "stl")}${button("Export OBJ", "obj")}${button("Download volume JSON", "backup")}</div>`)}</div></div>${card("Reconstruction jobs", studyTable())}`;
}
function analysis() {
  return `<div class="columns dominant">${card("3D Surface & Measurements", viewport())}${card("Dimensional Analysis", dimensionTable())}</div><div class="columns">${card("Cross-sectional Preview", slices())}${card("Study History", studyTable())}</div>`;
}
function report() {
  return `<div class="columns dominant"><div class="report">${card("Reconstruction Report", `<div class="report-title">⬡ XRay 3D Reconstruction System</div><h2>${esc(dataset)}</h2><p>${esc(source)} · ${new Date().toLocaleString()}</p>${dimensionTable()}<p>Input projections: ${views.length}<br>Grid: ${n} × ${n} × ${n}<br>Spacing: ${spacing} mm<br>Surface triangles: ${mesh.positions.length / 9}<br>Processing time: ${seconds.toFixed(2)} s</p><p class="notice">Research demonstration. No anatomical or diagnostic validation, reference error, or clinical accuracy is available.</p>`)}</div><div>${card("Report Actions", `<div class="stack">${button("Generate report record", "report", "primary")}${button("Print / Save as PDF", "print")}${button("CSV Export", "csv")}${button("JSON Report", "report-json")}${button("Export STL", "stl")}</div>`)}${card("Recent Reports", reports.map((r) => `<p class="history-entry"><b>${esc(r.name)}</b><br>${esc(r.date)}</p>`).join("") || "<p>No reports generated yet.</p>")}</div></div>`;
}
function settings() {
  return `${card("Workspace Controls", `<div class="stack">${button("Download complete workspace JSON", "backup")}${button("Restore workspace JSON", "restore")}${button("Reset to synthetic sample", "sample")}</div><p>Only report and job metadata persist automatically in this browser. Volume and projections are session data; use a JSON backup to preserve them.</p><p>There is no server upload, authentication, cloud storage, DICOM reader, trained model, CUDA processing, or clinical validation. Use synthetic or de-identified inputs.</p>`)}${card("Supplied Design References", `<p>Visual targets provided with this project. The numbers and reconstructed anatomy in these images are illustrative and are not generated by this application.</p><div class="reference-grid">${[1, 2, 3, 4, 5].map((i) => `<a href="${references[i - 1]}" target="_blank" rel="noopener"><img src="${references[i - 1]}" alt="Design reference ${i}" loading="lazy"></a>`).join("")}</div>`)}`;
}
function render() {
  viewer?.dispose();
  mesh = voxelMesh(volume, n, threshold, spacing);
  $("#app").innerHTML =
    `<header><div class="logo">⬡</div><b>XRay 3D Reconstruction System</b><span class="header-note">LOCAL RESEARCH WORKSPACE</span><span class="status">● ${busy ? "Computing" : "Ready"}</span></header><nav>${tabs.map((v, i) => `<button data-page="${v}" class="${page === v ? "active" : ""}"><span>${icons[i]}</span>${v}</button>`).join("")}<div class="nav-footer"><i></i> Browser engine<br><small>CPU reconstruction · WebGL view</small></div></nav><main><div class="heading"><div><h1>${page === "Dashboard" ? "Reconstruction Dashboard" : page}</h1><p>${esc(dataset)} <span class="pill">${source === "Synthetic phantom" ? "SYNTHETIC DATA" : "IMPORTED PROJECTIONS"}</span></p></div><div class="toolbar">${button("Import Projections", "open-import")}${button("Export Results", "stl", "primary")}</div></div>${{ Dashboard: dashboard, "X-Ray Import": imports, Calibration: calibration, Segmentation: segmentation, Reconstruction: reconstruction, Analysis: analysis, Reports: report, Settings: settings }[page]()}</main>`;
  if ($("#viewport")) {
    viewer = createViewer(
      $("#viewport"),
      mesh,
      { size: n * spacing, mode: display, section, cut, measure: measuring },
      (d) => {
        $("#measurement").textContent =
          `Surface distance: ${d.toFixed(2)} mm · based on user spacing`;
      },
    );
    $("#display").value = display;
  }
  drawCanvases();
  applyBusy();
}
function drawPixels(canvas, data, { mask = false, edges = false } = {}) {
  const ctx = canvas.getContext("2d"),
    pixels = ctx.createImageData(n, n);
  let max = 0;
  for (const v of data) max = Math.max(max, v);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = data[i] / (max || 1);
      if (edges) {
        const at = (xx, yy) =>
          data[
            Math.max(0, Math.min(n - 1, yy)) * n +
              Math.max(0, Math.min(n - 1, xx))
          ];
        v = Math.min(
          1,
          Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1)) *
            2,
        );
      }
      if (mask) v = data[i] >= threshold ? 1 : 0;
      for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = v * 255;
      pixels.data[i * 4 + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
}
function drawCanvases() {
  document
    .querySelectorAll("canvas.projection")
    .forEach((c) => drawPixels(c, views[Number(c.dataset.view)].data));
  const data = slice(volume, n, plane, sliceIndex);
  if ($("#slice-canvas")) drawPixels($("#slice-canvas"), data);
  if ($("#segmentation")) drawPixels($("#segmentation"), data, { mask: true });
  document.querySelectorAll(".filter-preview").forEach((c) =>
    drawPixels(c, data, {
      mask: c.dataset.filter === "Threshold",
      edges: c.dataset.filter === "Edges",
    }),
  );
}
function applyBusy() {
  document
    .querySelectorAll("main input,main select,main button")
    .forEach((b) => {
      if (b.dataset.action !== "cancel") b.disabled = busy;
    });
  if ($("#progress")) $("#progress").value = progress;
}
function run(kind) {
  if (busy) return;
  busy = true;
  progress = 0;
  applyBusy();
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e) => {
    if (e.data.error) {
      stopJob();
      toast(e.data.error);
      return;
    }
    if (e.data.done) {
      volume = e.data.volume;
      views = e.data.views;
      seconds = e.data.seconds;
      source = kind === "phantom" ? "Synthetic phantom" : source;
      if (kind === "phantom") dataset = "Synthetic ankle-like phantom";
      projectionIndex = 0;
      const s = stat();
      history.unshift({
        name: dataset,
        date: new Date().toISOString(),
        views: views.length,
        volume: s.volumeMM3 / 1000,
        seconds,
        source,
      });
      history = history.slice(0, 30);
      meta();
      stopJob();
      render();
      toast("Reconstruction completed");
    } else {
      progress = e.data.progress;
      if ($("#progress")) $("#progress").value = progress;
      if ($("#progress-state"))
        $("#progress-state").textContent =
          `${e.data.phase} · ${(progress * 100).toFixed(0)}%`;
    }
  };
  worker.onerror = (e) => {
    stopJob();
    toast("Reconstruction worker failed: " + e.message);
  };
  worker.postMessage({
    kind,
    n,
    count: viewCount,
    views: kind === "phantom" ? null : views,
  });
}
function stopJob() {
  worker?.terminate();
  worker = null;
  busy = false;
  applyBusy();
  if ($("#progress-state")) $("#progress-state").textContent = "Ready";
}
function reportData() {
  return {
    dataset,
    source,
    date: new Date().toISOString(),
    grid: n,
    spacingMM: spacing,
    threshold,
    projections: views.length,
    triangles: mesh.positions.length / 9,
    seconds,
    ...stat(),
    clinicalValidation: false,
  };
}
const actions = {
  "open-import": () => {
    page = "X-Ray Import";
    render();
  },
  "open-reconstruction": () => {
    page = "Reconstruction";
    render();
  },
  upload: () => $("#upload").click(),
  reconstruct: () => run("current"),
  phantom: () => run("phantom"),
  cancel: () => {
    stopJob();
    toast("Job cancelled; previous volume retained");
  },
  sample: () => {
    if (!confirm("Replace the active dataset with the synthetic sample?"))
      return;
    n = 40;
    sliceIndex = 20;
    volume = phantom(n);
    viewCount = 24;
    views = project(
      volume,
      n,
      Array.from({ length: 24 }, (_, i) => i * 7.5),
    );
    source = "Synthetic phantom";
    dataset = "Synthetic ankle-like phantom";
    projectionIndex = 0;
    seconds = 0;
    render();
  },
  previous: () => {
    projectionIndex = (projectionIndex + views.length - 1) % views.length;
    render();
  },
  next: () => {
    projectionIndex = (projectionIndex + 1) % views.length;
    render();
  },
  "reset-view": () => viewer?.reset(),
  measure: () => {
    measuring = !measuring;
    viewer?.update({ measure: measuring });
    $("[data-action=measure]").setAttribute("aria-pressed", measuring);
    $("#measurement").textContent = measuring
      ? "Click two surface points."
      : "Measurement off.";
  },
  png: () => {
    const url = viewer?.png();
    if (!url) return toast("WebGL screenshot unavailable");
    const a = document.createElement("a");
    a.href = url;
    a.download = "xray-viewport.png";
    a.click();
  },
  stl: () => download("xray-surface.stl", stl(mesh), "model/stl"),
  obj: () => download("xray-surface.obj", obj(mesh), "text/plain"),
  backup: () =>
    download(
      "xray-workspace.json",
      JSON.stringify({
        version: 1,
        n,
        spacing,
        threshold,
        dataset,
        source,
        volume: Array.from(volume),
        views: views.map((v) => ({ angle: v.angle, data: Array.from(v.data) })),
      }),
    ),
  restore: () => $("#backup-input").click(),
  report: () => {
    reports.unshift({ name: dataset, date: new Date().toISOString() });
    reports = reports.slice(0, 50);
    meta();
    render();
    toast("Report record generated");
  },
  print: () => window.print(),
  "report-json": () =>
    download("xray-report.json", JSON.stringify(reportData(), null, 2)),
  csv: () => {
    const r = reportData();
    const rows = [
      ["Metric", "Value"],
      ["Dataset", r.dataset],
      ["Source", r.source],
      ["Occupied volume mm3", r.volumeMM3],
      ["X extent mm", r.boundsMM[0]],
      ["Y extent mm", r.boundsMM[1]],
      ["Z extent mm", r.boundsMM[2]],
      ["Triangles", r.triangles],
    ];
    download(
      "xray-measurements.csv",
      rows
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@-]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n"),
      "text/csv",
    );
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.page) {
      page = b.dataset.page;
      render();
    } else if (b.dataset.plane) {
      plane = b.dataset.plane;
      render();
    } else if (b.dataset.action) actions[b.dataset.action]?.();
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  try {
    if (t.id === "display") {
      display = t.value;
      viewer?.update({ mode: display });
    }
    if (t.id === "section") {
      section = t.checked;
      viewer?.update({ section });
    }
    if (t.id === "spacing") {
      const v = Number(t.value);
      if (v < 0.01 || v > 10 || !Number.isFinite(v))
        throw Error("Spacing must be 0.01–10 mm");
      spacing = v;
      render();
    }
    if (t.id === "view-count") {
      const v = Number(t.value);
      if (!Number.isInteger(v) || v < 6 || v > 90)
        throw Error("Use 6–90 views");
      viewCount = v;
    }
    if (t.id === "grid") {
      if (source !== "Synthetic phantom")
        throw Error("Reload a synthetic sample before changing grid size");
      n = Number(t.value);
      sliceIndex = Math.floor(n / 2);
      volume = phantom(n);
      seconds = 0;
      views = project(
        volume,
        n,
        Array.from({ length: viewCount }, (_, i) => (i * 180) / viewCount),
      );
      render();
    }
    if (t.id === "dataset-name") {
      if (!t.value.trim()) throw Error("Dataset name is required");
      dataset = t.value.trim();
      render();
    }
    if (t.dataset.angle) {
      const i = Number(t.dataset.angle),
        next = views.map((v, k) => ({
          ...v,
          angle: i === k ? Number(t.value) : v.angle,
        }));
      validateViews(next, n);
      views = next;
    }
  } catch (err) {
    toast(err.message);
    render();
  }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "slice") {
    sliceIndex = Number(t.value);
    $("#slice-label").textContent = `Slice ${sliceIndex + 1} / ${n}`;
    drawCanvases();
  }
  if (t.id === "cut") {
    cut = Number(t.value);
    viewer?.update({ cut });
  }
  if (t.id === "projection") {
    projectionIndex = Number(t.value);
    render();
  }
  if (t.id === "threshold") {
    threshold = Number(t.value);
    $("#threshold-value").textContent = threshold;
    drawCanvases();
  }
  if (t.id === "study-search") {
    studySearch = t.value;
    $("#study-rows").innerHTML = studyRows();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "threshold") render();
});
async function importFiles(files) {
  if (busy) return;
  if (files.length < 6 || files.length > 90)
    return toast("Import 6–90 parallel-beam projection images");
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  busy = true;
  applyBusy();
  try {
    const input = [];
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 10 * 1024 * 1024
      )
        throw Error("Images must be PNG/JPEG/WebP up to 10 MB each");
      const img = await createImageBitmap(f);
      if (img.width * img.height > 24000000) {
        img.close();
        throw Error("Image exceeds 24 megapixels");
      }
      const c = document.createElement("canvas");
      c.width = c.height = n;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, n, n);
      img.close();
      const pixels = ctx.getImageData(0, 0, n, n).data,
        data = new Float32Array(n * n);
      for (let j = 0; j < data.length; j++)
        data[(n - 1 - Math.floor(j / n)) * n + (j % n)] =
          (0.299 * pixels[j * 4] +
            0.587 * pixels[j * 4 + 1] +
            0.114 * pixels[j * 4 + 2]) /
          255;
      input.push({ angle: (i * 180) / sorted.length, data });
    }
    validateViews(input, n);
    views = input;
    volume = new Float32Array(n ** 3);
    source = "Imported raster projections";
    dataset = "Imported projection dataset";
    projectionIndex = 0;
    seconds = 0;
    toast("Projections imported. Review angles, then reconstruct.");
  } catch (err) {
    toast("Import rejected: " + err.message);
  } finally {
    busy = false;
    render();
  }
}
$("#upload").onchange = (e) => {
  importFiles(e.target.files);
  e.target.value = "";
};
document.addEventListener("dragover", (e) => {
  if (e.target.closest("#drop")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (e.target.closest("#drop")) {
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  }
});
$("#backup-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || busy) return;
  try {
    if (file.size > 16000000) throw Error("Backup exceeds 16 MB");
    const b = JSON.parse(await file.text());
    if (
      b.version !== 1 ||
      !Number.isInteger(b.n) ||
      b.n < 16 ||
      b.n > 64 ||
      typeof b.dataset !== "string" ||
      !b.dataset.trim() ||
      b.dataset.length > 80 ||
      !["Synthetic phantom", "Imported raster projections"].includes(
        b.source,
      ) ||
      !Array.isArray(b.volume) ||
      b.volume.length !== b.n ** 3 ||
      b.volume.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
      !Array.isArray(b.views)
    )
      throw Error("Invalid workspace");
    validateViews(b.views, b.n);
    volumeStats(b.volume, b.n, b.threshold, b.spacing);
    n = b.n;
    volume = Float32Array.from(b.volume);
    views = b.views.map((v) => ({
      angle: v.angle,
      data: Float32Array.from(v.data),
    }));
    spacing = b.spacing;
    threshold = b.threshold;
    dataset = b.dataset;
    source = b.source;
    sliceIndex = Math.floor(n / 2);
    projectionIndex = 0;
    seconds = 0;
    render();
    toast("Workspace restored");
  } catch (err) {
    toast("Restore rejected: " + err.message);
  }
};
window.addEventListener("beforeunload", () => {
  viewer?.dispose();
  worker?.terminate();
});
render();
window.xrayDiagnostics = () => ({
  n,
  projections: views.length,
  source,
  triangles: mesh.positions.length / 9,
  busy,
  history: history.length,
  reports: reports.length,
  threshold,
  spacing,
});
