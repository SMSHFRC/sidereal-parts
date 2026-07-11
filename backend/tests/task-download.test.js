import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadSpecForTask } from '../src/utils/taskDownload.js';

const taskFor = (methodCode, materialCode = null) => ({
  manufacturingMethod: { code: methodCode },
  material: materialCode ? { code: materialCode } : null,
});

test('task download format follows method and material', () => {
  assert.equal(downloadSpecForTask(taskFor('3DP'))?.format, 'stl');
  assert.equal(downloadSpecForTask(taskFor('LASER'))?.format, 'dxf');
  assert.equal(downloadSpecForTask(taskFor('CNC', 'PC_6MM'))?.format, 'dxf');
  assert.equal(downloadSpecForTask(taskFor('CNC', 'AL6061_PLATE_5MM'))?.format, 'dxf');
  assert.equal(downloadSpecForTask(taskFor('CNC', 'ROUND_SHAFT_10MM')), null);
  assert.equal(downloadSpecForTask(taskFor('LATHE')), null);
});
