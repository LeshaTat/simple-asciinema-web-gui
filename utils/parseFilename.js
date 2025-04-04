/**
 * Parses an asciinema filename to extract date, time, and tags.
 * Supports formats like:
 * - asciinema_2025-04-04_13-56-53.cast
 * - asciinema_2025-04-04_13-56-53_tags_work-project.cast
 * 
 * @param {string} filename - The asciinema cast filename to parse
 * @returns {Object|null} - Parsed information or null if format is invalid
 */
function parseFilenameDate(filename) {
  // Match pattern like asciinema_2025-04-04_13-56-53.cast or asciinema_2025-04-04_13-56-53_tags_tag1-tag2.cast
  const match = filename.match(/asciinema_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})(?:_tags_([^.]+))?\.cast/);
  if (match) {
    // Parse tags if they exist
    const tags = match[3] ? match[3].split('-').map(tag => tag.trim()).filter(Boolean) : [];
    
    return {
      date: match[1],
      time: match[2].replace(/-/g, ':'),
      dateObj: new Date(`${match[1]}T${match[2].replace(/-/g, ':')}`),
      tags: tags,
      tagsString: tags.length > 0 ? tags.join(', ') : ''
    };
  }
  return null;
}

module.exports = {
  parseFilenameDate
};