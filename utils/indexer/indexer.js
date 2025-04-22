/**
 * Main indexer implementation for cast files
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const db = require('./db');
const fileProcessor = require('./file-processor');
const search = require('./search');

// Convert callbacks to promises
const readFileAsync = promisify(fs.readFile);

// Path constants
const CONFIG_PATH = path.join(__dirname, '..', 'index-config.json');

/**
 * Load indexing configuration
 * 
 * @returns {Promise<Object>} - Configuration object
 */
async function loadConfig() {
  try {
    const data = await readFileAsync(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error loading config:`, err);
    throw err;
  }
}

/**
 * Process and index a cast file with the given strategy
 * 
 * @param {Database} database - SQLite database instance
 * @param {string} filePath - Path to the cast file
 * @param {string} strategy - Strategy configuration
 * @param {boolean} isGzipped - Whether the file is gzipped
 * @returns {Promise<boolean>} - True if indexing was successful
 */
async function indexCastFile(database, filePath, strategy, isGzipped) {
  // Extract base filename, removing .gz extension if needed
  const filename = isGzipped ? path.basename(filePath, '.gz') : path.basename(filePath);
  
  try {
    // Get file stats
    const stats = await fileProcessor.statAsync(filePath);
    
    // Begin transaction to ensure atomicity
    database.exec('BEGIN TRANSACTION');
    
    try {
      // Register file in the database to get file ID
      // This will check if the file is already registered and return its ID
      const fileId = db.registerFile(database, filePath, filename, stats);
      
      // Get current file info from database
      const fileInfoStmt = database.prepare('SELECT file_size, file_mtime, indexed_at FROM indexed_files WHERE id = ?');
      const fileInfo = fileInfoStmt.get(fileId);
      
      // Check if file is already indexed with current strategy
      if (db.isFileIndexed(database, fileId, strategy.id, strategy.version)) {
        // Check for modification by comparing file size and modified time
        const fileModTime = stats.mtimeMs || (stats.mtime ? stats.mtime.getTime() : null);
        
        // Assume modified if we can't verify both size and time
        const isModified = !fileInfo || 
                           fileInfo.file_size !== stats.size || 
                           !fileModTime || // If we can't get mod time, assume changed
                           !fileInfo.file_mtime || // If no stored mod time, assume changed
                           fileModTime > fileInfo.file_mtime;
        
        if (!isModified) {
          console.log(`Skipping ${filename} - already indexed with ${strategy.id} ${strategy.version}`);
          database.exec('COMMIT');
          return true;
        } else {
          // File has changed since last indexing, reindex it
          console.log(`File ${filename} has changed, reindexing...`);
        }
      }
      
      console.log(`Indexing ${filename} with strategy ${strategy.id} ${strategy.version}`);
      
      // Clear any partial indexing data for this file
      db.clearPartialIndexing(database, fileId);
      
      // Load and parse the cast file (gzipped or plain)
      const events = isGzipped 
        ? await fileProcessor.loadGzippedCastFile(filePath)
        : await fileProcessor.loadPlainCastFile(filePath);
      
      // Extract file metadata for indexing
      const parsedInfo = require('../parseFilename').parseFilenameDate(filename);
      const tagsString = parsedInfo && parsedInfo.tags.length ? parsedInfo.tagsString : '';
      const fileTimestamp = parsedInfo ? parsedInfo.dateObj.getTime() : null;
      
      // Prepare insert statement for indexing content
      const insertStmt = database.prepare(
        'INSERT INTO cast_content (content, file_id, timestamp, time_offset, tags) VALUES (?, ?, ?, ?, ?)'
      );
      
      // Process events (skip the header at index 0)
      let processedEvents = 0;
      for (let i = 1; i < events.length; i++) {
        const event = events[i];
        
        if (Array.isArray(event) && event.length >= 3) {
          const timeOffset = event[0]; // Time offset in seconds
          const type = event[1];       // "o" for output, "i" for input
          let content = event[2];      // Content
          
          // Skip empty content
          if (!content) continue;
          
          // Strip ANSI colors from content
          content = fileProcessor.stripColors(content);
          
          // Skip if content is empty after stripping
          if (!content.trim()) continue;
          
          // Insert content into FTS5 table
          insertStmt.run(
            content,
            fileId,
            fileTimestamp,
            timeOffset,
            tagsString
          );
          
          processedEvents++;
        }
      }
      
      // Mark strategy as completed for this file
      db.markStrategyCompleted(database, fileId, strategy.id, strategy.version);
      
      // Mark file as completely indexed
      db.markFileCompleted(database, fileId);
      
      // Commit transaction
      database.exec('COMMIT');
      
      console.log(`Successfully indexed ${filename}: ${processedEvents} events`);
      return true;
    } catch (err) {
      // Rollback transaction on error to maintain consistency
      database.exec('ROLLBACK');
      console.error(`Error processing ${filename}:`, err);
      throw err;
    }
  } catch (err) {
    console.error(`Error indexing ${filename}:`, err);
    return false;
  }
}

/**
 * Main function to index cast files
 */
async function indexCastFiles() {
  let database = null;
  
  try {
    // Load configuration
    const config = await loadConfig();
    
    // Open database
    database = db.getDatabase();
    
    // Initialize database schema
    db.initDatabase(database);
    
    // Set database schema version if not already set
    if (!db.getVersion(database, 'schema_version')) {
      db.setVersion(database, 'schema_version', '1.0.0');
    }
    
    // Check for indexer version change - important for reindexing when strategies are updated
    const currentVersion = db.getVersion(database, 'indexer_version');
    const isVersionChanged = currentVersion !== config.version;
    
    if (isVersionChanged) {
      console.log(`Indexer version changed from ${currentVersion || 'none'} to ${config.version}`);
    }
    
    // Set indexer version
    db.setVersion(database, 'indexer_version', config.version);
    
    // Find all cast files (both regular and gzipped)
    const castFiles = await fileProcessor.findAllCastFiles();
    console.log(`Found ${castFiles.length} cast files (${castFiles.filter(f => f.isGzipped).length} gzipped, ${castFiles.filter(f => !f.isGzipped).length} regular)`);
    
    // Process each file with each relevant strategy
    for (const strategyId of config.currentStrategies) {
      // Find strategy definition
      const strategy = config.indexStrategies.find(s => s.id === strategyId);
      
      if (!strategy) {
        console.error(`Strategy ${strategyId} not found in config`);
        continue;
      }
      
      console.log(`Applying strategy: ${strategy.name} (${strategy.version})`);
      
      // Process each cast file
      for (const fileInfo of castFiles) {
        try {
          await indexCastFile(database, fileInfo.path, strategy, fileInfo.isGzipped);
        } catch (err) {
          // Log error but continue with next file
          console.error(`Error processing file ${path.basename(fileInfo.path)}:`, err);
        }
      }
    }
    
    console.log('Indexing completed successfully');
  } catch (err) {
    console.error('Error during indexing:', err);
  } finally {
    // Always close the database connection
    if (database) {
      database.close();
    }
  }
}

/**
 * Get indexing statistics
 * 
 * @returns {Promise<Object>} - Statistics object
 */
async function getIndexStats() {
  let database = null;
  
  try {
    // Open database
    database = db.getDatabase();
    
    const stats = {
      totalFiles: 0,
      indexedFiles: 0,
      strategies: {},
      indexerVersion: db.getVersion(database, 'indexer_version') || 'unknown',
      schemaVersion: db.getVersion(database, 'schema_version') || 'unknown'
    };
    
    // Get total files
    const totalStmt = database.prepare('SELECT COUNT(*) as count FROM indexed_files');
    const totalRow = totalStmt.get();
    stats.totalFiles = totalRow ? totalRow.count : 0;
    
    // Get completed files
    const completedStmt = database.prepare('SELECT COUNT(*) as count FROM indexed_files WHERE completed = 1');
    const completedRow = completedStmt.get();
    stats.indexedFiles = completedRow ? completedRow.count : 0;
    
    // Get strategy stats
    const strategyStmt = database.prepare(`
      SELECT 
        strategy_id, 
        strategy_version, 
        COUNT(*) as count 
      FROM 
        indexing_strategies 
      WHERE 
        completed_at IS NOT NULL 
      GROUP BY 
        strategy_id, strategy_version
    `);
    
    const strategies = strategyStmt.all();
    
    for (const strategy of strategies) {
      stats.strategies[strategy.strategy_id] = {
        version: strategy.strategy_version,
        count: strategy.count
      };
    }
    
    return stats;
  } catch (err) {
    console.error('Error getting index stats:', err);
    return {
      totalFiles: 0,
      indexedFiles: 0,
      strategies: {},
      indexerVersion: 'unknown',
      schemaVersion: 'unknown',
      error: err.message
    };
  } finally {
    // Always close the database connection
    if (database) {
      database.close();
    }
  }
}

module.exports = {
  indexCastFiles,
  getIndexStats,
  searchCasts: search.searchCasts
};