/**
 * AsciinemaPlayer utility functions
 * Provides functionality to create and manage asciinema players
 */

// Global reference to the active player instance
let currentPlayer = null;

// Store base line height settings globally
window.asciinemaSettings = {
  baseLineHeight: 1.4,
  minLineHeight: 1.0,
  lineHeightStep: 0.1,
  currentLineHeight: 1.4, // Will be updated during adjustment
  adjustmentAttempts: 0,
  maxAdjustmentAttempts: 10
};

/**
 * Create or reload an asciinema player with the specified options
 * 
 * @param {string} filename - The name of the .cast file to play
 * @param {string|HTMLElement} container - The ID of the container element or the element itself
 * @param {Object} options - Player configuration options
 * @returns {Object} The player instance
 */
function loadPlayer(filename, container, options = {}) {
  // Ensure container is an element, not a string ID
  if (typeof container === 'string') {
    container = document.getElementById(container);
  }
  
  // If no container found, return early
  if (!container) {
    console.error('Player container not found:', container);
    return null;
  }
  
  // Clear the container
  container.innerHTML = '';
  
  // Dispose of any existing player
  if (currentPlayer) {
    try {
      currentPlayer.dispose();
    } catch (e) {
      console.warn('Error disposing player:', e);
    }
    currentPlayer = null;
  }
  
  // Reset adjustment attempts
  window.asciinemaSettings.adjustmentAttempts = 0;
  
  // Update base line height if provided in options
  if (options.terminalLineHeight) {
    window.asciinemaSettings.baseLineHeight = options.terminalLineHeight;
    window.asciinemaSettings.currentLineHeight = options.terminalLineHeight;
  } else {
    // Reset to base line height
    window.asciinemaSettings.currentLineHeight = window.asciinemaSettings.baseLineHeight;
  }
  
  // Default options
  const defaultOptions = {
    autoPlay: true,
    preload: true,
    terminalFontFamily: '"Fira Code Nerd Font", "Fira Code", monospace',
    terminalFontSize: '16px',
    terminalLineHeight: window.asciinemaSettings.currentLineHeight,
    theme: 'monokai'
  };
  
  // Merge default options with provided options
  const playerOptions = { ...defaultOptions, ...options };
  
  // Create path to the cast file
  const castPath = filename.startsWith('/') ? filename : `/casts/${filename}`;
  
  // Create the player
  try {
    currentPlayer = AsciinemaPlayer.create(castPath, container, playerOptions);
    
    // After player is created, check if it fits and adjust if needed
    setTimeout(() => {
      adjustPlayerHeight(filename, container, playerOptions);
    }, 300); // Give the player time to render
    
    return currentPlayer;
  } catch (e) {
    console.error('Error creating player:', e);
    container.innerHTML = `<div class="player-error">Error loading player: ${e.message}</div>`;
    return null;
  }
}

/**
 * Update the active state in the sidebar and update the URL
 * 
 * @param {string} filename - The name of the file to mark as active
 */
function updateActiveRecording(filename) {
  // Update active state in sidebar
  document.querySelectorAll('.recording-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeItem = document.querySelector(`.recording-item[data-filename="${filename}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
    
    // Ensure the active item is visible (scroll to it)
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // Update URL without reloading page
  if (window.location.pathname.includes('timeline')) {
    window.history.pushState({}, '', `/timeline?file=${filename}`);
  }
}

/**
 * Adjust player height by reducing line height if needed
 * 
 * @param {string} filename - The name of the .cast file to play
 * @param {string|HTMLElement} container - The player container
 * @param {Object} options - Previous player options
 */
function adjustPlayerHeight(filename, container, options = {}) {
  // Ensure container is an element, not a string ID
  if (typeof container === 'string') {
    container = document.getElementById(container);
  }
  
  // If we've already tried too many adjustments, stop
  if (window.asciinemaSettings.adjustmentAttempts >= window.asciinemaSettings.maxAdjustmentAttempts) {
    console.warn('Maximum adjustment attempts reached, stopping further adjustments');
    return;
  }
  
  // Get container and content dimensions
  const containerElement = container;
  if (!containerElement) return;
  
  // Get the main content area
  const contentDiv = containerElement.closest('.content') || 
                     containerElement.closest('body') || 
                     document.querySelector('.content');
  if (!contentDiv) return;
  
  // Get player wrapper element (the one created by asciinema-player)
  const playerWrapper = containerElement.querySelector('.asciinema-player') || 
                        containerElement.querySelector('.ap-player');
  if (!playerWrapper) return;
  
  // Calculate dimensions and check if adjustment is needed
  const containerHeight = containerElement.clientHeight;
  const terminalHeight = playerWrapper.scrollHeight;
  
  // Determine if player is too tall for its container
  const isTooTall = terminalHeight > containerHeight
  
  console.log('Adjustment check:', {
    containerHeight,
    terminalHeight,
    currentLineHeight: window.asciinemaSettings.currentLineHeight,
    isTooTall
  });
  
  // If player is too tall, adjust line height and reload
  if (isTooTall) {
    window.asciinemaSettings.adjustmentAttempts++;
    
    // Calculate new line height
    const newLineHeight = Math.max(
      window.asciinemaSettings.minLineHeight,
      window.asciinemaSettings.currentLineHeight - window.asciinemaSettings.lineHeightStep
    );
    
    window.asciinemaSettings.currentLineHeight = newLineHeight;
    
    console.log(`Adjusting line height to ${newLineHeight}`);
    
    // Reload player with new line height
    if (currentPlayer) {
      try {
        currentPlayer.dispose();
      } catch (e) {
        console.warn('Error disposing player:', e);
      }
      currentPlayer = null;
    }
    
    // Create new options with updated line height
    const newOptions = {
      ...options,
      terminalLineHeight: newLineHeight
    };
    
    // Create the player with new settings
    currentPlayer = AsciinemaPlayer.create(
      filename.startsWith('/') ? filename : `/casts/${filename}`, 
      containerElement, 
      newOptions
    );
    
    // Check again after a delay to see if more adjustment is needed
    setTimeout(() => {
      adjustPlayerHeight(filename, containerElement, newOptions);
    }, 300);
  }
}

// Export functions for global use
window.asciinemaPlayer = {
  load: loadPlayer,
  updateActive: updateActiveRecording,
  adjustHeight: adjustPlayerHeight
};
