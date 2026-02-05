const API_BASE = 'http://localhost:3000/api';
let currentBmView = 'list'; 

/* ================= INIT ================= */

document.addEventListener('DOMContentLoaded', () => {
    switchTab('dashboard');
    loadBookmarks();
    loadTags(); // Load tags immediately for sidebar
});

// === TAB SWITCHING ===
function switchTab(tabName) {
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    
    document.querySelectorAll('.sidebar li').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${tabName}`).classList.add('active');
    document.getElementById(`view-${tabName}`).classList.remove('hidden');
    document.getElementById(`nav-${tabName}`).classList.add('active');

    // Load data on demand
    if (tabName === 'dashboard') { loadDashboard(); loadTags(); }
    if (tabName === 'tasks') loadTasks();
    if (tabName === 'bookmarks') loadBookmarks();
    if (tabName === 'research') loadNotes();
}

/* ================= BOOKMARKS LOGIC ================= */

async function loadBookmarks() {
    try {
        const res = await fetch(`${API_BASE}/bookmarks`);
        const bookmarks = await res.json();
        
        // Update Dashboard Stat
        const el = document.getElementById('dash-bm-count');
        if(el) el.innerText = bookmarks.length;

        renderBookmarks(bookmarks);
    } catch (err) {
        console.error('Failed to load bookmarks', err);
    }
}

async function addBookmark() {
    const urlInput = document.getElementById('bm-url-input');
    const titleInput = document.getElementById('bm-title-input'); // NEW
    const tagInput = document.getElementById('bm-tag-input');
    const descInput = document.getElementById('bm-desc-input'); 
    
    const url = urlInput.value.trim();
    if (!url) return alert("Please enter a URL");

    const payload = {
        url: url,
        title: titleInput.value.trim(), // Send user's title
        description: descInput.value.trim(), 
        tags: tagInput.value.split(',').map(t => t.trim().toLowerCase())
    };

    // Use user title as the main title if provided, otherwise send empty
    if (!payload.title) {
        payload.title = "Fetching title...";
    }

    try {
        await fetch(`${API_BASE}/bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        urlInput.value = '';
        titleInput.value = '';
        tagInput.value = '';
        descInput.value = '';
        loadBookmarks(); 
        loadTags();
    } catch (err) {
        console.error('Error saving bookmark', err);
    }
}


async function deleteBookmark(id) {
    if(!confirm("Delete this bookmark?")) return;
    try {
        await fetch(`${API_BASE}/bookmarks/${id}`, { method: 'DELETE' });
        loadBookmarks();
        loadTags(); // Refresh tags counts
    } catch (err) {
        console.error('Error deleting', err);
    }
}

function toggleBmView(view) {
    currentBmView = view;
    loadBookmarks(); 
}

/* ================= RENDER LOGIC (Twitter + Masonry) ================= */

