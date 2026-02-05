const API_BASE = 'http://localhost:3000/api';
let currentBmView = 'grid'; // Default to grid
let currentFolderFilter = null; // null = View All, integer = specific folder ID
let allBookmarksCache = []; // Stores raw data from API
let currentSearchTerm = ''; // Stores local search text
let allNotesCache = [];
let currentNoteFolder = null; // null = All
let currentNoteSearch = '';
let dashboardDate = new Date(); // Tracks the month currently being viewed
let activeTaskData = null; // Holds the full data for the task in the modal
let taskChecklist = []; // Holds the checklist items for the active task
/* =================================================================
   INITIALIZATION & CORE NAVIGATION
   ================================================================= */

function setViewFolder(id, name) {
    currentFolderFilter = id;
    const header = document.querySelector('#view-bookmarks h1');
    
    // Update the visual header
    if (currentFolderFilter) {
        header.textContent = `Folder: ${name}`;
        // Add a "Back to All" button dynamically if it doesn't exist
        if (!document.getElementById('back-to-all-btn')) {
            const btn = document.createElement('button');
            btn.id = 'back-to-all-btn';
            btn.textContent = '← View All';
            btn.style.fontSize = '12px'; 
            btn.style.marginLeft = '10px';
            btn.style.padding = '5px 10px';
            btn.style.cursor = 'pointer';
            btn.onclick = () => setViewFolder(null, 'All');
            header.appendChild(btn);
        }
    } else {
        header.textContent = 'Bookmarks';
    }
    
    // Reload bookmarks to apply the filter
    loadBookmarks();
}

// Opens the modal and populates it
async function openTaskModal(taskId) {
    try {
        // Find the full task data from the cache
        const res = await fetch(`${API_BASE}/tasks`);
        const tasks = await res.json();
        activeTaskData = tasks.find(t => t.id === taskId);
        
        if (!activeTaskData) {
            console.error("Task not found!");
            return;
        }

        // 1. Populate Header
        document.getElementById('task-modal-title').innerText = activeTaskData.title;

        // 2. Populate Notes
        document.getElementById('task-modal-notes').innerHTML = activeTaskData.notes || '';

        // 3. Populate Stats
        document.getElementById('task-stat-status').innerText = activeTaskData.status.charAt(0).toUpperCase() + activeTaskData.status.slice(1);
        document.getElementById('task-stat-breaks').innerText = activeTaskData.break_count || '0';
        const totalTime = (activeTaskData.past_duration || 0) + (activeTaskData.active_start ? (new Date() - new Date(activeTaskData.active_start + 'Z'))/1000 : 0);
        document.getElementById('task-stat-time').innerText = formatTime(Math.floor(totalTime));
        
        // 4. Populate Checklist
        taskChecklist = activeTaskData.checklist ? JSON.parse(activeTaskData.checklist) : [];
        renderTaskChecklist();

        // 5. Show Modal
        document.getElementById('task-modal-backdrop').classList.remove('hidden');

    } catch (err) {
        console.error("Failed to open task modal", err);
    }
}

// Closes the modal
function closeTaskModal() {
    activeTaskData = null;
    document.getElementById('task-modal-backdrop').classList.add('hidden');
}

// Renders the checklist items from the `taskChecklist` array
function renderTaskChecklist() {
    const container = document.getElementById('task-modal-checklist');
    const progressContainer = document.getElementById('task-modal-progress');
    const progressFill = document.getElementById('task-modal-progress-fill');
    const progressText = document.getElementById('task-modal-progress-text');

    // Calculate and display progress
    const progress = calculateChecklistProgress(taskChecklist);
    
    if (taskChecklist.length > 0) {
        progressContainer.style.display = 'block';
        progressFill.style.width = `${progress.percent}%`;
        progressText.innerText = `${progress.percent}% (${progress.text})`;
    } else {
        progressContainer.style.display = 'none'; // Hide if no items
    }

    // Render the list items
    container.innerHTML = '';
    if (taskChecklist.length === 0) {
        container.innerHTML = '<p style="color:#999; text-align:center;">No items yet.</p>';
        return;
    }

    taskChecklist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'checklist-item';
        if (item.done) div.classList.add('checked');

        div.innerHTML = `
            <input type="checkbox" id="check-${index}" ${item.done ? 'checked' : ''} onchange="toggleChecklistItem(${index})">
            <label for="check-${index}">${item.text}</label>
            <button class="delete-checklist" onclick="deleteChecklistItem(${index})">&times;</button>
        `;
        container.appendChild(div);
    });
}

