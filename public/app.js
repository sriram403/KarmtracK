const API_BASE = 'http://localhost:3000/api';

// --- Utility: HTML escape to prevent XSS ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Utility: Safe fetch wrapper with res.ok check ---
async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API error ${res.status}: ${errBody}`);
    }
    return res.json();
}

// --- Utility: Toast notification system ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '&#10003;', error: '&#10007;', info: '&#9432;' };
    toast.innerHTML = `<span>${icons[type] || icons.info}</span> ${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Utility: Themed confirm dialog (replaces native confirm) ---
// options.skipKey: if provided, checks localStorage('confirm_skip_<skipKey>') and shows "Don't show again" checkbox
function showConfirm(message, options = {}) {
    const { skipKey } = options;
    if (skipKey && localStorage.getItem(`confirm_skip_${skipKey}`) === 'true') {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const backdrop = document.getElementById('confirm-dialog-backdrop');
        const msgEl = document.getElementById('confirm-dialog-message');
        const yesBtn = document.getElementById('confirm-dialog-yes');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        const skipLabel = document.getElementById('confirm-dialog-skip-label');
        const skipCb = document.getElementById('confirm-dialog-skip-cb');
        if (!backdrop || !msgEl) { resolve(confirm(message)); return; }

        msgEl.textContent = message;
        if (skipKey && skipLabel && skipCb) {
            skipCb.checked = false;
            skipLabel.classList.remove('hidden');
        } else if (skipLabel) {
            skipLabel.classList.add('hidden');
        }
        backdrop.classList.remove('hidden');

        function cleanup(result) {
            backdrop.classList.add('hidden');
            if (skipKey && skipCb && skipCb.checked && result) {
                localStorage.setItem(`confirm_skip_${skipKey}`, 'true');
            }
            yesBtn.removeEventListener('click', onYes);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onYes() { cleanup(true); }
        function onCancel() { cleanup(false); }

        yesBtn.addEventListener('click', onYes);
        cancelBtn.addEventListener('click', onCancel);
    });
}
let currentBmView = 'grid'; // Default to grid
let xPreviewMode = 'compact'; // compact | full
let currentFolderFilter = null; // null = View All, integer = specific folder ID
let allBookmarksCache = []; // Stores raw data from API
let currentSearchTerm = ''; // Stores local search text
let allTagsCache = []; // Cache of all existing tags for autocomplete
let bmCollapsedSections = {}; // Tracks which folder sections are collapsed
let currentBmSort = 'newest'; // newest | oldest
let allNotesCache = [];
let currentNoteFolder = null; // null = All
let currentNoteSearch = '';
let dashboardDate = new Date(); // Tracks the month currently being viewed
let activeTaskData = null; // Holds the full data for the task in the modal
let taskChecklist = []; // Holds the checklist items for the active task
let activeEditBookmarkId = null; // Stores the ID of the bookmark being edited
const TIMER_NOTIFY_KEY = 'taskTimerNotifySettings';
let taskTimerNotifySettings = {};
let taskStatusMap = {};
let draggedTaskId = null;
let runningTimerNotificationState = {};
let taskNotificationAudioContext = null;
let taskNotificationAudioUnlocked = false;

try {
    taskTimerNotifySettings = JSON.parse(localStorage.getItem(TIMER_NOTIFY_KEY) || '{}');
} catch (err) {
    taskTimerNotifySettings = {};
}
/* =================================================================
   INITIALIZATION & CORE NAVIGATION
   ================================================================= */

function toggleSidebarSection(sectionId, titleEl) {
    const section = document.getElementById(sectionId);
    const arrows = titleEl.querySelectorAll('.material-icons');
    const arrow = arrows[arrows.length - 1];
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? (sectionId === 'sidebar-tags' ? 'flex' : 'block') : 'none';
    if (arrow) arrow.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
}

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
        btn.innerHTML = '<- View All';
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
    
    // Re-render using cached data to apply the filter
    renderBookmarks();
}

