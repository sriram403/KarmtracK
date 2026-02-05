const API_BASE = 'http://localhost:3000/api';
let currentBmView = 'grid'; // Default to grid

/* =================================================================
   INITIALIZATION & CORE NAVIGATION
   ================================================================= */

document.addEventListener('DOMContentLoaded', () => {
    // Initial data load for the dashboard view
    switchTab('dashboard');
    
    // Set up event listeners that only need to be attached once
    document.getElementById('bm-folder-select').addEventListener('change', (e) => {
        if (e.target.value === 'CREATE_NEW') {
            createNewFolder();
        }
    });

    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title-input');
    if (editor) editor.addEventListener('input', triggerAutoSave);
    if (titleInput) titleInput.addEventListener('input', triggerAutoSave);
});

function switchTab(tabName) {
    // Hide all main content sections
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    
    // De-select all sidebar items
    document.querySelectorAll('.sidebar li').forEach(el => el.classList.remove('active'));

    // Show the selected section and highlight the sidebar item
    document.getElementById(`view-${tabName}`).classList.add('active');
    document.getElementById(`nav-${tabName}`).classList.add('active');

    // Load the necessary data for the new tab
    if (tabName === 'dashboard') { loadDashboard(); loadTags(); loadFolders(); }
    if (tabName === 'bookmarks') { loadBookmarks(); loadFolders(); }
    if (tabName === 'tasks') loadTasks();
    if (tabName === 'research') loadNotes();
}

/* =================================================================
   BOOKMARKS
   ================================================================= */

