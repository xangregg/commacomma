import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBoundaries, parseFwf, detectFwfPreamble } from './fwf.js';
import { generateCsvw } from './csvw.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name) {
    return readFileSync(join(dir, 'testdata', name), 'utf8');
}

describe('generateCsvw', () => {
    describe('BOXBIKE2.DAT with 23 comment lines', () => {
        const raw = readText('BOXBIKE2.DAT');
        const { commentLines } = detectFwfPreamble(raw);
        const lines = raw.split('\n');
        const notes = lines.slice(0, commentLines).join('\n');
        const text  = lines.slice(commentLines).join('\n');
        const rows  = parseFwf(text, detectBoundaries(text));
        const csvw  = JSON.parse(generateCsvw(rows, 'boxbike2.csv', null, notes));

        test('notes contains one entry with the comment block', () => {
            assert.equal(csvw.notes.length, 1);
            assert.ok(csvw.notes[0].includes('BOX, HUNTER & HUNTER (1978)'));
            assert.ok(csvw.notes[0].includes('\n'));
        });

        test('notes starts with the first comment line', () => {
            assert.ok(csvw.notes[0].startsWith('SEAT/DYNAMO/HANDLEBAR'));
        });

        test('columns have correct names', () => {
            const names = csvw.tableSchema.columns.map(c => c.name);
            assert.deepEqual(names, ['Y', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7']);
        });

        test('response variable Y inferred as integer', () => {
            const y = csvw.tableSchema.columns.find(c => c.name === 'Y');
            assert.equal(y.datatype, 'integer');
        });
    });
});
