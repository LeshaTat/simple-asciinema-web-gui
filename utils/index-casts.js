/**
 * Main script for indexing cast files using SQLite and FTS5
 * 
 * This script processes gzipped cast files from the zip directory,
 * decompresses them in memory, strips ANSI colors, and indexes
 * the content for full-text search.
 */

const { indexCastFiles } = require('./indexer');

// Run the indexing
indexCastFiles().catch(err => {
  console.error('Indexing failed:', err);
  process.exit(1);
});