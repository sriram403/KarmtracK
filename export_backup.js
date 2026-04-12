/**
 * export_backup.js
 * Exports all data from pkm.db to karmtrack_full_backup.json
 * Run standalone: node export_backup.js
 * Also called automatically by the pre-commit git hook.
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'pkm.db');
const BACKUP_PATH = path.join(__dirname, 'karmtrack_full_backup.json');

if (!fs.existsSync(DB_PATH)) {
    console.error('[backup] pkm.db not found — skipping export.');
    process.exit(0);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) { console.error('[backup] Cannot open DB:', err.message); process.exit(1); }
});

const q = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function run() {
    const folders = (await q("SELECT name FROM folders")).map(r => r.name);
    const tags    = (await q("SELECT name FROM tags")).map(r => r.name);

    const bmRows = await q(`
        SELECT b.url, b.title, b.description, b.thumbnail, b.created_at,
               f.name as folder_name, GROUP_CONCAT(t.name) as tag_list
        FROM bookmarks b
        LEFT JOIN folders f ON b.folder_id = f.id
        LEFT JOIN item_tags it ON b.id = it.item_id AND it.item_type = 'bookmark'
        LEFT JOIN tags t ON it.tag_id = t.id
        GROUP BY b.id
    `);
    const bookmarks = bmRows.map(r => ({
        url: r.url, title: r.title, description: r.description,
        thumbnail: r.thumbnail, created_at: r.created_at,
        folder: r.folder_name,
        tags: r.tag_list ? r.tag_list.split(',') : []
    }));

    const noteRows = await q(`
        SELECT n.title, n.content, n.created_at, f.name as folder_name
        FROM notes n
        LEFT JOIN folders f ON n.folder_id = f.id
    `);
    const notes = noteRows.map(r => ({
        title: r.title, content: r.content,
        created_at: r.created_at, folder: r.folder_name
    }));

    const taskRows = await q("SELECT * FROM tasks");
    const tasks = await Promise.all(taskRows.map(async task => {
        const sessions = await q(
            "SELECT start_time, end_time FROM task_sessions WHERE task_id = ?", [task.id]
        );
        return {
            title: task.title, status: task.status, due_date: task.due_date,
            checklist: task.checklist, notes: task.notes,
            created_at: task.created_at, sessions
        };
    }));

    const exportData = {
        version: 1,
        timestamp: new Date().toISOString(),
        folders, tags, bookmarks, notes, tasks
    };

    fs.writeFileSync(BACKUP_PATH, JSON.stringify(exportData, null, 2));
    console.log(`[backup] Exported ${bookmarks.length} bookmarks, ${notes.length} notes, ${tasks.length} tasks → karmtrack_full_backup.json`);
}

run()
    .catch(err => { console.error('[backup] Export failed:', err.message); process.exit(1); })
    .finally(() => db.close());
