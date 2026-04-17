function stringify(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

// Recursively flatten a nested object into a single-level object.
// mode='flatten': keys joined with dots  → { "a.x": 1 }
// mode='leaf':    innermost key only     → { "x": 1 }
function flattenRecord(rec, mode, result = {}, prefix = '') {
    for (const [k, v] of Object.entries(rec)) {
        const key = mode === 'flatten' ? (prefix ? `${prefix}.${k}` : k) : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flattenRecord(v, mode, result, key);
        } else {
            result[key] = v;
        }
    }
    return result;
}

// Convert an array of objects to a rows array (header + data).
// Collects keys in first-seen order across all records; missing keys → ''.
function recordsToRows(records, mode) {
    const flat = mode === 'stringify'
        ? records
        : records.map(rec => flattenRecord(rec, mode));

    const keys = [];
    const keyIndex = new Map();
    for (const rec of flat) {
        for (const k of Object.keys(rec)) {
            if (!keyIndex.has(k)) {
                keyIndex.set(k, keys.length);
                keys.push(k);
            }
        }
    }

    const K = keys.length;
    const rows = [keys];
    for (const rec of flat) {
        const row = new Array(K).fill('');
        for (const [k, v] of Object.entries(rec)) {
            const idx = keyIndex.get(k);
            if (idx !== undefined)
                row[idx] = stringify(v);
        }
        rows.push(row);
    }
    return rows;
}

function parseNdjson(text, mode) {
    const records = [];
    for (const line of text.split('\n')) {
        if (line.trim())
            records.push(JSON.parse(line));
    }
    return recordsToRows(records, mode);
}

function parseJson(text, mode) {
    const root = JSON.parse(text);

    if (Array.isArray(root)) {
        if (root.length === 0)
            return [[]];
        if (Array.isArray(root[0]))
            return root.map(r => r.map(stringify));
        return recordsToRows(root, mode);
    }

    if (typeof root === 'object' && root !== null) {
        const entries = Object.entries(root);
        const arrayEntries  = entries.filter(([, v]) => Array.isArray(v));
        const scalarEntries = entries.filter(([, v]) => !Array.isArray(v));
        // API envelope: exactly one array field → use it as rows, broadcast scalars
        if (arrayEntries.length === 1) {
            const scalars = Object.fromEntries(scalarEntries);
            const records = arrayEntries[0][1].map(item =>
                (item !== null && typeof item === 'object' && !Array.isArray(item))
                    ? { ...scalars, ...item }
                    : { ...scalars, value: item }
            );
            return recordsToRows(records, mode);
        }
        const vals = Object.values(root);
        // Columnar format: { col: [v, v, …], col: [v, v, …] }
        if (vals.every(v => Array.isArray(v))) {
            const keys = Object.keys(root);
            const len  = Math.max(...vals.map(v => v.length));
            const rows = [keys];
            for (let i = 0; i < len; i++)
                rows.push(keys.map((_, j) => stringify(vals[j][i])));
            return rows;
        }
        return recordsToRows([root], mode);
    }

    throw new Error('JSON root must be an array or object.');
}

export function parseJsonFile(text, filename, mode = 'stringify') {
    const name = filename.replace(/\.[^.]+$/, '');
    const ext  = filename.split('.').pop().toLowerCase();

    let rows;
    if (ext === 'jsonl' || ext === 'ndjson') {
        rows = parseNdjson(text, mode);
    } else {
        try {
            rows = parseJson(text, mode);
        } catch {
            rows = parseNdjson(text, mode);
        }
    }

    return [{ name, rows, columnMeta: null }];
}
