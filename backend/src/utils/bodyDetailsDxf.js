import { ApiError } from './ApiError.js';

const MM_PER_METER = 1000;
const EPSILON = 1e-9;

const vector = (value = {}) => [Number(value.x ?? 0), Number(value.y ?? 0), Number(value.z ?? 0)];
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scale = (value, amount) => value.map((component) => component * amount);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (value) => Math.sqrt(dot(value, value));
const normalize = (value) => {
  const magnitude = length(value);
  return magnitude < EPSILON ? null : scale(value, 1 / magnitude);
};

const number = (value) => {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  return Number(rounded.toFixed(8)).toString();
};
const dxfEntity = (pairs) => pairs.flatMap(([code, value]) => [String(code), String(value)]).join('\n');

const planarFace = (body) =>
  (body?.faces ?? [])
    .filter((face) => face?.surface?.type === 'PLANE' || String(face?.surface?.btType ?? '').includes('Plane'))
    .sort((a, b) => Number(b.area ?? 0) - Number(a.area ?? 0))[0];

function faceBasis(face, edges) {
  const normal = normalize(vector(face.surface.normal));
  if (!normal) throw new ApiError(502, 'Onshape 平面缺少有效法向量', 'ONSHAPE_DXF_BAD_PLANE');
  const candidate = edges
    .map((edge) => {
      const direction = subtract(vector(edge?.geometry?.endPoint), vector(edge?.geometry?.startPoint));
      return subtract(direction, scale(normal, dot(direction, normal)));
    })
    .find((direction) => length(direction) > EPSILON);
  const fallbackAxis = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const xAxis = normalize(candidate ?? cross(fallbackAxis, normal));
  const yAxis = normalize(cross(normal, xAxis));
  if (!xAxis || !yAxis) throw new ApiError(502, '無法建立 DXF 平面座標', 'ONSHAPE_DXF_BAD_PLANE');
  return { origin: vector(face.surface.origin), xAxis, yAxis };
}

const projector = ({ origin, xAxis, yAxis }) => (point) => {
  const relative = subtract(vector(point), origin);
  return [dot(relative, xAxis) * MM_PER_METER, dot(relative, yAxis) * MM_PER_METER];
};
const angleDegrees = ([x, y]) => {
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  return angle < 0 ? angle + 360 : angle;
};

function lineEntity(edge, project) {
  const start = project(edge.geometry.startPoint);
  const end = project(edge.geometry.endPoint);
  return dxfEntity([
    [0, 'LINE'], [8, 0], [10, number(start[0])], [20, number(start[1])], [30, 0],
    [11, number(end[0])], [21, number(end[1])], [31, 0],
  ]);
}

function circleEntity(edge, coedge, project) {
  const center = project(edge.curve.origin);
  const radius = Number(edge.curve.radius) * MM_PER_METER;
  const geometry = edge.geometry ?? {};
  const start = project(geometry.startPoint);
  const end = project(geometry.endPoint);
  const sweep = Math.abs(Number(geometry.arcSweep ?? 0));
  const isFullCircle = edge.vertices?.length === 0 || sweep >= Math.PI * 2 - 1e-7 || length(subtract(start, end)) < 1e-7;
  if (isFullCircle) {
    return dxfEntity([
      [0, 'CIRCLE'], [8, 0], [10, number(center[0])], [20, number(center[1])], [30, 0], [40, number(radius)],
    ]);
  }

  let from = start;
  let to = end;
  let clockwise = Boolean(geometry.arcIsClockwise);
  if (coedge.orientation === false) {
    [from, to] = [to, from];
    clockwise = !clockwise;
  }
  if (clockwise) [from, to] = [to, from];
  return dxfEntity([
    [0, 'ARC'], [8, 0], [10, number(center[0])], [20, number(center[1])], [30, 0], [40, number(radius)],
    [50, number(angleDegrees(subtract(from, center)))], [51, number(angleDegrees(subtract(to, center)))],
  ]);
}

function edgeEntity(edge, coedge, project) {
  const type = edge?.curve?.type;
  if (type === 'LINE') return lineEntity(edge, project);
  if (type === 'CIRCLE') return circleEntity(edge, coedge, project);
  throw new ApiError(422, `此零件包含尚未支援的 DXF 曲線：${type || 'UNKNOWN'}`, 'ONSHAPE_DXF_UNSUPPORTED_CURVE', {
    edgeId: edge?.id,
    curveType: type || 'UNKNOWN',
  });
}

export function bodyDetailsToDxf(data) {
  const body = data?.bodies?.[0];
  if (!body) throw new ApiError(502, 'Onshape 沒有回傳零件幾何', 'ONSHAPE_DXF_NO_BODY');
  const face = planarFace(body);
  if (!face) throw new ApiError(422, '此零件找不到可匯出的平面', 'ONSHAPE_DXF_NO_PLANAR_FACE');

  const edgeMap = new Map((body.edges ?? []).map((edge) => [edge.id, edge]));
  const coedges = (face.loops ?? []).flatMap((loop) => loop.coedges ?? []);
  const faceEdges = coedges.map((coedge) => edgeMap.get(coedge.edgeId)).filter(Boolean);
  const project = projector(faceBasis(face, faceEdges));
  const entities = coedges.map((coedge) => {
    const edge = edgeMap.get(coedge.edgeId);
    if (!edge) throw new ApiError(502, 'Onshape 平面邊線資料不完整', 'ONSHAPE_DXF_MISSING_EDGE');
    return edgeEntity(edge, coedge, project);
  });
  if (entities.length === 0) throw new ApiError(502, 'Onshape 平面沒有可匯出的邊線', 'ONSHAPE_DXF_EMPTY_FACE');

  const header = dxfEntity([
    [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1027'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
  ]);
  return Buffer.from(`${header}\n${entities.join('\n')}\n0\nENDSEC\n0\nEOF\n`, 'ascii');
}
