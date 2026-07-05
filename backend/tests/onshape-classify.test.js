import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBomRow } from '../src/services/onshape.service.js';

test('classifyBomRow: vendor part numbers become COTS', () => {
  const rootDid = 'root-doc';
  for (const partNumber of ['WCP-0940', 'TTB-0130', '217-2592', '217-2734', 'am-3945_green']) {
    const row = classifyBomRow(
      {
        name: 'vendor item',
        quantity: 1,
        partNumber,
        description: 'vendor description',
        itemSource: { documentId: rootDid, partId: 'part-a' },
      },
      rootDid,
    );
    assert.equal(row.classification, 'cots');
    assert.equal(row.cotsReason, 'vendor_part_number');
  }
});

test('classifyBomRow: vendor description catches COTS when part number is missing', () => {
  const row = classifyBomRow(
    {
      name: 'hex bore pulley',
      quantity: 2,
      partNumber: null,
      description: 'VEXpro 1/2" hex bore pulley',
      itemSource: { documentId: 'root-doc', partId: 'part-b' },
    },
    'root-doc',
  );
  assert.equal(row.classification, 'cots');
  assert.equal(row.cotsReason, 'vendor_description');
});

test('classifyBomRow: team part numbers and material stay made', () => {
  const row = classifyBomRow(
    {
      name: 'arm plate',
      quantity: 1,
      partNumber: 'ARM-0061',
      material: '6061-T6 Aluminum',
      itemSource: { documentId: 'root-doc', partId: 'part-c' },
    },
    'root-doc',
  );
  assert.equal(row.classification, 'made');
  assert.equal(row.classificationReason, 'team_part_number');
});

test('classifyBomRow: empty rows stay unknown', () => {
  const row = classifyBomRow(
    {
      name: null,
      quantity: 2,
      partNumber: null,
      material: null,
      itemSource: null,
    },
    'root-doc',
  );
  assert.equal(row.classification, 'unknown');
  assert.equal(row.classificationReason, 'missing_part_id');
});