// Opens the modal and populates it
async function openTaskModal(taskId) {
    try {
        // Find the full task data from the cache
        const tasks = await apiFetch(`${API_BASE}/tasks`);
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
        await apiFetch(`${API_BASE}/tasks/${activeTaskData.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        closeTaskModal();
        loadTasks();
    } catch (err) {
        console.error("Failed to save task details", err);
        showToast('Failed to save task details', 'error');
    }
}

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
    xPreviewMode = localStorage.getItem('xPreviewMode') === 'full' ? 'full' : 'compact';
    updateXPreviewModeButtons();
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
        const activeIds = new Set();

        activeTimers.forEach(el => {
            const startStr = el.getAttribute('data-active-start');
            const pastSeconds = parseInt(el.getAttribute('data-past-duration')) || 0;
            const taskId = parseInt(el.getAttribute('data-task-id'));
            const taskTitle = el.getAttribute('data-task-title') || 'Task';

            // Calculate distinct UTC offset adjustment to handle local browser time vs UTC DB time
            const startDate = new Date(startStr + "Z"); // Append Z to treat DB time as UTC
            const now = new Date();
            const elapsedSinceStart = Math.floor((now - startDate) / 1000);

            const totalSeconds = pastSeconds + elapsedSinceStart;
            el.innerText = formatTime(totalSeconds);

            if (!Number.isNaN(taskId)) {
                activeIds.add(taskId);
                maybeSendTaskRunningNotification(taskId, taskTitle, elapsedSinceStart);
            }
        });

        Object.keys(runningTimerNotificationState).forEach((id) => {
            if (!activeIds.has(parseInt(id))) {
                delete runningTimerNotificationState[id];
            }
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

function persistTaskTimerNotifySettings() {
    localStorage.setItem(TIMER_NOTIFY_KEY, JSON.stringify(taskTimerNotifySettings));
}

function getTaskNotifySetting(taskId) {
    const raw = taskTimerNotifySettings[String(taskId)] || {};
    const intervalMinutes = Number(raw.intervalMinutes) > 0 ? Number(raw.intervalMinutes) : 10;
    const customValue = Number(raw.customValue) > 0 ? Number(raw.customValue) : 10;
    const customUnit = raw.customUnit === 'hours' ? 'hours' : 'minutes';

    return {
        enabled: !!raw.enabled,
        intervalMinutes,
        isCustom: !!raw.isCustom,
        customValue,
        customUnit
    };
}

function setTaskNotifySetting(taskId, setting) {
    taskTimerNotifySettings[String(taskId)] = setting;
    delete runningTimerNotificationState[String(taskId)];
    persistTaskTimerNotifySettings();
}

function getTaskNotifyOptionValue(taskId) {
    const setting = getTaskNotifySetting(taskId);
    if (!setting.enabled) return 'off';
    if (setting.isCustom) return 'custom';
    if ([10, 20, 30, 60].includes(setting.intervalMinutes)) return `${setting.intervalMinutes}m`;
    return 'custom';
}

function getTaskNotifyLabel(taskId) {
    const setting = getTaskNotifySetting(taskId);
    if (!setting.enabled) return 'Off';
    if (setting.isCustom) return `Every ${setting.customValue} ${setting.customUnit === 'hours' ? 'hr' : 'min'}`;
    return `Every ${setting.intervalMinutes} min`;
}

function formatDurationShort(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function unlockTaskNotificationSound() {
    try {
        if (!window.AudioContext && !window.webkitAudioContext) return false;

        if (!taskNotificationAudioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            taskNotificationAudioContext = new AudioCtx();
        }

        if (taskNotificationAudioContext.state === 'suspended') {
            taskNotificationAudioContext.resume();
        }

        taskNotificationAudioUnlocked = true;
        return true;
    } catch (err) {
        return false;
    }
}

function playTaskNotificationSound() {
    try {
        const unlocked = unlockTaskNotificationSound();
        if (!unlocked || !taskNotificationAudioContext) return;

        const ctx = taskNotificationAudioContext;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.22);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.25);
    } catch (err) {
        // Ignore sound playback errors silently.
    }
}
async function ensureNotificationPermission() {
    unlockTaskNotificationSound();

    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    const permission = await Notification.requestPermission();
    return permission === 'granted';
}

async function handleTaskNotifyOptionChange(taskId, optionValue) {
    if (optionValue === 'off') {
        setTaskNotifySetting(taskId, { enabled: false, intervalMinutes: 10, isCustom: false, customValue: 10, customUnit: 'minutes' });
        loadTasks();
        return;
    }

    if (optionValue === 'custom') {
        const current = getTaskNotifySetting(taskId);
        const suggestedValue = current.isCustom ? String(current.customValue) : '45';
        const suggestedUnit = current.isCustom ? current.customUnit : 'minutes';

        const valueInput = prompt('Custom notification interval value:', suggestedValue);
        if (!valueInput) {
            loadTasks();
            return;
        }

        const customValue = Number(valueInput);
        if (!Number.isFinite(customValue) || customValue <= 0) {
            showToast('Please enter a valid positive number.', 'error');
            loadTasks();
            return;
        }

        const unitInput = (prompt('Type unit: minutes or hours', suggestedUnit) || '').trim().toLowerCase();
        const customUnit = unitInput.startsWith('h') ? 'hours' : 'minutes';
        const intervalMinutes = customUnit === 'hours' ? customValue * 60 : customValue;

        setTaskNotifySetting(taskId, {
            enabled: true,
            intervalMinutes,
            isCustom: true,
            customValue,
            customUnit
        });

        unlockTaskNotificationSound();
        await ensureNotificationPermission();
        loadTasks();
        return;
    }

    const minutes = parseInt(optionValue.replace('m', ''), 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        loadTasks();
        return;
    }

    setTaskNotifySetting(taskId, {
        enabled: true,
        intervalMinutes: minutes,
        isCustom: false,
        customValue: minutes,
        customUnit: 'minutes'
    });

    unlockTaskNotificationSound();
    await ensureNotificationPermission();
    loadTasks();
}

function editTaskCustomNotify(taskId) {
    handleTaskNotifyOptionChange(taskId, 'custom');
}
function maybeSendTaskRunningNotification(taskId, taskTitle, runningSeconds) {
    const setting = getTaskNotifySetting(taskId);
    if (!setting.enabled) return;

    const intervalMs = setting.intervalMinutes * 60 * 1000;
    const currentMs = runningSeconds * 1000;
    const step = Math.floor(currentMs / intervalMs);

    if (step < 1) return;

    const key = String(taskId);
    const state = runningTimerNotificationState[key] || { lastStep: 0 };
    if (step <= state.lastStep) return;

    runningTimerNotificationState[key] = { lastStep: step };

    playTaskNotificationSound();

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Task timer reminder', {
            body: `${taskTitle} is still running (${formatDurationShort(runningSeconds)}).`,
            tag: `task-running-${taskId}`
        });
    }
}

function setupTaskDragAndDrop() {
    const dropTargets = [
        { id: 'task-list-todo', status: 'todo' },
        { id: 'task-list-progress', status: 'inprogress' },
        { id: 'task-list-done', status: 'done' }
    ];

    dropTargets.forEach(({ id, status }) => {
        const zone = document.getElementById(id);
        if (!zone) return;

        zone.ondragover = (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        };

        zone.ondragleave = (e) => {
            if (!zone.contains(e.relatedTarget)) {
                zone.classList.remove('drag-over');
            }
        };

        zone.ondrop = async (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            const dataId = parseInt(e.dataTransfer.getData('text/task-id'));
            const taskId = Number.isFinite(dataId) ? dataId : draggedTaskId;
            if (!taskId) return;

            await updateTaskStatus(taskId, status, true);
            await loadTasks();
        };
    });
}

async function startTimer(taskId) {
    await apiFetch(`${API_BASE}/tasks/${taskId}/timer/start`, { method: 'POST' });

    const setting = getTaskNotifySetting(taskId);
    if (setting.enabled) {
        unlockTaskNotificationSound();
        await ensureNotificationPermission();
    }

    runningTimerNotificationState[String(taskId)] = { lastStep: 0 };
    loadTasks();
}

async function stopTimer(taskId, skipReload = false) {
    await apiFetch(`${API_BASE}/tasks/${taskId}/timer/stop`, { method: 'POST' });
    delete runningTimerNotificationState[String(taskId)];
    if (!skipReload) loadTasks();
}

async function resetTimer(taskId) {
    if(!(await showConfirm("Reset timer? This will erase all time logs for this task."))) return;
    await apiFetch(`${API_BASE}/tasks/${taskId}/timer/reset`, { method: 'POST' });
    delete runningTimerNotificationState[String(taskId)];
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

    const bmExtras = document.getElementById('bookmark-sidebar-extras');
    if (bmExtras) bmExtras.style.display = tabName === 'bookmarks' ? 'block' : 'none';

    if (tabName === 'dashboard') loadDashboard();
    if (tabName === 'bookmarks') { loadBookmarks(); loadFolders(); loadTags(); }
    if (tabName === 'tasks') loadTasks();
    if (tabName === 'research') { loadNotes(); loadNoteFolders(); }
    if (tabName === 'archive') loadArchive();
    if (tabName === 'stats') loadStats();
    if (tabName === 'planner') initPlanner();
}
async function loadNoteFolders() {
    try {
        const folders = await apiFetch(`${API_BASE}/folders`);

        // 1. Populate Left Sidebar List
        const list = document.getElementById('note-folder-list');
        list.innerHTML = '';

        // "All Notes" item
        const allDiv = document.createElement('div');
        allDiv.className = 'rp-folder-item' + (currentNoteFolder === null ? ' active' : '');
        allDiv.innerHTML = `<span class="material-icons rp-folder-icon">inbox</span><span class="rp-folder-name">All Notes</span>`;
        allDiv.onclick = () => { currentNoteFolder = null; loadNoteFolders(); renderNotesList(); };
        list.appendChild(allDiv);

        folders.forEach(f => {
            const div = document.createElement('div');
            div.className = 'rp-folder-item' + (currentNoteFolder === f.id ? ' active' : '');

            const icon = document.createElement('span');
            icon.className = 'material-icons rp-folder-icon';
            icon.textContent = 'folder';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'rp-folder-name';
            nameSpan.textContent = f.name;

            const delBtn = document.createElement('span');
            delBtn.className = 'material-icons rp-folder-del';
            delBtn.textContent = 'close';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(f.id, f.name); };

            div.appendChild(icon);
            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            div.onclick = () => { currentNoteFolder = f.id; loadNoteFolders(); renderNotesList(); };
            list.appendChild(div);
        });

        // 2. Populate Dropdown in Editor
        const select = document.getElementById('note-folder-select');
        const currentVal = select.value;
        select.innerHTML = '<option value="">Uncategorized</option>';
        folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.name;
            select.appendChild(opt);
        });
        if (currentVal) select.value = currentVal;

    } catch (err) { console.error(err); }
}

async function createNewFolderForNotes() {
    const name = prompt("New Folder Name:");
    if (!name) return;
    try {
        await apiFetch(`${API_BASE}/folders`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name }) });
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
    if (!url) { showToast("Please enter a URL", "error"); return; }

    const payload = {
        url: url,
        title: titleInput.value.trim() || "Fetching title...",
        description: descInput.value.trim(), 
        tags: tagInput.value.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0),
        folderId: folderSelect.value
    };

    try {
        await apiFetch(`${API_BASE}/bookmarks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        urlInput.value = ''; titleInput.value = ''; tagInput.value = ''; descInput.value = '';
        hideTagDropdown('bm-tag-dropdown');
        showToast('Bookmark saved!', 'success');
        loadBookmarks();
        loadTags();
    } catch (err) { console.error('Error saving bookmark', err); showToast('Failed to save bookmark', 'error'); }
}

async function loadBookmarks() {
    try {
        const container = document.getElementById('bookmark-list');
        if (container && allBookmarksCache.length === 0) container.innerHTML = '<div class="loading-spinner"></div>';
        allBookmarksCache = await apiFetch(`${API_BASE}/bookmarks`);
        renderBookmarks();
    } catch (err) { console.error("Failed to load bookmarks", err); }
}
function filterBookmarksLocally(query) {
    currentSearchTerm = query.toLowerCase();
    renderBookmarks();
}

function editBookmark(id) {
    const bm = allBookmarksCache.find(b => b.id === id);
    if (bm) openEditModal(bm);
}

function exportDatabase() {
    fetch('/api/export/database')
        .then(res => {
            if (!res.ok) throw new Error("Network response was not ok");
            return res.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `karmtrack_full_backup_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        })
        .catch(err => console.error("Export failed:", err));
}

async function importDatabase(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const jsonData = JSON.parse(e.target.result);

            if (!jsonData.bookmarks && !jsonData.tasks && !jsonData.notes) {
                showToast("File does not appear to be a valid KarmtracK backup.", "error");
                return;
            }

            if(await showConfirm("This will merge the backup data into your current database. Continue?")) {
                try {
                    const data = await apiFetch('/api/import/database', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(jsonData)
                    });
                    showToast(data.message || "Import successful!", "success");
                    setTimeout(() => window.location.reload(), 1000);
                } catch (err) {
                    showToast("Import Error: " + err.message, "error");
                }
            }

        } catch (err) {
            showToast("Error parsing JSON file: " + err.message, "error");
        }
    };
    reader.readAsText(file);
    input.value = '';
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape: close modals and confirm dialog
    if (e.key === "Escape") {
        const confirmBackdrop = document.getElementById('confirm-dialog-backdrop');
        if (confirmBackdrop && !confirmBackdrop.classList.contains('hidden')) {
            document.getElementById('confirm-dialog-cancel').click();
            return;
        }
        if (!document.getElementById('edit-modal-backdrop').classList.contains('hidden')) {
            closeEditModal();
            return;
        }
        if (!document.getElementById('task-modal-backdrop').classList.contains('hidden')) {
            closeTaskModal();
            return;
        }
    }

    // Ctrl/Cmd shortcuts (skip if typing in input/textarea/contenteditable)
    if (e.ctrlKey || e.metaKey) {
        const tag = document.activeElement?.tagName;
        const isEditable = document.activeElement?.contentEditable === 'true';

        if (e.key === 'k' || e.key === 'K') {
            e.preventDefault();
            const searchInput = document.getElementById('global-search-input');
            if (searchInput) searchInput.focus();
            return;
        }

        // Tab switching: Ctrl+1/2/3/4
        if (['1','2','3','4'].includes(e.key)) {
            e.preventDefault();
            const tabs = ['dashboard', 'bookmarks', 'tasks', 'research'];
            switchTab(tabs[parseInt(e.key) - 1]);
            return;
        }
    }
});

async function deleteBookmark(id) {
    if(!(await showConfirm("Delete this bookmark?", { skipKey: 'delete' }))) return;
    try {
        await apiFetch(`${API_BASE}/bookmarks/${id}`, { method: 'DELETE' });
        allBookmarksCache = allBookmarksCache.filter(bm => bm.id !== id);
        showToast('Bookmark deleted', 'success');
        renderBookmarks();
        loadTags();
    } catch (err) { console.error('Error deleting', err); showToast('Failed to delete bookmark', 'error'); }
}

function toggleBmView(view) {
    currentBmView = view;
    renderBookmarks();
}

function toggleBmSort() {
    currentBmSort = currentBmSort === 'newest' ? 'oldest' : 'newest';
    const btn = document.getElementById('bm-sort-btn');
    if (btn) btn.textContent = currentBmSort === 'newest' ? 'Newest First' : 'Oldest First';
    renderBookmarks();
}

function updateXPreviewModeButtons() {
    const compactBtn = document.getElementById('x-mode-compact-btn');
    const fullBtn = document.getElementById('x-mode-full-btn');
    if (!compactBtn || !fullBtn) return;

    const activeStyle = 'background: var(--accent-cyan); color: #111; border: 1px solid var(--accent-cyan); border-radius: 4px; padding: 10px 12px; font-size: 12px;';
    const idleStyle = 'background: #222; color: white; border: 1px solid #444; border-radius: 4px; padding: 10px 12px; font-size: 12px;';

    compactBtn.style.cssText = xPreviewMode === 'compact' ? activeStyle : idleStyle;
    fullBtn.style.cssText = xPreviewMode === 'full' ? activeStyle : idleStyle;
}

function setXPreviewMode(mode) {
    xPreviewMode = mode === 'full' ? 'full' : 'compact';
    localStorage.setItem('xPreviewMode', xPreviewMode);
    updateXPreviewModeButtons();
    renderBookmarks();
}

const BM_PAGE_SIZE = 30; // Max items to render per folder section at once

function renderBmPage(container, items, offset) {
    const slice = items.slice(offset, offset + BM_PAGE_SIZE);
    slice.forEach(bm => container.appendChild(createBookmarkElement(bm)));
    const remaining = items.length - offset - BM_PAGE_SIZE;
    if (remaining > 0) {
        const btn = document.createElement('button');
        btn.textContent = `Show ${Math.min(remaining, BM_PAGE_SIZE)} more of ${remaining} remaining...`;
        btn.style.cssText = 'display:block; width:100%; margin:10px 0; padding:8px; background:#222; color:#aaa; border:1px solid #333; border-radius:4px; cursor:pointer; font-size:13px;';
        btn.onclick = () => { btn.remove(); renderBmPage(container, items, offset + BM_PAGE_SIZE); };
        container.appendChild(btn);
    }
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

    // Sort by upload time
    displayData = [...displayData].sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return currentBmSort === 'newest' ? tb - ta : ta - tb;
    });

    if (displayData.length === 0) {
        mainContainer.innerHTML = '<div style="padding:20px; color:#666; font-style:italic;">The void stares back... (No bookmarks found)</div>';
        return;
    }

    const isFiltered = (currentFolderFilter !== null || currentSearchTerm !== '');

    if (isFiltered) {
        const folderContainer = document.createElement('div');
        folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
        mainContainer.appendChild(folderContainer);
        renderBmPage(folderContainer, displayData, 0);
    } else {
        // Grouped View
        const groupedByFolder = displayData.reduce((acc, bm) => {
            const folderName = bm.folder_name || 'Uncategorized';
            if (!acc[folderName]) acc[folderName] = [];
            acc[folderName].push(bm);
            return acc;
        }, {});

        for (const folderName in groupedByFolder) {
            const isCollapsed = folderName in bmCollapsedSections ? bmCollapsedSections[folderName] : true;
            const items = groupedByFolder[folderName];
            const count = items.length;
            let itemsRendered = false;

            const header = document.createElement('div');
            header.className = 'bm-section-header';
            header.innerHTML = `<span style="display:flex;align-items:center;gap:10px;">${escapeHtml(folderName)}<span class="bm-section-count">${count}</span></span><span class="bm-section-toggle material-icons${isCollapsed ? ' collapsed' : ''}">expand_more</span>`;
            mainContainer.appendChild(header);

            const folderContainer = document.createElement('div');
            folderContainer.className = currentBmView === 'grid' ? 'bm-grid-layout' : 'bm-list-layout';
            mainContainer.appendChild(folderContainer);

            if (!isCollapsed) {
                // Already expanded: render first page immediately
                renderBmPage(folderContainer, items, 0);
                itemsRendered = true;
                folderContainer.style.display = '';
            } else {
                // Collapsed: hide container but don't render DOM nodes yet
                folderContainer.style.display = 'none';
            }

            header.addEventListener('click', () => {
                const currentState = folderName in bmCollapsedSections ? bmCollapsedSections[folderName] : true;
                const collapsed = !currentState;
                bmCollapsedSections[folderName] = collapsed;
                const arrow = header.querySelector('.bm-section-toggle');
                if (collapsed) {
                    arrow.classList.add('collapsed');
                    folderContainer.style.display = 'none';
                } else {
                    arrow.classList.remove('collapsed');
                    folderContainer.style.display = '';
                    // Lazy render: only create DOM nodes on first expand
                    if (!itemsRendered) {
                        renderBmPage(folderContainer, items, 0);
                        itemsRendered = true;
                    }
                    // Re-initialize Twitter widgets for newly visible embeds
                    if (currentBmView === 'grid' && xPreviewMode === 'full') {
                        renderTwitterWidgets(folderContainer);
                    }
                }
            });
        }
    }
    const hasTwitterBookmarks = displayData.some(bm => bm.url.includes('x.com') || bm.url.includes('twitter.com'));
    if (currentBmView === 'grid' && xPreviewMode === 'full' && hasTwitterBookmarks) {
        renderTwitterWidgets();
    }
}

function createBookmarkElement(bm) {
    const div = document.createElement('div');
    div.className = 'bm-item';
    
    const isTwitter = bm.url.includes('x.com') || bm.url.includes('twitter.com');
    const displayUrl = bm.url.replace(/^https?:\/\/(www\.)?/i, '');
    const compactUrl = displayUrl.length > 52 ? `${displayUrl.slice(0, 52)}...` : displayUrl;
    
    // Tags HTML (Neon Chips) - escaped
    let tagsHtml = '';
    if (bm.tags && bm.tags.length > 0) {
        tagsHtml = bm.tags.map(t =>
            `<span style="border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-right: 4px; display:inline-block; text-transform: uppercase;">#${escapeHtml(t)}</span>`
        ).join('');
    }

    // Description HTML (Yellow Highlight box) - escaped
    const descHtml = (bm.description && bm.description !== "Pending...")
        ? `<div style="margin-top: 10px; font-size: 13px; color: #ffc107; background: rgba(255, 193, 7, 0.1); padding: 8px; border-left: 2px solid #ffc107; font-style: italic;">"${escapeHtml(bm.description)}"</div>`
        : '';

    // Buttons HTML - pass ID instead of full JSON to prevent XSS
    const pinClass = bm.pinned ? 'pin-btn pinned' : 'pin-btn';
    const pinIcon = bm.pinned ? '&#9733;' : '&#9734;';
    const buttonsHtml = `
        <button class="${pinClass}" onclick="event.stopPropagation(); togglePin('bookmark', ${bm.id})" title="Pin">${pinIcon}</button>
        <button onclick="editBookmark(${bm.id})" style="font-size:10px; color:black; background:white; border:none; padding:4px 8px; border-radius:2px; margin-right:5px;">EDIT</button>
        <button onclick="deleteBookmark(${bm.id})" style="font-size:10px; color:white; background:var(--primary-red); border:none; padding:4px 8px; border-radius:2px;">DEL</button>
    `;

    if (currentBmView === 'grid') {
        // --- GRID VIEW ---
        let mediaHtml = '';
        if (isTwitter) {
            if (xPreviewMode === 'full') {
                mediaHtml = navigator.onLine
                    ? `<div style="min-height:100px; display:flex; justify-content:center; overflow:hidden; margin-bottom:10px;"><blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><a href="${bm.url.replace('x.com','twitter.com')}"></a></blockquote></div>`
                    : `<div style="padding:20px; text-align:center; background:#222; border:1px dashed #444; font-size:12px; color:#666;">Offline Preview</div>`;
            } else {
                mediaHtml = `
                    <a class="x-compact-card" href="${bm.url}" target="_blank" rel="noopener noreferrer">
                        <div class="x-compact-badge">X</div>
                        <div class="x-compact-meta">
                            <div class="x-compact-label">X Post</div>
                            <div class="x-compact-url">${compactUrl}</div>
                        </div>
                        <div class="x-compact-open">Open</div>
                    </a>`;
            }
        } else if (bm.thumbnail) {
            const proxiedSrc = `/api/proxy-image?url=${encodeURIComponent(bm.thumbnail)}`;
            mediaHtml = `<img src="${proxiedSrc}" loading="lazy" style="width:100%; height:160px; display:block; border-radius:4px; margin-bottom:10px; object-fit: cover; opacity: 0.9;" onerror="this.style.display='none'">`;
        }
        
        div.innerHTML = `
            ${mediaHtml}
            <h4 style="margin:0 0 5px 0; word-break: break-word; line-height: 1.4; font-size: 1rem;">
                <a href="${escapeHtml(bm.url)}" target="_blank" style="text-decoration:none;">${escapeHtml(bm.title)}</a>
            </h4>
            ${descHtml}
            <div class="bm-meta-row">
                <div class="bm-tags-wrap">${tagsHtml}</div>
                <div class="bm-actions">${buttonsHtml}</div>
            </div>`;

    } else {
        // --- LIST VIEW ---
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.padding = '15px';
        
        div.innerHTML = `
            <div style="flex: 1; overflow: hidden; margin-right: 15px;">
                <a href="${escapeHtml(bm.url)}" target="_blank" class="bm-title-link" style="text-decoration:none; font-weight:bold; font-size: 1.1rem; color: white;">${escapeHtml(bm.title)}</a>
                <div class="bm-url-line" style="font-size:12px; color:#666; margin-top:2px;" title="${escapeHtml(bm.url)}">${escapeHtml(bm.url)}</div>
                ${descHtml}
                <div style="margin-top:8px;">${tagsHtml}</div>
            </div>
            <div style="display:flex; align-items:center;">
                ${buttonsHtml}
            </div>`;
    }
    return div;
}

function renderTwitterWidgets(container) {
    if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load(container || document);
    } else {
        setTimeout(() => renderTwitterWidgets(container), 500);
    }
}


