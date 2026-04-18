import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBoundaries, parseFwf, detectFwfPreamble, widthsToBoundaries } from '../fwf.js';
import { parseWsv } from '../parser.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name) {
    return readFileSync(join(dir, '..', 'testdata', name), 'utf8');
}

describe('parseWsv', () => {
    test('splits on any whitespace', () => {
        const rows = parseWsv('a  b\tc\nd  e  f\n');
        assert.deepEqual(rows[0], ['a', 'b', 'c']);
        assert.deepEqual(rows[1], ['d', 'e', 'f']);
    });

    test('leading and trailing whitespace ignored', () => {
        const rows = parseWsv('  a  b  \n');
        assert.deepEqual(rows[0], ['a', 'b']);
    });

    test('blank lines skipped', () => {
        const rows = parseWsv('a b\n\nc d\n');
        assert.equal(rows.length, 2);
    });

    test('quoted fields may contain spaces', () => {
        const rows = parseWsv('1 "New Jersey" .961\n');
        assert.deepEqual(rows[0], ['1', 'New Jersey', '.961']);
    });

    test('quoted fields may contain commas and tabs', () => {
        const rows = parseWsv('4\t"Washington, D.C."\t.960\n');
        assert.deepEqual(rows[0], ['4', 'Washington, D.C.', '.960']);
    });

    test('hdi.dat: quoted state names parsed correctly', () => {
        const rows = parseWsv(readText('hdi.dat'));
        assert.deepEqual(rows[0],  ['rank', 'state', 'hdi', 'canada.dist']);
        assert.deepEqual(rows[1],  ['1', 'Connecticut', '.962', '2']);
        assert.deepEqual(rows[4],  ['4', 'Washington, D.C.', '.960', '4']);
        assert.deepEqual(rows[50], ['50', 'West Virginia', '.800', '3']);
        assert.equal(rows.length, 52);
    });

    test('deaths_fixed.txt: skip 2 comment lines, parse 6 columns', () => {
        const raw  = readText('deaths_fixed.txt');
        const text = raw.split('\n').slice(2).join('\n');
        const rows = parseWsv(text);
        assert.deepEqual(rows[0], ['PopName', 'Year', 'Age', 'Female', 'Male', 'Total']);
        assert.deepEqual(rows[1], ['AUS', '1921-1924', '0', '13810.50', '18316.55', '32127.05']);
    });
});

describe('detectBoundaries', () => {
    test('simple 3-column file', () => {
        const text = readText('simple.fwf');
        assert.deepEqual(detectBoundaries(text), [0, 13, 18]);
    });

    test('single column (no gaps) returns [0]', () => {
        const text = 'hello\nworld\nfoo\n';
        assert.deepEqual(detectBoundaries(text), [0]);
    });

    test('gaps produce correct boundaries', () => {
        // Two columns separated by two spaces
        const text = 'AA  BB\nCC  DD\nEE  FF\n';
        assert.deepEqual(detectBoundaries(text), [0, 4]);
    });

    test('multiple space gap still yields one boundary', () => {
        const text = 'A    B\nC    D\n';
        assert.deepEqual(detectBoundaries(text), [0, 5]);
    });

    test('blank lines are ignored during detection', () => {
        const text = 'AA  BB\n\nCC  DD\n';
        assert.deepEqual(detectBoundaries(text), [0, 4]);
    });
});

describe('detectFwfPreamble', () => {
    test('returns null when no hyphen line present', () => {
        assert.equal(detectFwfPreamble('a b\nc d\n'), null);
    });

    test('returns null when hyphen line is first line', () => {
        assert.equal(detectFwfPreamble('------\na b\n'), null);
    });

    test('header immediately before hyphen: commentLines=0, headerLines=1', () => {
        const text = 'Name  Age\n---------\nAlice  30\n';
        assert.deepEqual(detectFwfPreamble(text), { commentLines: 0, headerLines: 1 });
    });

    test('weather_station_ids.txt: 2 comment lines, 1 header line', () => {
        assert.deepEqual(detectFwfPreamble(readText('weather_station_ids.txt')),
            { commentLines: 2, headerLines: 1 });
    });

    test('boxbike2.dat: 23 comment lines, 1 header line', () => {
        assert.deepEqual(detectFwfPreamble(readText('boxbike2.dat')),
            { commentLines: 23, headerLines: 1 });
    });
});

describe('hyphen separator line', () => {
    const text = [
        'Name         Age  City',
        '-----------  ---  -------------',
        'John Doe      30  New York',
        'Jane Smith    25  San Francisco',
    ].join('\n') + '\n';

    test('boundaries derived from hyphen runs', () => {
        assert.deepEqual(detectBoundaries(text), [0, 13, 18]);
    });

    test('hyphen line filtered from parsed rows', () => {
        const rows = parseFwf(text, detectBoundaries(text));
        assert.equal(rows.length, 3); // header + 2 data rows, no hyphen row
        assert.deepEqual(rows[0], ['Name', 'Age', 'City']);
        assert.deepEqual(rows[1], ['John Doe', '30', 'New York']);
    });

    test('all-hyphens line (no spaces) also filtered', () => {
        const t = 'A  B\n----\nx  y\n';
        const rows = parseFwf(t, [0, 3]);
        assert.equal(rows.length, 2);
        assert.deepEqual(rows[1], ['x', 'y']);
    });
});

