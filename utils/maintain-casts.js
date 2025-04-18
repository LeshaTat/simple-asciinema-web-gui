/**
 * Maintenance script for cast files
 * 
 * This script:
 * 1. Compresses cast files using gzip
 * 2. Saves them to public/casts/zip directory
 * 3. Creates .info files with additional metadata (currently duration)
 * 4. Skips files that already have info files
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { pipeline } = require('stream');

// Convert callbacks to promises
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const mkdirAsync = promisify(fs.mkdir);
const accessAsync = promisify(fs.access);
const pipelineAsync = promisify(pipeline);

// Path constants
const CASTS_DIR = path.join(__dirname, '..', 'public', 'casts');
const ZIP_DIR = path.join(CASTS_DIR, 'zip');

/**
 * Extract recording duration from a cast file
 * 
 * @param {string} filePath - Path to the cast file
 * @returns {Promise<number|null>} - Duration in seconds or null if can't be determined
 */
async function getRecordingDuration(filePath) {
  try {
    // Read file data
    const data = await readFileAsync(filePath, 'utf8');
    const lines = data.split('\n');
    
    if (lines.length < 2) {
      return null;
    }
    
    // Check if duration is in the header (v2 format)
    const header = JSON.parse(lines[0]);
    if (header.version === 2 && header.duration) {
      return header.duration;
    }
    
    // For files without duration in header, find the timestamp of the last event
    let lastTimestamp = 0;
    
    // Sample lines from the end to find timestamps
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

/**
 * Compress a file using gzip
 * 
 * @param {string} inputPath - Path to the input file
 * @param {string} outputPath - Path for the compressed output
 * @returns {Promise<void>}
 */
async function compressFile(inputPath, outputPath) {
  const readStream = fs.createReadStream(inputPath);
  const writeStream = fs.createWriteStream(outputPath);
  const gzip = zlib.createGzip();
  
  await pipelineAsync(readStream, gzip, writeStream);
}

/**
 * Create info file with metadata for a cast file
 * 
 * @param {string} originalFilePath - Path to the original cast file
 * @param {string} zipFilePath - Path to the zipped cast file
 * @param {number|null} duration - Duration in seconds
 * @returns {Promise<void>}
 */
async function createInfoFile(originalFilePath, zipFilePath, duration) {
  const infoFilePath = `${zipFilePath}.info`;
  
  const infoData = {
    duration: duration,
    compressed_at: new Date().toISOString(),
    original_size: (await statAsync(originalFilePath)).size,
    compressed_size: (await statAsync(zipFilePath)).size
  };
  
  await writeFileAsync(infoFilePath, JSON.stringify(infoData, null, 2), 'utf8');
  console.log(`Created info file: ${path.basename(infoFilePath)}`);
}

/**
 * Main function to maintain cast files
 */
async function maintainCastFiles() {
  try {
    // Ensure zip directory exists
    try {
      await accessAsync(ZIP_DIR, fs.constants.F_OK);
    } catch (err) {
      console.log(`Creating directory: ${ZIP_DIR}`);
      await mkdirAsync(ZIP_DIR, { recursive: true });
    }
    
    // Get all cast files
    const files = await readdirAsync(CASTS_DIR);
    const castFiles = files.filter(file => file.endsWith('.cast'));
    
    console.log(`Found ${castFiles.length} cast files`);
    
    // Find the most recent cast file to skip (it might be currently recording)
    let latestFile = null;
    let latestMtime = 0;
    
    // Get the most recent file by modification time
    for (const filename of castFiles) {
      const filePath = path.join(CASTS_DIR, filename);
      try {
        const stats = await statAsync(filePath);
        if (stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestFile = filename;
        }
      } catch (err) {
        // Ignore error if file can't be accessed
      }
    }
    
    // Process each cast file
    for (const filename of castFiles) {
      // Skip the most recent file as it might be currently recording
      if (filename === latestFile) {
        console.log(`Skipping ${filename} - it's the most recent file (possibly being recorded)`);
        continue;
      }
      if ("example.cast" == filename.substring(-12)) {
        console.log(`Skipping ${filename} - it's an example file`);
        continue;
      }
      
      const originalFilePath = path.join(CASTS_DIR, filename);
      const zipFilePath = path.join(ZIP_DIR, `${filename}.gz`);
      const infoFilePath = `${zipFilePath}.info`;
      
      // Check if info file already exists
      try {
        await accessAsync(infoFilePath, fs.constants.F_OK);
        console.log(`Info file exists for ${filename}`);
        
        // If zip file also exists, delete the original
        try {
          await accessAsync(zipFilePath, fs.constants.F_OK);
          console.log(`Zip file exists for ${filename}, deleting original`);
          await fs.promises.unlink(originalFilePath);
          console.log(`Deleted original file: ${filename}`);
        } catch (delErr) {
          console.log(`Could not delete original file ${filename}: ${delErr.message}`);
        }
        
        continue;
      } catch (err) {
        // Info file doesn't exist, proceed
      }
      
      // Check if zip file exists
      let zipExists = false;
      try {
        await accessAsync(zipFilePath, fs.constants.F_OK);
        zipExists = true;
      } catch (err) {
        // Zip file doesn't exist
      }
      
      // Compress file if needed
      if (!zipExists) {
        console.log(`Compressing: ${filename}`);
        await compressFile(originalFilePath, zipFilePath);
      } else {
        console.log(`Using existing compressed file: ${filename}.gz`);
      }
      
      // Get duration and create info file only if zip file exists
      try {
        await accessAsync(zipFilePath, fs.constants.F_OK);
        const duration = await getRecordingDuration(originalFilePath);
        await createInfoFile(originalFilePath, zipFilePath, duration);
      } catch (err) {
        console.error(`Error creating info file for ${filename}: ${err.message}`);
      }
      try {
        await accessAsync(infoFilePath, fs.constants.F_OK);
        console.log(`Info file exists for ${filename}`);
        
        // If zip file also exists, delete the original
        try {
          await accessAsync(zipFilePath, fs.constants.F_OK);
          console.log(`Zip file exists for ${filename}, deleting original`);
          await fs.promises.unlink(originalFilePath);
          console.log(`Deleted original file: ${filename}`);
        } catch (delErr) {
          console.log(`Could not delete original file ${filename}: ${delErr.message}`);
        }
        
        continue;
      } catch (err) {
        // Info file doesn't exist, proceed
      }
    }
    
    console.log('Maintenance completed successfully');
  } catch (err) {
    console.error('Error during maintenance:', err);
  }
}

// Run the maintenance if this script is executed directly
if (require.main === module) {
  maintainCastFiles().catch(err => {
    console.error('Maintenance failed:', err);
    process.exit(1);
  });
}

module.exports = {
  maintainCastFiles
};