// Saves all details from the modal back to the server
async function saveTaskDetails() {
    if (!activeTaskData) return;

    const newNotes = document.getElementById('task-modal-notes').innerHTML;
    
    const payload = {
        notes: newNotes,
        checklist: JSON.stringify(taskChecklist) // Save the checklist array as a string
    };

    try {
        await fetch(`${API_BASE}/tasks/${activeTaskData.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        closeTaskModal();
        loadTasks(); // Refresh the main view
    } catch (err) {
        console.error("Failed to save task details", err);
    }
}

// Esc key to close modal
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape" && !document.getElementById('task-modal-backdrop').classList.contains('hidden')) {
        closeTaskModal();
    }
});

function changeDashMonth(offset) {
    dashboardDate.setMonth(dashboardDate.getMonth() + offset);
    loadDashboard(); // Reloads data and redraws calendar
}

function renderDashboardCalendar(tasks) {
    const grid = document.getElementById('dash-cal-grid');
    const title = document.getElementById('dash-cal-title');
    
    if (!grid || !title) return; // Guard clause in case we aren't on dashboard
    
    grid.innerHTML = '';
    
    const year = dashboardDate.getFullYear();
    const month = dashboardDate.getMonth();
    
    // Update Title
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    title.innerText = `${monthNames[month]} ${year}`;

    // Date Maths
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayIndex = firstDay.getDay(); // 0 (Sun) - 6 (Sat)

    // 1. Padding Days (Empty cells before the 1st)
    for (let i = 0; i < startDayIndex; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day-cell';
        blank.style.background = '#fcfcfc'; // Slightly darker to indicate disabled
        grid.appendChild(blank);
    }

    // 2. Actual Days
    const todayStr = new Date().toISOString().split('T')[0];

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day-cell';
        
        // Generate YYYY-MM-DD string for this cell to match DB format
        // IMPORTANT: month is 0-indexed in JS, but 1-indexed in YYYY-MM-DD
        const currentMonthStr = (month + 1).toString().padStart(2, '0');
        const currentDayStr = day.toString().padStart(2, '0');
        const dateStr = `${year}-${currentMonthStr}-${currentDayStr}`;

        if (dateStr === todayStr) cell.classList.add('today');

        // Day Number
        const num = document.createElement('span');
        num.className = 'cal-day-number';
        num.innerText = day;
        cell.appendChild(num);

        // Find tasks for this day
        const daysTasks = tasks.filter(t => t.due_date === dateStr);
        
        daysTasks.forEach(t => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'cal-task-item';
            
            if (t.status === 'done') taskDiv.classList.add('cal-task-done');
            else if (t.status === 'inprogress') taskDiv.classList.add('cal-task-prog');
            else taskDiv.classList.add('cal-task-todo');

            taskDiv.innerText = t.title;
            taskDiv.title = t.title; // Tooltip
            
            // Clicking jumps to task tab (simple UX)
            taskDiv.onclick = () => {
                switchTab('tasks');
                // Optional: You could scroll to the task here if you wanted
            };
            
            cell.appendChild(taskDiv);
        });

        grid.appendChild(cell);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initial data load for the dashboard view
    switchTab('dashboard');
    
    // Set up event listeners that only need to be attached once
    document.getElementById('bm-folder-select').addEventListener('change', (e) => {
        if (e.target.value === 'CREATE_NEW') {
            createNewFolder();
        }
    });

    // GLOBAL CLOCK TICKER (Updates UI every second)
    setInterval(() => {
        const activeTimers = document.querySelectorAll('.task-timer-display[data-active-start]');
        activeTimers.forEach(el => {
            const startStr = el.getAttribute('data-active-start');
            const pastSeconds = parseInt(el.getAttribute('data-past-duration')) || 0;
            
            // Calculate distinct UTC offset adjustment to handle local browser time vs UTC DB time
            const startDate = new Date(startStr + "Z"); // Append Z to treat DB time as UTC
            const now = new Date();
            const elapsedSinceStart = Math.floor((now - startDate) / 1000);
            
            const totalSeconds = pastSeconds + elapsedSinceStart;
            el.innerText = formatTime(totalSeconds);
        });
    }, 1000);

    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title-input');
    if (editor) editor.addEventListener('input', triggerAutoSave);
    if (titleInput) titleInput.addEventListener('input', triggerAutoSave);
});

// Helper function to format seconds into HH:MM:SS
function formatTime(seconds) {
    if(seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
}

async function startTimer(taskId) {
    await fetch(`${API_BASE}/tasks/${taskId}/timer/start`, { method: 'POST' });
    loadTasks();
}

async function stopTimer(taskId) {
    await fetch(`${API_BASE}/tasks/${taskId}/timer/stop`, { method: 'POST' });
    loadTasks();
}

async function resetTimer(taskId) {
    if(!confirm("Reset timer? This will erase all time logs for this task.")) return;
    await fetch(`${API_BASE}/tasks/${taskId}/timer/reset`, { method: 'POST' });
    loadTasks();
}

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
    if (tabName === 'research') { 
        loadNotes(); 
        loadNoteFolders(); // <--- ADD THIS
    }
}
async function loadNoteFolders() {
    try {
        const res = await fetch(`${API_BASE}/folders`);
        const folders = await res.json();
        
        // 1. Populate Left Sidebar List
        const list = document.getElementById('note-folder-list');
        list.innerHTML = '';
        
        // "All Notes" option
        const allDiv = document.createElement('div');
        allDiv.innerHTML = '📝 <strong>All Notes</strong>';
        allDiv.style.padding = '10px';
        allDiv.style.cursor = 'pointer';
        allDiv.style.borderBottom = '1px solid #eee';
        allDiv.onclick = () => { currentNoteFolder = null; renderNotesList(); };
        list.appendChild(allDiv);

        folders.forEach(f => {
            // Container
            const div = document.createElement('div');
            div.style.padding = '10px';
            div.style.cursor = 'pointer';
            div.style.fontSize = '14px';
            div.style.display = 'flex';              // <--- Changed to Flex
            div.style.justifyContent = 'space-between'; // <--- Push X to right
            div.style.alignItems = 'center';
            div.style.borderBottom = '1px solid #f9f9f9';

            // Hover effect
            div.onmouseover = () => div.style.background = '#eef';
            div.onmouseout = () => div.style.background = 'transparent';
            
            // Click Folder Name Logic
            div.onclick = () => { currentNoteFolder = f.id; renderNotesList(); };

            // Folder Name
            const nameSpan = document.createElement('span');
            nameSpan.textContent = f.name;

            // Delete Button (X)
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;';
            delBtn.style.color = '#ccc';
            delBtn.style.fontWeight = 'bold';
            delBtn.style.paddingLeft = '10px';
            delBtn.onmouseover = (e) => { e.target.style.color = 'red'; };
            delBtn.onmouseout = (e) => { e.target.style.color = '#ccc'; };
            
            // Prevent click from bubbling up (so clicking X doesn't open the folder)
            delBtn.onclick = (e) => { 
                e.stopPropagation(); 
                deleteFolder(f.id, f.name); 
            };

            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            list.appendChild(div);
        });

        // 2. Populate Dropdown in Editor
        const select = document.getElementById('note-folder-select');
        // Save current selection if possible, otherwise it resets every time we add a folder
        const currentVal = select.value; 
        
        select.innerHTML = '<option value="">Uncategorized</option>';
        folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.name;
            select.appendChild(opt);
        });
        
        if(currentVal) select.value = currentVal;

    } catch (err) { console.error(err); }
}

async function createNewFolderForNotes() {
    const name = prompt("New Folder Name:");
    if (!name) return;
    try {
        await fetch(`${API_BASE}/folders`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name }) });
        loadNoteFolders(); // Refresh note folders
        // If we are in dashboard/bookmarks, we might want to refresh those too, but this is enough for now.
    } catch(err) { console.error(err); }
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
        allBookmarksCache = await res.json(); // Store in cache
        renderBookmarks(); // Render using the cache
    } catch (err) { console.error("Failed to load bookmarks", err); }
}
function filterBookmarksLocally(query) {
    currentSearchTerm = query.toLowerCase();
    renderBookmarks();
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

function renderBookmarks() {
    // Note: We don't pass 'bookmarks' as argument anymore, we use 'allBookmarksCache'
    const mainContainer = document.getElementById('bookmark-list');
    mainContainer.innerHTML = '';
    mainContainer.className = '';

    // 1. Filter by Folder
    let displayData = allBookmarksCache;
    if (currentFolderFilter !== null) {
        displayData = displayData.filter(bm => bm.folder_id === currentFolderFilter);
    }

    // 2. Filter by Search Term (Title, URL, Description, or Tags)
    if (currentSearchTerm.trim() !== '') {
        displayData = displayData.filter(bm => {
            const tagString = bm.tags ? bm.tags.join(' ') : '';
            return (
                bm.title.toLowerCase().includes(currentSearchTerm) ||
                bm.url.toLowerCase().includes(currentSearchTerm) ||
                (bm.description && bm.description.toLowerCase().includes(currentSearchTerm)) ||
                tagString.includes(currentSearchTerm)
            );
        });
    }

    // If no bookmarks found
    if (displayData.length === 0) {
        mainContainer.innerHTML = '<div style="padding:20px; color:#888;">No bookmarks found matching criteria.</div>';
        return;
    }

    // 3. Render (Grouped or Flat)
    // Logic: If we are filtering by Folder OR by Search Term, we show a Flat View.
    // We only show the "Grouped by Folder" view if showing Everything with no filters.
    
    const isFiltered = (currentFolderFilter !== null || currentSearchTerm !== '');

    if (isFiltered) {
        // --- FLAT VIEW ---
        const folderContainer = document.createElement('div');
        folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
        mainContainer.appendChild(folderContainer);
        
        displayData.forEach(bm => {
            folderContainer.appendChild(createBookmarkElement(bm));
        });

    } else {
        // --- GROUPED VIEW (Default Dashboard Style) ---
        const groupedByFolder = displayData.reduce((acc, bm) => {
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
            header.style.color = '#555';
            mainContainer.appendChild(header);

            const folderContainer = document.createElement('div');
            folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
            mainContainer.appendChild(folderContainer);

            groupedByFolder[folderName].forEach(bm => {
                folderContainer.appendChild(createBookmarkElement(bm));
            });
        }
    }
    renderTwitterWidgets();
}

function createBookmarkElement(bm) {
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
    return div;
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
        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name;
            selectDropdown.appendChild(option);
        });
        
        const createOption = document.createElement('option');
        createOption.value = 'CREATE_NEW';
        createOption.textContent = '--- Create New Folder ---';
        selectDropdown.appendChild(createOption);
        
        sidebarList.innerHTML = '';

        const allDiv = document.createElement('div');
        allDiv.style.padding = '8px 5px';
        allDiv.style.cursor = 'pointer';
        allDiv.style.color = '#fff';
        allDiv.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        allDiv.style.marginBottom = '5px';
        allDiv.innerHTML = '📂 <strong>View All</strong>';
        allDiv.onclick = () => {
            switchTab('bookmarks');
            setViewFolder(null, 'All');
        };
        sidebarList.appendChild(allDiv);

        folders.forEach(folder => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.padding = '5px';
            div.style.color = '#ddd';
            div.style.fontSize = '14px'; 
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = folder.name;
            nameSpan.style.cursor = 'pointer';
            nameSpan.style.flex = '1'; 
            nameSpan.onmouseover = () => nameSpan.style.color = '#fff';
            nameSpan.onmouseout = () => nameSpan.style.color = '#ddd';
            nameSpan.onclick = () => {
                switchTab('bookmarks');
                setViewFolder(folder.id, folder.name);
            };

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.style.color = '#ff6b6b'; 
            delBtn.style.border = 'none'; 
            delBtn.style.background = 'none'; 
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontSize = '16px';
            delBtn.onclick = (e) => { 
                e.stopPropagation(); 
                deleteFolder(folder.id, folder.name); 
            };

            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            sidebarList.appendChild(div);
        });
        
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
    if (!confirm(`WARNING: Are you SURE you want to delete the "${name}" folder?\n\nThis will permanently delete:\n- All Bookmarks in this folder\n- All Notes in this folder`)) return;
    
    try {
        await fetch(`${API_BASE}/folders/${id}`, { method: 'DELETE' });
        
        // 1. Refresh Bookmark Views
        loadFolders(); 
        loadBookmarks();
        
        // 2. Refresh Note Views
        loadNoteFolders();
        loadNotes();

        // 3. Reset filters if we were looking at the deleted folder
        if (currentFolderFilter == id) {
            setViewFolder(null, 'All');
        }
        if (currentNoteFolder == id) {
            currentNoteFolder = null;
            // Visual feedback: clear the editor if the deleted folder contained the active note
            // (Optional, but safer to just leave the editor content or clear it)
        }

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
    // 1. Clear the current lists
    document.getElementById('task-list-todo').innerHTML = '';
    document.getElementById('task-list-progress').innerHTML = '';
    document.getElementById('task-list-done').innerHTML = '';

    tasks.forEach(task => {
        // 2. Create the card container and set up modal click
        const card = document.createElement('div');
        card.className = 'task-card';
        card.style.background = '#fff';
        card.style.padding = '10px';
        card.style.marginBottom = '10px';
        card.style.borderRadius = '4px';
        card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        card.style.cursor = 'pointer';

        // Open modal only if not clicking a button or input
        card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
                openTaskModal(task.id);
            }
        };

        // 3. --- DEFINE ALL UI PIECES ---

        // Status Controls (for moving between columns)
        let controls = '';
        if (task.status === 'todo') {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:11px;">Start Work &rarr;</button>`;
        } else if (task.status === 'inprogress') {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'todo')" style="font-size:11px;">&larr; Back</button> <button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'done')" style="font-size:11px;">Done &checkmark;</button>`;
        } else {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:11px;">Reopen</button>`;
        }

        // Due Date Input
        let dateHtml = task.due_date 
            ? `<input type="date" value="${task.due_date}" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:#666; cursor:pointer;">`
            : `<input type="date" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:#888; cursor:pointer;">`;
        
        // Timer Controls
        const past = parseInt(task.past_duration) || 0;
        let timerControls = '';
        if (task.active_start) {
            const activeAttr = `data-active-start="${task.active_start}" data-past-duration="${past}"`;
            timerControls = `
                <div style="display:flex; align-items:center;">
                    <span class="task-timer-display" ${activeAttr} style="font-family:monospace; font-weight:bold; color:#007bff; margin-right:10px; font-size:12px;">Syncing...</span>
                    <button onclick="event.stopPropagation(); stopTimer(${task.id})" style="border:1px solid #ff4444; background:#fff; color:#ff4444; border-radius:3px; cursor:pointer; font-size:11px; padding:2px 6px;">⏸ Stop</button>
                </div>`;
        } else {
            timerControls = `
                <div style="display:flex; align-items:center;">
                    <span class="task-timer-display" style="font-family:monospace; color:#666; margin-right:10px; font-size:12px;">${formatTime(past)}</span>
                    <button onclick="event.stopPropagation(); startTimer(${task.id})" style="border:1px solid #28a745; background:#fff; color:#28a745; border-radius:3px; cursor:pointer; font-size:11px; padding:2px 6px;">▶ Start</button>
                    <button onclick="event.stopPropagation(); resetTimer(${task.id})" title="Reset Timer" style="border:none; background:none; color:#bbb; cursor:pointer; font-size:14px; margin-left:5px; padding:0;">↺</button>
                </div>`;
        }

        // Checklist Progress Bar (only if checklist exists)
        let checklistProgressHtml = '';
        try {
            const checklist = task.checklist ? JSON.parse(task.checklist) : [];
            if (checklist.length > 0) {
                const progress = calculateChecklistProgress(checklist);
                checklistProgressHtml = `
                    <div class="progress-bar-container" title="${progress.text} Completed" style="height:12px; margin-bottom:8px;">
                        <div class="progress-bar-fill" style="width: ${progress.percent}%;"></div>
                        <span class="progress-bar-text" style="font-size:8px;">${progress.percent}%</span>
                    </div>`;
            }
        } catch (e) { /* malformed checklist JSON, ignore */ }
        
        // 4. --- ASSEMBLE THE FINAL CARD HTML ---
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="font-weight:bold; font-size:14px; margin-bottom:5px;">${task.title}</div>
                <div style="font-size:12px; white-space:nowrap;">
                    <button onclick='event.stopPropagation(); editTaskTitle(${task.id}, "${task.title}")' style="border:none;background:none;cursor:pointer; opacity:0.6;">✏️</button>
                    <button onclick="event.stopPropagation(); deleteTask(${task.id})" style="border:none;background:none;cursor:pointer;color:red; opacity:0.6;">🗑️</button>
                </div>
            </div>
            
            <div style="margin-bottom:8px;">${dateHtml}</div>

            ${checklistProgressHtml}

            <div style="background:#f9f9f9; padding:5px; border-radius:4px; margin-bottom:10px; border:1px solid #eee;">
                ${timerControls}
            </div>

            <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #eee;">
                ${controls}
            </div>
        `;

        // 5. Append to the correct column
        if (task.status === 'todo') document.getElementById('task-list-todo').appendChild(card);
        else if (task.status === 'inprogress') document.getElementById('task-list-progress').appendChild(card);
        else document.getElementById('task-list-done').appendChild(card);
    });
}

// Adds a new item to the checklist
function addChecklistItem() {
    const input = document.getElementById('task-checklist-input');
    const text = input.value.trim();

    if (text) {
        taskChecklist.push({ text: text, done: false });
        input.value = ''; // Clear the input
        renderTaskChecklist(); // Re-render the list with the new item
    }
}

function calculateChecklistProgress(checklistArray) {
    if (!checklistArray || checklistArray.length === 0) {
        return { percent: 0, text: '0/0' };
    }
    const total = checklistArray.length;
    const done = checklistArray.filter(item => item.done).length;
    const percent = Math.round((done / total) * 100);
    return { percent, text: `${done}/${total}` };
}

// Toggles the 'done' status of an item
function toggleChecklistItem(index) {
    if (taskChecklist[index]) {
        taskChecklist[index].done = !taskChecklist[index].done;
        renderTaskChecklist(); // Re-render to show the change (e.g., line-through)
    }
}

// Deletes an item from the checklist
function deleteChecklistItem(index) {
    taskChecklist.splice(index, 1); // Remove the item from the array
    renderTaskChecklist(); // Re-render the list
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
        allNotesCache = await res.json();
        renderNotesList();
    } catch (err) { console.error(err); }
}
function filterNotesLocally(query) {
    currentNoteSearch = query.toLowerCase();
    renderNotesList();
}

function renderNotesList() {
    const list = document.getElementById('notes-list-ul');
    list.innerHTML = '';
    
    // Filter
    let displayNotes = allNotesCache;
    
    // 1. By Folder
    if (currentNoteFolder !== null) {
        displayNotes = displayNotes.filter(n => n.folder_id === currentNoteFolder);
    }
    
    // 2. By Search
    if (currentNoteSearch) {
        displayNotes = displayNotes.filter(n => 
            (n.title && n.title.toLowerCase().includes(currentNoteSearch)) || 
            (n.content && n.content.toLowerCase().includes(currentNoteSearch))
        );
    }

    if (displayNotes.length === 0) {
        list.innerHTML = '<li style="padding:15px; color:#999; text-align:center;">No notes found.</li>';
        return;
    }

    displayNotes.forEach(note => {
        const li = document.createElement('li');
        li.style.padding = '12px';
        li.style.borderBottom = '1px solid #f0f0f0';
        li.style.cursor = 'pointer';
        li.style.background = (activeNoteId === note.id) ? '#e6f7ff' : 'white';
        
        li.innerHTML = `
            <div style="font-weight:600; font-size:14px; color:#333;">${note.title || 'Untitled'}</div>
            <div style="font-size:11px; color:#888; margin-top:4px;">
                ${new Date(note.created_at).toLocaleDateString()}
            </div>
        `;
        
        li.onclick = () => openNote(note.id);
        list.appendChild(li);
    });
}

async function createNewNote() {
    // Default to the currently viewed folder, or null if viewing "All"
    const targetFolder = currentNoteFolder; 
    
    try {
        const res = await fetch(`${API_BASE}/notes`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                title: 'Untitled Note', 
                content: '',
                folderId: targetFolder 
            }) 
        });
        const data = await res.json();
        
        // Reload list and open the new note
        await loadNotes(); 
        openNote(data.id); 
    } catch (err) { console.error(err); }
}

async function openNote(id) {
    activeNoteId = id;
    
    // 1. Fetch details
    const res = await fetch(`${API_BASE}/notes/${id}`);
    const note = await res.json();
    
    // 2. Populate Editor
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-editor').innerHTML = note.content || '';
    
    // 3. Set Folder Dropdown
    const folderSelect = document.getElementById('note-folder-select');
    folderSelect.value = note.folder_id || ""; // Select the correct folder or "Uncategorized"

    // 4. Update Visual Highlight in List
    renderNotesList(); // Re-render to show the "active" blue background on the list item
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
    const folderId = document.getElementById('note-folder-select').value; // Get selected folder

    try {
        await fetch(`${API_BASE}/notes/${activeNoteId}`, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ title, content, folderId }) 
        });
        
        // Visual Feedback
        const btn = document.querySelector('.save-float');
        const originalText = btn.innerText;
        btn.innerText = "Saved!";
        setTimeout(() => btn.innerText = originalText, 1000);
        
        // Refresh list (in case title changed or it moved folders)
        loadNotes(); 
    } catch (err) { console.error('Save failed', err); }
}

function moveCurrentNote(newFolderId) {
    // Simply trigger a save. The save function reads the value of the dropdown.
    saveCurrentNote();
}

function triggerAutoSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 1000); }


/* =================================================================
   DASHBOARD & SEARCH
   ================================================================= */

async function loadDashboard() {
    // Fetch Data
    const [resTasks, resBms] = await Promise.all([fetch(`${API_BASE}/tasks`), fetch(`${API_BASE}/bookmarks`)]);
    const tasks = await resTasks.json();
    const bookmarks = await resBms.json();

    // Update Text Stats
    document.getElementById('dash-task-count').innerText = `${tasks.filter(t => t.status !== 'done').length} Pending`;
    document.getElementById('dash-bm-count').innerText = `${bookmarks.length} Total`;

    // RENDER CALENDAR
    renderDashboardCalendar(tasks);

    // (You can remove the old "Today's Agenda" code below this if you want, 
    // since the calendar now shows today's tasks visually)
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