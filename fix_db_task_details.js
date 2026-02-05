const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'pkm.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    console.log("Upgrading Tasks table for details...");

    db.run("ALTER TABLE tasks ADD COLUMN notes TEXT", (err) => {
        if (err && !err.message.includes("duplicate column")) {
            console.error("Error adding 'notes' column:", err.message);
        } else {
            console.log("SUCCESS: 'notes' column added or already exists in tasks table.");
        }
    });
});