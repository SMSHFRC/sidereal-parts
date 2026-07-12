import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportSTEP,
  makeBaseBox,
  makeCylinder,
} from 'replicad';
import {
  assertValidStep,
  initializeStepConverter,
  stepToDxf,
} from '../src/utils/stepToDxf.js';

test('converts a STEP plate with a hole into a millimeter DXF', async () => {
  await initializeStepConverter();
  const plate = makeBaseBox(100, 50, 5);
  const hole = makeCylinder(10, 7, [0, 0, -1]);
  const perforatedPlate = plate.cut(hole);
  const stepBlob = exportSTEP([{ shape: perforatedPlate, name: 'test-plate' }]);
  const stepBuffer = Buffer.from(await stepBlob.arrayBuffer());

  assert.doesNotThrow(() => assertValidStep(stepBuffer));
  const dxf = await stepToDxf(stepBuffer);
  const text = dxf.toString('utf8');

  assert.match(text, /\nSECTION\n/);
  assert.match(text, /\n\$INSUNITS\n70\n4\n/);
  assert.equal((text.match(/\nLWPOLYLINE\n/g) ?? []).length, 1);
  assert.equal((text.match(/\nCIRCLE\n/g) ?? []).length, 1);
  assert.match(text, /\nEOF\n/);

  perforatedPlate.delete();
});

test('converts a rotated STEP plate by projecting its planar face', async () => {
  await initializeStepConverter();
  const plate = makeBaseBox(80, 40, 4).rotate(35, [0, 0, 0], [0, 1, 0]);
  const stepBlob = exportSTEP([{ shape: plate, name: 'rotated-plate' }]);
  const stepBuffer = Buffer.from(await stepBlob.arrayBuffer());

  const dxf = await stepToDxf(stepBuffer);
  const text = dxf.toString('utf8');

  assert.match(text, /\nSECTION\n/);
  assert.match(text, /\nLWPOLYLINE\n/);
  assert.match(text, /\nEOF\n/);

  plate.delete();
});

test('rejects non-STEP responses before conversion', () => {
  assert.throws(
    () => assertValidStep(Buffer.from('<html>gateway error</html>')),
    (error) => error.code === 'ONSHAPE_STEP_INVALID',
  );
});
