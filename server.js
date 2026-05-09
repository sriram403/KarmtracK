const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, 'pkm.db');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // 1. FOLDERS
        db.run(`CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )`);

        // 2. BOOKMARKS
        db.run(`CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            thumbnail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            folder_id INTEGER,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        )`);

        // 3. TASKS (Updated with 'notes' column)
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            title TEXT NOT NULL, 
            status TEXT DEFAULT 'todo', 
            due_date TEXT, 
            checklist TEXT, 
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 4. TASK SESSIONS (Critical for Timers - Missing previously)
        db.run(`CREATE TABLE IF NOT EXISTS task_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER,
            start_time DATETIME,
            end_time DATETIME,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )`);

        // 5. NOTES (Updated with 'folder_id')
        db.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            title TEXT, 
            content TEXT, 
            is_encrypted INTEGER DEFAULT 0, 
            folder_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        )`);

        // 6. TAGS & LINKS
        db.run(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)`);
        db.run(`CREATE TABLE IF NOT EXISTS item_tags (item_id INTEGER, item_type TEXT, tag_id INTEGER, PRIMARY KEY (item_id, item_type, tag_id), FOREIGN KEY (tag_id) REFERENCES tags(id))`);
        db.run(`CREATE TABLE IF NOT EXISTS links (source_id INTEGER, source_type TEXT, target_id INTEGER, target_type TEXT)`);

        // Schema migrations: add pinned and archived columns if missing
        db.run(`ALTER TABLE bookmarks ADD COLUMN pinned INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE bookmarks ADD COLUMN archived INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE tasks ADD COLUMN pinned INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE notes ADD COLUMN archived INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE tasks ADD COLUMN repeat TEXT`, () => {});

        // 7. PLANNER BLOCKS
        db.run(`CREATE TABLE IF NOT EXISTS planner_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT DEFAULT '#05d9e8'
        )`);

        console.log("Database initialized with full modern schema.");
    });
}

/* ================= UPDATED BOOKMARK ROUTES ================= */
app.get('/api/bookmarks', (req, res) => {
    const sql = `
        SELECT b.*, GROUP_CONCAT(t.name) as tag_list, f.name as folder_name
        FROM bookmarks b
        LEFT JOIN item_tags it ON b.id = it.item_id AND it.item_type = 'bookmark'
        LEFT JOIN tags t ON it.tag_id = t.id
        LEFT JOIN folders f ON b.folder_id = f.id
        WHERE b.archived = 0
        GROUP BY b.id
        ORDER BY b.pinned DESC, f.name, b.created_at DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const results = rows.map(r => ({ ...r, tags: r.tag_list ? r.tag_list.split(',') : [] }));
        res.json(results);
    });
});

app.post('/api/bookmarks', (req, res) => {
    const { url, title, tags, description, folderId } = req.body; 
    const descToSave = description || "Pending...";
    const sql = `INSERT INTO bookmarks (url, title, description, thumbnail, folder_id) VALUES (?, ?, ?, ?, ?)`;
    const params = [url, title || url, descToSave, "", folderId || null]; 
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const bookmarkId = this.lastID;
        // (Tag handling logic remains the same)
        if (tags && tags.length > 0) {
            const tagInsertStmt = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
            const linkInsertStmt = db.prepare("INSERT INTO item_tags (item_id, item_type, tag_id) VALUES (?, 'bookmark', (SELECT id FROM tags WHERE name = ?))");
            tags.forEach(tag => {
                const cleanTag = tag.trim();
                if(cleanTag) {
                    tagInsertStmt.run(cleanTag);
                    linkInsertStmt.run(bookmarkId, cleanTag);
                }
            });
            tagInsertStmt.finalize();
            linkInsertStmt.finalize();
        }
        enrichBookmark(bookmarkId, url);
        res.json({ id: bookmarkId, url, title, message: "Saved" });
    });
});


app.delete('/api/bookmarks/:id', (req, res) => {
    const id = req.params.id;
    db.run("UPDATE bookmarks SET archived = 1 WHERE id = ?", id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Bookmark archived" });
    });
});

// --- Tasks ---
app.get('/api/tasks', (req, res) => {
    const sql = `
        SELECT t.*, 
            COALESCE((
                SELECT SUM(strftime('%s', end_time) - strftime('%s', start_time)) 
                FROM task_sessions 
                WHERE task_id = t.id AND end_time IS NOT NULL
            ), 0) as past_duration,
            (
                SELECT start_time 
                FROM task_sessions 
                WHERE task_id = t.id AND end_time IS NULL 
                LIMIT 1
            ) as active_start,
            (
                SELECT COUNT(id)
                FROM task_sessions
                WHERE task_id = t.id AND end_time IS NOT NULL
            ) as break_count
        FROM tasks t
        WHERE t.archived = 0
        ORDER BY t.pinned DESC, t.created_at DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/tasks', (req, res) => {
    const { title, status } = req.body;
    db.run("INSERT INTO tasks (title, status) VALUES (?, ?)", [title, status || 'todo'], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, title, status });
    });
});