/* =================================================================
   FOLDERS
   ================================================================= */

async function loadFolders() {
    try {
        const folders = await apiFetch(`${API_BASE}/folders`);
        
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
        allDiv.className = 'sidebar-folder-item sidebar-folder-all';
        allDiv.innerHTML = '<span class="material-icons" style="font-size:14px;opacity:0.5;">layers</span><span>All Bookmarks</span>';
        allDiv.onclick = () => { setViewFolder(null, 'All'); };
        sidebarList.appendChild(allDiv);

        folders.forEach(folder => {
            const div = document.createElement('div');
            div.className = 'sidebar-folder-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'sidebar-folder-name';
            nameSpan.textContent = folder.name;
            nameSpan.onclick = () => { setViewFolder(folder.id, folder.name); };

            const delBtn = document.createElement('button');
            delBtn.className = 'sidebar-folder-del';
            delBtn.innerHTML = '<span class="material-icons" style="font-size:13px;">delete_outline</span>';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };

            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            sidebarList.appendChild(div);
        });

        const newFolderBtn = document.createElement('button');
        newFolderBtn.className = 'sidebar-folder-new-btn';
        newFolderBtn.innerHTML = '<span class="material-icons" style="font-size:13px;">add</span> New Folder';
        newFolderBtn.onclick = createNewFolder;
        sidebarList.appendChild(newFolderBtn);
        
    } catch (err) { console.error("Failed to load folders", err); }
}

