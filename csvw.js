function inferColumnType(values) {
    const nonEmpty = values.filter(v => v !== '');
    if (nonEmpty.length === 0)
        return 'string';
    if (nonEmpty.every(v => /^-?\d+$/.test(v)))
        return 'integer';
    if (nonEmpty.every(v => /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)))
        return 'number';
    if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}T/.test(v)))
        return 'datetime';
    if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)))
        return 'date';
    if (nonEmpty.every(v => /^(TRUE|FALSE|true|false)$/.test(v)))
        return 'boolean';
    return 'string';
}

export function generateCsvw(rows, csvFilename, columnMeta = null, notes = null) {
    if (rows.length === 0)
        return null;
    const headers  = rows[0];
    const dataRows = rows.slice(1);
    const columns  = headers.map((title, i) => {
        const values   = dataRows.map(r => r[i] ?? '');
        const meta     = columnMeta?.[i];
        const datatype = meta?.datatype ?? inferColumnType(values);
        const name     = (title.replace(/[^A-Za-z0-9_]/g, '_') || `col${i + 1}`)
                             .replace(/^(\d)/, '_$1');
        const col  = { name, titles: title, datatype };
        if (meta?.levels?.length > 0) {
            const escaped = meta.levels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            col.datatype = { base: 'string', format: `^(${escaped.join('|')})$` };
            col.enum     = meta.levels;
        }
        if (meta?.label) {
            col['dc:description'] = meta.label;
        } else if (meta?.levels?.length > 0) {
            const prefix = meta.ordered ? 'Ordered factor' : 'Factor';
            col['dc:description'] = `${prefix} with levels: ${meta.levels.join(', ')}`;
        }
        if (meta?.tzone)       col.tzone       = meta.tzone;
        if (meta?.valueLabels) col.valueLabels = meta.valueLabels;
        return col;
    });
    const table = {
        '@context': 'http://www.w3.org/ns/csvw',
        url: csvFilename,
    };
    if (notes)
        table.notes = [notes];
    table.tableSchema = { columns };
    return JSON.stringify(table, null, 2);
}