async function addBookmark() {
    const urlInput = document.getElementById('bm-url-input');
    const titleInput = document.getElementById('bm-title-input');
    const tagInput = document.getElementById('bm-tag-input');
    const descInput = document.getElementById('bm-desc-input');
    const folderSelect = document.getElementById('bm-folder-select');
    
    const url = urlInput.value.trim();
    if (!url) return alert("Please enter a URL");

    const payload = {
        url: url,
        title: titleInput.value.trim() || "Fetching title...",
        description: descInput.value.trim(), 
        tags: tagInput.value.split(',').map(t => t.trim().toLowerCase()),
        folderId: folderSelect.value
    };

    try {
        await fetch(`${API_BASE}/bookmarks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        urlInput.value = ''; titleInput.value = ''; tagInput.value = ''; descInput.value = '';
        loadBookmarks(); 
        loadTags();
    } catch (err) { console.error('Error saving bookmark', err); }
}

async function loadBookmarks() {
    try {
        const res = await fetch(`${API_BASE}/bookmarks`);
        const bookmarks = await res.json();
        renderBookmarks(bookmarks);
    } catch (err) { console.error("Failed to load bookmarks", err); }
}

async function editBookmark(bm) {
    const newTitle = prompt("Edit Title:", bm.title || '');
    if (newTitle === null) return;
    const newDesc = prompt("Edit Possible Idea:", bm.description && bm.description !== "Pending..." ? bm.description : '');
    if (newDesc === null) return;
    const currentTags = bm.tags ? bm.tags.join(', ') : '';
    const newTags = prompt("Edit tags (comma-separated):", currentTags);
    if (newTags === null) return;

    const payload = { title: newTitle.trim(), description: newDesc.trim(), tags: newTags.split(',').map(t => t.trim().toLowerCase()) };
    try {
        await fetch(`${API_BASE}/bookmarks/${bm.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        loadBookmarks();
        loadTags();
    } catch (err) { console.error("Failed to update bookmark", err); }
}

async function deleteBookmark(id) {
    if(!confirm("Delete this bookmark?")) return;
    try {
        await fetch(`${API_BASE}/bookmarks/${id}`, { method: 'DELETE' });
        loadBookmarks();
        loadTags();
    } catch (err) { console.error('Error deleting', err); }
}

function toggleBmView(view) {
    currentBmView = view;
    loadBookmarks();
}

function renderBookmarks(bookmarks) {
    const mainContainer = document.getElementById('bookmark-list');
    mainContainer.innerHTML = '';
    mainContainer.className = '';

    const groupedByFolder = bookmarks.reduce((acc, bm) => {
        const folderName = bm.folder_name || 'Uncategorized';
        if (!acc[folderName]) acc[folderName] = [];
        acc[folderName].push(bm);
        return acc;
    }, {});

    for (const folderName in groupedByFolder) {
        const header = document.createElement('h2');
        header.textContent = folderName;
        header.style.borderBottom = '2px solid #eee';
        header.style.paddingBottom = '5px';
        header.style.marginTop = '20px';
        mainContainer.appendChild(header);

        const folderContainer = document.createElement('div');
        folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
        mainContainer.appendChild(folderContainer);

        groupedByFolder[folderName].forEach(bm => {
            const div = document.createElement('div');
            div.className = 'bm-item';
            
            const isTwitter = bm.url.includes('x.com') || bm.url.includes('twitter.com');
            let tagsHtml = bm.tags && bm.tags.length > 0 ? `<div style="margin-top:8px; display:flex; gap:5px; flex-wrap:wrap;">${bm.tags.map(t => `<span style="background:#eef; color:#007bff; padding:2px 6px; border-radius:4px; font-size:10px;">#${t}</span>`).join('')}</div>` : '';
            const descHtml = (bm.description && bm.description !== "Pending...") ? `<div style="margin-top: 8px; font-size: 13px; color: #444; background: #fffbe6; padding: 8px; border-left: 3px solid #ffd700;">💡 ${bm.description}</div>` : '';

            if (currentBmView === 'grid') {
                let mediaHtml = '';
                if (isTwitter) mediaHtml = navigator.onLine ? `<div style="min-height:100px; display:flex; justify-content:center;"><blockquote class="twitter-tweet" data-dnt="true" data-theme="light"><a href="${bm.url.replace('x.com','twitter.com')}"></a></blockquote></div>` : `<div style="padding:20px; text-align:center; background:#f8f9fa; border:1px dashed #ccc;">Offline Preview</div>`;
                else if (bm.thumbnail) mediaHtml = `<img src="${bm.thumbnail}" style="width:100%; height:auto; display:block; border-radius:4px;" onerror="this.style.display='none'">`;
                
                div.innerHTML = `
                    ${mediaHtml}
                    <h4 style="margin:10px 0 5px 0;"><a href="${bm.url}" target="_blank" style="text-decoration:none; color:#333;">${bm.title}</a></h4>
                    ${descHtml}
                    ${tagsHtml}
                    <div style="margin-top:10px; text-align:right; display:flex; gap:5px; justify-content:flex-end;">
                        <button onclick='editBookmark(${JSON.stringify(bm)})' style="font-size:11px; color:white; background:#007bff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Edit</button>
                        <button onclick="deleteBookmark(${bm.id})" style="font-size:11px; color:white; background:#ff4444; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Delete</button>
                    </div>`;
            } else {
                div.style.display = 'flex';
                div.style.justifyContent = 'space-between';
                div.style.alignItems = 'center';
                div.style.padding = '10px';
                div.style.borderBottom = '1px solid #eee';
                div.innerHTML = `
                    <div style="flex: 1; overflow: hidden; margin-right: 15px;">
                        <a href="${bm.url}" target="_blank" style="text-decoration:none; font-weight:bold;">${bm.title}</a>
                        ${descHtml}
                        ${tagsHtml}
                    </div>
                    <div style="display:flex; gap:5px;">
                         <button onclick='editBookmark(${JSON.stringify(bm)})' style="font-size:11px; color:white; background:#007bff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Edit</button>
                         <button onclick="deleteBookmark(${bm.id})" style="font-size:11px; color:white; background:#ff4444; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Delete</button>
                    </div>`;
            }
            folderContainer.appendChild(div);
        });
    }
    renderTwitterWidgets();
}

function renderTwitterWidgets() {
    if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load();
    } else {
        setTimeout(renderTwitterWidgets, 500);
    }
}


/* =================================================================
   FOLDERS
   ================================================================= */

async function loadFolders() {
    try {
        const res = await fetch(`${API_BASE}/folders`);
        const folders = await res.json();
        
        const selectDropdown = document.getElementById('bm-folder-select');
        const sidebarList = document.getElementById('sidebar-folders');
        
        selectDropdown.innerHTML = '<option value="">Uncategorized</option>';
        sidebarList.innerHTML = '';

        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name;
            selectDropdown.appendChild(option);
            
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '5px';
            div.style.color = '#fff';
            div.innerHTML = `<span>${folder.name}</span> <button onclick="deleteFolder(${folder.id}, '${folder.name}')" style="color:red; border:none; background:none; cursor:pointer;">&times;</button>`;
            sidebarList.appendChild(div);
        });
        
        const createOption = document.createElement('option');
        createOption.value = 'CREATE_NEW';
        createOption.textContent = '--- Create New Folder ---';
        selectDropdown.appendChild(createOption);
        
    } catch (err) { console.error("Failed to load folders", err); }
}

