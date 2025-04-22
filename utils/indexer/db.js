/**
 * Database utilities for cast file indexing
 */

const Database = require('better-sqlite3');
const path = require('path');

// Path constants
const CASTS_DIR = path.join(__dirname, '../..', 'public', 'casts');
const DB_PATH = path.join(__dirname, '../..', 'index.db');

/**
 * Initialize the database with necessary tables
 * 
 * @param {Database} db - SQLite database instance
 */
function initDatabase(db) {
  // Enable WAL mode for better concurrency and crash recovery
  db.pragma('journal_mode = WAL');
  
  // Create version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS version (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Get current schema version
  const schemaVersion = getVersion(db, 'schema_version') || '0.0.0';
  
  // Initialize tables with initial schema
  if (schemaVersion === '0.0.0') {
    console.log('Initializing database schema...');
    
    // Create indexed_files table to track which files have been indexed
    db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        date TEXT,
        time TEXT,
        timestamp INTEGER,
        file_size INTEGER,
        indexed_at INTEGER,
        completed BOOLEAN DEFAULT 0,
        UNIQUE(file_path)
      );
    `);

    // Create indexing_strategies table to track which strategies have been applied
    db.exec(`
      CREATE TABLE IF NOT EXISTS indexing_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (file_id) REFERENCES indexed_files(id) ON DELETE CASCADE,
        UNIQUE(file_id, strategy_id, strategy_version)
      );
    `);

    // Create FTS5 table for searching cast content
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cast_content USING fts5(
        content,
        file_id UNINDEXED,
        timestamp UNINDEXED,
        time_offset UNINDEXED,
        tags UNINDEXED
      );
    `);
    
    // Update schema version
    setVersion(db, 'schema_version', '1.0.0');
  }
  
  // Apply migrations as needed
  applyMigrations(db, schemaVersion);
}

/**
 * Apply database migrations based on current schema version
 * 
 * @param {Database} db - SQLite database instance
 * @param {string} currentVersion - Current schema version
 */
function applyMigrations(db, currentVersion) {
  // Migration from 0.0.0 or 1.0.0 to add file_mtime column
  if (currentVersion === '0.0.0' || currentVersion === '1.0.0') {
    console.log('Migrating database schema: Adding file_mtime column...');
    
    // Add file_mtime column if it doesn't exist
    try {
      db.exec('ALTER TABLE indexed_files ADD COLUMN file_mtime INTEGER;');
      console.log('Added file_mtime column successfully');
    } catch (err) {
      // Column might already exist
      if (!err.message.includes('duplicate column name')) {
        console.error('Error adding file_mtime column:', err);
      }
    }
    
    // Update schema version
    setVersion(db, 'schema_version', '1.1.0');
  }
}

/**
 * Set database version
 * 
 * @param {Database} db - SQLite database instance
 * @param {string} key - Version key
 * @param {string} value - Version value
 */
function setVersion(db, key, value) {
  const stmt = db.prepare('INSERT OR REPLACE INTO version (key, value) VALUES (?, ?)');
  stmt.run(key, value);
}

/**
 * Get database version
 * 
 * @param {Database} db - SQLite database instance
 * @param {string} key - Version key
 * @returns {string|null} - Version value or null if not found
 */
