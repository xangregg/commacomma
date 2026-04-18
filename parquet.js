import { parquetRead, parquetMetadataAsync } from './vendor/hyparquet/index.js';

function stringify(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v);
}

// Map a Parquet schema element to a CSVW datatype string.
// Checks logical_type first (modern), then converted_type (legacy), then physical type.
function schemaDatatype(field) {
    const lt = field.logical_type?.type;
    if (lt === 'STRING' || lt === 'ENUM' || lt === 'UUID' || lt === 'JSON' || lt === 'BSON')
        return 'string';
    if (lt === 'INTEGER') return 'integer';
    if (lt === 'DECIMAL') return 'number';
    if (lt === 'DATE') return 'date';
    if (lt === 'TIME') return 'time';
    if (lt === 'TIMESTAMP') return 'datetime';
    if (lt === 'FLOAT16') return 'number';

    const ct = field.converted_type;
    if (ct === 'UTF8' || ct === 'ENUM' || ct === 'JSON' || ct === 'BSON') return 'string';
    if (ct === 'DECIMAL') return 'number';
    if (ct === 'DATE') return 'date';
    if (ct === 'TIMESTAMP_MILLIS' || ct === 'TIMESTAMP_MICROS') return 'datetime';
    if (ct === 'TIME_MILLIS' || ct === 'TIME_MICROS') return 'time';
    if (ct === 'INT_8' || ct === 'INT_16' || ct === 'INT_32' || ct === 'INT_64' ||
        ct === 'UINT_8' || ct === 'UINT_16' || ct === 'UINT_32' || ct === 'UINT_64')
        return 'integer';

    switch (field.type) {
        case 'BOOLEAN': return 'boolean';
        case 'INT32':   return 'integer';
        case 'INT64':   return 'integer';
        case 'INT96':   return 'datetime'; // legacy timestamp encoding
        case 'FLOAT':   return 'number';
        case 'DOUBLE':  return 'number';
        default:        return 'string';   // BYTE_ARRAY, FIXED_LEN_BYTE_ARRAY
    }
}

export async function parseParquetFile(arrayBuffer, filename) {
    const name = filename.replace(/\.[^.]+$/, '');
    const file = {
        byteLength: arrayBuffer.byteLength,
        slice: (start, end) => Promise.resolve(arrayBuffer.slice(start, end)),
    };
    const meta = await parquetMetadataAsync(file);
    const fields = meta.schema.slice(1);
    const columns = fields.map(f => f.name);
    const columnMeta = fields.map(field => ({
        datatype: schemaDatatype(field),
        label: null,
        levels: null,
        ordered: false,
        tzone: null,
        valueLabels: null,
    }));
    const rows = [columns];
    await parquetRead({
        file,
        metadata: meta,
        rowFormat: 'array',
        onComplete: data => {
            for (const row of data)
                rows.push(row.map(stringify));
        },
    });
    return [{ name, rows, columnMeta }];
}
