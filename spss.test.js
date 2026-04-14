import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSavFile } from './spss.js';
import { serializeDelimited } from './parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name) {
    return readFileSync(join(dir, 'testdata', name), 'utf8');
}

function readBinary(name) {
    return readFileSync(join(dir, 'testdata', name));
}

function applyValueLabels(rows, columnMeta, mode, sep) {
    if (mode === 'metadata')
        return rows;
    const [header, ...dataRows] = rows;
    return [header, ...dataRows.map(row =>
        row.map((val, i) => {
            const label = columnMeta[i]?.valueLabels?.[val];
            if (label == null)
                return val;
            if (mode === 'replace')
                return label;
            return val + sep + label;
        })
    )];
}

// slaa2020.sav from:
// State Library Administrative Agencies Survey: Fiscal Year 2020
// https://catalog.data.gov/dataset/state-library-administrative-agencies-survey-fiscal-year-2020-0b91f
describe('slaa2020.sav', () => {
    let tables;

    test('parses without error', async () => {
        tables = await parseSavFile(readBinary('slaa2020.sav'), 'slaa2020.sav');
        assert.equal(tables.length, 1);
    });

    const cases = [
        { label: 'metadata', mode: 'metadata', sep: null,  file: 'slaa2020-vl-metadata.csv' },
        { label: 'replace',  mode: 'replace',  sep: null,  file: 'slaa2020-vl-replace.csv' },
        { label: 'combine :', mode: 'combine', sep: ':',   file: 'slaa2020-vl-combine-colon.csv' },
        { label: 'combine →', mode: 'combine', sep: '→',  file: 'slaa2020-vl-combine-arrow.csv' },
    ];

    for (const { label, mode, sep, file } of cases) {
        test(`value labels: ${label}`, async () => {
            if (!tables)
                tables = await parseSavFile(readBinary('slaa2020.sav'), 'slaa2020.sav');
            const { rows, columnMeta } = tables[0];
            const output = applyValueLabels(rows, columnMeta, mode, sep);
            const actual = serializeDelimited(output, ',');
            assert.equal(actual, readText(file));
        });
    }
});
