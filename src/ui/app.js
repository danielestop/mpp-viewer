// UI: file open, Project/Tasks/Resources/Assignments tabs, cross-linked details,
// search. Uses the global CFB library.
import { readMpp } from '../mpp/reader.js';
import { formatNumber, formatDate, formatDuration, formatPercent, formatPredecessor, formatRate, formatMaxUnits, formatAssignmentUnits, formatAssignmentWork, matchesQuery, customFieldRows, availableColumns, customFieldValues, customColumnText, progressWidth, projectSummary, RESOURCE_TYPE_LABELS, DATE_FORMATS, setDateFormat, getDateFormat } from './display.js';

const $ = id => document.getElementById(id);
const drop = $('drop');
const input = $('file');
const errorBox = $('error');
const viewer = $('viewer');
const search = $('search');
const TABS = ['project', 'tasks', 'resources', 'assignments'];

// Page state for the open file.
const state = {
  model: null,
  taskByUid: new Map(),
  resourceByUid: new Map(),
  assignmentsByTask: new Map(),
  assignmentsByResource: new Map(),
  collapsed: new Set(), // uids of collapsed summary tasks
  selectedTask: null,
  selectedResource: null,
  groupBy: 'task',
  query: '',
  fileName: '',
  columns: { tasks: new Set(), resources: new Set() }, // field IDs picked as columns, kept across files
  available: { tasks: [], resources: [] }, // columns offered for the open file: [{ field, label }]
};

// --- basic elements ---

