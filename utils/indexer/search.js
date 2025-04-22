/**
 * Search functionality for indexed cast files
 */

const db = require('./db');

/**
 * Search cast content in the database
 * 
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @param {Array<string>} [options.tags] - Optional tags to filter by
 * @param {string} [options.dateFrom] - Optional start date (YYYY-MM-DD)
 * @param {string} [options.dateTo] - Optional end date (YYYY-MM-DD)
 * @param {number} [options.limit=50] - Maximum results to return
 * @param {number} [options.timeWindow=10] - Time window in minutes for result grouping (not implemented yet)
 * @returns {Promise<Array<Object>>} - Search results
 */
async function searchCasts(query, options = {}) {
  const {
    tags = [],
    dateFrom = null,
    dateTo = null,
    limit = 50,
    timeWindow = 10  // Keep the parameter for future implementation
  } = options;
  
  let database = null;
  
  try {
    // Open database
    database = db.getDatabase();
    
    // Build a simple query for reliable search
    let sql = `
      SELECT
        c.content AS snippet,
        c.time_offset,
        i.file_path,
        i.filename,
        i.date,
        i.time,
        c.tags
      FROM
        cast_content c
      JOIN
        indexed_files i ON c.file_id = i.id
      WHERE
        c.content MATCH ?
        AND i.completed = 1
    `;
    
    const params = [query];
    
    // Add tag filtering if provided
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `c.tags LIKE ?`).join(' OR ');
      sql += ` AND (${tagConditions})`;
      tags.forEach(tag => params.push(`%${tag}%`));
    }
    
    // Add date filtering if provided
    if (dateFrom) {
      sql += ` AND i.date >= ?`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      sql += ` AND i.date <= ?`;
      params.push(dateTo);
    }
    
    // Order and limit results
    sql += ` ORDER BY i.timestamp DESC, c.time_offset ASC LIMIT ?`;
    params.push(limit);
    
    // Execute query
    const stmt = database.prepare(sql);
    const results = stmt.all(...params);
    
    return results;
  } catch (err) {
    console.error('Search error:', err);
    return [];
  } finally {
    // Always close the database connection
    if (database) {
      database.close();
    }
  }
}

module.exports = {
  searchCasts
};