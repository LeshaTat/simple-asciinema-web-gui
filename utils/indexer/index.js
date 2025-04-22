/**
 * Main entry point for cast file indexing
 */

const indexer = require('./indexer');

module.exports = {
  indexCastFiles: indexer.indexCastFiles,
  searchCasts: indexer.searchCasts,
  getIndexStats: indexer.getIndexStats
};