function el(tag, { text, className, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function cell(row, content, className) {
  const td = el('td', { className });
  if (typeof content === 'string') td.textContent = content;
  else if (content) td.append(content);
  row.append(td);
  return td;
}

// Button styled as a link (jumps to a task or resource).
function linkButton(text, onClick, title) {
  const button = el('button', { text, className: 'link', attrs: { type: 'button' } });
  if (title) button.title = title;
  button.addEventListener('click', e => {
    e.stopPropagation();
    onClick();
  });
  return button;
}

function joinNodes(nodes, separator) {
  const span = el('span');
  nodes.forEach((n, i) => {
    if (i > 0) span.append(separator);
    span.append(n);
  });
  return span;
}

function definitionList(dl, rows) {
  dl.replaceChildren();
  for (const [label, value] of rows) {
    const dd = el('dd');
    if (typeof value === 'string') dd.textContent = value || '—';
    else dd.append(value);
    dl.append(el('dt', { text: label }), dd);
  }
}

// % complete with a mini bar (green at 100%); empty text when missing.
function progress(value) {
  const width = progressWidth(value);
  if (width === null) return '';
  const bar = el('span', { className: 'bar' });
  bar.style.width = `${width}%`;
  return el('span', { className: width === 100 ? 'progress done' : 'progress' }, [
    el('span', { className: 'track', attrs: { 'aria-hidden': 'true' } }, [bar]),
    el('span', { text: formatPercent(value) }),
  ]);
}

const taskLabel = task => `${task.id} · ${task.name ?? '(unnamed)'}`;
const resourceLabel = resource => resource.name ?? `(resource ${resource.id})`;
const visibleAssignments = list => (list ?? []).filter(a => a.resourceUid !== null);
const hasTasks = model => model.tasks.some(t => t.uid !== 0 && !t.null);

// --- tabs ---

function selectTab(name, focus = false) {
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    const selected = tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`panel-${tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  search.disabled = name === 'project';
}

for (const tab of TABS) {
  const button = $(`tab-${tab}`);
  button.addEventListener('click', () => selectTab(tab));
  // Left/right arrows move between tabs, like standard tabs.
  button.addEventListener('keydown', e => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length], true);
  });
}

// --- project ---

function card(label, value, extra) {
  return el('div', { className: 'card' }, [
    el('span', { text: label, className: 'card-label' }),
    el('strong', { text: value || '—', className: 'card-value' }),
    ...(extra ? [extra] : []),
  ]);
}

function renderProject(fileName) {
  const { model } = state;
  const p = model.project;
  const summary = projectSummary(model);
  const { milestones } = summary;
  const percent = progress(summary.percentComplete);
  $('project-cards').replaceChildren(
    card('Start', formatDate(summary.start)),
    card('Finish', formatDate(summary.finish)),
    ...(percent ? [card('% complete', formatPercent(summary.percentComplete), percent)] : []),
    card('Tasks', formatNumber(summary.tasks), milestones
      ? el('span', { text: `${formatNumber(milestones)} ${milestones === 1 ? 'milestone' : 'milestones'}`, className: 'card-note' })
      : undefined),
    card('Resources', formatNumber(summary.resources)),
    card('Assignments', formatNumber(summary.assignments)),
  );
  definitionList($('project-details'), [
    ['Title', p.title || ''],
    ['File', fileName],
    ['Saved with', model.applicationName || ''],
    ['Subject', p.subject || ''],
    ['Author', p.author || ''],
    ['Company', p.company || ''],
    ['Manager', p.manager || ''],
    ['Start', formatDate(p.start)],
    ['Finish', formatDate(p.finish)],
    ['Status date', formatDate(p.statusDate)],
    ['Tasks', `${summary.tasks}${milestones ? ` (${milestones} ${milestones === 1 ? 'milestone' : 'milestones'})` : ''}`],
    ['Resources', String(summary.resources)],
    ['Assignments', String(summary.assignments)],
  ]);
}

// --- tasks ---

// Rows to show: without a search, respect collapsed summaries; with one, only the matches.
function visibleTasks() {
  const tasks = state.model.tasks.filter(t => t.uid !== 0);
  // Name and WBS by substring; unique ID only on exact match (searching "7" won't show 17 or 70).
  if (state.query) {
    const columns = shownColumns('tasks');
    return tasks.filter(t => !t.null && (matchesQuery(state.query, t.name, t.wbs, ...columnTexts('tasks', t, columns)) || String(t.uid) === state.query));
  }
  const result = [];
  let hiddenBelow = null; // level of the collapsed summary we're inside
  for (const task of tasks) {
    const level = task.outlineLevel;
    if (hiddenBelow !== null) {
      if (level === null || level > hiddenBelow) continue;
      hiddenBelow = null;
    }
    result.push(task);
    if (task.summary && state.collapsed.has(task.uid)) hiddenBelow = level ?? 0;
  }
  return result;
}

function resourceNamesFor(task) {
  return visibleAssignments(state.assignmentsByTask.get(task.uid))
    .map(a => state.resourceByUid.get(a.resourceUid))
    .filter(Boolean);
}

function renderTasks() {
  const rows = document.createDocumentFragment();
  const tasks = visibleTasks();
  const columns = shownColumns('tasks');
  for (const task of tasks) {
    const row = el('tr', { attrs: { 'data-uid': task.uid } });
    if (task.null) {
      row.className = 'empty';
      cell(row, String(task.id), 'num');
      cell(row, String(task.uid), 'num');
      for (let i = 0; i < 10 + columns.length; i++) cell(row, '');
      rows.append(row);
      continue;
    }
    row.tabIndex = 0;
    if (task.summary) row.classList.add('summary');
    if (task.uid === state.selectedTask) row.classList.add('selected');
    cell(row, String(task.id), 'num');
    cell(row, String(task.uid), 'num');
    cell(row, task.wbs ?? '');

    const name = el('span', { text: task.name ?? '', className: task.milestone ? 'milestone' : '' });
    const nameCell = cell(row, null, 'name');
    nameCell.style.paddingLeft = `${10 + (state.query ? 0 : Math.max(0, (task.outlineLevel ?? 1) - 1) * 18)}px`;
    if (task.summary && !state.query) {
      const collapsed = state.collapsed.has(task.uid);
      const toggle = el('button', {
        text: collapsed ? '▸' : '▾',
        className: 'toggle',
        attrs: { type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': collapsed ? 'Expand' : 'Collapse' },
      });
      toggle.addEventListener('click', e => {
        e.stopPropagation();
        if (collapsed) state.collapsed.delete(task.uid);
        else state.collapsed.add(task.uid);
        renderTasks();
      });
      nameCell.append(toggle);
    }
    nameCell.append(name);

    cell(row, formatDuration(task.duration), 'num');
    cell(row, formatDuration(task.work), 'num');
    cell(row, formatDuration(task.remainingWork), 'num');
    cell(row, formatDate(task.start));
    cell(row, formatDate(task.finish));
    cell(row, progress(task.percentComplete), 'num');
    cell(row, joinNodes(task.predecessors.map(p => {
      const other = state.taskByUid.get(p.uid);
      return linkButton(formatPredecessor(p, other?.id ?? '?'), () => goToTask(p.uid), other ? taskLabel(other) : undefined);
    }), '; '));
    cell(row, joinNodes(resourceNamesFor(task).map(r => linkButton(resourceLabel(r), () => goToResource(r.uid))), ', '), 'names');
    for (const text of columnTexts('tasks', task, columns)) cell(row, text);
    rows.append(row);
  }
  $('tasks-body').replaceChildren(rows);
  const empty = $('tasks-empty');
  const noTasks = !hasTasks(state.model);
  empty.hidden = !noTasks && tasks.length > 0;
  empty.textContent = noTasks ? 'The project contains no tasks.' : `No tasks match “${state.query}”.`;
}

function renderTaskDetail() {
  const box = $('task-detail');
  const task = state.taskByUid.get(state.selectedTask);
  box.hidden = !task;
  if (!task) return;
  const dl = el('dl', { className: 'details' });
  definitionList(dl, [
    ['Unique ID', String(task.uid)],
    ['WBS', task.wbs ?? ''],
    ['Duration', formatDuration(task.duration)],
    ['Work', formatDuration(task.work)],
    ['Remaining work', formatDuration(task.remainingWork)],
    ['Start', formatDate(task.start)],
    ['Finish', formatDate(task.finish)],
    ['% complete', progress(task.percentComplete)],
    ['Type', task.milestone ? 'Milestone' : task.summary ? 'Summary task' : 'Task'],
  ]);
  const assignments = visibleAssignments(state.assignmentsByTask.get(task.uid));
  const list = assignments.length
    ? detailTable(['Resource', 'Units', 'Work', 'Start', 'Finish'], assignments.map(a => {
      const resource = state.resourceByUid.get(a.resourceUid);
      return [
        resource ? linkButton(resourceLabel(resource), () => goToResource(resource.uid)) : '',
        formatAssignmentUnits(a, resource), formatAssignmentWork(a, resource), formatDate(a.start), formatDate(a.finish),
      ];
    }))
    : el('p', { text: 'No resources assigned.', className: 'empty-note' });
  box.replaceChildren(
    detailHeader(taskLabel(task), () => selectTask(null)),
    dl,
    ...customFieldsSection(task.customFields, 'task'),
    ...customFieldsSection(task.enterpriseFields, 'task', 'Enterprise fields'),
    el('h3', { text: `Assigned resources (${assignments.length})` }),
    list,
    ...assignmentCustomFields(assignments, a => resourceLabel(state.resourceByUid.get(a.resourceUid) ?? { id: a.resourceUid })),
  );
}

// Highlights the selected row without redrawing the table (stays fast with thousands of rows).
function markSelected(bodyId, uid) {
  const body = $(bodyId);
  body.querySelector('tr.selected')?.classList.remove('selected');
  if (uid !== null) body.querySelector(`tr[data-uid="${uid}"]`)?.classList.add('selected');
}

function selectTask(uid) {
  state.selectedTask = uid;
  markSelected('tasks-body', uid);
  renderTaskDetail();
}

// Go to a task: Tasks tab, parent summaries expanded, row selected and scrolled into view.
function goToTask(uid) {
  const task = state.taskByUid.get(uid);
  if (!task) return;
  clearQueryWithoutTasks();
  for (let parent = parentOf(task); parent; parent = parentOf(parent)) state.collapsed.delete(parent.uid);
  selectTab('tasks');
  renderTasks();
  selectTask(uid);
  focusRow('tasks-body', uid);
}

// Parent summary: the closest earlier task with a lower level.
function parentOf(task) {
  const tasks = state.model.tasks;
  for (let i = tasks.indexOf(task) - 1; i >= 0; i--) {
    const level = tasks[i].outlineLevel;
    if (level !== null && task.outlineLevel !== null && level < task.outlineLevel) return tasks[i];
  }
  return null;
}

// --- resources ---

function renderResources() {
  const columns = shownColumns('resources');
  const resources = state.model.resources
    .filter(r => r.uid !== 0)
    .filter(r => matchesQuery(state.query, r.name, r.initials, r.group, ...(state.query ? columnTexts('resources', r, columns) : [])));
  const rows = document.createDocumentFragment();
  for (const r of resources) {
    const row = el('tr', { attrs: { 'data-uid': r.uid } });
    row.tabIndex = 0;
    if (r.uid === state.selectedResource) row.classList.add('selected');
    cell(row, String(r.id), 'num');
    cell(row, r.name ?? '', 'name');
    cell(row, RESOURCE_TYPE_LABELS[r.type] ?? r.type);
    cell(row, r.initials ?? '');
    cell(row, r.group ?? '');
    cell(row, formatMaxUnits(r), 'num');
    cell(row, formatRate(r), 'num');
    for (const text of columnTexts('resources', r, columns)) cell(row, text);
    rows.append(row);
  }
  $('resources-body').replaceChildren(rows);
  const empty = $('resources-empty');
  const noResources = !state.model.resources.some(r => r.uid !== 0);
  empty.hidden = resources.length > 0;
  empty.textContent = noResources ? 'The project contains no resources.' : `No resources match “${state.query}”.`;
}

function renderResourceDetail() {
  const box = $('resource-detail');
  const resource = state.resourceByUid.get(state.selectedResource);
  box.hidden = !resource;
  if (!resource) return;
  const dl = el('dl', { className: 'details' });
  definitionList(dl, [
    ['Type', RESOURCE_TYPE_LABELS[resource.type] ?? resource.type],
    ['Initials', resource.initials ?? ''],
    ['Group', resource.group ?? ''],
    ['Max units', formatMaxUnits(resource)],
    ['Standard rate', formatRate(resource)],
  ]);
  const assignments = state.assignmentsByResource.get(resource.uid) ?? [];
  const list = assignments.length
    ? detailTable(['Task', 'Units', 'Work', 'Start', 'Finish'], assignments.map(a => {
      const task = state.taskByUid.get(a.taskUid);
      return [
        task ? linkButton(taskLabel(task), () => goToTask(task.uid)) : '',
        formatAssignmentUnits(a, resource), formatAssignmentWork(a, resource), formatDate(a.start), formatDate(a.finish),
      ];
    }))
    : el('p', { text: 'Not assigned to any task.', className: 'empty-note' });
  box.replaceChildren(
    detailHeader(resourceLabel(resource), () => selectResource(null)),
    dl,
    ...customFieldsSection(resource.customFields, 'resource'),
    ...customFieldsSection(resource.enterpriseFields, 'resource', 'Enterprise fields'),
    el('h3', { text: `Assigned tasks (${assignments.length})` }),
    list,
    ...assignmentCustomFields(assignments, a => {
      const task = state.taskByUid.get(a.taskUid);
      return task ? taskLabel(task) : String(a.taskUid);
    }),
  );
}

function selectResource(uid) {
  state.selectedResource = uid;
  markSelected('resources-body', uid);
  renderResourceDetail();
}

function goToResource(uid) {
  if (!state.resourceByUid.has(uid)) return;
  setQuery('');
  selectTab('resources');
  selectResource(uid);
  focusRow('resources-body', uid);
}

// --- details ---

function detailHeader(title, onClose) {
  const close = el('button', { text: '×', className: 'close', attrs: { type: 'button', 'aria-label': 'Close details' } });
  close.addEventListener('click', onClose);
  return el('div', { className: 'detail-header' }, [el('h2', { text: title }), close]);
}

// "Custom fields" or "Enterprise fields" section of the details; skipped if nothing has a value.
function customFieldsSection(fields, cls, title = 'Custom fields') {
  const rows = customFieldRows(fields, state.model.customFieldNames?.[cls], state.model.enterpriseFieldTypes?.[cls]);
  if (!rows.length) return [];
  const dl = el('dl', { className: 'details' });
  definitionList(dl, rows);
  return [el('h3', { text: title }), dl];
}

// Custom and enterprise fields of the assignments listed in the details, one block per assignment.
function assignmentCustomFields(assignments, label) {
  return assignments.flatMap(a => customFieldsSection([...a.customFields, ...(a.enterpriseFields ?? [])], 'assignment', `Assignment fields · ${label(a)}`));
}

function detailTable(headers, rows) {
  const tbody = el('tbody');
  for (const values of rows) {
    const row = el('tr');
    values.forEach((value, i) => cell(row, value, i > 0 && i < 3 ? 'num' : undefined));
    tbody.append(row);
  }
  const head = el('tr', {}, headers.map((h, i) => el('th', { text: h, className: i > 0 && i < 3 ? 'num' : '' })));
  return el('div', { className: 'table-wrap compact' }, [el('table', {}, [el('thead', {}, [head]), tbody])]);
}

function focusRow(bodyId, uid) {
  const row = $(bodyId).querySelector(`tr[data-uid="${uid}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    row.focus({ preventScroll: true });
  }
}

// Click or Enter on a row selects it.
function bindRowSelection(bodyId, onSelect) {
  const body = $(bodyId);
  const pick = target => {
    const row = target.closest('tr[data-uid]');
    if (row && row.tabIndex === 0) onSelect(Number(row.dataset.uid));
  };
  body.addEventListener('click', e => pick(e.target));
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('tr')) pick(e.target);
  });
}

