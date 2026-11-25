import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanReply } from './cleanReply';

test('removes markdown emphasis and keeps paragraphs', () => {
  const raw =
    '**Career** is saal *Shani* ki chal rahi hai.\n\n**Upay:** Har Shanivar ko daan karo. \n\nKya abhi job change soch rahe ho?';
  assert.equal(cleanReply(raw), 'Career is saal Shani ki chal rahi hai.\n\nUpay: Har Shanivar ko daan karo.\n\nKya abhi job change soch rahe ho?');
});

test('removes emoji, including joined and skin-tone sequences', () => {
  assert.equal(cleanReply('Hiii ❤️ Cards ready hain 🙏🏽'), 'Hiii Cards ready hain');
  assert.equal(cleanReply('Namaskara 😊 Ek sawaal 👨‍👩‍👧'), 'Namaskara Ek sawaal');
});

test('removes headings, bullets, numbered lists and back-ticks', () => {
  const raw = '## Aapka din\n- pehla upay\n* doosra upay\n1. teesra `upay`\n> quote';
  assert.equal(cleanReply(raw), 'Aapka din\npehla upay\ndoosra upay\nteesra upay\nquote');
});

test('turns long dashes into commas and collapses blank lines', () => {
  assert.equal(cleanReply('Pranam — janm vivaran dijiye\n\n\n\nphir dekhte hain'), 'Pranam, janm vivaran dijiye\n\nphir dekhte hain');
});

test('keeps link text only', () => {
  assert.equal(cleanReply('Dekhiye [yahan](https://example.com).'), 'Dekhiye yahan.');
});
