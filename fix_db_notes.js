const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'pkm.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    console.log("Upgrading Notes table...");

    // Add folder_id to notes table
    db.run("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL", (err) => {
        if (err) {
            if (err.message.includes("duplicate column")) {
                console.log("Column 'folder_id' already exists in notes.");
            } else {
                console.error("Error adding folder_id:", err.message);
            }
        } else {
            console.log("SUCCESS: Added 'folder_id' column to notes table.");
        }
    });
});

setTimeout(() => {
    console.log("Migration complete.");
}, 1000);