bindRowSelection('tasks-body', uid => selectTask(uid === state.selectedTask ? null : uid));
bindRowSelection('resources-body', uid => selectResource(uid === state.selectedResource ? null : uid));

$('expand-all').addEventListener('click', () => {
  state.collapsed.clear();
  renderTasks();
});
$('collapse-all').addEventListener('click', () => {
  for (const t of state.model.tasks) if (t.summary && t.uid !== 0) state.collapsed.add(t.uid);
  renderTasks();
});

// --- assignments ---

function renderAssignments() {
  const byTask = state.groupBy === 'task';
  $('assignments-first-column').textContent = byTask ? 'Resource' : 'Task';
  const rows = document.createDocumentFragment();
  const groups = byTask
    ? state.model.tasks.filter(t => t.uid !== 0).map(t => [t, visibleAssignments(state.assignmentsByTask.get(t.uid))])
    : state.model.resources.filter(r => r.uid !== 0).map(r => [r, state.assignmentsByResource.get(r.uid) ?? []]);
  let shown = 0;
  for (const [owner, all] of groups) {
    const items = all.filter(a => {
      const other = byTask ? state.resourceByUid.get(a.resourceUid) : state.taskByUid.get(a.taskUid);
      return matchesQuery(state.query, owner.name, other?.name);
    });
    if (!items.length) continue;
    shown += items.length;
    const title = byTask
      ? linkButton(taskLabel(owner), () => goToTask(owner.uid))
      : linkButton(resourceLabel(owner), () => goToResource(owner.uid));
    const header = el('tr', { className: 'group' });
    const th = el('th', { attrs: { colspan: '5', scope: 'rowgroup' } }, [title, el('span', { text: ` (${items.length})`, className: 'count' })]);
    header.append(th);
    rows.append(header);
    for (const a of items) {
      const task = state.taskByUid.get(a.taskUid);
      const resource = state.resourceByUid.get(a.resourceUid);
      const row = el('tr');
      cell(row, byTask
        ? (resource ? linkButton(resourceLabel(resource), () => goToResource(resource.uid)) : '')
        : (task ? linkButton(taskLabel(task), () => goToTask(task.uid)) : ''), 'name indent');
      cell(row, formatAssignmentUnits(a, resource), 'num');
      cell(row, formatAssignmentWork(a, resource), 'num');
      cell(row, formatDate(a.start));
      cell(row, formatDate(a.finish));
      rows.append(row);
    }
  }
  $('assignments-body').replaceChildren(rows);
  const empty = $('assignments-empty');
  empty.hidden = shown > 0;
  empty.textContent = visibleAssignments(state.model.assignments).length === 0
    ? 'No resources are assigned to tasks.'
    : `No assignments match “${state.query}”.`;
}

