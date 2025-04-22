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
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {number} [options.timeWindow=10] - Time window in minutes for result grouping (not implemented yet)
 * @returns {Promise<{results: Array<Object>, total: number}>} - Search results and total count
 */
async function searchCasts(query, options = {}) {
  const {
    tags = [],
    dateFrom = null,
    dateTo = null,
    limit = 50,
    offset = 0,
    timeWindow = 10  // Keep the parameter for future implementation
  } = options;
  
  let database = null;
  
  try {
    // Open database
    database = db.getDatabase();
    
    // Build the WHERE clause conditions
    const whereConditions = ['c.content MATCH ?', 'i.completed = 1'];
    const params = [query];
    
    // Add tag filtering if provided
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `c.tags LIKE ?`).join(' OR ');
      whereConditions.push(`(${tagConditions})`);
      tags.forEach(tag => params.push(`%${tag}%`));
    }
    
    // Add date filtering if provided
    if (dateFrom) {
      whereConditions.push('i.date >= ?');
      params.push(dateFrom);
    }
    
    if (dateTo) {
      whereConditions.push('i.date <= ?');
      params.push(dateTo);
    }
    
    // Combine all conditions
    const whereClause = whereConditions.join(' AND ');
    
    // If timeWindow is enabled (>0), use window functions to group results
    let sql;
    
    if (timeWindow > 0) {
      // Calculate time window in milliseconds
      const timeWindowMs = timeWindow * 60 * 1000;
      
      sql = `
        WITH matches AS (
          SELECT
            c.content AS snippet,
            c.time_offset,
            c.tags,
            i.file_path,
            i.filename,
            i.date,
            i.time,
            i.timestamp,
            (i.timestamp / ${timeWindowMs}) AS time_window,
            ROW_NUMBER() OVER (
              PARTITION BY (i.timestamp / ${timeWindowMs})
              ORDER BY i.timestamp DESC
            ) AS row_num
          FROM
            cast_content c
          JOIN
            indexed_files i ON c.file_id = i.id
          WHERE
            ${whereClause}
        )
        SELECT
          snippet,
          time_offset,
          file_path,
          filename,
          date,
          time,
          tags
        FROM
          matches
        WHERE
          row_num = 1
        ORDER BY
          timestamp DESC
      `;
    } else {
      // Simple query without time window grouping
      sql = `
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
          ${whereClause}
      `;
    }
    
    // Add ORDER BY clause
    if (timeWindow > 0) {
      // For time window query, we already have ORDER BY timestamp DESC
    } else {
      // For regular query, add ORDER BY clause
      sql += ` ORDER BY i.timestamp DESC, c.time_offset ASC`;
    }
    
    // Now get total count first (for pagination metadata)
    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const countStmt = database.prepare(countSql);
    const { total } = countStmt.get(...params) || { total: 0 };
    
    // Add LIMIT and OFFSET for pagination
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    // Execute main query with pagination
    const stmt = database.prepare(sql);
    const results = stmt.all(...params);
    
    if (timeWindow > 0) {
      console.log(`Time window grouping applied: ${results.length} results from search (total: ${total})`);
    }
    
    return {
      results,
      total
    };
  } catch (err) {
    console.error('Search error:', err);
    return { results: [], total: 0 };
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