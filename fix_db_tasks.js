const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'pkm.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    console.log("Creating Task Sessions table...");

    // Create table to track every start/stop interval
    db.run(`CREATE TABLE IF NOT EXISTS task_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        start_time DATETIME,
        end_time DATETIME,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`);

    console.log("SUCCESS: 'task_sessions' table created.");
});