for (const radio of document.querySelectorAll('input[name="group-by"]')) {
  radio.addEventListener('change', () => {
    state.groupBy = radio.value;
    renderAssignments();
  });
}

// --- search ---

function setQuery(query) {
  if (state.query === query) return;
  state.query = query;
  search.value = query;
  renderTasks();
  renderResources();
  renderAssignments();
}

// Clears the search, redrawing resources and assignments; the caller redraws tasks.
function clearQueryWithoutTasks() {
  if (!state.query) return;
  state.query = '';
  search.value = '';
  renderResources();
  renderAssignments();
}

let searchTimer = null;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setQuery(search.value.trim()), 150);
});
search.addEventListener('keydown', e => {
  if (e.key === 'Escape') setQuery('');
});

// --- custom columns ---

// Only the picked field IDs (e.g. "TEXT3") are stored in the browser, never file values or names.
const COLUMNS_KEY = 'mpp-reader.columns';
const COLUMN_CLASS = { tasks: 'task', resources: 'resource' };
const valueCache = new WeakMap(); // item -> field -> value

function valuesOf(item) {
  let values = valueCache.get(item);
  if (!values) {
    values = customFieldValues(item);
    valueCache.set(item, values);
  }
  return values;
}

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? '{}');
    for (const kind of ['tasks', 'resources']) {
      if (Array.isArray(saved?.[kind])) state.columns[kind] = new Set(saved[kind].filter(f => typeof f === 'string'));
    }
  } catch {
    // storage unavailable or bad content: no extra columns
  }
}

