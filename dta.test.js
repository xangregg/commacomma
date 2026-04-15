import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDtaFile } from './dta.js';
import { serializeDelimited } from './parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

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
