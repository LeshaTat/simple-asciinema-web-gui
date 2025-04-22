/**
 * Script to strip ANSI color sequences from cast files
 * 
 * This script finds the most recent cast file in public/casts,
 * strips all ANSI color escape sequences, and saves the output
 * to a new file with a .plain postfix.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Convert callbacks to promises
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// Path constant
const CASTS_DIR = path.join(__dirname, '..', 'public', 'casts');

/**
 * Finds the most recent .cast file in the directory
 * 
 * @param {string} dirPath - Directory to search
 * @returns {Promise<string|null>} - Path to the most recent file or null if none found
 */
async function findMostRecentCastFile(dirPath) {
  try {
    const files = await readdirAsync(dirPath);
    const castFiles = files.filter(file => file.endsWith('.cast'));
    
    if (castFiles.length === 0) {
      return null;
    }
    
    let latestFile = null;
    let latestMtime = 0;
    
    for (const filename of castFiles) {
      const filePath = path.join(dirPath, filename);
      try {
        const stats = await statAsync(filePath);
        if (stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestFile = filePath;
        }
      } catch (err) {
        // Ignore error if file can't be accessed
      }
    }
    
    return latestFile;
  } catch (err) {
    console.error(`Error finding most recent cast file:`, err);
    return null;
  }
}

/**
 * Process a cast file to strip color information
 * 
 * @param {string} filePath - Path to the cast file
 * @returns {Promise<string>} - Path to the processed file
 */
async function processCastFile(filePath) {
  try {
    const data = await readFileAsync(filePath, 'utf8');
    const lines = data.split('\n');
    const processedLines = [];
    
    // Process the header (first line)
    if (lines.length > 0) {
      const header = JSON.parse(lines[0]);
      processedLines.push(JSON.stringify(header));
    }
    
    // Process each event line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const event = JSON.parse(line);
        if (Array.isArray(event) && event.length >= 3) {
          const timestamp = event[0];
          const type = event[1];  // "o" for output, "i" for input
          let content = event[2];
          
          // Handle special case for an empty string
          if (content === '') {
            processedLines.push(JSON.stringify([timestamp, type, '']));
            continue;
          }
          
          // Replace the content with a plain text version (no ANSI control codes)
          const plainText = content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')     // ANSI color/style
                                  .replace(/\x1B\][0-9];.*?\x07/g, '')        // OSC escape sequences
                                  .replace(/\x1B\][0-9].*;.*?(\x1B\\|\x07)/g, '') // OSC escape sequences alternate format
                                  .replace(/\x1B[@-Z\\-_]/g, '')              // ANSI escapes
                                  .replace(/\x1B[[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') // ANSI sequences
                                  .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '') // Control characters
                                  .replace(/\r/g, '');                        // Carriage returns
          
          event[2] = plainText;
          processedLines.push(JSON.stringify(event));
        } else {
          // Just include the line as-is if it's not a standard event
          processedLines.push(line);
        }
      } catch (e) {
        // If parsing fails, just add the original line
        processedLines.push(line);
      }
    }
    
    // Create the output file path
    const outputPath = `${filePath}.plain`;
    
    // Write the processed data to the output file
    await writeFileAsync(outputPath, processedLines.join('\n'), 'utf8');
    
    return outputPath;
  } catch (err) {
    console.error(`Error processing cast file ${filePath}:`, err);
    throw err;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    let castFile;
    
    // Check if a specific file is provided via command line arguments
    if (process.argv.length > 2) {
      castFile = process.argv[2];
      // If only a filename is provided without path, assume it's in the CASTS_DIR
      if (!path.isAbsolute(castFile)) {
        castFile = path.join(CASTS_DIR, castFile);
      }
      console.log(`Processing specified file: ${path.basename(castFile)}`);
    } else {
      // Find the most recent cast file if no specific file is provided
      castFile = await findMostRecentCastFile(CASTS_DIR);
      
      if (!castFile) {
        console.error('No cast files found in directory:', CASTS_DIR);
        process.exit(1);
      }
      
      console.log(`Found most recent cast file: ${path.basename(castFile)}`);
    }
    
    const outputPath = await processCastFile(castFile);
    console.log(`Successfully processed file. Output saved to: ${path.basename(outputPath)}`);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

// Run the script if it's executed directly
if (require.main === module) {
  main();
}

module.exports = {
  processCastFile,
  findMostRecentCastFile
};