function saveColumns() {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify({ tasks: [...state.columns.tasks], resources: [...state.columns.resources] }));
  } catch {
    // storage unavailable: the choice lasts until the page is closed
  }
}

// Added columns that are shown: the picked ones that have values in the open file, in offered order.
function shownColumns(kind) {
  return state.available[kind].filter(c => state.columns[kind].has(c.field));
}

function columnTexts(kind, item, columns) {
  const types = state.model.enterpriseFieldTypes?.[COLUMN_CLASS[kind]];
  return columns.map(c => customColumnText(valuesOf(item), c.field, types));
}

function renderColumnHeaders(kind) {
  const row = $(`${kind}-body`).closest('table').querySelector('thead tr');
  row.querySelectorAll('th.extra').forEach(th => th.remove());
  for (const c of shownColumns(kind)) row.append(el('th', { text: c.label, className: 'extra' }));
}

// "Columns" button: one checkbox per field with values; hidden if the file has none.
function renderColumnPicker(kind) {
  const box = $(`${kind}-columns`);
  box.open = false;
  box.hidden = state.available[kind].length === 0;
  box.querySelector('.columns-list').replaceChildren(...state.available[kind].map(c => {
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.checked = state.columns[kind].has(c.field);
    input.addEventListener('change', () => {
      if (input.checked) state.columns[kind].add(c.field);
      else state.columns[kind].delete(c.field);
      saveColumns();
      renderColumnHeaders(kind);
      if (kind === 'tasks') renderTasks();
      else renderResources();
    });
    return el('label', {}, [input, el('span', { text: c.label })]);
  }));
  renderColumnHeaders(kind);
}