async function createNewFolder() {
    const folderName = prompt("Enter new folder name:");
    if (folderName && folderName.trim() !== "") {
        try {
            const res = await fetch(`${API_BASE}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folderName.trim() }) });
            const newFolder = await res.json();
            await loadFolders(); // Refresh lists
            document.getElementById('bm-folder-select').value = newFolder.id;
        } catch (err) { console.error("Failed to create folder", err); }
    } else {
        document.getElementById('bm-folder-select').value = "";
    }
}

async function deleteFolder(id, name) {
    if (!confirm(`Are you SURE you want to delete the "${name}" folder? All bookmarks inside it will be permanently deleted.`)) return;
    try {
        await fetch(`${API_BASE}/folders/${id}`, { method: 'DELETE' });
        loadFolders();
        loadBookmarks();
    } catch(err) { console.error("Failed to delete folder", err); }
}


/* =================================================================
   TAGS
   ================================================================= */

async function loadTags() {
    try {
        const res = await fetch(`${API_BASE}/tags`);
        const tags = await res.json();
        const container = document.getElementById('sidebar-tags');
        container.innerHTML = '';
        tags.forEach(tag => {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'inline-flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.margin = '4px';
            wrapper.style.background = 'rgba(255,255,255,0.15)';
            wrapper.style.borderRadius = '15px';
            wrapper.style.padding = '4px 10px';
            const span = document.createElement('span');
            span.style.fontSize = '12px';
            span.style.color = '#fff';
            span.innerText = `${tag.name} (${tag.count})`;
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;';
            delBtn.style.marginLeft = '8px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.color = '#ff6b6b';
            delBtn.style.fontWeight = 'bold';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteTag(tag.id, tag.name); };
            wrapper.appendChild(span);
            wrapper.appendChild(delBtn);
            container.appendChild(wrapper);
        });
    } catch (err) { console.error("Error loading tags:", err); }
}

async function deleteTag(id, name) {
    if(!confirm(`Warning: Deleting tag "${name}" will remove it from ALL items. Proceed?`)) return;
    try {
        await fetch(`${API_BASE}/tags/${id}`, { method: 'DELETE' });
        loadTags();
        if(document.getElementById('view-bookmarks').classList.contains('active')) {
            loadBookmarks();
        }
    } catch (err) { console.error("Error deleting tag", err); }
}


/* =================================================================
   TASKS & CALENDAR
   ================================================================= */

async function loadTasks() {
    try {
        const res = await fetch(`${API_BASE}/tasks`);
        const tasks = await res.json();
        renderTasks(tasks);
        renderCalendarPreview(tasks);
    } catch (err) { console.error('Failed to load tasks', err); }
}

async function addTask() {
    const input = document.getElementById('new-task-input');
    const title = input.value.trim();
    if (!title) return;
    await fetch(`${API_BASE}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, status: 'todo' }) });
    input.value = '';
    loadTasks();
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
        await fetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle.trim() }) });
        loadTasks();
    }
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


/* =================================================================
   RESEARCH NOTES
   ================================================================= */

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
    loadNotes(); 
    openNote(data.id); 
}

async function openNote(id) {
    activeNoteId = id;
    const res = await fetch(`${API_BASE}/notes/${id}`);
    const note = await res.json();
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-editor').innerHTML = note.content || '';
    
    const saveBtn = document.querySelector('.save-float');
    let delBtn = document.getElementById('delete-note-btn');
    if (!delBtn) {
        delBtn = document.createElement('button');
        delBtn.id = 'delete-note-btn';
        delBtn.innerText = "Delete Note";
        delBtn.style.background = "#ff4444";
        delBtn.style.color = "white";
        delBtn.style.marginLeft = "10px";
        delBtn.onclick = deleteNote;
        saveBtn.after(delBtn);
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
        loadNotes();
    } catch (err) { console.error("Failed to delete note", err); }
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

function triggerAutoSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 1000); }


/* =================================================================
   DASHBOARD & SEARCH
   ================================================================= */

async function loadDashboard() {
    const [resTasks, resBms] = await Promise.all([fetch(`${API_BASE}/tasks`), fetch(`${API_BASE}/bookmarks`)]);
    const tasks = await resTasks.json();
    const bookmarks = await resBms.json();

    document.getElementById('dash-task-count').innerText = `${tasks.filter(t => t.status !== 'done').length} Pending`;
    document.getElementById('dash-bm-count').innerText = `${bookmarks.length} Total`;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayTasks = tasks.filter(t => t.due_date === todayStr && t.status !== 'done');
    
    let agendaHtml = `<h3>Today's Agenda</h3>`;
    if(todayTasks.length === 0) agendaHtml += `<p style="color:#888">Nothing due today.</p>`;
    else todayTasks.forEach(t => agendaHtml += `<div class="agenda-item">${t.title}</div>`);
    
    let agendaContainer = document.getElementById('dash-agenda');
    if(!agendaContainer) {
        agendaContainer = document.createElement('div');
        agendaContainer.id = 'dash-agenda';
        agendaContainer.style.marginTop = '20px';
        document.querySelector('.stats-container').after(agendaContainer);
    }
    agendaContainer.innerHTML = agendaHtml;
}

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
    list.style.display = 'flex'; list.style.flexDirection = 'column'; list.style.gap = '10px';
    results.forEach(item => {
        const div = document.createElement('div');
        div.style.background = '#fff';
        div.style.padding = '15px';
        div.style.borderRadius = '5px';
        div.style.borderLeft = `5px solid ${getTypeColor(item.type)}`;
        div.style.cursor = 'pointer';
        let icon = {'bookmark': '🔖', 'task': '✅', 'note': '📝'}[item.type] || '❓';
        div.innerHTML = `<div style="font-weight:bold; font-size:16px;">${icon} ${item.title}</div><div style="color:#666; font-size:12px; margin-top:2px;">Type: ${item.type.toUpperCase()} | Info: ${item.info || ''}</div>`;
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