import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRFile } from './rds.js';
import { serializeDelimited } from './parser.js';
import { generateCsvw } from './csvw.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(dataset, ext) {
    return readFileSync(join(dir, 'testdata', `${dataset}.${ext}`), 'utf8');
}

function readBinary(dataset, ext) {
    return readFileSync(join(dir, 'testdata', `${dataset}.${ext}`));
}

const DELIMITERS = { csv: ',', tsv: '\t', ssv: ';' };
const DATASETS   = ['dataframe', 'dataframe_dates', 'dataframe_factor', 'dataframe_na'];
const DST_FMTS   = ['csv', 'tsv', 'ssv'];

for (const dataset of DATASETS) {
    describe(dataset, () => {
        for (const dst of DST_FMTS) {
            test(`rds → ${dst}`, async () => {
                const tables = await parseRFile(readBinary(dataset, 'rds'), `${dataset}.rds`);
                assert.equal(tables.length, 1);
                const actual = serializeDelimited(tables[0].rows, DELIMITERS[dst]);
                assert.equal(actual, readText(dataset, dst));
            });
        }

        test('rds → csvw', async () => {
            const tables  = await parseRFile(readBinary(dataset, 'rds'), `${dataset}.rds`);
            assert.equal(tables.length, 1);
            const actual   = generateCsvw(tables[0].rows, `${dataset}.csv`, tables[0].columnMeta);
            const expected = readText(dataset, 'csv-metadata.json');
            assert.equal(actual, expected);
        });
    });
}
