const express = require('express');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { parseFilenameDate } = require('./utils/parseFilename');
const { searchCasts, getIndexStats } = require('./utils/indexer');

const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const accessAsync = promisify(fs.access);

const app = express();
const PORT = process.env.PORT || 3000;
const CASTS_DIR = path.join(__dirname, 'public', 'casts');
const ZIP_DIR = path.join(CASTS_DIR, 'zip');

// Set view engine
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static('public'));

// Serve node_modules files
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Serve asciinema-player files
app.use('/asciinema-player', express.static(
  path.join(__dirname, 'node_modules', 'asciinema-player', 'dist')
));

// Add body parser for API routes
app.use(express.json());

// Helper function to get info file data
async function getInfoFileData(castFilename) {
  try {
    const infoFilePath = path.join(ZIP_DIR, `${castFilename}.gz.info`);
    const infoData = await readFileAsync(infoFilePath, 'utf8');
    return JSON.parse(infoData);
  } catch (err) {
    return null;
  }
}

// Helper function to get cast files with exactly: filename, duration, tags, and date
async function getCastFilesWithInfo() {
  try {
    // Get list of all cast files from main directory
    const mainDirFiles = await readdirAsync(CASTS_DIR);
    const mainDirCastFiles = mainDirFiles
      .filter(file => file.endsWith('.cast') && file !== 'zip');  // Exclude 'zip' directory itself
    
    // Get all info files from zip directory
    let zipFiles = [];
    try {
      const zipDirFiles = await readdirAsync(ZIP_DIR);
      zipFiles = zipDirFiles
        .filter(file => file.endsWith('.gz.info'))
        .map(file => file.slice(0, -8)); // Remove .gz.info to get original filename
    } catch (err) {
      console.log('Zip directory not accessible:', err.message);
    }
    
    // Combine file lists (original files + files that only exist in zip directory)
    const uniqueFilenames = new Set([...mainDirCastFiles, ...zipFiles]);
    
    // Process each file to collect specified info
    const results = [];
    
    for (const filename of uniqueFilenames) {
      // Get date info from filename
      const dateInfo = parseFilenameDate(filename);
      
      // Skip files that don't match our timestamp pattern
      if (!dateInfo) continue;
      
      // Get duration from info file or by parsing the cast file
      let duration = null;
      const infoData = await getInfoFileData(filename);
      
      if (infoData && typeof infoData.duration === 'number') {
        duration = infoData.duration;
      } else {
        // Fallback to extracting from the original file if it exists
        const filePath = path.join(CASTS_DIR, filename);
        try {
          await accessAsync(filePath, fs.constants.F_OK);
          duration = await getRecordingDuration(filePath);
        } catch (err) {
          // File doesn't exist in the original directory, can't get duration
          console.error(`File access error for ${filePath}:`, err);
        }
      }
      
      // Add to results with only the specified info
      results.push({
        filename,
        duration,
        tags: dateInfo.tags || [],
        date: dateInfo.date
      });
    }
    
    return results;
  } catch (err) {
    console.error('Error gathering cast files info:', err);
    return [];
  }
}

// Main route - list of cast files
app.get('/', async (req, res) => {
  try {
    const castFilesInfo = await getCastFilesWithInfo();
    res.render('index', { castFiles: castFilesInfo });
  } catch (err) {
    console.error('Error reading casts information:', err);
    return res.status(500).send('Error reading casts information');
  }
});

// Helper function to extract recording duration from .cast file
async function getRecordingDuration(filePath) {
  try {
    // Read first line to get header data
    const data = await readFileAsync(filePath, 'utf8');
    const lines = data.split('\n');
    
    if (lines.length < 2) {
      return null;
    }
    
    const header = JSON.parse(lines[0]);
    if (header.version === 2 && header.duration) {
      return header.duration;
    }
    
    // For version 2 files without duration in header, or version 1 files,
    // we need to find the timestamp of the last event
    let lastTimestamp = 0;
    
    // Sample a few lines from the end to find timestamps
    const sampleLines = lines.slice(-100).filter(line => line.trim());
    
    for (const line of sampleLines) {
      try {
        const event = JSON.parse(line);
        if (Array.isArray(event) && typeof event[0] === 'number') {
          lastTimestamp = Math.max(lastTimestamp, event[0]);
        }
      } catch (e) {
        // Skip lines that aren't valid JSON
      }
    }
    
    return lastTimestamp > 0 ? lastTimestamp : null;
  } catch (e) {
    console.error(`Error extracting duration from ${filePath}:`, e);
    return null;
  }
}

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
  if (seconds === null || isNaN(seconds)) {
    return '';
  }
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Search page
app.get('/search', async (req, res) => {
  try {
    // Get all unique tags from cast files
    const castFilesInfo = await getCastFilesWithInfo();
    const allTags = new Set();
    
    castFilesInfo.forEach(fileInfo => {
      if (fileInfo.tags && Array.isArray(fileInfo.tags)) {
        fileInfo.tags.forEach(tag => allTags.add(tag));
      }
    });
    
    res.render('search', { 
      availableTags: Array.from(allTags).sort()
    });
  } catch (err) {
    console.error('Error preparing search page:', err);
    return res.status(500).send('Error preparing search page');
  }
});