function renderBookmarks(bookmarks) {
    const container = document.getElementById('bookmark-list');
    container.innerHTML = '';
    container.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';

    bookmarks.forEach(bm => {
        const div = document.createElement('div');
        div.className = 'bm-item'; 

        const isTwitter = bm.url.includes('x.com') || bm.url.includes('twitter.com');
        let mediaHtml = '';

        if (isTwitter && currentBmView === 'grid') {
            if (navigator.onLine) {
                const embedUrl = bm.url.replace('x.com', 'twitter.com');
                mediaHtml = `<div style="min-height:100px; display:flex; justify-content:center;"><blockquote class="twitter-tweet" data-dnt="true" data-theme="light"><a href="${embedUrl}"></a></blockquote></div>`;
            } else {
                mediaHtml = `<div style="padding:20px; text-align:center; background:#f8f9fa; border:1px dashed #ccc;">Offline Preview</div>`;
            }
        } else {
            if (bm.thumbnail && bm.thumbnail.startsWith('http')) {
                mediaHtml = `<img src="${bm.thumbnail}" style="width:100%; height:auto; display:block; border-radius:4px;" onerror="this.style.display='none'">`;
            }
        }

        let tagsHtml = '';
        if (bm.tags && bm.tags.length > 0) {
            tagsHtml = '<div style="margin-top:8px; display:flex; gap:5px; flex-wrap:wrap;">';
            bm.tags.forEach(t => {
                tagsHtml += `<span style="background:#eef; color:#007bff; padding:2px 6px; border-radius:4px; font-size:10px;">#${t}</span>`;
            });
            tagsHtml += '</div>';
        }

        const descHtml = (bm.description && bm.description !== "Pending...") 
            ? `<div style="margin-top: 8px; font-size: 13px; color: #444; background: #fffbe6; padding: 8px; border-left: 3px solid #ffd700;">💡 ${bm.description}</div>` 
            : '';

        if (currentBmView === 'grid') {
            div.innerHTML = `
                ${mediaHtml}
                <h4 style="margin:10px 0 5px 0; font-size:14px;"><a href="${bm.url}" target="_blank" style="text-decoration:none; color:#333;">${bm.title || 'Untitled'}</a></h4>
                ${descHtml}
                ${tagsHtml}
                <div style="margin-top:10px; text-align:right; display:flex; gap:5px; justify-content:flex-end;">
                    <!-- NEW: Edit Button -->
                    <button onclick='editBookmark(${JSON.stringify(bm)})' style="font-size:11px; color:white; background:#007bff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Edit</button>
                    <button onclick="deleteBookmark(${bm.id})" style="font-size:11px; color:white; background:#ff4444; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Delete</button>
                </div>
            `;
        }
        container.appendChild(div);
    });
    renderTwitterWidgets();
}

function renderTwitterWidgets() {
    if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load();
    } else {
        setTimeout(renderTwitterWidgets, 500);
    }
}

/* ================= TAGS LOGIC (WITH X BUTTON) ================= */

async function loadTags() {
    try {
        const res = await fetch(`${API_BASE}/tags`);
        const tags = await res.json();
        
        const container = document.getElementById('sidebar-tags');
        container.innerHTML = '';
        
        tags.forEach(tag => {
            // Container
            const wrapper = document.createElement('div');
            wrapper.style.display = 'inline-flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.justifyContent = 'space-between';
            wrapper.style.margin = '4px';
            wrapper.style.background = 'rgba(255,255,255,0.15)'; 
            wrapper.style.borderRadius = '15px';
            wrapper.style.padding = '4px 10px';
            wrapper.style.border = '1px solid rgba(255,255,255,0.1)';

            // Name
            const span = document.createElement('span');
            span.style.fontSize = '12px';
            span.style.color = '#fff';
            span.style.cursor = 'pointer';
            span.innerText = `${tag.name} (${tag.count})`;
            
            // Delete 'X' Button
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;'; 
            delBtn.style.marginLeft = '8px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.color = '#ff6b6b'; 
            delBtn.style.fontWeight = 'bold';
            delBtn.style.fontSize = '16px';
            delBtn.title = "Delete Tag";
            
            delBtn.onmouseover = () => delBtn.style.color = '#ff0000';
            delBtn.onmouseout = () => delBtn.style.color = '#ff6b6b';

            delBtn.onclick = (e) => {
                e.stopPropagation(); 
                deleteTag(tag.id, tag.name);
            };

            wrapper.appendChild(span);
            wrapper.appendChild(delBtn);
            container.appendChild(wrapper);
        });
    } catch (err) {
        console.error("Error loading tags:", err);
    }
}

async function deleteTag(id, name) {
    if(!confirm(`Warning: Deleting tag "${name}" will remove it from ALL bookmarks and notes. Proceed?`)) return;
    
    try {
        await fetch(`${API_BASE}/tags/${id}`, { method: 'DELETE' });
        loadTags(); // Refresh sidebar
        if(document.getElementById('view-bookmarks').classList.contains('active')) {
            loadBookmarks(); // Refresh bookmarks to show they lost the tag
        }
    } catch (err) {
        console.error("Error deleting tag", err);
    }
}