// The column list closes on an outside click or Esc.
document.addEventListener('click', e => {
  for (const box of document.querySelectorAll('details.columns[open]')) if (!box.contains(e.target)) box.open = false;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const box of document.querySelectorAll('details.columns[open]')) {
    box.open = false;
    box.querySelector('summary').focus();
  }
});

// --- opening the file ---

function indexModel(model) {
  state.model = model;
  state.taskByUid = new Map(model.tasks.map(t => [t.uid, t]));
  state.resourceByUid = new Map(model.resources.map(r => [r.uid, r]));
  state.assignmentsByTask = new Map();
  state.assignmentsByResource = new Map();
  for (const a of model.assignments) {
    if (!state.assignmentsByTask.has(a.taskUid)) state.assignmentsByTask.set(a.taskUid, []);
    state.assignmentsByTask.get(a.taskUid).push(a);
    if (a.resourceUid === null) continue;
    if (!state.assignmentsByResource.has(a.resourceUid)) state.assignmentsByResource.set(a.resourceUid, []);
    state.assignmentsByResource.get(a.resourceUid).push(a);
  }
  state.collapsed = new Set();
  state.selectedTask = null;
  state.selectedResource = null;
  state.query = '';
  search.value = '';
}

function showModel(fileName, model) {
  state.fileName = fileName;
  indexModel(model);
  errorBox.hidden = true;
  drop.hidden = true;
  $('project-title').textContent = model.project.title || fileName;
  $('file-name').textContent = model.project.title ? fileName : '';
  $('count-tasks').textContent = formatNumber(model.tasks.filter(t => t.uid !== 0 && !t.null).length);
  $('count-resources').textContent = formatNumber(model.resources.filter(r => r.uid !== 0).length);
  $('count-assignments').textContent = formatNumber(visibleAssignments(model.assignments).length);
  renderProject(fileName);
  $('project-empty').hidden = hasTasks(model);
  state.available.tasks = availableColumns(model.tasks.filter(t => t.uid !== 0 && !t.null), model.customFieldNames?.task);
  state.available.resources = availableColumns(model.resources.filter(r => r.uid !== 0), model.customFieldNames?.resource);
  renderColumnPicker('tasks');
  renderColumnPicker('resources');
  renderTasks();
  renderTaskDetail();
  renderResources();
  renderResourceDetail();
  renderAssignments();
  viewer.hidden = false;
  selectTab(hasTasks(model) ? 'tasks' : 'project');
}

