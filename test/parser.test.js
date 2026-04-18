import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDelimited, serializeDelimited } from '../parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readData(dataset, ext) {
    return readFileSync(join(dir, '..', 'testdata', `${dataset}.${ext}`), 'utf8');
}

const DELIMITERS = { csv: ',', tsv: '\t', ssv: ';', txt: ',' };
const DATASETS   = ['simple', 'empty_fields', 'quoted', 'ragged'];
const SRC_FMTS   = ['csv', 'tsv', 'ssv', 'txt'];
const DST_FMTS   = ['csv', 'tsv', 'ssv'];

for (const dataset of DATASETS) {
    describe(dataset, () => {
        for (const src of SRC_FMTS) {
            for (const dst of DST_FMTS) {
                test(`${src} → ${dst}`, () => {
                    const rows   = parseDelimited(readData(dataset, src), DELIMITERS[src]);
                    const actual = serializeDelimited(rows, DELIMITERS[dst]);
                    assert.equal(actual, readData(dataset, dst));
                });
            }
        }
    });
}