/* ================= TASKS LOGIC ================= */

async function loadTasks() {
    try {
        const res = await fetch(`${API_BASE}/tasks`);
        const tasks = await res.json();

        const todoCount = tasks.filter(t => t.status !== 'done').length;
        const el = document.getElementById('dash-task-count');
        if(el) el.innerText = `${todoCount} Pending`;

        renderTasks(tasks);
        renderCalendarPreview(tasks);
    } catch (err) {
        console.error('Failed to load tasks', err);
    }
}

/* ================= UPDATED TASK RENDER FUNCTION ================= */

function renderTasks(tasks) {
    document.getElementById('task-list-todo').innerHTML = '';
    document.getElementById('task-list-progress').innerHTML = '';
    document.getElementById('task-list-done').innerHTML = '';

    tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.style.background = '#fff';
        card.style.padding = '10px';
        card.style.marginBottom = '10px';
        card.style.borderRadius = '4px';
        card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        
        let controls = '';
        if (task.status === 'todo') controls = `<button onclick="updateTaskStatus(${task.id}, 'inprogress')">Start &rarr;</button>`;
        else if (task.status === 'inprogress') controls = `<button onclick="updateTaskStatus(${task.id}, 'todo')">&larr; Back</button> <button onclick="updateTaskStatus(${task.id}, 'done')">Done &checkmark;</button>`;
        else controls = `<button onclick="updateTaskStatus(${task.id}, 'inprogress')">Reopen</button>`;

        let dateHtml = task.due_date 
            ? `<input type="date" value="${task.due_date}" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent;">`
            : `<input type="date" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent;">`;

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-weight:bold;">${task.title}</div>
                <!-- NEW: Edit/Delete Task Buttons -->
                <div style="font-size:12px;">
                    <button onclick='editTaskTitle(${task.id}, "${task.title}")' style="border:none;background:none;cursor:pointer;">✏️</button>
                    <button onclick="deleteTask(${task.id})" style="border:none;background:none;cursor:pointer;color:red;">🗑️</button>
                </div>
            </div>
            ${dateHtml}
            <div style="margin-top:10px;">${controls}</div>
        `;

        if (task.status === 'todo') document.getElementById('task-list-todo').appendChild(card);
        else if (task.status === 'inprogress') document.getElementById('task-list-progress').appendChild(card);
        else document.getElementById('task-list-done').appendChild(card);
    });
}

function renderCalendarPreview(tasks) {
    const container = document.getElementById('simple-calendar');
    container.innerHTML = '';
    const datedTasks = tasks.filter(t => t.due_date).sort((a,b) => new Date(a.due_date) - new Date(b.due_date));

    if(datedTasks.length === 0) {
        container.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">No tasks scheduled.</div>';
        return;
    }

    datedTasks.forEach(t => {
        const item = document.createElement('div');
        item.style.padding = '8px';
        item.style.borderBottom = '1px solid #eee';
        const isDone = t.status === 'done' ? 'text-decoration:line-through; color:#aaa;' : '';
        item.innerHTML = `<div style="font-weight:bold; ${isDone}">${t.due_date}</div><div style="${isDone}">${t.title}</div>`;
        container.appendChild(item);
    });
}

async function addTask() {
    const input = document.getElementById('new-task-input');
    const title = input.value.trim();
    if (!title) return;
    await fetch(`${API_BASE}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, status: 'todo' }) });
    input.value = '';
    loadTasks();
}

async function updateTaskStatus(id, newStatus) {
    await fetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
    loadTasks();
}

async function updateTaskDate(id, dateStr) {
    if(!dateStr) return;
    await fetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: dateStr }) });
    loadTasks();
}

