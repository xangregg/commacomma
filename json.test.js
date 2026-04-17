import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonFile } from './json.js';
import { serializeDelimited } from './parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name) {
    return readFileSync(join(dir, 'testdata', name), 'utf8');
}

describe('simple3name.jsonl', () => {
    test('→ csv', () => {
        const [table] = parseJsonFile(readText('simple3name.jsonl'), 'simple3name.jsonl');
        assert.equal(serializeDelimited(table.rows, ','), readText('simple3name.csv'));
    });
});

describe('simple3name.json', () => {
    test('→ csv', () => {
        const [table] = parseJsonFile(readText('simple3name.json'), 'simple3name.json');
        assert.equal(serializeDelimited(table.rows, ','), readText('simple3name.csv'));
    });
});

// Chicago Food Inspections (20 records) from:
// City of Chicago Data Portal (public domain)
// https://data.cityofchicago.org/resource/4ijn-s7e5.json
describe('chicago-food-inspections.json', () => {
    test('→ csv', () => {
        const [table] = parseJsonFile(readText('chicago-food-inspections.json'), 'chicago-food-inspections.json');
        assert.equal(serializeDelimited(table.rows, ','), readText('chicago-food-inspections.csv'));
    });
});

describe('chicago-food-inspections.ndjson', () => {
    test('→ csv', () => {
        const [table] = parseJsonFile(readText('chicago-food-inspections.ndjson'), 'chicago-food-inspections.ndjson');
        assert.equal(serializeDelimited(table.rows, ','), readText('chicago-food-inspections.csv'));
    });
});

// bolides5.json from NASA CNEOS Fireball/Bolide Reports API
// Structure: { success: true, data: [ 5 bolide objects ] }
describe('bolides5.json', () => {
    test('→ csv (api envelope: scalar fields broadcast onto each array row)', () => {
        const [table] = parseJsonFile(readText('bolides5.json'), 'bolides5.json');
        assert.equal(table.rows.length - 1, 5);
        assert.equal(table.rows[1][0], 'true'); // success replicated on every row
        assert.equal(serializeDelimited(table.rows, ','), readText('bolides5.csv'));
    });
});

describe('nested object handling', () => {
    const nested = '[{"a":{"x":1,"y":2},"b":3}]';

    test('stringify (default): nested object becomes JSON string', () => {
        const [table] = parseJsonFile(nested, 'test.json');
        assert.deepEqual(table.rows[0], ['a', 'b']);
        assert.deepEqual(table.rows[1], ['{"x":1,"y":2}', '3']);
    });

    test('flatten: keys joined with dots', () => {
        const [table] = parseJsonFile(nested, 'test.json', 'flatten');
        assert.deepEqual(table.rows[0], ['a.x', 'a.y', 'b']);
        assert.deepEqual(table.rows[1], ['1', '2', '3']);
    });

    test('leaf: innermost key only', () => {
        const [table] = parseJsonFile(nested, 'test.json', 'leaf');
        assert.deepEqual(table.rows[0], ['x', 'y', 'b']);
        assert.deepEqual(table.rows[1], ['1', '2', '3']);
    });

    test('flatten: deeply nested', () => {
        const [table] = parseJsonFile('[{"a":{"b":{"c":1}}}]', 'test.json', 'flatten');
        assert.deepEqual(table.rows[0], ['a.b.c']);
        assert.deepEqual(table.rows[1], ['1']);
    });

    test('leaf: deeply nested uses innermost key', () => {
        const [table] = parseJsonFile('[{"a":{"b":{"c":1}}}]', 'test.json', 'leaf');
        assert.deepEqual(table.rows[0], ['c']);
        assert.deepEqual(table.rows[1], ['1']);
    });

    test('flatten: arrays inside objects are stringified, not flattened', () => {
        const [table] = parseJsonFile('[{"a":{"x":[1,2]}}]', 'test.json', 'flatten');
        assert.deepEqual(table.rows[0], ['a.x']);
        assert.deepEqual(table.rows[1], ['[1,2]']);
    });

    test('flatten: ndjson', () => {
        const text = '{"a":{"x":1}}\n{"a":{"x":2}}';
        const [table] = parseJsonFile(text, 'test.ndjson', 'flatten');
        assert.deepEqual(table.rows[0], ['a.x']);
        assert.deepEqual(table.rows[1], ['1']);
        assert.deepEqual(table.rows[2], ['2']);
    });
});

describe('parseJsonFile edge cases', () => {
    test('empty array', () => {
        const [table] = parseJsonFile('[]', 'empty.json');
        assert.deepEqual(table.rows, [[]]);
    });

    test('missing keys in some rows', () => {
        const text = '{"a":1}\n{"a":2,"b":3}\n{"b":4}';
        const [table] = parseJsonFile(text, 'sparse.jsonl');
        assert.deepEqual(table.rows[0], ['a', 'b']);
        assert.deepEqual(table.rows[1], ['1', '']);
        assert.deepEqual(table.rows[2], ['2', '3']);
        assert.deepEqual(table.rows[3], ['', '4']);
    });

    test('null values become empty string', () => {
        const [table] = parseJsonFile('[{"a":null,"b":1}]', 'nulls.json');
        assert.deepEqual(table.rows[1], ['', '1']);
    });

    test('nested objects are stringified', () => {
        const [table] = parseJsonFile('[{"a":{"x":1}}]', 'nested.json');
        assert.equal(table.rows[1][0], '{"x":1}');
    });

    test('array of arrays uses first row as header', () => {
        const text = '[["x","y"],[1,2],[3,4]]';
        const [table] = parseJsonFile(text, 'matrix.json');
        assert.deepEqual(table.rows[0], ['x', 'y']);
        assert.deepEqual(table.rows[1], ['1', '2']);
    });

    test('columnar object format', () => {
        const text = '{"name":["Alice","Bob"],"age":[30,25]}';
        const [table] = parseJsonFile(text, 'columnar.json');
        assert.deepEqual(table.rows[0], ['name', 'age']);
        assert.deepEqual(table.rows[1], ['Alice', '30']);
        assert.deepEqual(table.rows[2], ['Bob', '25']);
    });

    test('single object becomes one data row', () => {
        const [table] = parseJsonFile('{"a":1,"b":2}', 'single.json');
        assert.deepEqual(table.rows[0], ['a', 'b']);
        assert.deepEqual(table.rows[1], ['1', '2']);
    });

    test('.json extension falls back to ndjson on parse failure', () => {
        const text = '{"a":1}\n{"a":2}';
        const [table] = parseJsonFile(text, 'fallback.json');
        assert.deepEqual(table.rows[0], ['a']);
        assert.deepEqual(table.rows[1], ['1']);
        assert.deepEqual(table.rows[2], ['2']);
    });
});