async function createNewFolder() {
    const folderName = prompt("Enter new folder name:");
    if (folderName && folderName.trim() !== "") {
        try {
            const newFolder = await apiFetch(`${API_BASE}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folderName.trim() }) });
            await loadFolders(); // Refresh lists
            document.getElementById('bm-folder-select').value = newFolder.id;
        } catch (err) { console.error("Failed to create folder", err); }
    } else {
        document.getElementById('bm-folder-select').value = "";
    }
}

async function deleteFolder(id, name) {
    if (!(await showConfirm(`WARNING: Delete the "${name}" folder? This will permanently delete all Bookmarks and Notes in this folder.`, { skipKey: 'delete' }))) return;
    
    try {
        await apiFetch(`${API_BASE}/folders/${id}`, { method: 'DELETE' });
        showToast(`Folder "${name}" deleted`, 'success');
        
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
   TAG AUTOCOMPLETE HELPERS
   ================================================================= */

function getCurrentTagsFromInput(inputId) {
    const val = document.getElementById(inputId).value;
    return val.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
}

function showTagDropdown(dropdownId, inputId) {
    filterTagDropdown(dropdownId, inputId);
}

function hideTagDropdown(dropdownId) {
    const dd = document.getElementById(dropdownId);
    if (dd) { dd.classList.remove('visible'); }
}

function filterTagDropdown(dropdownId, inputId) {
    const dd = document.getElementById(dropdownId);
    const input = document.getElementById(inputId);
    if (!dd || !input) return;

    // Get the last tag fragment being typed (after last comma)
    const rawVal = input.value;
    const parts = rawVal.split(',');
    const currentFragment = parts[parts.length - 1].trim().toLowerCase();

    const alreadyAdded = getCurrentTagsFromInput(inputId);

    // Filter tags: match fragment, exclude already-fully-added ones
    const matching = allTagsCache.filter(tag => {
        if (currentFragment.length > 0) return tag.includes(currentFragment);
        return true;
    });

    if (matching.length === 0) {
        hideTagDropdown(dropdownId);
        return;
    }

    dd.innerHTML = '';
    matching.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-option' + (alreadyAdded.includes(tag) ? ' already-added' : '');
        chip.textContent = '#' + tag;
        if (!alreadyAdded.includes(tag)) {
            chip.onclick = () => {
                // Replace the last fragment with this tag + comma
                const existingParts = input.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
                // Remove the last partial fragment
                if (existingParts.length > 0 && tag.startsWith(existingParts[existingParts.length - 1].toLowerCase())) {
                    existingParts[existingParts.length - 1] = tag;
                } else {
                    existingParts.push(tag);
                }
                input.value = existingParts.join(', ') + ', ';
                input.focus();
                filterTagDropdown(dropdownId, inputId);
            };
        }
        dd.appendChild(chip);
    });

    dd.classList.add('visible');
}

/* =================================================================
   TAGS
   ================================================================= */

async function loadTags() {
    try {
        const tags = await apiFetch(`${API_BASE}/tags`);
        allTagsCache = tags.map(t => t.name); // Update autocomplete cache
        const container = document.getElementById('sidebar-tags');
        container.innerHTML = '';
        tags.forEach(tag => {
            const wrapper = document.createElement('div');
            wrapper.className = 'sidebar-tag-pill';

            const label = document.createElement('span');
            label.className = 'sidebar-tag-label';
            label.textContent = tag.name;
            label.onclick = () => {
                const filterInput = document.querySelector('#view-bookmarks input[onkeyup]');
                if (filterInput) { filterInput.value = tag.name; filterBookmarksLocally(tag.name); }
            };

            const count = document.createElement('span');
            count.className = 'sidebar-tag-count';
            count.textContent = tag.count;

            const delBtn = document.createElement('button');
            delBtn.className = 'sidebar-tag-del';
            delBtn.innerHTML = '&times;';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteTag(tag.id, tag.name); };

            wrapper.appendChild(label);
            wrapper.appendChild(count);
            wrapper.appendChild(delBtn);
            container.appendChild(wrapper);
        });
    } catch (err) { console.error("Error loading tags:", err); }
}

async function deleteTag(id, name) {
    if(!(await showConfirm(`Deleting tag "${name}" will remove it from ALL items. Proceed?`, { skipKey: 'delete' }))) return;
    try {
        await apiFetch(`${API_BASE}/tags/${id}`, { method: 'DELETE' });
        showToast(`Tag "${name}" deleted`, 'success');
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
        const todoEl = document.getElementById('task-list-todo');
        if (todoEl && todoEl.innerHTML === '') todoEl.innerHTML = '<div class="loading-spinner"></div>';
        const tasks = await apiFetch(`${API_BASE}/tasks`);

        const dueDates = [...new Set(tasks.filter(t => t.status === 'todo' && t.due_date).map(t => t.due_date))];
        const plannedSet = new Set();
        const plannedBlockMap = {}; // key "date::label" -> block object
        if (dueDates.length > 0) {
            const results = await Promise.all(dueDates.map(d => apiFetch(`${API_BASE}/planner?date=${d}`).catch(() => [])));
            results.forEach(blocks => blocks.forEach(b => {
                const key = `${b.date}::${b.label}`;
                plannedSet.add(key);
                plannedBlockMap[key] = b;
            }));
        }

        renderTasks(tasks, plannedSet, plannedBlockMap);
    } catch (err) { console.error('Failed to load tasks', err); }
}

async function addTask() {
    const input = document.getElementById('new-task-input');
    const title = input.value.trim();
    if (!title) return;
    await apiFetch(`${API_BASE}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, status: 'todo' }) });
    input.value = '';
    showToast('Task created!', 'success');
    loadTasks();
}

async function deleteTask(id) {
    try {
        await apiFetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
        showToast('Task deleted', 'success');
        loadTasks();
    } catch (err) { console.error("Failed to delete task", err); showToast('Failed to delete task', 'error'); }
}

async function editTaskTitle(id, currentTitle) {
    const newTitle = prompt("Enter new task title:", currentTitle);
    if (newTitle && newTitle.trim() !== "") {
        await apiFetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle.trim() }) });
        loadTasks();
    }
}

