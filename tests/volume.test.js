import test from "node:test";
import assert from "node:assert/strict";
import {
  index,
  phantom,
  project,
  reconstruct,
  slice,
  voxelMesh,
  volumeStats,
  validateViews,
  obj,
  stl,
} from "../src/volume.js";
test("synthetic phantom is finite, bounded and occupies a minority of volume", () => {
  const v = phantom(24),
    s = volumeStats(v, 24, 0.5, 1);
  assert.ok(s.occupied > 300 && s.occupied < 24 ** 3 / 2);
  assert.ok(v.every((x) => x >= 0 && x <= 1));
  assert.throws(() => phantom(500));
});
test("forward projection at 0 and 90 degrees conserves central voxel signal", () => {
  const n = 16,
    v = new Float32Array(n ** 3);
  v[index(8, 8, 8, n)] = 1;
  const p = project(v, n, [0, 90]);
  for (const q of p)
    assert.ok(Math.abs(q.data.reduce((a, b) => a + b, 0) - 1) < 1e-6);
});
test("filtered backprojection recovers synthetic object with positive correlation", () => {
  const n = 24,
    v = phantom(n),
    angles = Array.from({ length: 36 }, (_, i) => i * 5),
    views = project(v, n, angles),
    out = reconstruct(views, n);
  assert.equal(out.length, v.length);
  assert.ok(out.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length,
    a = mean(v),
    b = mean(out);
  let covariance = 0,
    aa = 0,
    bb = 0;
  v.forEach((x, i) => {
    covariance += (x - a) * (out[i] - b);
    aa += (x - a) ** 2;
    bb += (out[i] - b) ** 2;
  });
  assert.ok(covariance / Math.sqrt(aa * bb) > 0.8);
});
test("reconstruction validates angles, signal, dimensions and nonfinite pixels", () => {
  const n = 16,
    views = Array.from({ length: 6 }, (_, i) => ({
      angle: i * 30,
      data: new Float32Array(n * n),
    }));
  assert.throws(() => reconstruct(views, n), /signal/);
  views[1].angle = 0;
  assert.throws(() => validateViews(views, n), /unique/);
  views[1].angle = 30;
  views[0].data[0] = NaN;
  assert.throws(() => validateViews(views, n), /pixels/);
  assert.throws(() => validateViews([], n));
});
test("slice orientations select correct voxel coordinates", () => {
  const n = 16,
    v = new Float32Array(n ** 3);
  v[index(2, 3, 4, n)] = 1;
  assert.equal(slice(v, n, "Axial", 4)[3 * n + 2], 1);
  assert.equal(slice(v, n, "Coronal", 3)[(n - 1 - 4) * n + 2], 1);
  assert.equal(slice(v, n, "Sagittal", 2)[(n - 1 - 4) * n + 3], 1);
});
test("single voxel mesh has 12 outward triangles and calibrated bounds", () => {
  const n = 16,
    v = new Float32Array(n ** 3);
  v[index(8, 8, 8, n)] = 1;
  const m = voxelMesh(v, n, 0.5, 2);
  assert.equal(m.positions.length / 9, 12);
  const s = volumeStats(v, n, 0.5, 2);
  assert.equal(s.volumeMM3, 8);
  assert.deepEqual(s.boundsMM, [2, 2, 2]);
  for (let i = 0; i < m.positions.length; i += 9) {
    const p = m.positions,
      a = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]],
      b = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]],
      c = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    assert.ok(c.reduce((s, x, j) => s + x * m.normals[i + j], 0) > 0);
  }
});
test("adjacent voxels share no internal surface and exports contain triangles", () => {
  const n = 16,
    v = new Float32Array(n ** 3);
  v[index(8, 8, 8, n)] = v[index(9, 8, 8, n)] = 1;
  const m = voxelMesh(v, n, 0.5);
  assert.equal(m.positions.length / 9, 20);
  assert.equal((obj(m).match(/^f /gm) || []).length, 20);
  assert.equal((stl(m).match(/facet normal/g) || []).length, 20);
});
test("threshold and spacing change physical estimates predictably", () => {
  const n = 16,
    v = new Float32Array(n ** 3);
  v[0] = 0.25;
  v[1] = 0.75;
  assert.equal(volumeStats(v, n, 0.5, 1).occupied, 1);
  assert.equal(volumeStats(v, n, 0.2, 2).volumeMM3, 16);
  assert.throws(() => volumeStats(v, n, 0.5, 0));
  assert.deepEqual(
    volumeStats(new Float32Array(n ** 3), n, 0.5, 1).boundsMM,
    [0, 0, 0],
  );
});
