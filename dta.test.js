import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDtaFile } from './dta.js';
import { serializeDelimited } from './parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

function applyValueLabels(rows, columnMeta, mode) {
    if (mode === 'metadata')
        return rows;
    const [header, ...dataRows] = rows;
    return [header, ...dataRows.map(row =>
        row.map((val, i) => {
            const label = columnMeta[i]?.valueLabels?.[val];
            return label != null ? label : val;
        })
    )];
}

function readText(name) {
    return readFileSync(join(dir, 'testdata', name), 'utf8');
}

function readBinary(name) {
    return readFileSync(join(dir, 'testdata', name));
}

// child_iq.dta from:
// Gelman & Hill "Data Analysis Using Regression..." (2007)
// via http://www.stat.columbia.edu/~gelman/arm/examples/child.iq/
describe('child_iq.dta', () => {
    let tables;

    test('parses without error', async () => {
        tables = await parseDtaFile(readBinary('child_iq.dta'), 'child_iq.dta');
        assert.equal(tables.length, 1);
    });

    test('→ csv', async () => {
        if (!tables)
            tables = await parseDtaFile(readBinary('child_iq.dta'), 'child_iq.dta');
        const actual = serializeDelimited(tables[0].rows, ',');
        assert.equal(actual, readText('child_iq.csv'));
    });
});

// fmli841.dta from:
// U.S. Bureau of Labor Statistics Consumer Expenditure Survey public-use microdata
// https://www.bls.gov/cex/pumd_data.htm
describe('fmli841.dta', () => {
    let tables;

    test('parses without error', async () => {
        tables = await parseDtaFile(readBinary('fmli841.dta'), 'fmli841.dta');
        assert.equal(tables.length, 1);
    });

    test('→ csv', async () => {
        if (!tables)
            tables = await parseDtaFile(readBinary('fmli841.dta'), 'fmli841.dta');
        const actual = serializeDelimited(tables[0].rows, ',');
        assert.equal(actual, readText('fmli841.csv'));
    });
});

// BLW_wave1_expert.dta from:
// Bright Line Watch expert survey, wave 1
// https://brightlinewatch.org/survey-data-and-replication-material/
describe('BLW_wave1_expert.dta', () => {
    let tables;

    test('parses without error', async () => {
        tables = await parseDtaFile(readBinary('BLW_wave1_expert.dta'), 'BLW_wave1_expert.dta');
        assert.equal(tables.length, 1);
    });

    const cases = [
        { label: 'replace',  mode: 'replace',  file: 'BLW_wave1_expert-replace.csv' },
        { label: 'metadata', mode: 'metadata', file: 'BLW_wave1_expert-metadata.csv' },
    ];

    for (const { label, mode, file } of cases) {
        test(`value labels: ${label}`, async () => {
            if (!tables)
                tables = await parseDtaFile(readBinary('BLW_wave1_expert.dta'), 'BLW_wave1_expert.dta');
            const { rows, columnMeta } = tables[0];
            const output = applyValueLabels(rows, columnMeta, mode);
            const actual = serializeDelimited(output, ',');
            assert.equal(actual, readText(file));
        });
    }
});

// sample-pyreadstat.dta from:
// pyreadstat test data (Apache 2.0)
// https://github.com/Roche/pyreadstat/tree/master/test_data/basic
describe('sample-pyreadstat.dta', () => {
    let tables;

    test('parses without error', async () => {
        tables = await parseDtaFile(readBinary('sample-pyreadstat.dta'), 'sample-pyreadstat.dta');
        assert.equal(tables.length, 1);
    });

    test('→ csv', async () => {
        if (!tables)
            tables = await parseDtaFile(readBinary('sample-pyreadstat.dta'), 'sample-pyreadstat.dta');
        const actual = serializeDelimited(tables[0].rows, ',');
        assert.equal(actual, readText('sample-pyreadstat.csv'));
    });
});