// START TIMER (atomic check-and-insert to prevent race conditions)
app.post('/api/tasks/:id/timer/start', (req, res) => {
    const taskId = req.params.id;
    const sql = `INSERT INTO task_sessions (task_id, start_time)
        SELECT ?, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
            SELECT 1 FROM task_sessions WHERE task_id = ? AND end_time IS NULL
        )`;
    db.run(sql, [taskId, taskId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.json({ message: "Timer already running" });
        res.json({ message: "Timer started" });
    });
});

// STOP TIMER
app.post('/api/tasks/:id/timer/stop', (req, res) => {
    const taskId = req.params.id;
    db.run("UPDATE task_sessions SET end_time = CURRENT_TIMESTAMP WHERE task_id = ? AND end_time IS NULL", [taskId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Timer stopped" });
    });
});

// RESET TIMER (Deletes history for this task)
app.post('/api/tasks/:id/timer/reset', (req, res) => {
    const taskId = req.params.id;
    db.run("DELETE FROM task_sessions WHERE task_id = ?", [taskId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Timer history deleted" });
    });
});

// Soft delete task (archive)
app.delete('/api/tasks/:id', (req, res) => {
    const id = req.params.id;
    db.run("UPDATE tasks SET archived = 1 WHERE id = ?", id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Task archived" });
    });
});

