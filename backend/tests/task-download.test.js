import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadSpecForTask } from '../src/utils/taskDownload.js';
import { downloadFilename } from '../src/services/onshape.service.js';

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

test('STL download keeps the imported Onshape part name', () => {
  assert.equal(
    downloadFilename({ note: 'Onshape: Intake Mount\nPart number: ARM-1234', partNumber: 'ARM-9999' }, 'stl'),
    'Intake Mount.stl',
  );
  assert.equal(downloadFilename({ note: 'Onshape: Front/Plate.stl', partNumber: 'ARM-9999' }, 'stl'), 'Front_Plate.stl');
});
