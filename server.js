const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_PATH = path.resolve(__dirname, 'pkm.db');

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
        // NEW: Folders table
        db.run(`CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )`);

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

        // (Your other tables: tasks, notes, etc. remain unchanged)
        db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT DEFAULT 'todo', due_date TEXT, checklist TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, is_encrypted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)`);
        db.run(`CREATE TABLE IF NOT EXISTS item_tags (item_id INTEGER, item_type TEXT, tag_id INTEGER, PRIMARY KEY (item_id, item_type, tag_id), FOREIGN KEY (tag_id) REFERENCES tags(id))`);
        db.run(`CREATE TABLE IF NOT EXISTS links (source_id INTEGER, source_type TEXT, target_id INTEGER, target_type TEXT)`);
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
        GROUP BY b.id
        ORDER BY f.name, b.created_at DESC
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
    // 1. Delete the Bookmark
    db.run("DELETE FROM bookmarks WHERE id = ?", id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // 2. Delete the Tag Links (Clean up!)
        db.run("DELETE FROM item_tags WHERE item_id = ? AND item_type = 'bookmark'", id, (err) => {
            if (err) console.error("Error cleaning tags", err);
            res.json({ message: "Deleted bookmark and tag links" });
        });
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

// START TIMER
app.post('/api/tasks/:id/timer/start', (req, res) => {
    const taskId = req.params.id;
    // Only start if there isn't already one running
    db.get("SELECT id FROM task_sessions WHERE task_id = ? AND end_time IS NULL", [taskId], (err, row) => {
        if(row) return res.json({ message: "Timer already running" });
        
        db.run("INSERT INTO task_sessions (task_id, start_time) VALUES (?, CURRENT_TIMESTAMP)", [taskId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Timer started" });
        });
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

// Also update DELETE TASK to clean up sessions
app.delete('/api/tasks/:id', (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        db.run("DELETE FROM task_sessions WHERE task_id = ?", id); // Clean logs
        db.run("DELETE FROM tasks WHERE id = ?", id, (err) => { // Delete task
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Task deleted" });
        });
    });
});

// --- Notes ---
app.get('/api/notes', (req, res) => {
    // UPDATED: Now selects folder_id
    db.all("SELECT id, title, content, folder_id, created_at FROM notes ORDER BY created_at DESC", [], (err, rows) => {
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
    
    // 1. Search Bookmarks (Now including Tags!)
    const p1 = new Promise((resolve, reject) => {
        const sql = `
            SELECT DISTINCT b.id, b.title, b.url as info, 'bookmark' as type 
            FROM bookmarks b
            LEFT JOIN item_tags it ON b.id = it.item_id AND it.item_type = 'bookmark'
            LEFT JOIN tags t ON it.tag_id = t.id
            WHERE b.title LIKE ? 
               OR b.description LIKE ? 
               OR b.url LIKE ? 
               OR t.name LIKE ?
        `;
        // We pass 'term' 4 times now
        db.all(sql, [term, term, term, term], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });

    // 2. Search Tasks
    const p2 = new Promise((resolve, reject) => {
        db.all("SELECT id, title, status as info, 'task' as type FROM tasks WHERE title LIKE ?", [term], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });

    // 3. Search Notes
    const p3 = new Promise((resolve, reject) => {
        db.all("SELECT id, title, 'note' as info, 'note' as type FROM notes WHERE title LIKE ? OR content LIKE ?", [term, term], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });

    Promise.all([p1, p2, p3])
        .then(results => {
            const flatResults = results.flat(); 
            // Remove duplicates (just in case) based on ID and Type
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

// --- Tasks (Delete) ---
app.delete('/api/tasks/:id', (req, res) => {
    db.run("DELETE FROM tasks WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Task deleted" });
    });
});

// --- Tasks (Update - now includes title) ---
app.put('/api/tasks/:id', (req, res) => {
    const { title, status, due_date } = req.body;
    let sql = "UPDATE tasks SET title = COALESCE(?, title), status = COALESCE(?, status), due_date = COALESCE(?, due_date) WHERE id = ?";
    db.run(sql, [title, status, due_date, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Updated" });
    });
});

// --- Notes (Delete) ---
app.delete('/api/notes/:id', (req, res) => {
    db.run("DELETE FROM notes WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Note deleted" });
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
    if (!name) return res.status(400).json({ error: "Folder name is required" });
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { db };