// --- Notes ---
app.get('/api/notes', (req, res) => {
    // UPDATED: Now selects folder_id
    db.all("SELECT id, title, content, folder_id, created_at FROM notes WHERE archived = 0 ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/notes/:id', (req, res) => {
    db.get("SELECT * FROM notes WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

app.post('/api/notes', (req, res) => {
    // UPDATED: Accepts folderId
    const { title, content, folderId } = req.body;
    db.run("INSERT INTO notes (title, content, folder_id) VALUES (?, ?, ?)", [title, content, folderId || null], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, title, folder_id: folderId });
    });
});

app.put('/api/notes/:id', (req, res) => {
    const { title, content, folderId } = req.body;
    const noteId = req.params.id;
    const normalizedFolderId = folderId === '' || folderId === undefined ? null : folderId;

    db.run(
        "UPDATE notes SET title = COALESCE(?, title), content = COALESCE(?, content), folder_id = ? WHERE id = ?",
        [title, content, normalizedFolderId, noteId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Note updated" });
        }
    );
});

function getNextDueDate(currentDueDate, repeat) {
    const base = currentDueDate ? new Date(currentDueDate + 'T00:00:00') : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
    if (repeat === 'daily') {
        // next is already +1
    } else if (repeat === 'weekdays') {
        while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    } else if (repeat === 'weekends') {
        while (next.getDay() !== 0 && next.getDay() !== 6) next.setDate(next.getDate() + 1);
    } else if (dayMap[repeat] !== undefined) {
        const target = dayMap[repeat];
        while (next.getDay() !== target) next.setDate(next.getDate() + 1);
    }
    return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
}

app.put('/api/tasks/:id/repeat', (req, res) => {
    const { repeat } = req.body;
    db.run("UPDATE tasks SET repeat = ? WHERE id = ?", [repeat || null, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Updated" });
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { title, status, due_date, notes, checklist } = req.body;
    const taskId = req.params.id;

    // Special Logic: If moving to 'done', calculate final time and append to notes.
    if (status && status === 'done') {
        db.get("SELECT * FROM tasks WHERE id = ?", [taskId], (err, task) => {
            if (err || !task) return res.status(500).json({ error: "Task not found for completion." });
            
            // Calculate total time
            const sqlTime = `SELECT SUM(strftime('%s', end_time) - strftime('%s', start_time)) as total FROM task_sessions WHERE task_id = ? AND end_time IS NOT NULL`;
            db.get(sqlTime, [taskId], (err, timeRow) => {
                const totalSeconds = timeRow ? timeRow.total : 0;
                
                const h = Math.floor(totalSeconds / 3600);
                const m = Math.floor((totalSeconds % 3600) / 60);
                const s = totalSeconds % 60;
                const timeString = `${h}h ${m}m ${s}s`;

                const completionMessage = `\n\n<hr><p><em><strong>Completed on:</strong> ${new Date().toLocaleString()}<br><strong>Total Time Taken:</strong> ${timeString}</em></p>`;
                
                const newNotes = (task.notes || '') + completionMessage;

                // Final update query
                const sql = "UPDATE tasks SET title = COALESCE(?, title), status = ?, due_date = COALESCE(?, due_date), notes = ?, checklist = COALESCE(?, checklist) WHERE id = ?";
                db.run(sql, [title, status, due_date, newNotes, checklist, taskId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    // Spawn next occurrence for repeating tasks
                    if (task.repeat) {
                        const nextDue = getNextDueDate(task.due_date, task.repeat);
                        db.run("INSERT INTO tasks (title, status, due_date, repeat) VALUES (?, 'todo', ?, ?)",
                            [task.title, nextDue, task.repeat]);
                    }
                    res.json({ message: "Task completed and updated." });
                });
            });
        });
    } else {
        // Standard update for any other change
        const sql = "UPDATE tasks SET title = COALESCE(?, title), status = COALESCE(?, status), due_date = COALESCE(?, due_date), notes = COALESCE(?, notes), checklist = COALESCE(?, checklist) WHERE id = ?";
        db.run(sql, [title, status, due_date, notes, checklist, taskId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Updated" });
        });
    }
});

/* ================= IMAGE PROXY (bypass hotlink/CORS on thumbnails) ================= */
const http = require('http');
const https = require('https');

app.get('/api/proxy-image', (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).end();

    let parsedUrl;
    try { parsedUrl = new URL(imageUrl); } catch { return res.status(400).end(); }

    // Block private/internal IPs to prevent SSRF
    const hostname = parsedUrl.hostname;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost|::1)/i.test(hostname)) {
        return res.status(403).end();
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KarmtracK/1.0)', 'Referer': parsedUrl.origin }
    };

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB limit
    const proxyReq = protocol.get(options, (proxyRes) => {
        if (proxyRes.statusCode >= 400) return res.status(proxyRes.statusCode).end();

        // Validate content type is an image
        const contentType = proxyRes.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
            proxyRes.destroy();
            return res.status(400).end();
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        let totalBytes = 0;
        proxyRes.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_SIZE) {
                proxyRes.destroy();
                res.status(413).end();
            }
        });
        proxyRes.pipe(res);
    });
    proxyReq.on('error', () => res.status(502).end());
    proxyReq.setTimeout(8000, () => { proxyReq.destroy(); res.status(504).end(); });
});

/* ================= UPDATED ENRICHMENT LOGIC (NO X SCRAPING) ================= */
const ogs = require('open-graph-scraper');

