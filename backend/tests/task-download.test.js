import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDownloadPermission, downloadSpecForTask } from '../src/utils/taskDownload.js';
import { assertValidDxf, downloadFilename, stepExportPayload, stepExportRefs } from '../src/services/onshape.service.js';

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

test('all signed-in members can download task files', () => {
  const task = { assigneeId: 999n };
  assert.doesNotThrow(() => assertDownloadPermission(task, { id: 1n, role: 'member' }));
  assert.doesNotThrow(() => assertDownloadPermission(task, { id: 2n, role: 'admin' }));
});

test('DXF conversion requests a STEP export for one Onshape part', () => {
  const payload = stepExportPayload({
    note: 'Onshape: indexer-1',
    partNumber: 'ARM-0001',
    onshapePartId: 'JHD',
    onshapeConfig: 'default',
  });
  assert.equal(payload.format, 'STEP');
  assert.equal(payload.destinationName, 'indexer-1');
  assert.equal(payload.partIds, 'JHD');
  assert.equal(payload.units, 'millimeter');
  assert.equal(payload.zipSingleFileOutput, false);
  assert.equal(payload.configuration, 'default');
});

test('DXF export falls back to the source workspace when the stored ref is a microversion', () => {
  const refs = stepExportRefs({
    drawingUrl:
      'https://cad.onshape.com/documents/837f81e033220942d05f09ec/w/0ded200efc302a87e1954109/e/f58bce1d42a9290b9146408e',
    onshapeDid: '837f81e033220942d05f09ec',
    onshapeWvm: 'm',
    onshapeWvmId: 'a603d9c33817ad2f296957b1',
    onshapeEid: 'c79c1fa9305f99dff3d584c8',
  });

  assert.deepEqual(refs, [
    {
      did: '837f81e033220942d05f09ec',
      wvm: 'm',
      wvmId: 'a603d9c33817ad2f296957b1',
      eid: 'c79c1fa9305f99dff3d584c8',
    },
    {
      did: '837f81e033220942d05f09ec',
      wvm: 'w',
      wvmId: '0ded200efc302a87e1954109',
      eid: 'c79c1fa9305f99dff3d584c8',
    },
  ]);
});

test('DXF response validation rejects ZIP and accepts ASCII DXF', () => {
  assert.doesNotThrow(() => assertValidDxf(Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n')));
  assert.throws(
    () => assertValidDxf(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    (error) => error.code === 'ONSHAPE_DXF_ZIP',
  );
  assert.throws(
    () => assertValidDxf(Buffer.from('<html>failed</html>')),
    (error) => error.code === 'ONSHAPE_DXF_INVALID',
  );
});
