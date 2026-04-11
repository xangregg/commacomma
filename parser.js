function quoteField(field, delimiter) {
    if (field.includes(delimiter) || field.includes('"') || field.includes('\n'))
        return '"' + field.replace(/"/g, '""') + '"';
    return field;
}

export function parseDelimited(text, delimiter) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (text.endsWith('\n'))
        text = text.slice(0, -1);
    if (text === '')
        return [];

    const rows = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
        const row = [];

        while (true) {
            let field = '';

            if (i < n && text[i] === '"') {
                i++;
                while (i < n) {
                    if (text[i] === '"') {
                        if (i + 1 < n && text[i + 1] === '"') {
                            field += '"';
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        field += text[i++];
                    }
                }
                while (i < n && text[i] !== delimiter && text[i] !== '\n')
                    i++;
            } else {
                while (i < n && text[i] !== delimiter && text[i] !== '\n')
                    field += text[i++];
            }

            row.push(field);

            if (i >= n || text[i] === '\n')
                break;
            i++; // skip delimiter
        }

        if (i < n)
            i++; // skip '\n'

        rows.push(row);
    }

    return rows;
}

export function serializeDelimited(rows, delimiter) {
    return rows
        .map(row => row.map(f => quoteField(f, delimiter)).join(delimiter))
        .join('\n') + '\n';
}
