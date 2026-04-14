import { FORMATS, detectFormatFromExt, sniffFormat } from './formats.js';
import { parseDelimited, serializeDelimited } from './parser.js';
import { parseRFile } from './rds.js';
import { parseSavFile } from './spss.js';
import { generateCsvw } from './csvw.js';

const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_COLS = 100;

let parsedRows    = null;
let currentFile   = null;
let inputFormatId  = 'csv';
let outputFormatId = 'tsv';
let rTables       = null; // [{name, rows}] extracted from an R file
let rTableIndex   = 0;

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

function collapseHeaders(rows, headerLines, combineStr) {
    if (headerLines <= 1)
        return rows;
    const headerRows = rows.slice(0, headerLines);
    const dataRows   = rows.slice(headerLines);
    const maxCols    = headerRows.reduce((max, r) => Math.max(max, r.length), 0);
    const collapsed  = Array.from({ length: maxCols }, (_, c) =>
        headerRows.map(r => r[c] ?? '').filter(s => s !== '').join(combineStr)
    );
    return [collapsed, ...dataRows];
}

function reparse() {
    if (!currentFile)
        return;

    const commentLines = getSpinValue('commentLines');
    const headerLines  = getSpinValue('headerLines');
    const combineStr   = document.getElementById('combineStr').value;

    let text = currentFile.text;
    if (commentLines > 0) {
        const lines = text.split('\n');
        text = lines.slice(commentLines).join('\n');
    }

    document.getElementById('combineStr').disabled = headerLines <= 1;

    try {
        parsedRows = parseDelimited(text, getFormat(inputFormatId).delimiter);
        showError('');
        updateFileInfo();
        renderPreview(collapseHeaders(parsedRows, headerLines, combineStr), Math.min(headerLines, 1));
    } catch (e) {
        showError('Failed to parse file: ' + e.message);
        parsedRows = null;
        setOutputVisible(false);
    }
}

function setOutputVisible(visible) {
    const block = visible ? 'block' : 'none';
    const flex  = visible ? 'flex'  : 'none';
    document.getElementById('previewSection').style.display = block;
    document.getElementById('outputOptions').style.display  = block;
    document.getElementById('actionRow').style.display      = flex;
    document.getElementById('csvwNote').style.display       = flex;
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

function applyValueLabels(rows, columnMeta) {
    const [header, ...dataRows] = rows;
    return [header, ...dataRows.map(row =>
        row.map((val, i) => columnMeta[i]?.valueLabels?.[val] ?? val)
    )];
}

function labelsApplied() {
    return document.getElementById('applyLabelsCheck').checked;
}

function getActiveRows() {
    const table = rTables[rTableIndex];
    return labelsApplied() ? applyValueLabels(table.rows, table.columnMeta) : table.rows;
}

function getActiveColumnMeta() {
    const table = rTables[rTableIndex];
    if (!labelsApplied()) return table.columnMeta;
    return table.columnMeta?.map(m => {
        if (!m?.valueLabels) return m;
        const { valueLabels, ...rest } = m;
        return Object.keys(rest).length > 0 ? rest : null;
    }) ?? null;
}

function isBinaryExtension(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return ext === 'rds' || ext === 'rdata' || ext === 'rda' || ext === 'sav';
}

async function loadFile(file) {
    showError('');

    const area = document.getElementById('uploadArea');
    area.querySelector('.upload-text').textContent = file.name;
    area.querySelector('.upload-hint').textContent = 'Click or drop to change file';
    area.classList.add('has-file');

    // Reset all state
    parsedRows = null;
    currentFile = null;
    rTables = null;
    rTableIndex = 0;
    document.getElementById('applyLabelsCheck').checked = false;
    document.getElementById('valueLabelsOption').style.display = 'none';

    setOutputVisible(false);
    document.getElementById('inputOptions').style.display   = 'none';
    document.getElementById('fileInfo').style.display       = 'none';
    document.getElementById('rTablesSection').style.display = 'none';

    try {
        if (isBinaryExtension(file.name))
            await loadBinaryData(file);
        else
            await loadTextData(file);
    } catch (err) {
        showError('Could not read file: ' + err.message);
    }
}

async function loadTextData(file) {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF)
        text = text.slice(1); // strip UTF-8 BOM

    const lines        = text.split('\n');
    const commentCount = lines.findIndex(line => !line.startsWith('#'));
    document.getElementById('commentLines').value = commentCount < 0 ? 0 : commentCount;

    const sniffText  = commentCount > 0 ? lines.slice(commentCount).join('\n') : text;
    const detectedId = detectFormatFromExt(file.name) ?? sniffFormat(sniffText);
    currentFile = { name: file.name, text };

    setInputFormat(detectedId);
    setOutputFormat(FORMATS.find(f => f.id !== detectedId).id);

    document.getElementById('inputOptions').style.display = 'block';

    reparse();
}

