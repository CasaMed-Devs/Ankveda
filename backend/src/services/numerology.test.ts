import assert from 'node:assert/strict';
import { test } from 'node:test';

import { birthNumber, harmony, lifePath, luckyTimeFor, nameNumber, personalYear, phoneNumber, reduce, vehicleNumber } from './numerology';

// Values from the Figma "Name report — complete" frame: Aarav Sharma, 16 Aug 1996.
test('matches the Figma example report', () => {
  assert.deepEqual(nameNumber('Aarav Sharma'), { compound: 27, value: 9, text: '27 → 9' });
  assert.equal(birthNumber('1996-08-16').value, 7);
  assert.equal(lifePath('1996-08-16').value, 4);
});

test('reduce keeps single digits and folds larger numbers', () => {
  assert.equal(reduce(9), 9);
  assert.equal(reduce(99), 9);
  assert.equal(reduce(1234), 1);
});

test('phone and vehicle numbers', () => {
  assert.equal(phoneNumber('9876543210').compound, 45);
  assert.equal(phoneNumber('9876543210').value, 9);
  // M4 H5 1 2 A1 B2 1 2 3 4 = 25 → 7
  assert.equal(vehicleNumber('MH12AB1234').compound, 25);
  assert.equal(vehicleNumber('MH12AB1234').value, 7);
});

test('personal year and lucky time', () => {
  // 16 + 8 + (2+0+2+6) = 34 → 7
  assert.equal(personalYear('1996-08-16', 2026).value, 7);
  assert.equal(luckyTimeFor(1), '09:09');
});

test('harmony is symmetric', () => {
  assert.equal(harmony(1, 2), harmony(2, 1));
  assert.equal(harmony(5, 5), 'supportive');
});