function getVersion(db, key) {
  const stmt = db.prepare('SELECT value FROM version WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : null;
}

/**
 * Register file for indexing
 * 
 * @param {Database} db - SQLite database instance
 * @param {string} filePath - Path to the file
 * @param {string} filename - Filename without .gz extension
 * @param {object} fileInfo - File information
 * @returns {number} - File ID
 */
function registerFile(db, filePath, filename, fileInfo) {
  // Check if the file already exists in the database
  const existingStmt = db.prepare('SELECT id, file_size, file_mtime, indexed_at FROM indexed_files WHERE file_path = ?');
  const existing = existingStmt.get(filePath);
  
  if (existing) {
    // File exists, check if it's been modified based on size and mtime
    const fileModifiedTime = fileInfo.mtimeMs || (fileInfo.mtime ? fileInfo.mtime.getTime() : null);
    const lastIndexedTime = existing.indexed_at || 0;
    
    // Check if the file seems unchanged
    if (existing.file_size === fileInfo.size && 
        fileModifiedTime && 
        existing.file_mtime && 
        fileModifiedTime <= existing.file_mtime) {
      // File not modified since last indexing, return existing ID
      return existing.id;
    } else {
      // File was modified, update stats but keep the file as registered
      const updateStmt = db.prepare(`
        UPDATE indexed_files 
        SET file_size = ?, file_mtime = ?, indexed_at = ?, completed = 0
        WHERE id = ?
      `);
      updateStmt.run(fileInfo.size, fileModifiedTime, Date.now(), existing.id);
      return existing.id;
    }
  } else {
    // File doesn't exist, insert new record
    const parsedInfo = require('../parseFilename').parseFilenameDate(filename);
    const timestamp = parsedInfo ? parsedInfo.dateObj.getTime() : null;
    
    // Get file modified time safely
    const fileModifiedTime = fileInfo.mtimeMs || (fileInfo.mtime ? fileInfo.mtime.getTime() : null);
    
    const insertStmt = db.prepare(`
      INSERT INTO indexed_files 
      (file_path, filename, date, time, timestamp, file_size, file_mtime, indexed_at, completed) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    
    const info = insertStmt.run(
      filePath,
      filename,
      parsedInfo ? parsedInfo.date : null,
      parsedInfo ? parsedInfo.time : null,
      timestamp,
      fileInfo.size,
      fileModifiedTime,
      Date.now()
    );
    
    return info.lastInsertRowid;
  }
}

/**
 * Check if file has been indexed with the given strategy
 * 
 * @param {Database} db - SQLite database instance
 * @param {number} fileId - File ID
 * @param {string} strategyId - Strategy ID
 * @param {string} strategyVersion - Strategy version
 * @returns {boolean} - True if file has been indexed with this strategy version
 */
function isFileIndexed(db, fileId, strategyId, strategyVersion) {
  // First check if the file has been marked as completed
  const fileStmt = db.prepare('SELECT completed FROM indexed_files WHERE id = ?');
  const fileRow = fileStmt.get(fileId);
  
  if (!fileRow || fileRow.completed !== 1) {
    // File not completed, needs indexing
    return false;
  }
  
  // Then check if the specific strategy has been applied
  const strategyStmt = db.prepare(
    'SELECT completed_at FROM indexing_strategies WHERE file_id = ? AND strategy_id = ? AND strategy_version = ?'
  );
  const strategyRow = strategyStmt.get(fileId, strategyId, strategyVersion);
  
  return Boolean(strategyRow && strategyRow.completed_at);
}

/**
 * Mark strategy as completed for a file
 * 
 * @param {Database} db - SQLite database instance
 * @param {number} fileId - File ID
 * @param {string} strategyId - Strategy ID
 * @param {string} strategyVersion - Strategy version
 */
function markStrategyCompleted(db, fileId, strategyId, strategyVersion) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO indexing_strategies 
    (file_id, strategy_id, strategy_version, completed_at) 
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(fileId, strategyId, strategyVersion, Date.now());
}

/**
 * Mark file indexing as complete
 * 
 * @param {Database} db - SQLite database instance
 * @param {number} fileId - File ID
 */
function markFileCompleted(db, fileId) {
  const stmt = db.prepare('UPDATE indexed_files SET completed = 1 WHERE id = ?');
  stmt.run(fileId);
}

/**
 * Clear partial indexing data for a file
 * 
 * @param {Database} db - SQLite database instance
 * @param {number} fileId - File ID
 */
function clearPartialIndexing(db, fileId) {
  const stmt = db.prepare('DELETE FROM cast_content WHERE file_id = ?');
  stmt.run(fileId);
}

/**
 * Get database connection
 * 
 * @returns {Database} - SQLite database instance
 */
function getDatabase() {
  return new Database(DB_PATH);
}

module.exports = {
  DB_PATH,
  initDatabase,
  setVersion,
  getVersion,
  registerFile,
  isFileIndexed,
  markStrategyCompleted,
  markFileCompleted,
  clearPartialIndexing,
  getDatabase
};