describe('detectBoundaries with comment lines', () => {
    test('deaths_fixed.txt: skip 2 comment lines, detect 6 columns', () => {
        const raw  = readText('deaths_fixed.txt');
        const text = raw.split('\n').slice(2).join('\n');
        assert.deepEqual(detectBoundaries(text), [0, 9, 24, 40, 56, 72]);
        const rows = parseFwf(text, [0, 9, 24, 40, 56, 72]);
        assert.deepEqual(rows[0], ['PopName', 'Year', 'Age', 'Female', 'Male', 'Total']);
        assert.deepEqual(rows[1], ['AUS', '1921-1924', '0', '13810.50', '18316.55', '32127.05']);
    });
});

describe('BOXBIKE2.DAT', () => {
    const raw  = readText('BOXBIKE2.DAT');
    const { commentLines } = detectFwfPreamble(raw);
    const text = raw.split('\n').slice(commentLines).join('\n');

    test('preamble: 23 comment lines, 1 header line', () => {
        assert.deepEqual(detectFwfPreamble(raw), { commentLines: 23, headerLines: 1 });
    });

    test('boundaries auto-detected', () => {
        assert.deepEqual(detectBoundaries(text), [0, 5, 9, 13, 17, 21, 25, 29]);
    });

    test('header and first data row', () => {
        const rows = parseFwf(text, detectBoundaries(text));
        assert.deepEqual(rows[0], ['Y', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7']);
        assert.deepEqual(rows[1], ['69', '-1', '-1', '-1', '+1', '+1', '+1', '-1']);
        assert.equal(rows.length, 9);
    });
});

describe('weather_station_ids.txt', () => {
    const raw  = readText('weather_station_ids.txt');
    const { commentLines } = detectFwfPreamble(raw);
    const text = raw.split('\n').slice(commentLines).join('\n');
    const widths = [8, 41, 10, 9, 9, 9, 7, 4, 4];
    const boundaries = widthsToBoundaries(widths);
    const lineWidth  = widths.reduce((a, b) => a + b, 0);

    test('preamble: 2 comment lines, 1 header line', () => {
        assert.deepEqual(detectFwfPreamble(raw), { commentLines: 2, headerLines: 1 });
    });

    test('widthsToBoundaries gives correct starts', () => {
        assert.deepEqual(boundaries, [0, 8, 49, 59, 68, 77, 86, 93, 97]);
    });

    test('header and first data row with specified widths', () => {
        const rows = parseFwf(text, boundaries, lineWidth);
        assert.deepEqual(rows[0], ['Site', 'Name', 'Lat', 'Lon', 'Start', 'End', 'Years', '%', 'AWS']);
        assert.deepEqual(rows[1], ['1000', 'KARUNJIE', '-16.2919', '127.1956', 'Oct 1940', 'Aug 1981', '24.9', '61', 'N']);
        assert.equal(rows.length, 17891);
    });
});

describe('parseFwf', () => {
    test('simple 3-column file', () => {
        const text = readText('simple.fwf');
        const rows = parseFwf(text, [0, 13, 18]);
        assert.deepEqual(rows[0], ['Name', 'Age', 'City']);
        assert.deepEqual(rows[1], ['John Doe', '30', 'New York']);
        assert.deepEqual(rows[2], ['Jane Smith', '25', 'San Francisco']);
        assert.deepEqual(rows[3], ['Bob Johnson', '35', 'Chicago']);
        assert.equal(rows.length, 4);
    });

    test('fields are trimmed', () => {
        const text = 'AA    BB\nCC    DD\n';
        const rows = parseFwf(text, [0, 6]);
        assert.deepEqual(rows[0], ['AA', 'BB']);
    });

    test('short lines padded with empty string for missing columns', () => {
        const text = 'AAABBB\nAAA\n';
        const rows = parseFwf(text, [0, 3]);
        assert.deepEqual(rows[0], ['AAA', 'BBB']);
        assert.deepEqual(rows[1], ['AAA', '']);
    });

    test('CRLF line endings handled', () => {
        const text = 'AA  BB\r\nCC  DD\r\n';
        const rows = parseFwf(text, [0, 4]);
        assert.deepEqual(rows[0], ['AA', 'BB']);
        assert.deepEqual(rows[1], ['CC', 'DD']);
    });

    test('round-trip: detectBoundaries + parseFwf', () => {
        const text = readText('simple.fwf');
        const rows = parseFwf(text, detectBoundaries(text));
        assert.deepEqual(rows[0], ['Name', 'Age', 'City']);
        assert.deepEqual(rows[3], ['Bob Johnson', '35', 'Chicago']);
    });
});