async function updateTaskStatus(id, newStatus, skipReload = false) {
    const currentStatus = taskStatusMap[id];

    if (currentStatus === 'inprogress' && newStatus !== 'inprogress') {
        await stopTimer(id, true);
    }

    await apiFetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
    if (!skipReload) loadTasks();
}
async function updateTaskDate(id, dateStr) {
    if(!dateStr) return;
    await apiFetch(`${API_BASE}/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: dateStr }) });
    loadTasks();
}

async function updateTaskRepeat(id, repeatVal) {
    await apiFetch(`${API_BASE}/tasks/${id}/repeat`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repeat: repeatVal || null }) });
    loadTasks();
}

let plannerOpenedFromTask = false;

function planTaskInPlanner(taskTitle, dueDate) {
    plannerOpenedFromTask = true;
    plannerCurrentDate = dueDate;
    openPlannerModal(null);
    document.getElementById('pb-label').value = taskTitle;
}

function editPlannedBlock(blockJson) {
    plannerOpenedFromTask = true;
    const block = JSON.parse(decodeURIComponent(blockJson));
    plannerCurrentDate = block.date;
    openPlannerModal(block);
}

async function resetPlannedBlock(blockId) {
    try {
        await apiFetch(`${API_BASE}/planner/${blockId}`, { method: 'DELETE' });
        loadTasks();
    } catch(e) {
        showToast('Failed to remove plan', 'error');
    }
}

function renderTasks(tasks, plannedSet = new Set(), plannedBlockMap = {}) {
    // 1. Clear the current lists
    document.getElementById('task-list-todo').innerHTML = '';
    document.getElementById('task-list-progress').innerHTML = '';
    document.getElementById('task-list-done').innerHTML = '';

    taskStatusMap = {};
    tasks.forEach(task => {
        taskStatusMap[task.id] = task.status;
    });

    const todoTasks = tasks.filter(t => t.status === 'todo');
    const inProgressTasks = tasks
        .filter(t => t.status === 'inprogress')
        .sort((a, b) => {
            const aRunning = a.active_start ? 1 : 0;
            const bRunning = b.active_start ? 1 : 0;
            if (aRunning !== bRunning) return bRunning - aRunning;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
    const doneTasks = tasks.filter(t => t.status === 'done');

    const orderedTasks = [...todoTasks, ...inProgressTasks, ...doneTasks];

    orderedTasks.forEach(task => {
        // 2. Create the card container
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.setAttribute('data-task-id', String(task.id));
        card.setAttribute('data-task-status', task.status);

        // Base styling moved to CSS, specific overrides here:
        card.style.padding = '15px';
        card.style.marginBottom = '15px';
        card.style.borderRadius = '8px';
        card.style.cursor = 'pointer';
        card.style.position = 'relative';
        card.style.overflow = 'hidden';

        card.addEventListener('dragstart', (e) => {
            draggedTaskId = task.id;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/task-id', String(task.id));
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('.task-container').forEach(el => el.classList.remove('drag-over'));
        });

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
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && !e.target.closest('button')) {
                openTaskModal(task.id);
            }
        };

        // 3. UI Components
        let controls = '';
        if (task.status === 'todo') {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:10px; background:var(--accent-cyan); color:black; border:none; padding:4px 8px; border-radius:4px;">Move to in progress</button>`;
        } else if (task.status === 'inprogress') {
            controls = `
                <button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'todo')" style="font-size:10px; background:#444; color:white; border:none; padding:4px 8px; border-radius:4px;">Move to todo</button>
                <button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'done')" style="font-size:10px; background:var(--primary-red); color:white; border:none; padding:4px 8px; border-radius:4px; margin-left:5px;">Completed</button>`;
        } else {
            controls = `<button onclick="event.stopPropagation(); updateTaskStatus(${task.id}, 'inprogress')" style="font-size:10px; background:#444; color:white; border:none; padding:4px 8px; border-radius:4px;">Re-open</button>`;
        }

        let dateHtml = '';
        if (task.status === 'todo') {
            const safeTitleForAttr = String(task.title || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            if (task.due_date) {
                const planKey = `${task.due_date}::${task.title}`;
                const isPlanned = plannedSet.has(planKey);
                const planBtn = isPlanned
                    ? (() => {
                        const blockData = encodeURIComponent(JSON.stringify(plannedBlockMap[planKey]));
                        const blockId = plannedBlockMap[planKey].id;
                        return `<button onclick="event.stopPropagation(); editPlannedBlock('${blockData}')" title="Edit planned time" style="font-size:10px; color:#4caf50; background:rgba(76,175,80,0.12); border:1px solid rgba(76,175,80,0.3); border-radius:4px 0 0 4px; padding:2px 7px; cursor:pointer;">&#10003; Planned</button><button onclick="event.stopPropagation(); resetPlannedBlock(${blockId})" title="Remove planned time" style="font-size:10px; color:#888; background:rgba(76,175,80,0.08); border:1px solid rgba(76,175,80,0.3); border-left:none; border-radius:0 4px 4px 0; padding:2px 6px; cursor:pointer;">&times;</button>`;
                    })()
                    : `<button onclick="event.stopPropagation(); planTaskInPlanner('${safeTitleForAttr}', '${task.due_date}')" title="Plan start/end time in Planner" style="font-size:10px; background:rgba(5,217,232,0.12); color:var(--accent-cyan); border:1px solid rgba(5,217,232,0.3); border-radius:4px; padding:2px 7px; cursor:pointer;">&#128197; Plan</button>`;
                dateHtml = `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <input type="date" value="${task.due_date}" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:var(--accent-cyan); font-weight:bold; cursor:pointer;">
                    ${planBtn}
                </div>`;
            } else {
                dateHtml = `<input type="date" onclick="event.stopPropagation()" onchange="updateTaskDate(${task.id}, this.value)" style="font-size:11px; border:none; background:transparent; color:#666; cursor:pointer;">`;
            }
        } else if (task.due_date) {
            dateHtml = `<div style="font-size:11px; color:#888;">Due: ${task.due_date}</div>`;
        }

        const REPEAT_LABELS = { daily:'Every day', weekdays:'Weekdays', weekends:'Weekends', mon:'Every Mon', tue:'Every Tue', wed:'Every Wed', thu:'Every Thu', fri:'Every Fri', sat:'Every Sat', sun:'Every Sun' };
        let repeatHtml = '';
        if (task.status === 'todo') {
            const rv = task.repeat || '';
            repeatHtml = `<div style="display:flex; align-items:center; gap:5px; margin-top:4px;">
                <span style="font-size:10px; color:#666;">&#8635;</span>
                <select onclick="event.stopPropagation()" onchange="updateTaskRepeat(${task.id}, this.value)" style="font-size:10px; background:#1a1a1a; color:${rv ? 'var(--accent-cyan)' : '#666'}; border:1px solid #333; border-radius:4px; padding:2px 5px; cursor:pointer;">
                    <option value="" ${!rv ? 'selected' : ''}>No repeat</option>
                    <option value="daily" ${rv==='daily' ? 'selected' : ''}>Every day</option>
                    <option value="weekdays" ${rv==='weekdays' ? 'selected' : ''}>Weekdays (Mon–Fri)</option>
                    <option value="weekends" ${rv==='weekends' ? 'selected' : ''}>Weekends (Sat–Sun)</option>
                    <option value="mon" ${rv==='mon' ? 'selected' : ''}>Every Monday</option>
                    <option value="tue" ${rv==='tue' ? 'selected' : ''}>Every Tuesday</option>
                    <option value="wed" ${rv==='wed' ? 'selected' : ''}>Every Wednesday</option>
                    <option value="thu" ${rv==='thu' ? 'selected' : ''}>Every Thursday</option>
                    <option value="fri" ${rv==='fri' ? 'selected' : ''}>Every Friday</option>
                    <option value="sat" ${rv==='sat' ? 'selected' : ''}>Every Saturday</option>
                    <option value="sun" ${rv==='sun' ? 'selected' : ''}>Every Sunday</option>
                </select>
            </div>`;
        } else if (task.repeat) {
            repeatHtml = `<div style="font-size:10px; color:#888; margin-top:3px;">&#8635; ${REPEAT_LABELS[task.repeat] || task.repeat}</div>`;
        }

        const past = parseInt(task.past_duration) || 0;
        let timerControls = '';
        if (task.status === 'inprogress') {
            const notifyOptionValue = getTaskNotifyOptionValue(task.id);
            const notifyLabel = getTaskNotifyLabel(task.id);

            if (task.active_start) {
                const safeTitleAttr = String(task.title || '').replace(/"/g, '&quot;');
                const activeAttr = `data-active-start="${task.active_start}" data-past-duration="${past}" data-task-id="${task.id}" data-task-title="${safeTitleAttr}"`;
                timerControls = `
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; align-items:center; background: rgba(5, 217, 232, 0.1); padding: 5px; border-radius: 4px;">
                            <span class="task-timer-display" ${activeAttr} style="font-family:monospace; font-weight:bold; color:var(--accent-cyan); margin-right:10px; font-size:12px;">Syncing...</span>
                            <button onclick="event.stopPropagation(); stopTimer(${task.id})" style="border:none; background:none; color:var(--primary-red); cursor:pointer; font-size:16px; padding:0; line-height:1;">&#9209;</button>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:11px; color:#999;">Notify</span>
                            <select onclick="event.stopPropagation()" onchange="handleTaskNotifyOptionChange(${task.id}, this.value)" style="font-size:11px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:4px; padding:3px 6px;">
                                <option value="off" ${notifyOptionValue === 'off' ? 'selected' : ''}>Off</option>
                                <option value="10m" ${notifyOptionValue === '10m' ? 'selected' : ''}>Every 10m</option>
                                <option value="20m" ${notifyOptionValue === '20m' ? 'selected' : ''}>Every 20m</option>
                                <option value="30m" ${notifyOptionValue === '30m' ? 'selected' : ''}>Every 30m</option>
                                <option value="60m" ${notifyOptionValue === '60m' ? 'selected' : ''}>Every 60m</option>
                                <option value="custom" ${notifyOptionValue === 'custom' ? 'selected' : ''}>Custom</option>
                            </select>
                            <button onclick="event.stopPropagation(); editTaskCustomNotify(${task.id})" style="font-size:10px; background:#222; color:#ddd; border:1px solid #444; border-radius:4px; padding:2px 6px; cursor:pointer;">Edit</button>                            <span style="font-size:10px; color:#666;">${notifyLabel}</span>
                        </div>
                    </div>`;
            } else {
                timerControls = `
                    <div style="display:flex; align-items:center;">
                        <span class="task-timer-display" style="font-family:monospace; color:#888; margin-right:10px; font-size:12px;">${formatTime(past)}</span>
                        <button onclick="event.stopPropagation(); startTimer(${task.id})" style="border:none; background:none; color:var(--accent-cyan); cursor:pointer; font-size:16px; padding:0; line-height:1;">&#9654;</button>
                        <button onclick="event.stopPropagation(); resetTimer(${task.id})" title="Reset" style="border:none; background:none; color:#444; cursor:pointer; font-size:12px; margin-left:8px; padding:0;">&#8634;</button>
                    </div>`;
            }
        }

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

        const safeTitle = JSON.stringify(task.title || '');
        const taskPinClass = task.pinned ? 'pin-btn pinned' : 'pin-btn';
        const taskPinIcon = task.pinned ? '&#9733;' : '&#9734;';

        card.innerHTML = `
            <div class="task-head">
                <div class="task-title" style="font-weight:bold; font-size:15px; margin-bottom:5px; color:white;">${escapeHtml(task.title)}</div>
                <div class="task-actions" style="font-size:12px; white-space:nowrap;">
                    <button class="${taskPinClass}" onclick="event.stopPropagation(); togglePin('task', ${task.id})" title="Pin">${taskPinIcon}</button>
                    <button onclick='event.stopPropagation(); editTaskTitle(${task.id}, ${safeTitle})' style="border:none;background:none;cursor:pointer; opacity:0.5; color:white;">&#9998;</button>
                    <button onclick="event.stopPropagation(); deleteTask(${task.id})" style="border:none;background:none;cursor:pointer;color:var(--primary-red); opacity:0.8;">&times;</button>
                </div>
            </div>

            <div style="margin-bottom:4px;">${dateHtml}${repeatHtml}</div>

            ${checklistProgressHtml}

            ${timerControls ? `<div style="margin-bottom:10px;">${timerControls}</div>` : ''}

            <div class="task-controls" style="margin-top:5px; padding-top:5px; border-top:1px dashed #333;">
                ${controls}
            </div>
        `;

        if (task.status === 'todo') document.getElementById('task-list-todo').appendChild(card);
        else if (task.status === 'inprogress') document.getElementById('task-list-progress').appendChild(card);
        else document.getElementById('task-list-done').appendChild(card);
    });

    setupTaskDragAndDrop();
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


/* =================================================================
   RESEARCH NOTES
   ================================================================= */

let activeNoteId = null;
let saveTimer = null; 

async function loadNotes() {
    try {
        allNotesCache = await apiFetch(`${API_BASE}/notes`);
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
        list.innerHTML = '<li class="rp-notes-empty">No notes found.</li>';
        return;
    }

    displayNotes.forEach(note => {
        const li = document.createElement('li');
        li.className = 'rp-note-item' + (activeNoteId === note.id ? ' active' : '');

        const preview = (note.content || '').replace(/[#*`>\-_\[\]]/g, '').trim().slice(0, 60);
        const dateStr = new Date(note.updated_at || note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        li.innerHTML = `
            <div class="rp-note-title">${escapeHtml(note.title || 'Untitled')}</div>
            ${preview ? `<div class="rp-note-preview">${escapeHtml(preview)}</div>` : ''}
            <div class="rp-note-date">${dateStr}</div>
        `;

        li.onclick = () => openNote(note.id);
        list.appendChild(li);
    });
}

async function createNewNote() {
    // Default to the currently viewed folder, or null if viewing "All"
    const targetFolder = currentNoteFolder; 
    
    try {
        const data = await apiFetch(`${API_BASE}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Untitled Note',
                content: '',
                folderId: targetFolder
            })
        });
        
        // Reload list and open the new note
        await loadNotes(); 
        openNote(data.id); 
    } catch (err) { console.error(err); }
}

async function openNote(id) {
    activeNoteId = id;
    
    // 1. Fetch details
    const note = await apiFetch(`${API_BASE}/notes/${id}`);
    
    // 2. Populate Editor
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-editor').value = note.content || '';
    renderMarkdownPreview();

    // 3. Set Folder Dropdown
    const folderSelect = document.getElementById('note-folder-select');
    folderSelect.value = note.folder_id || ""; // Select the correct folder or "Uncategorized"

    // 4. Update Visual Highlight in List
    renderNotesList(); // Re-render to show the "active" blue background on the list item
}

async function deleteNote() {
    if (!activeNoteId) return;
    if (!(await showConfirm("Are you sure you want to delete this note permanently?", { skipKey: 'delete' }))) return;

    try {
        await apiFetch(`${API_BASE}/notes/${activeNoteId}`, { method: 'DELETE' });
        showToast('Note deleted', 'success');
        document.getElementById('note-title-input').value = '';
        document.getElementById('note-editor').value = '';
        activeNoteId = null;
        loadNotes();
    } catch (err) { console.error("Failed to delete note", err); }
}

async function saveCurrentNote() {
    if (!activeNoteId) return;
    
    const title = document.getElementById('note-title-input').value;
    const content = document.getElementById('note-editor').value;
    const folderId = document.getElementById('note-folder-select').value;

    try {
        await apiFetch(`${API_BASE}/notes/${activeNoteId}`, {
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
    const tasks = await apiFetch(`${API_BASE}/tasks`);

    document.getElementById('dash-task-count').innerText = `${tasks.filter(t => t.status !== 'done').length}`;

    renderDashboardCalendar(tasks);
    initTimeLeft();
    loadDashboardPlannerPreview();
}

async function loadDashboardPlannerPreview() {
    const today = todayStr();
    const dateLabel = document.getElementById('dash-planner-date');
    const blocksEl = document.getElementById('dash-planner-blocks');
    if (!dateLabel || !blocksEl) return;

    const d = new Date();
    dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    let blocks = [];
    try {
        blocks = await apiFetch(`${API_BASE}/planner?date=${today}`);
    } catch(e) { blocks = []; }

    if (!blocks.length) {
        blocksEl.innerHTML = '<span class="dash-planner-empty">No blocks scheduled today</span>';
        return;
    }

    blocks.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();

    blocksEl.innerHTML = blocks.map(block => {
        const startMin = timeToMinutes(block.start_time);
        const endMin = timeToMinutes(block.end_time);
        const isPast = endMin < nowMins;
        const isActive = startMin <= nowMins && nowMins < endMin;
        return `<div class="dash-planner-block-row${isActive ? ' active' : ''}${isPast ? ' past' : ''}" onclick="switchTab('planner')">
            <span class="dash-planner-block-dot" style="background:${block.color};"></span>
            <span class="dash-planner-block-time">${minutesToDisplay(startMin)}–${minutesToDisplay(endMin)}</span>
            <span class="dash-planner-block-label">${escapeHtml(block.label)}</span>
            ${isActive ? '<span class="dash-planner-active-badge">NOW</span>' : ''}
        </div>`;
    }).join('');
}

function getISOWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function updateTimeLeft() {
    const now = new Date();
    const DAY_NAMES = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

    const secOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const dayFrac = secOfDay / 86400;

    // ISO week: Mon=1 … Sun=7
    const isoDow = now.getDay() === 0 ? 7 : now.getDay();
    const weekFrac = ((isoDow - 1) + dayFrac) / 7;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthFrac = ((now.getDate() - 1) + dayFrac) / daysInMonth;

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd   = new Date(now.getFullYear() + 1, 0, 1);
    const yearFrac  = (now - yearStart) / (yearEnd - yearStart);

    const rows = [
        { id: 'tl-day',   label: DAY_NAMES[now.getDay()],           pct: dayFrac   },
        { id: 'tl-week',  label: `WEEK ${getISOWeekNumber(now)}`,   pct: weekFrac  },
        { id: 'tl-month', label: MONTH_NAMES[now.getMonth()],       pct: monthFrac },
        { id: 'tl-year',  label: String(now.getFullYear()),         pct: yearFrac  },
    ];

    const TOTAL_DOTS = 50;
    rows.forEach(({ id, label, pct }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.querySelector('.time-label').textContent = label;
        el.querySelector('.time-pct').textContent = Math.round(pct * 100) + '%';

        const filled = Math.round(pct * TOTAL_DOTS);
        const track = el.querySelector('.time-bar-track');
        track.innerHTML = Array.from({ length: TOTAL_DOTS }, (_, i) => {
            const isHot = i === filled - 1;
            const cls = i < filled ? (isHot ? 'time-dot filled hot' : 'time-dot filled') : 'time-dot';
            return `<span class="${cls}"></span>`;
        }).join('');
    });
}

let _timeLeftInterval = null;
function initTimeLeft() {
    updateTimeLeft();
    if (_timeLeftInterval) clearInterval(_timeLeftInterval);
    _timeLeftInterval = setInterval(updateTimeLeft, 60000);
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
            await performFilteredSearch(query);
        } catch (err) { console.error(err); }
    }, 300); 
}

function renderSearchResults(results, query) {
    const container = document.getElementById('search-results-container');
    container.innerHTML = `<p style="color: #aaa; margin-bottom: 20px;">Found ${results.length} fragments matching "<strong>${escapeHtml(query)}</strong>"</p>`;
    
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
        let icon = '?';
        if(item.type === 'bookmark') { typeColor = 'var(--accent-cyan)'; icon = '[BM]'; }
        if(item.type === 'task') { typeColor = 'var(--primary-red)'; icon = '[Task]'; }
        if(item.type === 'note') { typeColor = '#ffc107'; icon = '[Note]'; }
        
        div.style.borderLeft = `5px solid ${typeColor}`;

        div.onmouseover = () => { div.style.transform = 'translateX(5px)'; div.style.background = '#222'; };
        div.onmouseout = () => { div.style.transform = 'translateX(0)'; div.style.background = '#1a1a1a'; };

        div.innerHTML = `
            <div style="font-weight:bold; font-size:18px; color: white;">${icon} ${escapeHtml(item.title)}</div>
            <div style="color:#888; font-size:12px; margin-top:5px; text-transform: uppercase; letter-spacing: 1px;">
                Type: <span style="color:${typeColor}">${escapeHtml(item.type)}</span> | ${escapeHtml(item.info || '')}
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


/* ================= EDIT BOOKMARK MODAL ================= */

function openEditModal(bm) {
    activeEditBookmarkId = bm.id;
    document.getElementById('edit-modal-title-input').value = bm.title || '';
    document.getElementById('edit-modal-desc-input').value = (bm.description && bm.description !== "Pending...") ? bm.description : '';
    document.getElementById('edit-modal-tags-input').value = bm.tags ? bm.tags.join(', ') : '';
    hideTagDropdown('edit-tag-dropdown');
    document.getElementById('edit-modal-backdrop').classList.remove('hidden');
    // Ensure tag cache is available for autocomplete
    if (allTagsCache.length === 0) loadTags();
}

function closeEditModal() {
    activeEditBookmarkId = null;
    document.getElementById('edit-modal-backdrop').classList.add('hidden');
}

async function saveBookmarkChanges() {
    if (!activeEditBookmarkId) return;

    const newTitle = document.getElementById('edit-modal-title-input').value.trim();
    const newDesc = document.getElementById('edit-modal-desc-input').value.trim();
    const newTags = document.getElementById('edit-modal-tags-input').value;
    
    const payload = { 
        title: newTitle, 
        description: newDesc, 
        tags: newTags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0)
    };

    try {
        await apiFetch(`${API_BASE}/bookmarks/${activeEditBookmarkId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('Bookmark updated!', 'success');
        // Update cache locally — no need to refetch all bookmarks
        const idx = allBookmarksCache.findIndex(bm => bm.id === activeEditBookmarkId);
        if (idx !== -1) {
            allBookmarksCache[idx] = { ...allBookmarksCache[idx], title: newTitle, description: newDesc, tags: payload.tags };
        }
        closeEditModal();
        renderBookmarks();
        loadTags();
    } catch (err) {
        console.error("Failed to update bookmark", err);
        showToast("Failed to update bookmark", "error");
    }
}


/* ================= PIN / FAVORITE ================= */

async function togglePin(type, id) {
    try {
        await apiFetch(`${API_BASE}/${type}s/${id}/pin`, { method: 'PUT' });
        if (type === 'bookmark') loadBookmarks();
        else if (type === 'task') loadTasks();
    } catch (err) {
        showToast('Failed to toggle pin', 'error');
    }
}


/* ================= ARCHIVE ================= */

async function loadArchive() {
    try {
        const items = await apiFetch(`${API_BASE}/archive`);
        const container = document.getElementById('archive-list');
        container.innerHTML = '';

        if (items.length === 0) {
            container.innerHTML = '<div style="padding:20px; color:#666; font-style:italic; text-align:center;">Archive is empty. Deleted items will appear here.</div>';
            return;
        }

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'archive-item';

            const typeColors = { bookmark: 'var(--accent-cyan)', task: 'var(--primary-red)', note: '#ffc107' };
            div.style.borderLeft = `4px solid ${typeColors[item.type] || '#666'}`;

            div.innerHTML = `
                <div>
                    <div style="font-weight:bold; color:white;">${escapeHtml(item.title || 'Untitled')}</div>
                    <div style="font-size:11px; color:#666; margin-top:4px; text-transform:uppercase;">${escapeHtml(item.type)} &middot; ${new Date(item.created_at).toLocaleDateString()}</div>
                </div>
                <div class="archive-actions">
                    <button onclick="restoreItem('${item.type}', ${item.id})" style="background:var(--accent-cyan); color:black;">Restore</button>
                    <button onclick="hardDeleteItem('${item.type}', ${item.id})" style="background:var(--primary-red); color:white;">Delete Forever</button>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (err) {
        console.error('Failed to load archive', err);
    }
}

async function restoreItem(type, id) {
    try {
        await apiFetch(`${API_BASE}/archive/${type}/${id}/restore`, { method: 'POST' });
        showToast('Item restored!', 'success');
        loadArchive();
    } catch (err) {
        showToast('Failed to restore item', 'error');
    }
}

async function hardDeleteItem(type, id) {
    if (!(await showConfirm('Permanently delete this item? This cannot be undone.', { skipKey: 'delete' }))) return;
    try {
        await apiFetch(`${API_BASE}/archive/${type}/${id}`, { method: 'DELETE' });
        showToast('Permanently deleted', 'success');
        loadArchive();
    } catch (err) {
        showToast('Failed to delete item', 'error');
    }
}


/* ================= QUICK ADD (Dashboard Widget) ================= */

let quickAddType = 'bookmark';

function switchQuickTab(type, btn) {
    quickAddType = type;
    document.querySelectorAll('.quick-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const input = document.getElementById('quick-add-input');
    const placeholders = { bookmark: 'Paste a URL...', task: 'Enter task title...', note: 'Enter note title...' };
    input.placeholder = placeholders[type] || 'Enter...';
    input.focus();
}

async function quickAdd() {
    const input = document.getElementById('quick-add-input');
    const value = input.value.trim();
    if (!value) { showToast('Please enter something', 'error'); return; }

    try {
        if (quickAddType === 'bookmark') {
            await apiFetch(`${API_BASE}/bookmarks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: value, title: 'Fetching title...', tags: [], description: '' })
            });
            showToast('Bookmark saved!', 'success');
        } else if (quickAddType === 'task') {
            await apiFetch(`${API_BASE}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: value, status: 'todo' })
            });
            showToast('Task created!', 'success');
        } else if (quickAddType === 'note') {
            await apiFetch(`${API_BASE}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: value, content: '' })
            });
            showToast('Note created!', 'success');
        }
        input.value = '';
        loadDashboard();
    } catch (err) {
        showToast('Failed to add item', 'error');
    }
}


/* ================= SEARCH FILTERS ================= */

let currentSearchTypeFilter = '';

function setSearchFilter(type, btn) {
    currentSearchTypeFilter = type;
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Re-run the current search with the filter
    const query = document.getElementById('global-search-input').value;
    if (query && query.length >= 2) {
        performFilteredSearch(query);
    }
}

async function performFilteredSearch(query) {
    try {
        let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`;
        if (currentSearchTypeFilter) url += `&type=${currentSearchTypeFilter}`;
        const results = await apiFetch(url);
        renderSearchResults(results, query);
    } catch (err) { console.error(err); }
}


/* ================= STATS / ANALYTICS ================= */

let _statsCharts = {};

async function loadStats() {
    try {
        const data = await apiFetch(`${API_BASE}/stats`);
        renderStats(data);
    } catch (err) {
        showToast('Failed to load stats', 'error');
    }
}

function renderStats(data) {
    // Summary cards
    document.getElementById('stat-bm-total').textContent = data.bookmarks.active ?? '—';
    document.getElementById('stat-tasks-done').textContent = data.tasks.done ?? '—';
    const total = (data.tasks.done || 0) + (data.tasks.todo || 0) + (data.tasks.inprogress || 0);
    const rate = total > 0 ? Math.round((data.tasks.done / total) * 100) : 0;
    document.getElementById('stat-completion-rate').textContent = rate + '%';
    document.getElementById('stat-notes-total').textContent = data.notes.total ?? '—';

    // Destroy old charts to avoid canvas reuse error
    Object.values(_statsCharts).forEach(c => c.destroy());
    _statsCharts = {};

    const chartDefaults = {
        plugins: { legend: { labels: { color: '#a0a0a0', font: { family: 'Space Grotesk' } } } },
        scales: {
            x: { ticks: { color: '#666' }, grid: { color: '#222' } },
            y: { ticks: { color: '#666' }, grid: { color: '#222' }, beginAtZero: true }
        }
    };

    // 1. Bookmarks by week
    const bmWeekCtx = document.getElementById('chart-bm-weekly');
    if (bmWeekCtx) {
        bmWeekCtx.parentElement.innerHTML = '<h4>Bookmarks Added (Last 8 Weeks)</h4><canvas id="chart-bm-weekly" height="160"></canvas>';
        _statsCharts.bmWeekly = new Chart(document.getElementById('chart-bm-weekly'), {
            type: 'bar',
            data: {
                labels: data.bmByWeek.map(r => r.week),
                datasets: [{ label: 'Bookmarks', data: data.bmByWeek.map(r => r.count), backgroundColor: 'rgba(5,217,232,0.5)', borderColor: '#05d9e8', borderWidth: 1 }]
            },
            options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } }
        });
    }

    // 2. Task status doughnut
    const taskCtx = document.getElementById('chart-tasks-status');
    if (taskCtx) {
        taskCtx.parentElement.innerHTML = '<h4>Task Status Breakdown</h4><canvas id="chart-tasks-status" height="160"></canvas>';
        _statsCharts.taskStatus = new Chart(document.getElementById('chart-tasks-status'), {
            type: 'doughnut',
            data: {
                labels: ['Done', 'In Progress', 'Todo'],
                datasets: [{ data: [data.tasks.done, data.tasks.inprogress, data.tasks.todo], backgroundColor: ['#ff2a6d', '#ffc107', '#444'], borderColor: '#1a1a1a', borderWidth: 3 }]
            },
            options: { plugins: { legend: { labels: { color: '#a0a0a0', font: { family: 'Space Grotesk' } } } }, cutout: '65%' }
        });
    }

    // 3. Top tags bar
    const tagCtx = document.getElementById('chart-top-tags');
    if (tagCtx) {
        tagCtx.parentElement.innerHTML = '<h4>Top Tags</h4><canvas id="chart-top-tags" height="160"></canvas>';
        _statsCharts.topTags = new Chart(document.getElementById('chart-top-tags'), {
            type: 'bar',
            data: {
                labels: data.topTags.map(r => '#' + r.name),
                datasets: [{ label: 'Uses', data: data.topTags.map(r => r.count), backgroundColor: 'rgba(255,42,109,0.5)', borderColor: '#ff2a6d', borderWidth: 1 }]
            },
            options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, legend: { display: false } } }
        });
    }

    // 4. Top tasks by time tracked
    const taskTimeCtx = document.getElementById('chart-top-tasks');
    if (taskTimeCtx) {
        taskTimeCtx.parentElement.innerHTML = '<h4>Most Tracked Tasks (hours)</h4><canvas id="chart-top-tasks" height="160"></canvas>';
        _statsCharts.topTasks = new Chart(document.getElementById('chart-top-tasks'), {
            type: 'bar',
            data: {
                labels: data.topTasks.map(r => r.title.length > 20 ? r.title.slice(0, 20) + '…' : r.title),
                datasets: [{ label: 'Hours', data: data.topTasks.map(r => +(r.total_seconds / 3600).toFixed(2)), backgroundColor: 'rgba(5,217,232,0.35)', borderColor: '#05d9e8', borderWidth: 1 }]
            },
            options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, legend: { display: false } } }
        });
    }
}


/* ================= BULK OPERATIONS (Bookmarks) ================= */

let bulkSelectedIds = new Set();
let bulkModeActive = false;

function toggleBulkMode() {
    bulkModeActive = !bulkModeActive;
    document.body.classList.toggle('bulk-mode', bulkModeActive);
    bulkSelectedIds.clear();
    renderBookmarks();
    const btn = document.getElementById('bulk-toggle-btn');
    if (btn) btn.textContent = bulkModeActive ? 'Cancel' : 'Select';
    showBulkBar();
}

function showBulkBar() {
    const bar = document.getElementById('bulk-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', !bulkModeActive);
    const countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = `${bulkSelectedIds.size} selected`;
}

function hideBulkBar() {
    const bar = document.getElementById('bulk-bar');
    if (bar) bar.classList.add('hidden');
}

function toggleBulkSelect(id, checked) {
    if (checked) bulkSelectedIds.add(id);
    else bulkSelectedIds.delete(id);
    showBulkBar();
    document.querySelectorAll('.bm-item').forEach(el => {
        const cb = el.querySelector('.select-checkbox');
        if (cb) el.classList.toggle('selected', cb.checked);
    });
}

async function bulkDelete() {
    if (bulkSelectedIds.size === 0) { showToast('No items selected', 'error'); return; }
    if (!(await showConfirm(`Archive ${bulkSelectedIds.size} bookmark(s)?`))) return;
    try {
        await Promise.all([...bulkSelectedIds].map(id =>
            apiFetch(`${API_BASE}/bookmarks/${id}`, { method: 'DELETE' })
        ));
        showToast(`${bulkSelectedIds.size} bookmarks archived`, 'success');
        allBookmarksCache = allBookmarksCache.filter(bm => !bulkSelectedIds.has(bm.id));
        toggleBulkMode();
    } catch (err) {
        showToast('Bulk delete failed', 'error');
    }
}


/* ================= MARKDOWN NOTES ================= */

let noteViewMode = 'edit'; // 'edit' | 'preview' | 'split'

function initMarkdownToolbar() {
    const toolbar = document.getElementById('note-toolbar');
    if (!toolbar) return;
    updateMarkdownToolbar();
}

function updateMarkdownToolbar() {
    const toolbar = document.getElementById('note-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('button[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === noteViewMode);
    });
    const editor = document.getElementById('note-editor');
    const preview = document.getElementById('note-preview');
    if (!editor || !preview) return;
    if (noteViewMode === 'edit') {
        editor.style.display = 'block';
        preview.style.display = 'none';
    } else if (noteViewMode === 'preview') {
        editor.style.display = 'none';
        preview.style.display = 'block';
        renderMarkdownPreview();
    } else {
        editor.style.display = 'block';
        preview.style.display = 'block';
        preview.style.flex = '1';
        editor.style.flex = '1';
        renderMarkdownPreview();
    }
}

function setNoteViewMode(mode) {
    noteViewMode = mode;
    updateMarkdownToolbar();
}

function renderMarkdownPreview() {
    const editor = document.getElementById('note-editor');
    const preview = document.getElementById('note-preview');
    if (!editor || !preview || typeof marked === 'undefined') return;
    const text = editor.value || editor.innerText || '';
    preview.innerHTML = marked.parse(text);
}

// Auto-update preview while typing
function onNoteEditorInput() {
    triggerAutoSave();
    if (noteViewMode === 'preview' || noteViewMode === 'split') {
        renderMarkdownPreview();
    }
}

/* ================= PLANNER ================= */
const PLANNER_COLORS = [
    '#05d9e8', '#ff2a6d', '#a855f7', '#f59e0b',
    '#22c55e', '#3b82f6', '#ec4899', '#f97316',
    '#14b8a6', '#e2e8f0'
];
const PLANNER_PX_PER_MIN = 1; // 1px per minute → 60px per hour

let plannerCurrentDate = todayStr();
let plannerBlocks = [];
let plannerEditingId = null;
let plannerNowTimer = null;
let plannerSelectedColor = PLANNER_COLORS[0];

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function initPlanner() {
    plannerRequestPermission();
    const input = document.getElementById('planner-date-input');
    if (input.value === '') {
        plannerCurrentDate = todayStr();
        input.value = plannerCurrentDate;
    }
    loadPlanner();
}

async function loadPlanner() {
    const input = document.getElementById('planner-date-input');
    plannerCurrentDate = input.value || todayStr();
    input.value = plannerCurrentDate;
    plannerResetNotifications();
    try {
        plannerBlocks = await apiFetch(`${API_BASE}/planner?date=${plannerCurrentDate}`);
    } catch(e) {
        plannerBlocks = [];
    }
    renderPlannerTimeline();
}

function plannerShiftDay(delta) {
    const [y, m, d] = plannerCurrentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + delta);
    plannerCurrentDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    document.getElementById('planner-date-input').value = plannerCurrentDate;
    loadPlanner();
}