/* ================= NOTES LOGIC ================= */

let activeNoteId = null;
let saveTimer = null; 

async function loadNotes() {
    try {
        const res = await fetch(`${API_BASE}/notes`);
        const notes = await res.json();
        const list = document.getElementById('notes-list-ul');
        list.innerHTML = '';
        list.style.listStyle = 'none';
        list.style.padding = '0';
        notes.forEach(note => {
            const li = document.createElement('li');
            li.style.padding = '10px';
            li.style.borderBottom = '1px solid #eee';
            li.style.cursor = 'pointer';
            li.innerHTML = `<strong>${note.title || 'Untitled Note'}</strong><br><small style="color:#888">${new Date(note.created_at).toLocaleDateString()}</small>`;
            li.onclick = () => openNote(note.id);
            list.appendChild(li);
        });
    } catch (err) { console.error(err); }
}

async function createNewNote() {
    const res = await fetch(`${API_BASE}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Untitled Note', content: '' }) });
    const data = await res.json();
    activeNoteId = data.id;
    loadNotes(); 
    openNote(activeNoteId); 
}

async function openNote(id) {
    activeNoteId = id;
    const res = await fetch(`${API_BASE}/notes/${id}`);
    const note = await res.json();
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-editor').innerHTML = note.content || '';
}

async function saveCurrentNote() {
    if (!activeNoteId) return;
    const title = document.getElementById('note-title-input').value;
    const content = document.getElementById('note-editor').innerHTML;
    try {
        await fetch(`${API_BASE}/notes/${activeNoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content }) });
        const btn = document.querySelector('.save-float');
        const originalText = btn.innerText;
        btn.innerText = "Saved!";
        setTimeout(() => btn.innerText = originalText, 1000);
        loadNotes(); 
    } catch (err) { console.error('Save failed', err); }
}

const editor = document.getElementById('note-editor');
const titleInput = document.getElementById('note-title-input');
function triggerAutoSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 1000); }
if(editor) editor.addEventListener('input', triggerAutoSave);
if(titleInput) titleInput.addEventListener('input', triggerAutoSave);

/* ================= DASHBOARD ================= */

async function loadDashboard() {
    const [resTasks, resBms] = await Promise.all([fetch(`${API_BASE}/tasks`), fetch(`${API_BASE}/bookmarks`)]);
    const tasks = await resTasks.json();
    const bookmarks = await resBms.json();

    const todoCount = tasks.filter(t => t.status !== 'done').length;
    document.getElementById('dash-task-count').innerText = `${todoCount} Pending`;
    document.getElementById('dash-bm-count').innerText = `${bookmarks.length} Total`;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayTasks = tasks.filter(t => t.due_date === todayStr && t.status !== 'done');
    
    let agendaHtml = `<h3>Today's Agenda</h3>`;
    if(todayTasks.length === 0) agendaHtml += `<p style="color:#888">Nothing due today. Enjoy!</p>`;
    else todayTasks.forEach(t => agendaHtml += `<div style="padding:10px; background:#fff; border-left:4px solid #e67e22; margin-bottom:5px; border-radius:4px;">${t.title}</div>`);
    
    let agendaContainer = document.getElementById('dash-agenda');
    if(!agendaContainer) {
        agendaContainer = document.createElement('div');
        agendaContainer.id = 'dash-agenda';
        agendaContainer.style.marginTop = '20px';
        document.querySelector('.stats-container').after(agendaContainer);
    }
    agendaContainer.innerHTML = agendaHtml;
}

/* ================= SEARCH LOGIC ================= */
let searchDebounce;

function performSearch(query) {
    if (!query || query.length < 2) return;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
        document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
        document.getElementById('view-search').classList.remove('hidden');
        document.getElementById('view-search').classList.add('active');
        document.querySelectorAll('.sidebar li').forEach(el => el.classList.remove('active'));

        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
            const results = await res.json();
            renderSearchResults(results, query);
        } catch (err) { console.error(err); }
    }, 300); 
}