function showError(message) {
  viewer.hidden = true;
  drop.hidden = false;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function load(file) {
  if (!file) return;
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    showError(`Cannot read “${file.name}” from disk: make sure the file is not open in another program and try again.`);
    return;
  }
  try {
    showModel(file.name, readMpp(bytes, window.CFB));
  } catch (e) {
    if (e.name === 'MppError') {
      showError(e.message);
    } else {
      showError('Could not read the file: it may be damaged or use a structure that is not supported yet.');
      console.error(e);
    }
  } finally {
    input.value = ''; // lets the same file be opened again
  }
}

// --- date format ---

// Choice stored in the browser (convenience only: falls back to the default without storage).
const DATE_FORMAT_KEY = 'mpp-reader.date-format';
const dateSelect = $('date-format');

function loadDateFormat() {
  let saved = null;
  try {
    saved = localStorage.getItem(DATE_FORMAT_KEY);
  } catch {
    // storage unavailable
  }
  // Default: month/day/year only for US English browsers.
  const fallback = navigator.language === 'en-US' ? 'mdy' : 'dmy';
  setDateFormat(DATE_FORMATS[saved] ? saved : fallback);
  dateSelect.value = getDateFormat();
}

dateSelect.addEventListener('change', () => {
  setDateFormat(dateSelect.value);
  try {
    localStorage.setItem(DATE_FORMAT_KEY, getDateFormat());
  } catch {
    // storage unavailable: the choice lasts until the page is closed
  }
  if (!state.model) return;
  renderProject(state.fileName);
  renderTasks();
  renderTaskDetail();
  renderResources();
  renderResourceDetail();
  renderAssignments();
});

// --- theme ---

// Auto follows the system; Light and Dark override it. Only the choice is stored.
const THEME_KEY = 'mpp-reader.theme';
const THEMES = ['auto', 'light', 'dark'];
const themeSelect = $('theme');

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
}

function loadTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    // storage unavailable
  }
  applyTheme(THEMES.includes(saved) ? saved : 'auto');
}

themeSelect.addEventListener('change', () => {
  applyTheme(THEMES.includes(themeSelect.value) ? themeSelect.value : 'auto');
  try {
    localStorage.setItem(THEME_KEY, themeSelect.value);
  } catch {
    // storage unavailable: the choice lasts until the page is closed
  }
});

loadTheme();
loadDateFormat();
loadColumns();

input.addEventListener('change', () => load(input.files[0]));
$('open-other').addEventListener('click', () => input.click());
// Drop zone is reachable from the keyboard too.
drop.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    input.click();
  }
});

// Drag and drop: on the start zone or, once a file is open, anywhere on the page.
window.addEventListener('dragover', e => {
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) drop.classList.remove('over');
});
window.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  load(e.dataTransfer?.files[0]);
});
