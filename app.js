import { FORMATS, detectFormatFromExt, sniffFormat } from './formats.js';
import { parseDelimited, serializeDelimited } from './parser.js';

const MAX_PREVIEW_ROWS = 50;
const MAX_PREVIEW_COLS = 10;

let parsedRows    = null;
let currentFile   = null;
let inputFormatId  = 'csv';
let outputFormatId = 'tsv';

function getFormat(id) {
    return FORMATS.find(f => f.id === id);
}

function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
}

function buildButtons(containerId, selectedId, onSelect) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (const fmt of FORMATS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'format-btn' + (fmt.id === selectedId ? ' selected' : '');
        btn.textContent = fmt.label;
        btn.addEventListener('click', () => onSelect(fmt.id));
        container.appendChild(btn);
    }
}

function setInputFormat(id) {
    inputFormatId = id;
    buildButtons('inputButtons', id, newId => {
        setInputFormat(newId);
        reparse();
    });
}

function setOutputFormat(id) {
    outputFormatId = id;
    buildButtons('outputButtons', id, setOutputFormat);
}

function getSpinValue(id) {
    return Math.max(0, parseInt(document.getElementById(id).value, 10) || 0);
}

function reparse() {
    if (!currentFile)
        return;

    const commentLines = getSpinValue('commentLines');
    const headerLines  = getSpinValue('headerLines');

    let text = currentFile.text;
    if (commentLines > 0) {
        const lines = text.split('\n');
        text = lines.slice(commentLines).join('\n');
    }

    try {
        parsedRows = parseDelimited(text, getFormat(inputFormatId).delimiter);
        showError('');
        updateFileInfo();
        renderPreview(parsedRows, headerLines);
    } catch (e) {
        showError('Failed to parse file: ' + e.message);
        parsedRows = null;
        setOutputVisible(false);
    }
}

function setOutputVisible(visible) {
    const display = visible ? 'block' : 'none';
    document.getElementById('previewSection').style.display = display;
    document.getElementById('outputOptions').style.display  = display;
    document.getElementById('convertBtn').style.display     = display;
}

function updateFileInfo() {
    const rows = parsedRows.length;
    const cols = parsedRows.reduce((max, r) => Math.max(max, r.length), 0);
    document.getElementById('fileInfo').textContent =
        `${rows} row${rows !== 1 ? 's' : ''}, ${cols} column${cols !== 1 ? 's' : ''}`;
    document.getElementById('fileInfo').style.display = 'block';
}

function renderPreview(rows, headerLines) {
    if (!rows || rows.length === 0) {
        setOutputVisible(false);
        return;
    }

    const totalCols  = rows.reduce((max, r) => Math.max(max, r.length), 0);
    const clipCols   = totalCols > MAX_PREVIEW_COLS;
    const showCols   = Math.min(totalCols, MAX_PREVIEW_COLS);

    const visibleRows = rows.slice(0, MAX_PREVIEW_ROWS);
    const headRows    = visibleRows.slice(0, headerLines);
    const bodyRows    = visibleRows.slice(headerLines);

    const table = document.getElementById('previewTable');
    table.innerHTML = '';

    if (headRows.length > 0) {
        const thead = table.createTHead();
        for (const row of headRows) {
            const tr = thead.insertRow();
            for (let c = 0; c < showCols; c++) {
                const th = document.createElement('th');
                th.textContent = row[c] ?? '';
                tr.appendChild(th);
            }
            if (clipCols) {
                const th = document.createElement('th');
                th.textContent = '…';
                tr.appendChild(th);
            }
        }
    }

    const tbody = table.createTBody();
    for (const row of bodyRows) {
        const tr = tbody.insertRow();
        for (let c = 0; c < showCols; c++)
            tr.insertCell().textContent = row[c] ?? '';
        if (clipCols)
            tr.insertCell().textContent = '…';
    }

    const extraRows = Math.max(0, rows.length - MAX_PREVIEW_ROWS);
    const extraCols = Math.max(0, totalCols - MAX_PREVIEW_COLS);
    const parts = [];
    if (extraRows > 0)
        parts.push(`${extraRows} more row${extraRows !== 1 ? 's' : ''} not shown`);
    if (extraCols > 0)
        parts.push(`${extraCols} more column${extraCols !== 1 ? 's' : ''} not shown`);

    const notice = document.getElementById('previewOverflow');
    notice.textContent = parts.join(' · ');
    notice.style.display = parts.length > 0 ? 'block' : 'none';

    setOutputVisible(true);
}

async function loadFile(file) {
    showError('');

    const area = document.getElementById('uploadArea');
    area.querySelector('.upload-text').textContent = file.name;
    area.querySelector('.upload-hint').textContent = 'Click or drop to change file';
    area.classList.add('has-file');

    try {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF)
            text = text.slice(1); // strip UTF-8 BOM

        const detectedId = detectFormatFromExt(file.name) ?? sniffFormat(text);
        currentFile = { name: file.name, text };

        setInputFormat(detectedId);
        setOutputFormat(FORMATS.find(f => f.id !== detectedId).id);

        document.getElementById('inputOptions').style.display = 'block';

        reparse();
    } catch (err) {
        showError('Could not read file: ' + err.message);
    }
}

function convert() {
    if (!parsedRows)
        return;
    const fmt = getFormat(outputFormatId);
    const output = serializeDelimited(parsedRows, fmt.delimiter);
    const baseName = currentFile.name.replace(/\.[^.]+$/, '');
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName + '.' + fmt.ext;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Event wiring ---

const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0)
        loadFile(fileInput.files[0]);
});

fileInput.addEventListener('dragenter', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});

fileInput.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    uploadArea.classList.add('drag-over');
});

fileInput.addEventListener('dragleave', e => {
    if (!uploadArea.contains(e.relatedTarget))
        uploadArea.classList.remove('drag-over');
});

fileInput.addEventListener('drop', () => {
    uploadArea.classList.remove('drag-over');
});

document.getElementById('convertBtn').addEventListener('click', convert);
document.getElementById('commentLines').addEventListener('input', reparse);
document.getElementById('headerLines').addEventListener('input', reparse);
