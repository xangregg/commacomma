import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseParquetFile } from './parquet.js';
import { serializeDelimited } from './parser.js';
import { generateCsvw } from './csvw.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name) {
    return readFileSync(join(dir, 'testdata', name), 'utf8');
}

function readBuffer(name) {
    const buf = readFileSync(join(dir, 'testdata', name));
    return new Uint8Array(buf).buffer;
}

describe('userdata1.parquet', () => {
    test('→ csv', async () => {
        const [table] = await parseParquetFile(readBuffer('userdata1.parquet'), 'userdata1.parquet');
        assert.equal(table.rows.length - 1, 1000);
        assert.deepEqual(table.rows[0], [
            'registration_dttm', 'id', 'first_name', 'last_name', 'email',
            'gender', 'ip_address', 'cc', 'country', 'birthdate', 'salary',
            'title', 'comments',
        ]);
        assert.equal(serializeDelimited(table.rows, ','), readText('userdata1.csv'));
    });

    test('schema types preserved in csvw (no inference override)', async () => {
        const [table] = await parseParquetFile(readBuffer('userdata1.parquet'), 'userdata1.parquet');
        const csvw = JSON.parse(generateCsvw(table.rows, 'userdata1.csv', table.columnMeta));
        const byName = Object.fromEntries(csvw.tableSchema.columns.map(c => [c.titles, c.datatype]));

        // INT96 → datetime (not inferred — would also match, but tests the path)
        assert.equal(byName['registration_dttm'], 'datetime');
        // INT32 → integer
        assert.equal(byName['id'], 'integer');
        // DOUBLE → number
        assert.equal(byName['salary'], 'number');
        // BYTE_ARRAY+UTF8 → string even though cc values look like integers
        assert.equal(byName['cc'], 'string');
        // BYTE_ARRAY+UTF8 → string even though birthdate values look like dates
        assert.equal(byName['birthdate'], 'string');
    });
});