function plannerGoToday() {
    plannerCurrentDate = todayStr();
    document.getElementById('planner-date-input').value = plannerCurrentDate;
    loadPlanner();
}

function spinTime(inputId, delta, min, max) {
    const el = document.getElementById(inputId);
    let v = parseInt(el.value) || min;
    v += delta;
    if (v < min) v = max;
    if (v > max) v = min;
    el.value = (max === 59) ? String(v).padStart(2, '0') : v;
}

function buildTimePicker(prefix, value24h) {
    let h24 = 0, min = 0;
    if (value24h) [h24, min] = value24h.split(':').map(Number);
    const isPM = h24 >= 12;
    const h12 = h24 % 12 || 12;

    document.getElementById(`${prefix}-h`).value = h12;
    document.getElementById(`${prefix}-m`).value = String(min).padStart(2, '0');

    const toggle = document.getElementById(`${prefix}-ampm`);
    toggle.querySelectorAll('.ampm-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === (isPM ? 'PM' : 'AM'));
        btn.onclick = () => {
            toggle.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });
}

function getTimePickerValue(prefix) {
    let h12 = parseInt(document.getElementById(`${prefix}-h`).value) || 12;
    let m = parseInt(document.getElementById(`${prefix}-m`).value) || 0;
    h12 = Math.min(12, Math.max(1, h12));
    m = Math.min(59, Math.max(0, m));
    const isPM = document.getElementById(`${prefix}-ampm`).querySelector('.ampm-btn.active')?.dataset.val === 'PM';
    const h24 = h12 % 12 + (isPM ? 12 : 0);
    return `${String(h24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function minutesToDisplay(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}

function renderPlannerTimeline() {
    const wrap = document.getElementById('planner-timeline-wrap');
    const container = document.getElementById('planner-timeline');
    container.innerHTML = '';

    if (plannerNowTimer) clearInterval(plannerNowTimer);

    // Build 24-hour grid (0..23)
    for (let h = 0; h < 24; h++) {
        const row = document.createElement('div');
        row.className = 'planner-hour-row';
        row.style.height = `${60 * PLANNER_PX_PER_MIN}px`;

        const label = document.createElement('div');
        label.className = 'planner-hour-label';
        const ampm = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 || 12;
        label.textContent = `${h12}${ampm}`;

        const slot = document.createElement('div');
        slot.className = 'planner-hour-slot half-mark';
        slot.dataset.hour = h;
        slot.addEventListener('click', (e) => {
            if (e.target.closest('.planner-block')) return;
            const rect = slot.getBoundingClientRect();
            const clickMin = Math.floor((e.clientY - rect.top) / PLANNER_PX_PER_MIN);
            const totalMin = h * 60 + Math.round(clickMin / 5) * 5;
            const startH = String(Math.floor(totalMin / 60)).padStart(2,'0');
            const startM = String(totalMin % 60).padStart(2,'0');
            const endMin = Math.min(totalMin + 60, 24*60);
            const endH = String(Math.floor(endMin / 60)).padStart(2,'0');
            const endM = String(endMin % 60).padStart(2,'0');
            openPlannerModal(null, `${startH}:${startM}`, `${endH}:${endM}`);
        });

        row.appendChild(label);
        row.appendChild(slot);
        container.appendChild(row);
    }

    // Overlay blocks
    plannerBlocks.forEach(block => {
        const startMin = timeToMinutes(block.start_time);
        const endMin = timeToMinutes(block.end_time);
        const durationMin = endMin - startMin;
        if (durationMin <= 0) return;

        const el = document.createElement('div');
        el.className = 'planner-block' + (durationMin < 20 ? ' short' : '');
        el.dataset.blockId = block.id;
        el.style.top = `${startMin * PLANNER_PX_PER_MIN}px`;
        el.style.height = `${durationMin * PLANNER_PX_PER_MIN}px`;
        el.style.backgroundColor = block.color + '22';
        el.style.borderLeft = `3px solid ${block.color}`;
        el.style.color = block.color;

        // Progress fill bar (fills as time passes through the block)
        const fill = document.createElement('div');
        fill.className = 'planner-block-fill';
        fill.dataset.start = startMin;
        fill.dataset.end = endMin;
        fill.style.background = block.color + '44';
        el.appendChild(fill);

        const lbl = document.createElement('div');
        lbl.className = 'planner-block-label';
        lbl.textContent = block.label;

        const timeEl = document.createElement('div');
        timeEl.className = 'planner-block-time';
        timeEl.textContent = `${minutesToDisplay(startMin)} – ${minutesToDisplay(endMin)}`;

        el.appendChild(lbl);
        el.appendChild(timeEl);
        el.addEventListener('click', () => openPlannerModal(block));
        container.appendChild(el);
    });

    // Now line
    const nowLine = document.createElement('div');
    nowLine.className = 'planner-now-line';
    nowLine.id = 'planner-now-line';
    container.appendChild(nowLine);

    function updateNowLine() {
        const isToday = plannerCurrentDate === todayStr();
        nowLine.style.display = isToday ? 'flex' : 'none';
        if (!isToday) return;
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        nowLine.style.top = `${mins * PLANNER_PX_PER_MIN}px`;

        // Update progress fills
        container.querySelectorAll('.planner-block-fill').forEach(fill => {
            const s = parseInt(fill.dataset.start);
            const e = parseInt(fill.dataset.end);
            if (mins <= s) { fill.style.height = '0%'; }
            else if (mins >= e) { fill.style.height = '100%'; }
            else { fill.style.height = `${((mins - s) / (e - s)) * 100}%`; }
        });

        // Notifications
        plannerCheckNotifications(mins);
    }

    updateNowLine();
    plannerNowTimer = setInterval(updateNowLine, 30000);

    // Scroll to current time (or 8am as fallback)
    const now = new Date();
    const scrollMins = plannerCurrentDate === todayStr()
        ? Math.max(0, now.getHours() * 60 + now.getMinutes() - 120)
        : 8 * 60;
    setTimeout(() => { wrap.scrollTop = scrollMins * PLANNER_PX_PER_MIN; }, 50);
}

function openPlannerModal(block = null, defaultStart = '', defaultEnd = '') {
    plannerEditingId = block ? block.id : null;

    document.getElementById('pb-label').value = block ? block.label : '';
    buildTimePicker('pb-start', block ? block.start_time : defaultStart);
    buildTimePicker('pb-end', block ? block.end_time : defaultEnd);
    plannerSelectedColor = block ? block.color : PLANNER_COLORS[0];

    document.getElementById('pb-delete-btn').style.display = block ? 'inline-block' : 'none';

    // Render color swatches
    const picker = document.getElementById('pb-color-picker');
    picker.innerHTML = '';
    PLANNER_COLORS.forEach(c => {
        const sw = document.createElement('div');
        sw.className = 'planner-swatch' + (c === plannerSelectedColor ? ' selected' : '');
        sw.style.background = c;
        sw.title = c;
        sw.onclick = () => {
            plannerSelectedColor = c;
            picker.querySelectorAll('.planner-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
        };
        picker.appendChild(sw);
    });

    document.getElementById('planner-modal-backdrop').classList.remove('hidden');
    document.getElementById('pb-label').focus();
}

function closePlannerModal() {
    document.getElementById('planner-modal-backdrop').classList.add('hidden');
    plannerEditingId = null;
    plannerOpenedFromTask = false;
}

async function savePlannerBlock() {
    const label = document.getElementById('pb-label').value.trim();
    const start_time = getTimePickerValue('pb-start');
    const end_time = getTimePickerValue('pb-end');
    if (!label || !start_time || !end_time) { showToast('Fill in all fields', 'error'); return; }
    if (start_time >= end_time) { showToast('End must be after start', 'error'); return; }

    const payload = { date: plannerCurrentDate, start_time, end_time, label, color: plannerSelectedColor };

    try {
        if (plannerEditingId) {
            await apiFetch(`${API_BASE}/planner/${plannerEditingId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        } else {
            await apiFetch(`${API_BASE}/planner`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        }
        closePlannerModal();
        loadPlanner();
        if (plannerOpenedFromTask) {
            plannerOpenedFromTask = false;
            loadTasks();
        }
    } catch(e) {
        showToast('Failed to save block', 'error');
    }
}