async function enrichBookmark(id, url) {
    // NEW: Skip X/Twitter entirely
    if (url.includes('x.com') || url.includes('twitter.com')) {
        console.log(`[Enrichment] Skipping enrichment for X/Twitter URL: ${url}`);
        return;
    }

    console.log(`[Enrichment] Starting for ID: ${id} | URL: ${url}`);

    let title = "";
    let description = "";
    let thumbnail = "";

    const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    if (ytMatch && ytMatch[1]) {
        thumbnail = `https://img.youtube.com/vi/${ytMatch[1]}/0.jpg`;
        updateDb(id, "YouTube Video", "YouTube Video", thumbnail);
        return;
    }

    const options = { url, timeout: 8000, fetchOptions: { headers: { 'user-agent': 'Mozilla/5.0' } } };
    try {
        const { result } = await ogs(options);
        if (result.success) {
            title = result.ogTitle || result.twitterTitle || result.title || "No Title Found";
            description = result.ogDescription || result.twitterDescription || "";
            if (result.ogImage && result.ogImage.length > 0) thumbnail = result.ogImage[0].url;
            updateDb(id, title, description, thumbnail);
        }
    } catch (err) {
        console.error(`[Enrichment Crash]`, err.message);
    }
}

function updateDb(id, title, description, thumbnail) {
    // LOGIC: Only update description if the USER did NOT provide one.
    // If the DB already has a description (that isn't "Pending..."), we assume it's the User's "Possible Idea" and keep it.
    
    db.get("SELECT description FROM bookmarks WHERE id = ?", [id], (err, row) => {
        if(err || !row) return;

        let finalDesc = description; // Default to scraper description
        
        // If user wrote something (and it's not the default "Pending..."), keep user's text
        if (row.description && row.description !== "Pending..." && row.description.trim() !== "") {
            finalDesc = row.description;
        }

        const sql = `UPDATE bookmarks SET title = COALESCE(?, title), description = ?, thumbnail = ? WHERE id = ?`;
        db.run(sql, [title, finalDesc, thumbnail, id], (err) => {
            if (err) console.error(`[DB Error] Could not update bookmark ${id}:`, err.message);
            else console.log(`[DB Success] Updated bookmark ${id}. Description kept: "${finalDesc}"`);
        });
    });
}

