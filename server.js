const express = require('express');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { parseFilenameDate } = require('./utils/parseFilename');

const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

const app = express();
const PORT = process.env.PORT || 3000;
const CASTS_DIR = path.join(__dirname, 'public', 'casts');

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

// Main route - list of cast files
app.get('/', (req, res) => {
  fs.readdir(CASTS_DIR, (err, files) => {
    if (err) {
      console.error('Error reading casts directory:', err);
      return res.status(500).send('Error reading casts directory');
    }
    
    // Filter only .cast files
    const castFiles = files.filter(file => file.endsWith('.cast'));
    
    res.render('index', { castFiles });
  });
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

// Timeline view - organized by date
app.get('/timeline', async (req, res) => {
  try {
    const files = await readdirAsync(CASTS_DIR);
    
    // Filter only .cast files and sort by date (newest first)
    const castFiles = files
      .filter(file => file.endsWith('.cast'))
      .sort()
      .reverse();
    
    // Group recordings by date
    const recordingsByDate = {};
    
    // Process each file to extract durations
    for (const filename of castFiles) {
      const dateInfo = parseFilenameDate(filename);
      
      if (dateInfo) {
        // Get file duration
        const filePath = path.join(CASTS_DIR, filename);
        const duration = await getRecordingDuration(filePath);
        const durationFormatted = formatDuration(duration);
        
        // If this date doesn't exist yet, create an array for it
        if (!recordingsByDate[dateInfo.date]) {
          recordingsByDate[dateInfo.date] = [];
        }
        
        // Add this recording to its date
        recordingsByDate[dateInfo.date].push({
          filename,
          timeString: dateInfo.time.replace(/:/g, ':'),
          dateObj: dateInfo.dateObj,
          duration,
          durationFormatted,
          tags: dateInfo.tags || [],
          tagsString: dateInfo.tagsString || ''
        });
      }
      // Skip files that don't match our timestamp pattern
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

// Player route
app.get('/play/:filename', (req, res) => {
  const filename = req.params.filename;
  // Validate filename to prevent directory traversal
  if (!filename.match(/^[a-zA-Z0-9_\-\.]+\.cast$/)) {
    return res.status(400).send('Invalid filename');
  }
  
  res.render('player', { filename });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Place your .cast files in: ${CASTS_DIR}`);
});