async function deletePlannerBlock() {
    if (!plannerEditingId) return;
    try {
        await apiFetch(`${API_BASE}/planner/${plannerEditingId}`, { method: 'DELETE' });
        closePlannerModal();
        loadPlanner();
    } catch(e) {
        showToast('Failed to delete block', 'error');
    }
}

/* ---- Planner Notifications ---- */
const plannerNotifiedStart = new Set();
const plannerNotifiedEnd   = new Set();

async function plannerRequestPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
}

function plannerFireNotif(title, body, tag) {
    // In-app toast always
    showToast(`${title}: ${body}`, 'info');
    // Browser notification if permitted
    if (Notification.permission === 'granted') {
        new Notification(title, { body, tag, icon: '/favicon.ico', silent: false });
    }
}

function plannerCheckNotifications(nowMins) {
    if (plannerCurrentDate !== todayStr()) return;
    plannerBlocks.forEach(block => {
        const s = timeToMinutes(block.start_time);
        const e = timeToMinutes(block.end_time);
        const key = block.id;

        // Start notification — fire when we're within 1 min of start
        if (!plannerNotifiedStart.has(key) && nowMins >= s && nowMins < s + 2) {
            plannerNotifiedStart.add(key);
            plannerFireNotif('⏰ Starting now', block.label, `start-${key}`);
        }

        // End notification — fire when we're within 1 min of end
        if (!plannerNotifiedEnd.has(key) && nowMins >= e && nowMins < e + 2) {
            plannerNotifiedEnd.add(key);
            plannerFireNotif('✅ Time\'s up', block.label, `end-${key}`);
        }
    });
}

// Clear notification history when date changes or blocks reload
function plannerResetNotifications() {
    plannerNotifiedStart.clear();
    plannerNotifiedEnd.clear();
}