app.get('/api/tags', (req, res) => {
    // UPDATED: Added 't.id' so we can identify tags for deletion
    const sql = `
        SELECT t.id, t.name, COUNT(it.tag_id) as count 
        FROM tags t 
        JOIN item_tags it ON t.id = it.tag_id 
        GROUP BY t.id 
        ORDER BY count DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/* ================= GLOBAL SEARCH ================= */
/* ================= GLOBAL SEARCH (FIXED) ================= */
app.get('/api/search', (req, res) => {
    const term = `%${req.query.q}%`;
    const typeFilter = req.query.type; // optional: 'bookmark', 'task', 'note'
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    const promises = [];

    // 1. Search Bookmarks
    if (!typeFilter || typeFilter === 'bookmark') {
        promises.push(new Promise((resolve, reject) => {
            let sql = `
                SELECT DISTINCT b.id, b.title, b.url as info, 'bookmark' as type, b.created_at
                FROM bookmarks b
                LEFT JOIN item_tags it ON b.id = it.item_id AND it.item_type = 'bookmark'
                LEFT JOIN tags t ON it.tag_id = t.id
                WHERE b.archived = 0 AND (b.title LIKE ? OR b.description LIKE ? OR b.url LIKE ? OR t.name LIKE ?)
            `;
            const params = [term, term, term, term];
            if (dateFrom) { sql += ` AND b.created_at >= ?`; params.push(dateFrom); }
            if (dateTo) { sql += ` AND b.created_at <= ?`; params.push(dateTo + ' 23:59:59'); }
            db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
        }));
    }

    // 2. Search Tasks
    if (!typeFilter || typeFilter === 'task') {
        promises.push(new Promise((resolve, reject) => {
            let sql = `SELECT id, title, status as info, 'task' as type, created_at FROM tasks WHERE archived = 0 AND title LIKE ?`;
            const params = [term];
            if (dateFrom) { sql += ` AND created_at >= ?`; params.push(dateFrom); }
            if (dateTo) { sql += ` AND created_at <= ?`; params.push(dateTo + ' 23:59:59'); }
            db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
        }));
    }

    // 3. Search Notes
    if (!typeFilter || typeFilter === 'note') {
        promises.push(new Promise((resolve, reject) => {
            let sql = `SELECT id, title, 'note' as info, 'note' as type, created_at FROM notes WHERE archived = 0 AND (title LIKE ? OR content LIKE ?)`;
            const params = [term, term];
            if (dateFrom) { sql += ` AND created_at >= ?`; params.push(dateFrom); }
            if (dateTo) { sql += ` AND created_at <= ?`; params.push(dateTo + ' 23:59:59'); }
            db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
        }));
    }

    Promise.all(promises)
        .then(results => {
            const flatResults = results.flat();
            const unique = flatResults.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id && t.type === v.type))===i);
            res.json(unique);
        })
        .catch(err => res.status(500).json({ error: err.message }));
});

/* ================= TAG DELETION ================= */
app.delete('/api/tags/:id', (req, res) => {
    const tagId = req.params.id;
    
    // 1. Delete from Item Links (removes tag from all bookmarks/tasks)
    db.run("DELETE FROM item_tags WHERE tag_id = ?", tagId, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // 2. Delete the Tag itself
        db.run("DELETE FROM tags WHERE id = ?", tagId, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Tag deleted globally" });
        });
    });
});

/* ================= NEW & UPDATED API ROUTES FOR EDITING/DELETING ================= */

// --- Bookmarks (Update) ---
app.put('/api/bookmarks/:id', (req, res) => {
    const { title, description, tags } = req.body;
    const bookmarkId = req.params.id;

    // 1. Update main bookmark details
    db.run("UPDATE bookmarks SET title = ?, description = ? WHERE id = ?", [title, description, bookmarkId], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Wipe and re-add tags
        db.run("DELETE FROM item_tags WHERE item_id = ? AND item_type = 'bookmark'", [bookmarkId], (err) => {
            if (err) return res.status(500).json({ error: "Failed to clear old tags" });

            if (tags && tags.length > 0) {
                const tagInsertStmt = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
                const linkInsertStmt = db.prepare("INSERT INTO item_tags (item_id, item_type, tag_id) VALUES (?, 'bookmark', (SELECT id FROM tags WHERE name = ?))");
                tags.forEach(tag => {
                    const cleanTag = tag.trim();
                    if(cleanTag) {
                        tagInsertStmt.run(cleanTag);
                        linkInsertStmt.run(bookmarkId, cleanTag);
                    }
                });
                tagInsertStmt.finalize();
                linkInsertStmt.finalize();
            }
            res.json({ message: "Bookmark updated successfully" });
        });
    });
});

// (Duplicate task DELETE/PUT routes removed — the primary definitions above handle these)

// --- Notes (Soft Delete / Archive) ---
app.delete('/api/notes/:id', (req, res) => {
    db.run("UPDATE notes SET archived = 1 WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Note archived" });
    });
});

/* ================= PIN / FAVORITE TOGGLE ================= */
app.put('/api/bookmarks/:id/pin', (req, res) => {
    db.run("UPDATE bookmarks SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Pin toggled" });
    });
});

app.put('/api/tasks/:id/pin', (req, res) => {
    db.run("UPDATE tasks SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Pin toggled" });
    });
});

/* ================= ARCHIVE / SOFT DELETE ================= */
app.get('/api/archive', (req, res) => {
    const p1 = new Promise((resolve, reject) => {
        db.all("SELECT id, title, url, 'bookmark' as type, created_at FROM bookmarks WHERE archived = 1", [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
    const p2 = new Promise((resolve, reject) => {
        db.all("SELECT id, title, status, 'task' as type, created_at FROM tasks WHERE archived = 1", [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
    const p3 = new Promise((resolve, reject) => {
        db.all("SELECT id, title, 'note' as type, created_at FROM notes WHERE archived = 1", [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
    Promise.all([p1, p2, p3])
        .then(results => res.json(results.flat()))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/archive/:type/:id/restore', (req, res) => {
    const { type, id } = req.params;
    const tables = { bookmark: 'bookmarks', task: 'tasks', note: 'notes' };
    const table = tables[type];
    if (!table) return res.status(400).json({ error: 'Invalid type' });
    db.run(`UPDATE ${table} SET archived = 0 WHERE id = ?`, id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Restored" });
    });
});

app.delete('/api/archive/:type/:id', (req, res) => {
    const { type, id } = req.params;
    const tables = { bookmark: 'bookmarks', task: 'tasks', note: 'notes' };
    const table = tables[type];
    if (!table) return res.status(400).json({ error: 'Invalid type' });
    db.run(`DELETE FROM ${table} WHERE id = ? AND archived = 1`, id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Permanently deleted" });
    });
});

/* ================= NEW: FOLDER API ROUTES ================= */
app.get('/api/folders', (req, res) => {
    db.all("SELECT * FROM folders ORDER BY name", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/folders', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Folder name is required" });
    db.run("INSERT INTO folders (name) VALUES (?)", [name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name: name });
    });
});

app.delete('/api/folders/:id', (req, res) => {
    const folderId = req.params.id;
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        // 1. Delete Bookmarks in folder
        db.run("DELETE FROM bookmarks WHERE folder_id = ?", folderId, (err) => {
            if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: "Error deleting bookmarks" }); }
            
            // 2. NEW: Delete Notes in folder
            db.run("DELETE FROM notes WHERE folder_id = ?", folderId, (err) => {
                if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: "Error deleting notes" }); }

                // 3. Delete the Folder itself
                db.run("DELETE FROM folders WHERE id = ?", folderId, (err) => {
                    if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: "Error deleting folder" }); }
                    
                    db.run("COMMIT");
                    res.json({ message: "Folder and all contents (bookmarks & notes) deleted." });
                });
            });
        });
    });
});

/* ================= CSV EXPORT/IMPORT ROUTES ================= */

app.get('/api/export/database', (req, res) => {
    const exportData = {
        version: 1,
        timestamp: new Date().toISOString(),
        folders: [],
        tags: [],
        bookmarks: [],
        tasks: [],
        notes: []
    };

    const getFolders = new Promise((resolve, reject) => {
        db.all("SELECT name FROM folders", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.name));
        });
    });

    const getTags = new Promise((resolve, reject) => {
        db.all("SELECT name FROM tags", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.name));
        });
    });

    const getBookmarks = new Promise((resolve, reject) => {
        const sql = `
            SELECT b.url, b.title, b.description, b.thumbnail, b.created_at, f.name as folder_name, GROUP_CONCAT(t.name) as tag_list
            FROM bookmarks b
            LEFT JOIN folders f ON b.folder_id = f.id
            LEFT JOIN item_tags it ON b.id = it.item_id AND it.item_type = 'bookmark'
            LEFT JOIN tags t ON it.tag_id = t.id
            GROUP BY b.id
        `;
        db.all(sql, [], (err, rows) => {
            if (err) reject(err);
            else {
                resolve(rows.map(r => ({
                    url: r.url,
                    title: r.title,
                    description: r.description,
                    thumbnail: r.thumbnail,
                    created_at: r.created_at,
                    folder: r.folder_name,
                    tags: r.tag_list ? r.tag_list.split(',') : []
                })));
            }
        });
    });

    const getNotes = new Promise((resolve, reject) => {
        const sql = `
            SELECT n.title, n.content, n.created_at, f.name as folder_name
            FROM notes n
            LEFT JOIN folders f ON n.folder_id = f.id
        `;
        db.all(sql, [], (err, rows) => {
            if (err) reject(err);
            else {
                resolve(rows.map(r => ({
                    title: r.title,
                    content: r.content,
                    created_at: r.created_at,
                    folder: r.folder_name
                })));
            }
        });
    });

    const getTasks = new Promise((resolve, reject) => {
        db.all("SELECT * FROM tasks", [], (err, tasks) => {
            if (err) return reject(err);
            
            if (tasks.length === 0) return resolve([]);

            const taskPromises = tasks.map(task => {
                return new Promise((resSession, rejSession) => {
                    db.all("SELECT start_time, end_time FROM task_sessions WHERE task_id = ?", [task.id], (err, sessions) => {
                        if (err) rejSession(err);
                        else {
                            resSession({
                                title: task.title,
                                status: task.status,
                                due_date: task.due_date,
                                checklist: task.checklist,
                                notes: task.notes,
                                created_at: task.created_at,
                                sessions: sessions
                            });
                        }
                    });
                });
            });

            Promise.all(taskPromises).then(resolve).catch(reject);
        });
    });

    Promise.all([getFolders, getTags, getBookmarks, getNotes, getTasks])
        .then(([folders, tags, bookmarks, notes, tasks]) => {
            exportData.folders = folders;
            exportData.tags = tags;
            exportData.bookmarks = bookmarks;
            exportData.notes = notes;
            exportData.tasks = tasks;

            res.header('Content-Type', 'application/json');
            res.attachment(`karmtrack_backup_${new Date().toISOString().slice(0, 10)}.json`);
            res.send(JSON.stringify(exportData, null, 2));
        })
        .catch(err => {
            res.status(500).json({ error: err.message });
        });
});

app.post('/api/import/database', (req, res) => {
    const data = req.body;
    
    if (!data || !data.bookmarks || !data.tasks || !data.notes) {
        return res.status(400).json({ error: "Invalid backup data format." });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Restore Folders
        const folderStmt = db.prepare("INSERT OR IGNORE INTO folders (name) VALUES (?)");
        (data.folders || []).forEach(name => folderStmt.run(name));
        folderStmt.finalize();

        // 2. Restore Tags
        const tagStmt = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
        (data.tags || []).forEach(name => tagStmt.run(name));
        tagStmt.finalize();

        // 3. Re-fetch IDs for mapping
        const folderMap = {};
        const tagMap = {};

        // We use a Promise wrapper here just to synchronize the ID fetching within the flow
        new Promise((resolve, reject) => {
            db.all("SELECT id, name FROM folders", (err, rows) => {
                if(err) return reject(err);
                rows.forEach(r => folderMap[r.name] = r.id);
                
                db.all("SELECT id, name FROM tags", (err, tRows) => {
                    if(err) return reject(err);
                    tRows.forEach(r => tagMap[r.name] = r.id);
                    resolve();
                });
            });
        }).then(() => {
            return new Promise((resolve, reject) => {
                db.serialize(() => {
                    // 4. Restore Bookmarks
                    const bmStmt = db.prepare(`INSERT INTO bookmarks (url, title, description, thumbnail, created_at, folder_id) VALUES (?, ?, ?, ?, ?, ?)`);
                    const itemTagStmt = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, item_type, tag_id) VALUES (?, 'bookmark', ?)`);

                    (data.bookmarks || []).forEach(bm => {
                        const fId = bm.folder ? folderMap[bm.folder] : null;
                        bmStmt.run([bm.url, bm.title, bm.description, bm.thumbnail, bm.created_at, fId], function(err) {
                            if(!err && bm.tags && bm.tags.length > 0) {
                                const bmId = this.lastID;
                                bm.tags.forEach(tagName => {
                                    if(tagMap[tagName]) itemTagStmt.run(bmId, tagMap[tagName]);
                                });
                            }
                        });
                    });
                    bmStmt.finalize();
                    itemTagStmt.finalize();

                    // 5. Restore Notes
                    const noteStmt = db.prepare(`INSERT INTO notes (title, content, created_at, folder_id) VALUES (?, ?, ?, ?)`);
                    (data.notes || []).forEach(note => {
                        const fId = note.folder ? folderMap[note.folder] : null;
                        noteStmt.run([note.title, note.content, note.created_at, fId]);
                    });
                    noteStmt.finalize();

                    // 6. Restore Tasks & Sessions
                    const taskStmt = db.prepare(`INSERT INTO tasks (title, status, due_date, checklist, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
                    const sessionStmt = db.prepare(`INSERT INTO task_sessions (task_id, start_time, end_time) VALUES (?, ?, ?)`);

                    (data.tasks || []).forEach(task => {
                        taskStmt.run([task.title, task.status, task.due_date, task.checklist, task.notes, task.created_at], function(err) {
                            if(!err && task.sessions && task.sessions.length > 0) {
                                const taskId = this.lastID;
                                task.sessions.forEach(sess => {
                                    sessionStmt.run(taskId, sess.start_time, sess.end_time);
                                });
                            }
                        });
                    });
                    taskStmt.finalize();
                    sessionStmt.finalize();

                    // COMMIT after all serialized operations complete
                    db.run("COMMIT", (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });
        }).then(() => {
            res.json({ message: "Full database import complete." });
        }).catch(err => {
            db.run("ROLLBACK");
            res.status(500).json({ error: err.message });
        });
    });
});


/* ================= STATS / ANALYTICS ================= */
app.get('/api/stats', (req, res) => {
    const p1 = new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as total,
            SUM(CASE WHEN archived=0 THEN 1 ELSE 0 END) as active
            FROM bookmarks`, [], (err, r) => err ? reject(err) : resolve(r));
    });
    const p2 = new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as total,
            SUM(CASE WHEN status='done' AND archived=0 THEN 1 ELSE 0 END) as done,
            SUM(CASE WHEN status='todo' AND archived=0 THEN 1 ELSE 0 END) as todo,
            SUM(CASE WHEN status='inprogress' AND archived=0 THEN 1 ELSE 0 END) as inprogress
            FROM tasks`, [], (err, r) => err ? reject(err) : resolve(r));
    });
    const p3 = new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as total FROM notes WHERE archived=0`, [], (err, r) => err ? reject(err) : resolve(r));
    });
    // Bookmarks per week (last 8 weeks)
    const p4 = new Promise((resolve, reject) => {
        db.all(`SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as count
            FROM bookmarks WHERE archived=0 AND created_at >= date('now','-56 days')
            GROUP BY week ORDER BY week`, [], (err, r) => err ? reject(err) : resolve(r));
    });
    // Top tags by usage
    const p5 = new Promise((resolve, reject) => {
        db.all(`SELECT t.name, COUNT(it.tag_id) as count FROM tags t
            JOIN item_tags it ON t.id = it.tag_id
            GROUP BY t.id ORDER BY count DESC LIMIT 10`, [], (err, r) => err ? reject(err) : resolve(r));
    });
    // Top tasks by time tracked
    const p6 = new Promise((resolve, reject) => {
        db.all(`SELECT t.title,
            COALESCE(SUM(strftime('%s', ts.end_time) - strftime('%s', ts.start_time)), 0) as total_seconds
            FROM tasks t
            LEFT JOIN task_sessions ts ON t.id = ts.task_id AND ts.end_time IS NOT NULL
            WHERE t.archived=0
            GROUP BY t.id ORDER BY total_seconds DESC LIMIT 8`, [], (err, r) => err ? reject(err) : resolve(r));
    });

    Promise.all([p1, p2, p3, p4, p5, p6])
        .then(([bookmarks, tasks, notes, bmByWeek, topTags, topTasks]) => {
            res.json({ bookmarks, tasks, notes, bmByWeek, topTags, topTasks });
        })
        .catch(err => res.status(500).json({ error: err.message }));
});

/* ================= PLANNER API ================= */
app.get('/api/planner', (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });
    db.all("SELECT * FROM planner_blocks WHERE date = ? ORDER BY start_time", [date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/planner', (req, res) => {
    const { date, start_time, end_time, label, color } = req.body;
    if (!date || !start_time || !end_time || !label) return res.status(400).json({ error: 'Missing fields' });
    db.run(
        "INSERT INTO planner_blocks (date, start_time, end_time, label, color) VALUES (?, ?, ?, ?, ?)",
        [date, start_time, end_time, label, color || '#05d9e8'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, date, start_time, end_time, label, color: color || '#05d9e8' });
        }
    );
});

app.put('/api/planner/:id', (req, res) => {
    const { start_time, end_time, label, color } = req.body;
    db.run(
        "UPDATE planner_blocks SET start_time=?, end_time=?, label=?, color=? WHERE id=?",
        [start_time, end_time, label, color, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Updated' });
        }
    );
});

app.delete('/api/planner/:id', (req, res) => {
    db.run("DELETE FROM planner_blocks WHERE id=?", req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { db };