function renderSearchResults(results, query) {
    const container = document.getElementById('search-results-container');
    container.innerHTML = `<p>Found ${results.length} results for "<strong>${query}</strong>"</p>`;
    if (results.length === 0) return;
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '10px';

    results.forEach(item => {
        const div = document.createElement('div');
        div.style.background = '#fff';
        div.style.padding = '15px';
        div.style.borderRadius = '5px';
        div.style.borderLeft = `5px solid ${getTypeColor(item.type)}`;
        div.style.cursor = 'pointer';
        
        let icon = '';
        if(item.type === 'bookmark') icon = '🔖';
        if(item.type === 'task') icon = '✅';
        if(item.type === 'note') icon = '📝';

        div.innerHTML = `
            <div style="font-weight:bold; font-size:16px;">${icon} ${item.title}</div>
            <div style="color:#666; font-size:12px; margin-top:2px;">Type: ${item.type.toUpperCase()} | Info: ${item.info || ''}</div>
        `;
        div.onclick = () => {
            if(item.type === 'bookmark') switchTab('bookmarks'); 
            if(item.type === 'task') switchTab('tasks');
            if(item.type === 'note') { switchTab('research'); setTimeout(() => openNote(item.id), 100); }
        };
        list.appendChild(div);
    });
    container.appendChild(list);
}

function getTypeColor(type) {
    if(type === 'bookmark') return '#007bff';
    if(type === 'task') return '#28a745';
    if(type === 'note') return '#ffc107';
    return '#ccc';
}

/* ================= NEW EDIT/DELETE HELPER FUNCTIONS ================= */

async function editBookmark(bm) {
    const currentTags = bm.tags ? bm.tags.join(', ') : '';
    const newTags = prompt("Edit tags (comma-separated):", currentTags);
    if (newTags === null) return; // User cancelled

    const payload = {
        title: bm.title, // Keep existing data
        description: bm.description,
        tags: newTags.split(',').map(t => t.trim().toLowerCase())
    };

    try {
        await fetch(`${API_BASE}/bookmarks/${bm.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        loadBookmarks();
        loadTags();
    } catch (err) { console.error("Failed to update bookmark", err); }
}

async function deleteTask(id) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
        await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
        loadTasks();
    } catch (err) { console.error("Failed to delete task", err); }
}

async function editTaskTitle(id, currentTitle) {
    const newTitle = prompt("Enter new task title:", currentTitle);
    if (newTitle && newTitle.trim() !== "") {
        try {
            await fetch(`${API_BASE}/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim() })
            });
            loadTasks();
        } catch(err) { console.error("Failed to update task title", err); }
    }
}

async function deleteNote() {
    if (!activeNoteId) return;
    if (!confirm("Are you sure you want to delete this note permanently?")) return;

    try {
        await fetch(`${API_BASE}/notes/${activeNoteId}`, { method: 'DELETE' });
        document.getElementById('note-title-input').value = '';
        document.getElementById('note-editor').innerHTML = '';
        activeNoteId = null;
        loadNotes(); // Refresh the list
    } catch (err) { console.error("Failed to delete note", err); }
}

// And finally, update openNote to show the delete button
async function openNote(id) {
    activeNoteId = id;
    const res = await fetch(`${API_BASE}/notes/${id}`);
    const note = await res.json();
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-editor').innerHTML = note.content || '';
    
    // Add delete button dynamically
    const saveBtn = document.querySelector('.save-float');
    let delBtn = document.getElementById('delete-note-btn');
    if (!delBtn) {
        delBtn = document.createElement('button');
        delBtn.id = 'delete-note-btn';
        delBtn.innerText = "Delete Note";
        delBtn.style.background = "#ff4444";
        delBtn.style.color = "white";
        delBtn.onclick = deleteNote;
        saveBtn.after(delBtn);
    }
}