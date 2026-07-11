import path from 'node:path';
import { createRequire } from 'node:module';
import {
  drawFaceOutline,
  importSTEP,
  makeFace,
  measureArea,
  setOC,
} from 'replicad';
import { DxfWriter, LWPolylineFlags, Units } from '@tarikjabiri/dxf';
import { ApiError } from './ApiError.js';

const require = createRequire(import.meta.url);
const opencascadePath = require.resolve('replicad-opencascadejs');
const opencascadeModule = require('replicad-opencascadejs');
const initOpenCascade = opencascadeModule.default ?? opencascadeModule;
const opencascadeDirectory = path.dirname(opencascadePath);

const CURVE_TOLERANCE_MM = 0.03;
const MAX_SUBDIVISION_DEPTH = 15;
const MAX_POINTS_PER_LOOP = 20000;

let openCascadePromise;
let conversionQueue = Promise.resolve();

export async function initializeStepConverter() {
  if (!openCascadePromise) {
    // The generated Emscripten loader still expects these CommonJS globals on Node 24.
    globalThis.__dirname ??= opencascadeDirectory;
    globalThis.require ??= createRequire(opencascadePath);
    openCascadePromise = initOpenCascade({
      locateFile: (filename) => path.join(opencascadeDirectory, filename),
    }).then((openCascade) => {
      setOC(openCascade);
      return openCascade;
    });
  }
  return openCascadePromise;
}

const pointToSegmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
};

function sampleCurve(curve) {
  const firstParameter = curve.firstParameter;
  const lastParameter = curve.lastParameter;
  const firstPoint = curve.value(firstParameter);
  const lastPoint = curve.value(lastParameter);
  const points = [firstPoint];

  const subdivide = (fromParameter, fromPoint, toParameter, toPoint, depth) => {
    const middleParameter = (fromParameter + toParameter) / 2;
    const quarterParameter = (fromParameter * 3 + toParameter) / 4;
    const threeQuarterParameter = (fromParameter + toParameter * 3) / 4;
    const middlePoint = curve.value(middleParameter);
    const quarterPoint = curve.value(quarterParameter);
    const threeQuarterPoint = curve.value(threeQuarterParameter);
    const error = Math.max(
      pointToSegmentDistance(middlePoint, fromPoint, toPoint),
      pointToSegmentDistance(quarterPoint, fromPoint, toPoint),
      pointToSegmentDistance(threeQuarterPoint, fromPoint, toPoint),
    );

    if (depth >= MAX_SUBDIVISION_DEPTH || error <= CURVE_TOLERANCE_MM) {
      points.push(toPoint);
      return;
    }
    subdivide(fromParameter, fromPoint, middleParameter, middlePoint, depth + 1);
    subdivide(middleParameter, middlePoint, toParameter, toPoint, depth + 1);
  };

  if (curve.geomType === 'LINE') points.push(lastPoint);
  else subdivide(firstParameter, firstPoint, lastParameter, lastPoint, 0);
  return points;
}

const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

function wireToPoints(wire) {
  const temporaryFace = makeFace(wire);
  try {
    const blueprint = drawFaceOutline(temporaryFace).blueprint;
    const points = [];
    for (const curve of blueprint.curves) {
      const sampled = sampleCurve(curve);
      if (points.length && samePoint(points.at(-1), sampled[0])) sampled.shift();
      points.push(...sampled);
      if (points.length > MAX_POINTS_PER_LOOP) {
        throw new ApiError(422, 'STEP 輪廓過於複雜，無法轉換成 DXF', 'STEP_DXF_TOO_COMPLEX');
      }
    }
    if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();
    return points;
  } finally {
    temporaryFace.delete();
  }
}

async function convertStepToDxf(stepBuffer) {
  await initializeStepConverter();
  const shape = await importSTEP(new Blob([stepBuffer], { type: 'application/step' }));
  try {
    const planarFaces = shape.faces
      .filter((face) => face.geomType === 'PLANE')
      .sort((a, b) => measureArea(b) - measureArea(a));
    const face = planarFaces[0];
    if (!face) {
      throw new ApiError(422, 'STEP 找不到可供加工的平面', 'STEP_DXF_NO_PLANAR_FACE');
    }

    // Replicad's wire accessors consume the Face wrapper, so use a clone per call.
    const wires = [face.clone().outerWire(), ...face.clone().innerWires()];
    let loops;
    try {
      loops = wires.map(wireToPoints).filter((points) => points.length >= 3);
    } finally {
      wires.forEach((wire) => wire.delete());
    }
    if (!loops.length) {
      throw new ApiError(422, 'STEP 找不到可輸出的封閉輪廓', 'STEP_DXF_NO_OUTLINE');
    }

    const writer = new DxfWriter();
    writer.setUnits(Units.Millimeters);
    for (const points of loops) {
      writer.addLWPolyline(
        points.map(([x, y]) => ({ point: { x, y } })),
        { flags: LWPolylineFlags.Closed },
      );
    }
    return Buffer.from(`${writer.stringify()}\n`, 'utf8');
  } finally {
    shape.delete();
  }
}

export function stepToDxf(stepBuffer) {
  const run = conversionQueue.then(
    () => convertStepToDxf(stepBuffer),
    () => convertStepToDxf(stepBuffer),
  );
  conversionQueue = run.catch(() => undefined);
  return run;
}

export function assertValidStep(stepBuffer) {
  const prefix = stepBuffer.subarray(0, Math.min(stepBuffer.length, 512)).toString('ascii');
  if (!prefix.includes('ISO-10303-21')) {
    throw new ApiError(502, 'Onshape 回傳的內容不是有效 STEP', 'ONSHAPE_STEP_INVALID');
  }
}