// Timeline view - organized by date
app.get('/timeline', async (req, res) => {
  try {
    // Get all cast files with their info
    const castFilesInfo = await getCastFilesWithInfo();
    
    // Group recordings by date
    const recordingsByDate = {};
    
    // Process each file
    for (const fileInfo of castFilesInfo) {
      const dateInfo = parseFilenameDate(fileInfo.filename);
      const durationFormatted = formatDuration(fileInfo.duration);
      
      // If this date doesn't exist yet, create an array for it
      if (!recordingsByDate[fileInfo.date]) {
        recordingsByDate[fileInfo.date] = [];
      }
      
      // Add this recording to its date group
      recordingsByDate[fileInfo.date].push({
        filename: fileInfo.filename,
        timeString: dateInfo.time.replace(/:/g, ':'),
        dateObj: dateInfo.dateObj,
        duration: fileInfo.duration,
        durationFormatted,
        tags: fileInfo.tags,
        tagsString: fileInfo.tags.join(', ')
      });
    }
    
    // Sort recordings within each date by time
    Object.keys(recordingsByDate).forEach(date => {
      recordingsByDate[date].sort((a, b) => {
        if (a.dateObj && b.dateObj) {
          return b.dateObj - a.dateObj; // Newest first
        }
        return 0;
      });
    });
    
    // Helper function to format dates nicely
    const formatDate = (dateString) => {
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      } catch (e) {
        return dateString;
      }
    };
    
    res.render('timeline', { 
      recordingsByDate, 
      formatDate,
      activeFile: req.query.file || null
    });
  } catch (err) {
    console.error('Error reading casts directory:', err);
    return res.status(500).send('Error reading casts directory');
  }
});

// Serve gzipped cast files with appropriate headers
app.get('/casts/:filename', (req, res) => {
  const filename = req.params.filename;
  
  // Validate filename to prevent directory traversal
  if (!filename.match(/^[a-zA-Z0-9_\-\.]+\.cast$/)) {
    return res.status(400).send('Invalid filename');
  }
  
  // Check if we have a gzipped version
  const zipFilePath = path.join(ZIP_DIR, `${filename}.gz`);
  const originalFilePath = path.join(CASTS_DIR, filename);
  
  fs.access(zipFilePath, fs.constants.F_OK, (err) => {
    if (!err) {
      // Gzipped version exists
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(zipFilePath).pipe(res);
    } else {
      // Fall back to original file
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(originalFilePath).pipe(res);
    }
  });
});

// Player route
app.get('/play/:filename', (req, res) => {
  const filename = req.params.filename;
  // Validate filename to prevent directory traversal
  if (!filename.match(/^[a-zA-Z0-9_\-\.]+\.cast$/)) {
    return res.status(400).send('Invalid filename');
  }
  
  // Get timestamp parameter for jumping to a specific point
  const startAt = req.query.t ? parseFloat(req.query.t) : null;
  
  res.render('player', { filename, startAt });
});

// Search API endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query, tags, dateFrom, dateTo, limit, timeWindow, page } = req.body;
    
    if (!query || typeof query !== 'string' || query.length < 1) {
      return res.status(400).json({ error: 'Valid search query is required' });
    }
    
    // Calculate offset for pagination
    const currentPage = parseInt(page, 10) || 1;
    const resultsPerPage = parseInt(limit, 10) || 50;
    const offset = (currentPage - 1) * resultsPerPage;
    
    const options = { 
      tags: Array.isArray(tags) ? tags : [],
      dateFrom,
      dateTo,
      limit: resultsPerPage,
      offset,
      timeWindow: timeWindow || 10 // Default to 10 minutes if not specified
    };
    
    const { results, total } = await searchCasts(query, options);
    
    // Format results with additional contextual information
    const formattedResults = results.map(result => {
      return {
        snippet: result.snippet,
        filename: result.filename,
        date: result.date,
        time: result.time,
        timeOffset: result.time_offset || 0,
        timeFormatted: formatDuration(result.time_offset),
        tags: result.tags ? result.tags.split(', ') : [],
        playUrl: `/play/${result.filename}?t=${result.time_offset || 0}`
      };
    });
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(total / resultsPerPage);
    const hasMore = currentPage < totalPages;
    
    res.json({
      query,
      page: currentPage,
      totalPages,
      hasMore,
      totalCount: total,
      count: results.length,
      results: formattedResults
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'An error occurred during search' });
  }
});

// Index stats API endpoint
app.get('/api/index/stats', async (req, res) => {
  try {
    const stats = await getIndexStats();
    res.json(stats);
  } catch (err) {
    console.error('Error getting index stats:', err);
    res.status(500).json({ error: 'Failed to retrieve index statistics' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Place your .cast files in: ${CASTS_DIR}`);
});
