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
    
    // Ensure the header uses flexbox for vertical alignment of the button
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '15px'; // Space between Title and Button

    if (currentFolderFilter) {
        // Clear existing content to rebuild
        header.innerHTML = '';
        
        const titleText = document.createElement('span');
        titleText.textContent = `Folder: ${name}`;
        header.appendChild(titleText);

        // Add "Back to All" button with improved styling
        const btn = document.createElement('button');
        btn.id = 'back-to-all-btn';
        btn.innerHTML = '← View All';
        btn.style.fontSize = '12px'; 
        btn.style.padding = '5px 10px';
        btn.style.cursor = 'pointer';
        btn.style.backgroundColor = '#fff';
        btn.style.border = '1px solid #ccc';
        btn.style.borderRadius = '4px';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        
        // Hover effect logic could go here, but inline simpler for now
        btn.onclick = () => setViewFolder(null, 'All');
        header.appendChild(btn);

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

    const progress = calculateChecklistProgress(taskChecklist);
    
    if (taskChecklist.length > 0) {
        progressContainer.style.display = 'block';
        // Update Progress Bar Colors
        progressContainer.style.background = '#333';
        progressFill.style.width = `${progress.percent}%`;
        progressFill.style.background = 'var(--accent-cyan)';
        progressText.innerText = `${progress.percent}%`;
    } else {
        progressContainer.style.display = 'none';
    }

    container.innerHTML = '';
    if (taskChecklist.length === 0) {
        container.innerHTML = '<p style="color:#666; text-align:center; font-style:italic;">No sub-routines defined.</p>';
        return;
    }

    taskChecklist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'checklist-item';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.padding = '10px';
        div.style.borderBottom = '1px solid #333';
        div.style.color = 'white';

        if (item.done) {
            div.style.opacity = '0.5';
            div.style.textDecoration = 'line-through';
        }

        div.innerHTML = `
            <input type="checkbox" id="check-${index}" ${item.done ? 'checked' : ''} onchange="toggleChecklistItem(${index})" style="accent-color: var(--accent-cyan); width: 16px; height: 16px; cursor: pointer;">
            <label for="check-${index}" style="flex: 1; margin-left: 10px; cursor: pointer;">${item.text}</label>
            <button class="delete-checklist" onclick="deleteChecklistItem(${index})" style="background:none; border:none; color:#666; font-size:16px; cursor:pointer;">&times;</button>
        `;
        
        // Hover for delete button
        const delBtn = div.querySelector('.delete-checklist');
        delBtn.onmouseover = () => delBtn.style.color = 'var(--primary-red)';
        delBtn.onmouseout = () => delBtn.style.color = '#666';

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
    
    if (!grid || !title) return;
    
    grid.innerHTML = '';
    
    const year = dashboardDate.getFullYear();
    const month = dashboardDate.getMonth();
    
    const monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    title.innerText = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayIndex = firstDay.getDay();

    // Padding Days (Empty cells)
    for (let i = 0; i < startDayIndex; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day-cell';
        blank.style.opacity = '0.3'; 
        blank.style.background = 'transparent';
        blank.style.border = 'none';
        grid.appendChild(blank);
    }

    // --- FIX: GENERATE LOCAL DATE STRING ---
    const now = new Date();
    // Get local components
    const localYear = now.getFullYear();
    const localMonth = (now.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
    const localDay = now.getDate().toString().padStart(2, '0');
    // Combine to YYYY-MM-DD
    const todayStr = `${localYear}-${localMonth}-${localDay}`;
    // ---------------------------------------

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day-cell';
        
        const currentMonthStr = (month + 1).toString().padStart(2, '0');
        const currentDayStr = day.toString().padStart(2, '0');
        const dateStr = `${year}-${currentMonthStr}-${currentDayStr}`;

        if (dateStr === todayStr) cell.classList.add('today');

        const num = document.createElement('span');
        num.className = 'cal-day-number';
        num.innerText = day;
        cell.appendChild(num);

        const daysTasks = tasks.filter(t => t.due_date === dateStr);
        
        daysTasks.forEach(t => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'cal-task-item';
            
            if (t.status === 'done') {
                taskDiv.style.background = 'rgba(40, 167, 69, 0.2)';
                taskDiv.style.color = '#75b798';
                taskDiv.style.textDecoration = 'line-through';
            } else if (t.status === 'inprogress') {
                taskDiv.style.background = 'rgba(255, 193, 7, 0.2)';
                taskDiv.style.color = '#ffc107';
            } else {
                taskDiv.style.background = 'rgba(5, 217, 232, 0.2)';
                taskDiv.style.color = 'var(--accent-cyan)';
            }

            taskDiv.innerText = t.title;
            taskDiv.title = t.title;
            
            taskDiv.onclick = (e) => {
                e.stopPropagation();
                switchTab('tasks');
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
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    
    document.querySelectorAll('.sidebar li').forEach(el => el.classList.remove('active'));

    const viewTarget = document.getElementById(`view-${tabName}`);
    if (viewTarget) {
        viewTarget.classList.remove('hidden');
        viewTarget.classList.add('active');
    }

    const navTarget = document.getElementById(`nav-${tabName}`);
    if (navTarget) navTarget.classList.add('active');

    if (tabName === 'dashboard') { loadDashboard(); loadTags(); loadFolders(); }
    if (tabName === 'bookmarks') { loadBookmarks(); loadFolders(); }
    if (tabName === 'tasks') loadTasks();
    if (tabName === 'research') { 
        loadNotes(); 
        loadNoteFolders();
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
    const mainContainer = document.getElementById('bookmark-list');
    mainContainer.innerHTML = '';
    mainContainer.className = '';

    // 1. Filter Logic
    let displayData = allBookmarksCache;
    if (currentFolderFilter !== null) {
        displayData = displayData.filter(bm => bm.folder_id === currentFolderFilter);
    }
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

    if (displayData.length === 0) {
        mainContainer.innerHTML = '<div style="padding:20px; color:#666; font-style:italic;">The void stares back... (No bookmarks found)</div>';
        return;
    }

    const isFiltered = (currentFolderFilter !== null || currentSearchTerm !== '');

    if (isFiltered) {
        const folderContainer = document.createElement('div');
        folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
        mainContainer.appendChild(folderContainer);
        displayData.forEach(bm => folderContainer.appendChild(createBookmarkElement(bm)));
    } else {
        // Grouped View
        const groupedByFolder = displayData.reduce((acc, bm) => {
            const folderName = bm.folder_name || 'Uncategorized';
            if (!acc[folderName]) acc[folderName] = [];
            acc[folderName].push(bm);
            return acc;
        }, {});

        for (const folderName in groupedByFolder) {
            const header = document.createElement('h2');
            header.textContent = folderName;
            header.style.borderBottom = '1px solid var(--primary-red)';
            header.style.paddingBottom = '5px';
            header.style.marginTop = '30px';
            header.style.color = 'var(--text-white)';
            header.style.fontSize = '1.2rem';
            header.style.textTransform = 'uppercase';
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
    
    // Tags HTML (Neon Chips)
    let tagsHtml = '';
    if (bm.tags && bm.tags.length > 0) {
        tagsHtml = bm.tags.map(t => 
            `<span style="border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-right: 4px; display:inline-block; text-transform: uppercase;">#${t}</span>`
        ).join('');
    }

    // Description HTML (Yellow Highlight box)
    const descHtml = (bm.description && bm.description !== "Pending...") 
        ? `<div style="margin-top: 10px; font-size: 13px; color: #ffc107; background: rgba(255, 193, 7, 0.1); padding: 8px; border-left: 2px solid #ffc107; font-style: italic;">"${bm.description}"</div>` 
        : '';

    // Buttons HTML
    const buttonsHtml = `
        <button onclick='editBookmark(${JSON.stringify(bm)})' style="font-size:10px; color:black; background:white; border:none; padding:4px 8px; border-radius:2px; margin-right:5px;">EDIT</button>
        <button onclick="deleteBookmark(${bm.id})" style="font-size:10px; color:white; background:var(--primary-red); border:none; padding:4px 8px; border-radius:2px;">DEL</button>
    `;

    if (currentBmView === 'grid') {
        // --- GRID VIEW ---
        let mediaHtml = '';
        if (isTwitter) {
            mediaHtml = navigator.onLine 
                ? `<div style="min-height:100px; display:flex; justify-content:center; overflow:hidden; margin-bottom:10px;"><blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><a href="${bm.url.replace('x.com','twitter.com')}"></a></blockquote></div>` 
                : `<div style="padding:20px; text-align:center; background:#222; border:1px dashed #444; font-size:12px; color:#666;">Offline Preview</div>`;
        } else if (bm.thumbnail) {
            mediaHtml = `<img src="${bm.thumbnail}" style="width:100%; height:auto; display:block; border-radius:4px; margin-bottom:10px; object-fit: cover; opacity: 0.9;" onerror="this.style.display='none'">`;
        }
        
        div.innerHTML = `
            ${mediaHtml}
            <h4 style="margin:0 0 5px 0; word-break: break-word; line-height: 1.4; font-size: 1rem;">
                <a href="${bm.url}" target="_blank" style="text-decoration:none;">${bm.title}</a>
            </h4>
            ${descHtml}
            <div style="margin-top:15px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
                <div style="flex:1; display:flex; flex-wrap:wrap; gap:2px;">${tagsHtml}</div>
                <div style="white-space:nowrap; margin-left:10px;">${buttonsHtml}</div>
            </div>`;

    } else {
        // --- LIST VIEW ---
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.padding = '15px';
        
        div.innerHTML = `
            <div style="flex: 1; overflow: hidden; margin-right: 15px;">
                <a href="${bm.url}" target="_blank" style="text-decoration:none; font-weight:bold; font-size: 1.1rem; color: white;">${bm.title}</a>
                <div style="font-size:12px; color:#666; margin-top:2px;">${bm.url}</div>
                ${descHtml}
                <div style="margin-top:8px;">${tagsHtml}</div>
            </div>
            <div style="display:flex; align-items:center;">
                ${buttonsHtml}
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
        
        // 1. Update Dropdown
        const selectDropdown = document.getElementById('bm-folder-select');
        selectDropdown.innerHTML = '<option value="">Uncategorized</option>';
        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name;
            selectDropdown.appendChild(option);
        });
        const createOption = document.createElement('option');
        createOption.value = 'CREATE_NEW';
        createOption.textContent = '+ Create New Folder';
        selectDropdown.appendChild(createOption);
        
        // 2. Update Sidebar List
        const sidebarList = document.getElementById('sidebar-folders');
        sidebarList.innerHTML = '';

        const allDiv = document.createElement('div');
        allDiv.style.padding = '8px 10px';
        allDiv.style.cursor = 'pointer';
        allDiv.style.color = 'var(--text-white)';
        allDiv.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        allDiv.style.fontSize = '14px';
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
            div.style.padding = '8px 10px';
            div.style.color = '#aaa';
            div.style.fontSize = '14px';
            div.style.transition = '0.2s';
            
            div.onmouseover = () => { div.style.color = 'var(--accent-cyan)'; div.style.background = 'rgba(255,255,255,0.05)'; };
            div.onmouseout = () => { div.style.color = '#aaa'; div.style.background = 'transparent'; };

            const nameSpan = document.createElement('span');
            nameSpan.textContent = folder.name;
            nameSpan.style.cursor = 'pointer';
            nameSpan.style.flex = '1'; 
            nameSpan.onclick = () => {
                switchTab('bookmarks');
                setViewFolder(folder.id, folder.name);
            };

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.style.color = 'var(--primary-red)'; 
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
            wrapper.style.margin = '2px';
            wrapper.style.background = 'transparent';
            wrapper.style.border = '1px solid var(--accent-cyan)';
            wrapper.style.borderRadius = '15px';
            wrapper.style.padding = '2px 8px';
            
            const span = document.createElement('span');
            span.style.fontSize = '11px';
            span.style.color = 'var(--accent-cyan)';
            span.innerText = `${tag.name} (${tag.count})`;
            
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;';
            delBtn.style.marginLeft = '8px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.color = 'var(--primary-red)';
            delBtn.style.fontWeight = 'bold';
            delBtn.style.fontSize = '14px';
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
        // 2. Create the card container
        const card = document.createElement('div');
        card.className = 'task-card';
        // Base styling moved to CSS, specific overrides here:
        card.style.padding = '15px';
        card.style.marginBottom = '15px';
        card.style.borderRadius = '8px';
        card.style.cursor = 'pointer';
        card.style.position = 'relative';
        card.style.overflow = 'hidden';

        // Dynamic Border/Background based on status
        if(task.status === 'done') {
            card.style.borderLeft = '4px solid var(--primary-red)';
            card.style.opacity = '0.7';
        } else if (task.status === 'inprogress') {
            card.style.borderLeft = '4px solid var(--accent-cyan)';
            card.style.background = 'linear-gradient(90deg, #252525 0%, #2a2a2a 100%)';
        } else {
            card.style.borderLeft = '4px solid #444';
        }

        // Open modal click handler
        card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
                openTaskModal(task.id);
            }
        };

        // 3. UI Components

        // Status Controls
        let controls = '';
        if (task.status === 'todo') {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:10px; background:var(--accent-cyan); color:black; border:none; padding:4px 8px; border-radius:4px;">START &rarr;</button>`;
        } else if (task.status === 'inprogress') {
            controls = `
                <button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'todo')" style="font-size:10px; background:#444; color:white; border:none; padding:4px 8px; border-radius:4px;">&larr; PAUSE</button> 
                <button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'done')" style="font-size:10px; background:var(--primary-red); color:white; border:none; padding:4px 8px; border-radius:4px; margin-left:5px;">DONE</button>`;
        } else {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:10px; background:#444; color:white; border:none; padding:4px 8px; border-radius:4px;">RE-OPEN</button>`;
        }

        // Date Picker
        let dateHtml = task.due_date 
            ? `<input type="date" value="${task.due_date}" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:var(--accent-cyan); font-weight:bold; cursor:pointer;">`
            : `<input type="date" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:#666; cursor:pointer;">`;
        
        // Timer Logic
        const past = parseInt(task.past_duration) || 0;
        let timerControls = '';
        if (task.active_start) {
            const activeAttr = `data-active-start="${task.active_start}" data-past-duration="${past}"`;
            timerControls = `
                <div style="display:flex; align-items:center; background: rgba(5, 217, 232, 0.1); padding: 5px; border-radius: 4px;">
                    <span class="task-timer-display" ${activeAttr} style="font-family:monospace; font-weight:bold; color:var(--accent-cyan); margin-right:10px; font-size:12px;">Syncing...</span>
                    <button onclick="event.stopPropagation(); stopTimer(${task.id})" style="border:none; background:none; color:var(--primary-red); cursor:pointer; font-size:16px; padding:0; line-height:1;">⏹</button>
                </div>`;
        } else {
            timerControls = `
                <div style="display:flex; align-items:center;">
                    <span class="task-timer-display" style="font-family:monospace; color:#888; margin-right:10px; font-size:12px;">${formatTime(past)}</span>
                    <button onclick="event.stopPropagation(); startTimer(${task.id})" style="border:none; background:none; color:var(--accent-cyan); cursor:pointer; font-size:16px; padding:0; line-height:1;">▶</button>
                    <button onclick="event.stopPropagation(); resetTimer(${task.id})" title="Reset" style="border:none; background:none; color:#444; cursor:pointer; font-size:12px; margin-left:8px; padding:0;">↺</button>
                </div>`;
        }

        // Checklist Progress Bar
        let checklistProgressHtml = '';
        try {
            const checklist = task.checklist ? JSON.parse(task.checklist) : [];
            if (checklist.length > 0) {
                const progress = calculateChecklistProgress(checklist);
                checklistProgressHtml = `
                    <div class="progress-bar-container" title="${progress.text} Completed" style="height:4px; background:#333; margin: 8px 0; border-radius:2px;">
                        <div class="progress-bar-fill" style="width: ${progress.percent}%; background: var(--accent-cyan); height:100%;"></div>
                    </div>`;
            }
        } catch (e) { }
        
        // 4. Assemble HTML
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="font-weight:bold; font-size:15px; margin-bottom:5px; color:white;">${task.title}</div>
                <div style="font-size:12px; white-space:nowrap;">
                    <button onclick='event.stopPropagation(); editTaskTitle(${task.id}, "${task.title}")' style="border:none;background:none;cursor:pointer; opacity:0.5; color:white;">✏️</button>
                    <button onclick="event.stopPropagation(); deleteTask(${task.id})" style="border:none;background:none;cursor:pointer;color:var(--primary-red); opacity:0.8;">&times;</button>
                </div>
            </div>
            
            <div style="margin-bottom:8px;">${dateHtml}</div>

            ${checklistProgressHtml}

            <div style="margin-bottom:10px;">
                ${timerControls}
            </div>

            <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #333;">
                ${controls}
            </div>
        `;

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
        container.innerHTML = '<div style="color:#666; padding:20px; text-align:center; font-style:italic;">No missions scheduled.</div>';
        return;
    }
    
    datedTasks.forEach(t => {
        const item = document.createElement('div');
        item.style.padding = '10px';
        item.style.borderBottom = '1px solid #333';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        
        const isDone = t.status === 'done';
        const color = isDone ? '#444' : 'white';
        const dateColor = isDone ? '#444' : 'var(--accent-cyan)';
        const textDec = isDone ? 'line-through' : 'none';

        item.innerHTML = `
            <div style="color:${dateColor}; font-weight:bold; font-size:12px;">${t.due_date}</div>
            <div style="color:${color}; text-decoration:${textDec}; font-size:13px; text-align:right;">${t.title}</div>
        `;
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
    
    // Filter Logic
    let displayNotes = allNotesCache;
    if (currentNoteFolder !== null) {
        displayNotes = displayNotes.filter(n => n.folder_id === currentNoteFolder);
    }
    if (currentNoteSearch) {
        displayNotes = displayNotes.filter(n => 
            (n.title && n.title.toLowerCase().includes(currentNoteSearch)) || 
            (n.content && n.content.toLowerCase().includes(currentNoteSearch))
        );
    }

    if (displayNotes.length === 0) {
        list.innerHTML = '<li style="padding:15px; color:#666; text-align:center; font-style:italic;">No data fragments found.</li>';
        return;
    }

    displayNotes.forEach(note => {
        const li = document.createElement('li');
        li.style.padding = '15px';
        li.style.borderBottom = '1px solid #333';
        li.style.cursor = 'pointer';
        li.style.transition = '0.2s';
        
        // Active vs Inactive Styling
        if (activeNoteId === note.id) {
            li.style.background = 'rgba(5, 217, 232, 0.1)'; // Cyan Tint
            li.style.borderLeft = '4px solid var(--accent-cyan)';
            li.style.color = 'white';
        } else {
            li.style.background = 'transparent';
            li.style.borderLeft = '4px solid transparent';
            li.style.color = '#ccc';
        }
        
        // Hover Effect via JS (since we are doing inline styles for active state)
        li.onmouseover = () => { if(activeNoteId !== note.id) li.style.background = '#222'; };
        li.onmouseout = () => { if(activeNoteId !== note.id) li.style.background = 'transparent'; };
        
        li.innerHTML = `
            <div style="font-weight:600; font-size:14px;">${note.title || 'Untitled'}</div>
            <div style="font-size:11px; color:#666; margin-top:4px;">
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
    const [resTasks, resBms] = await Promise.all([fetch(`${API_BASE}/tasks`), fetch(`${API_BASE}/bookmarks`)]);
    const tasks = await resTasks.json();
    const bookmarks = await resBms.json();

    document.getElementById('dash-task-count').innerText = `${tasks.filter(t => t.status !== 'done').length}`;
    document.getElementById('dash-bm-count').innerText = `${bookmarks.length}`;

    renderDashboardCalendar(tasks);
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
    container.innerHTML = `<p style="color: #aaa; margin-bottom: 20px;">Found ${results.length} fragments matching "<strong>${query}</strong>"</p>`;
    
    if (results.length === 0) return;
    
    const list = document.createElement('div');
    list.style.display = 'flex'; 
    list.style.flexDirection = 'column'; 
    list.style.gap = '15px';
    
    results.forEach(item => {
        const div = document.createElement('div');
        div.style.background = '#1a1a1a';
        div.style.padding = '20px';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid #333';
        div.style.cursor = 'pointer';
        div.style.transition = '0.2s';
        
        // Dynamic Border Color based on Type
        let typeColor = '#ccc';
        let icon = '❓';
        if(item.type === 'bookmark') { typeColor = 'var(--accent-cyan)'; icon = '🔖'; }
        if(item.type === 'task') { typeColor = 'var(--primary-red)'; icon = '✅'; }
        if(item.type === 'note') { typeColor = '#ffc107'; icon = '📝'; }
        
        div.style.borderLeft = `5px solid ${typeColor}`;

        div.onmouseover = () => { div.style.transform = 'translateX(5px)'; div.style.background = '#222'; };
        div.onmouseout = () => { div.style.transform = 'translateX(0)'; div.style.background = '#1a1a1a'; };

        div.innerHTML = `
            <div style="font-weight:bold; font-size:18px; color: white;">${icon} ${item.title}</div>
            <div style="color:#888; font-size:12px; margin-top:5px; text-transform: uppercase; letter-spacing: 1px;">
                Type: <span style="color:${typeColor}">${item.type}</span> | ${item.info || ''}
            </div>`;
            
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