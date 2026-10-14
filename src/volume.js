export const index = (x, y, z, n) => (z * n + y) * n + x;
export function phantom(n = 40) {
  if (![24, 32, 40, 48, 64].includes(n)) throw Error("Unsupported volume size");
  const data = new Float32Array(n ** 3);
  const ellipsoids = [
    [-0.2, 0.02, 0.43, 0.21, 0.23, 0.74],
    [0.29, 0.05, 0.46, 0.1, 0.12, 0.7],
    [-0.16, -0.01, -0.25, 0.3, 0.3, 0.19],
    [-0.15, 0.12, -0.48, 0.33, 0.4, 0.22],
    [-0.13, -0.38, -0.62, 0.34, 0.45, 0.13],
  ];
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const p = [x, y, z].map((v) => (2 * v) / (n - 1) - 1);
        let v = 0;
        for (const [a, b, c, rx, ry, rz] of ellipsoids) {
          const r =
            ((p[0] - a) / rx) ** 2 +
            ((p[1] - b) / ry) ** 2 +
            ((p[2] - c) / rz) ** 2;
          if (r <= 1) v = Math.max(v, r > 0.56 ? 1 : 0.32);
        }
        data[index(x, y, z, n)] = v;
      }
  return data;
}
export function project(volume, n, angles, onProgress = () => {}) {
  if (volume.length !== n ** 3) throw Error("Volume size mismatch");
  const views = angles.map((angle, k) => {
    const a = (angle * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a),
      data = new Float32Array(n * n);
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const v = volume[index(x, y, z, n)];
          if (!v) continue;
          const u = (x - (n - 1) / 2) * c + (y - (n - 1) / 2) * s + (n - 1) / 2,
            lo = Math.floor(u),
            t = u - lo;
          if (lo >= 0 && lo < n) data[z * n + lo] += v * (1 - t);
          if (lo + 1 >= 0 && lo + 1 < n) data[z * n + lo + 1] += v * t;
        }
    onProgress((k + 1) / angles.length);
    return { angle, data };
  });
  return views;
}
export function validateViews(views, n) {
  if (!Number.isInteger(n) || n < 16 || n > 64)
    throw Error("Grid must be 16–64");
  if (!Array.isArray(views) || views.length < 6 || views.length > 90)
    throw Error("Use 6–90 projections");
  const angles = new Set();
  for (const v of views) {
    if (
      !Number.isFinite(v.angle) ||
      v.angle < 0 ||
      v.angle >= 180 ||
      angles.has(v.angle)
    )
      throw Error("Angles must be unique in [0,180)");
    angles.add(v.angle);
    if (
      v.data.length !== n * n ||
      v.data.some((x) => !Number.isFinite(x) || x < 0)
    )
      throw Error("Invalid projection pixels");
  }
  return views;
}
export function reconstruct(views, n, onProgress = () => {}) {
  validateViews(views, n);
  const volume = new Float32Array(n ** 3),
    sorted = [...views].sort((a, b) => a.angle - b.angle);
  for (let k = 0; k < sorted.length; k++) {
    const { data, angle } = sorted[k],
      filtered = new Float32Array(n * n);
    for (let z = 0; z < n; z++)
      for (let u = 0; u < n; u++) {
        let sum = data[z * n + u] / 4;
        for (let j = 1; j < n; j += 2) {
          const w = -1 / (Math.PI * Math.PI * j * j);
          if (u - j >= 0) sum += w * data[z * n + u - j];
          if (u + j < n) sum += w * data[z * n + u + j];
        }
        filtered[z * n + u] = sum;
      }
    const a = (angle * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a),
      prev =
        sorted[(k + sorted.length - 1) % sorted.length].angle -
        (k === 0 ? 180 : 0),
      next =
        sorted[(k + 1) % sorted.length].angle +
        (k === sorted.length - 1 ? 180 : 0),
      weight = (((next - prev) / 2) * Math.PI) / 180;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = (x - (n - 1) / 2) * c + (y - (n - 1) / 2) * s + (n - 1) / 2,
            lo = Math.floor(u),
            t = u - lo;
          if (lo >= 0 && lo + 1 < n)
            volume[index(x, y, z, n)] +=
              weight *
              (filtered[z * n + lo] * (1 - t) + filtered[z * n + lo + 1] * t);
        }
    onProgress((k + 1) / sorted.length);
  }
  let max = 0;
  for (const v of volume) max = Math.max(max, v);
  if (max <= 0) throw Error("No reconstructable signal");
  for (let i = 0; i < volume.length; i++)
    volume[i] = Math.max(0, volume[i] / max);
  return volume;
}
export function slice(volume, n, plane, k) {
  k = Math.max(0, Math.min(n - 1, k));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[y * n + x] =
        plane === "Axial"
          ? volume[index(x, y, k, n)]
          : plane === "Coronal"
            ? volume[index(x, k, n - 1 - y, n)]
            : volume[index(k, x, n - 1 - y, n)];
  return out;
}
export function volumeStats(volume, n, threshold, spacing) {
  if (
    volume.length !== n ** 3 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold > 1 ||
    !Number.isFinite(spacing) ||
    spacing <= 0 ||
    spacing > 10
  )
    throw Error("Invalid volume settings");
  let occupied = 0,
    min = [n, n, n],
    max = [-1, -1, -1];
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (volume[index(x, y, z, n)] >= threshold) {
          occupied++;
          [x, y, z].forEach((v, i) => {
            min[i] = Math.min(min[i], v);
            max[i] = Math.max(max[i], v);
          });
        }
  return {
    occupied,
    volumeMM3: occupied * spacing ** 3,
    boundsMM: max.map((v, i) => (v < 0 ? 0 : (v - min[i] + 1) * spacing)),
    min,
    max,
  };
}
const faces = [
  [
    [1, 0, 0],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ],
  [
    [0, 1, 0],
    [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  [
    [0, -1, 0],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, 1],
    [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, -1],
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
];
export function voxelMesh(volume, n, threshold, spacing = 1) {
  volumeStats(volume, n, threshold, spacing);
  const positions = [],
    normals = [];
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (volume[index(x, y, z, n)] < threshold) continue;
        for (const [normal, corners] of faces) {
          const q = [x + normal[0], y + normal[1], z + normal[2]];
          if (
            q.every((v) => v >= 0 && v < n) &&
            volume[index(...q, n)] >= threshold
          )
            continue;
          for (const i of [0, 1, 2, 0, 2, 3]) {
            positions.push(
              (x + corners[i][0] - n / 2) * spacing,
              (y + corners[i][1] - n / 2) * spacing,
              (z + corners[i][2] - n / 2) * spacing,
            );
            normals.push(...normal);
          }
        }
      }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };
}
export function obj(mesh) {
  let s = "# X-Ray voxel surface, units mm\n";
  for (let i = 0; i < mesh.positions.length; i += 3)
    s += `v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]}\n`;
  for (let i = 0; i < mesh.positions.length / 3; i += 3)
    s += `f ${i + 1} ${i + 2} ${i + 3}\n`;
  return s;
}
export function stl(mesh) {
  let s = "solid xray\n";
  for (let i = 0; i < mesh.positions.length; i += 9) {
    s += `facet normal ${mesh.normals[i]} ${mesh.normals[i + 1]} ${mesh.normals[i + 2]}\nouter loop\n`;
    for (let j = 0; j < 9; j += 3)
      s += `vertex ${mesh.positions[i + j]} ${mesh.positions[i + j + 1]} ${mesh.positions[i + j + 2]}\n`;
    s += "endloop\nendfacet\n";
  }
  return s + "endsolid xray\n";
}