async function loadBinaryData(file) {
    const ext    = file.name.split('.').pop().toLowerCase();
    const buffer = await file.arrayBuffer();
    rTables = ext === 'sav'
        ? await parseSavFile(buffer, file.name)
        : await parseRFile(buffer, file.name);

    if (rTables.length === 0) {
        showError('No data tables found in R file.');
        return;
    }

    setOutputFormat('csv');
    buildRTablesList();
    selectRTable(0);
}

function buildRTablesList() {
    const section = document.getElementById('rTablesSection');
    const list    = document.getElementById('rTablesList');
    list.innerHTML = '';

    for (let i = 0; i < rTables.length; i++) {
        const t    = rTables[i];
        const nrow = t.rows.length - 1;
        const ncol = t.rows[0]?.length ?? 0;
        const item = document.createElement('div');
        item.className   = 'r-table-item';
        item.dataset.idx = i;
        item.innerHTML   =
            `<span class="r-table-name">${t.name}</span>` +
            `<span class="r-table-dims">${nrow} × ${ncol}</span>`;
        item.addEventListener('click', () => selectRTable(i));
        list.appendChild(item);
    }

    section.style.display = rTables.length > 1 ? 'block' : 'none';
}

function selectRTable(index) {
    rTableIndex = index;

    // Highlight selected item in list
    const items = document.querySelectorAll('.r-table-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === index));

    const table = rTables[index];
    const nrow  = table.rows.length - 1;
    const ncol  = table.rows[0]?.length ?? 0;
    const info  = document.getElementById('fileInfo');
    info.textContent = rTables.length > 1
        ? `${table.name}: ${nrow} row${nrow !== 1 ? 's' : ''}, ${ncol} column${ncol !== 1 ? 's' : ''}`
        : `${nrow} row${nrow !== 1 ? 's' : ''}, ${ncol} column${ncol !== 1 ? 's' : ''}`;
    info.style.display = 'block';

    const btn = document.getElementById('convertBtn');
    btn.textContent = rTables.length > 1
        ? `Download "${table.name}"`
        : 'Download Data';

    const hasLabels = table.columnMeta?.some(m => m?.valueLabels != null) ?? false;
    document.getElementById('applyLabelsCheck').checked = false;
    document.getElementById('valueLabelsOption').style.display = hasLabels ? 'block' : 'none';

    renderPreview(table.rows, 1);
    setOutputVisible(true);
}

function convert() {
    const fmt = getFormat(outputFormatId);
    let outputRows, downloadName;

    if (rTables) {
        outputRows   = getActiveRows();
        downloadName = rTables[rTableIndex].name;
    } else {
        if (!parsedRows)
            return;
        const headerLines = getSpinValue('headerLines');
        const combineStr  = document.getElementById('combineStr').value;
        outputRows   = collapseHeaders(parsedRows, headerLines, combineStr);
        downloadName = currentFile.name.replace(/\.[^.]+$/, '');
    }

    const output = serializeDelimited(outputRows, fmt.delimiter);
    const blob   = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href     = url;
    a.download = downloadName + '.' + fmt.ext;
    a.click();
    URL.revokeObjectURL(url);
}


function downloadCsvw() {
    const fmt = getFormat(outputFormatId);
    let rows, baseName;

    if (rTables) {
        rows     = getActiveRows();
        baseName = rTables[rTableIndex].name;
    } else {
        if (!parsedRows)
            return;
        const headerLines = getSpinValue('headerLines');
        const combineStr  = document.getElementById('combineStr').value;
        rows     = collapseHeaders(parsedRows, headerLines, combineStr);
        baseName = currentFile.name.replace(/\.[^.]+$/, '');
    }

    const csvFilename = baseName + '.' + fmt.ext;
    const meta    = rTables ? getActiveColumnMeta() : null;
    const content = generateCsvw(rows, csvFilename, meta);
    if (!content)
        return;

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = csvFilename + '-metadata.json';
    a.click();
    URL.revokeObjectURL(url);
}

// --- Event wiring ---

const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

// Guard against the click bubbling back up from fileInput to uploadArea.
uploadArea.addEventListener('click', e => {
    if (e.target !== fileInput)
        fileInput.click();
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0)
        loadFile(fileInput.files[0]);
});

uploadArea.addEventListener('dragenter', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', e => {
    if (!uploadArea.contains(e.relatedTarget))
        uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file)
        loadFile(file);
});

document.getElementById('convertBtn').addEventListener('click', convert);
document.getElementById('csvwBtn').addEventListener('click', downloadCsvw);
document.getElementById('applyLabelsCheck').addEventListener('change', () => {
    if (rTables)
        renderPreview(getActiveRows(), 1);
});
document.getElementById('commentLines').addEventListener('input', reparse);
document.getElementById('headerLines').addEventListener('input', reparse);
document.getElementById('combineStr').addEventListener('input', reparse);
