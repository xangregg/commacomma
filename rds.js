// rds.js – Adapter around the vendored rds-js library.
// Supports .rds files (saveRDS) and .rdata/.rda workspace files (save).
//
// The library is in vendor/rds-js.js (pre-built ES module, zero dependencies).
// To update it: npm install && npm run vendor

import { parseRds, isDataFrame } from './vendor/rds-js.js';

// Needed only for the RData path: decompress so we can inspect and strip
// the "RDX2\n" magic header before handing off to parseRds.
async function decompressGzip(bytes) {
    const ds     = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const done   = writer.write(bytes).then(() => writer.close());
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done: d, value } = await reader.read();
        if (d) break;
        chunks.push(value);
        total += value.byteLength;
    }
    await done;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
    return out;
}

function dataFrameToTable(df, name) {
    const nrow = df.columns[0]?.length ?? 0;
    const rows = [df.names.map(String)];
    for (let r = 0; r < nrow; r++)
        rows.push(df.columns.map(col => {
            const v = col[r];
            if (v === null || v === undefined) return '';
            if (v === true)  return 'TRUE';
            if (v === false) return 'FALSE';
            return String(v);
        }));
    return { name, rows, columnMeta: df.columnMeta ?? null };
}

function extractTables(result, filename) {
    const name = filename.replace(/\.[^.]+$/, '');

    if (isDataFrame(result))
        return [dataFrameToTable(result, name)];

    // Named list (e.g. RData workspace, or a list of data frames in RDS)
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const tables = [];
        for (const [key, value] of Object.entries(result)) {
            if (isDataFrame(value))
                tables.push(dataFrameToTable(value, key));
        }
        if (tables.length > 0)
            return tables;
    }

    return [];
}

export async function parseRFile(arrayBuffer, filename) {
    let bytes = new Uint8Array(arrayBuffer);
    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'rdata' || ext === 'rda') {
        // RData files prepend a magic line ("RDX2\n" or "RDX3\n") before the
        // standard XDR serialization body that parseRds expects.
        // Decompress first so we can detect and strip the magic header.
        if (bytes[0] === 0x1f && bytes[1] === 0x8b)
            bytes = await decompressGzip(bytes);
        // Strip the 5-byte "RDX?\n" header (R=0x52, D=0x44, X=0x58).
        if (bytes[0] === 0x52 && bytes[1] === 0x44 && bytes[2] === 0x58)
            bytes = bytes.subarray(5);
        // bytes now starts with the XDR format byte ("X\n...").
        // parseRds's internal decompress is a no-op for non-compressed data.
    }

    const result = await parseRds(bytes);
    return extractTables(result, filename);
}
