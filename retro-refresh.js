// This script integrates the retro floating refresh bar
// with the existing dashboard and workers page functionality

(function() {
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Create the retro terminal bar if it doesn't exist yet
    if (!document.getElementById('retro-terminal-bar')) {
      createRetroTerminalBar();
    }
    
    // Hide the original refresh container
    const originalRefreshUptime = document.getElementById('refreshUptime');
    if (originalRefreshUptime) {
      originalRefreshUptime.style.visibility = 'hidden';
      originalRefreshUptime.style.height = '0';
      originalRefreshUptime.style.overflow = 'hidden';
      
      // Important: We keep the original elements and just hide them
      // This ensures all existing JavaScript functions still work
    }
    
    // Add extra space at the bottom of the page to prevent the floating bar from covering content
    const extraSpace = document.createElement('div');
    extraSpace.style.height = '100px';
    document.body.appendChild(extraSpace);
  });
  
  // Function to create the retro terminal bar
  function createRetroTerminalBar() {
    // Get the HTML content from the shared CSS/HTML
    const html = `
      <div id="retro-terminal-bar">
        <div class="terminal-header">
          <div class="terminal-title">SYSTEM MONITOR v0.1</div>
          <div class="terminal-controls">
            <div class="terminal-dot minimize" title="Minimize" onclick="toggleTerminal()"></div>
            <div class="terminal-dot close" title="Close" onclick="hideTerminal()"></div>
          </div>
        </div>
        <div class="terminal-content">
          <div class="status-indicators">
            <div class="status-indicator">
              <div class="status-dot connected"></div>
              <span>LIVE</span>
            </div>
            <div class="status-indicator">
              <span id="data-refresh-time">00:00:00</span>
            </div>
          </div>
          
          <div id="refreshContainer">
            <!-- Enhanced progress bar with tick marks -->
            <div class="bitcoin-progress-container">
              <div id="bitcoin-progress-inner">
                <div class="scan-line"></div>
              </div>
              <div class="progress-ticks">
                <span>0s</span>
                <span>15s</span>
                <span>30s</span>
                <span>45s</span>
                <span>60s</span>
              </div>
              <!-- Add tick marks every 5 seconds -->
              <div class="tick-mark major" style="left: 0%"></div>
              <div class="tick-mark" style="left: 8.33%"></div>
              <div class="tick-mark" style="left: 16.67%"></div>
              <div class="tick-mark major" style="left: 25%"></div>
              <div class="tick-mark" style="left: 33.33%"></div>
              <div class="tick-mark" style="left: 41.67%"></div>
              <div class="tick-mark major" style="left: 50%"></div>
              <div class="tick-mark" style="left: 58.33%"></div>
              <div class="tick-mark" style="left: 66.67%"></div>
              <div class="tick-mark major" style="left: 75%"></div>
              <div class="tick-mark" style="left: 83.33%"></div>
              <div class="tick-mark" style="left: 91.67%"></div>
              <div class="tick-mark major" style="left: 100%"></div>
            </div>
          </div>
          
          <div id="progress-text">60s to next update</div>
          <div id="uptimeTimer"><strong>Uptime:</strong> 0h 0m 0s</div>
        </div>
      </div>
    `;
    
    // Create a container for the HTML
    const container = document.createElement('div');
    container.innerHTML = html;
    
    // Append to the body
    document.body.appendChild(container.firstElementChild);
    
    // Start the clock update
    updateTerminalClock();
    setInterval(updateTerminalClock, 1000);
    
    // Check if terminal should be collapsed based on previous state
    const isCollapsed = localStorage.getItem('terminalCollapsed') === 'true';
    if (isCollapsed) {
      document.getElementById('retro-terminal-bar').classList.add('collapsed');
    }
  }
  
  // Function to update the terminal clock
  function updateTerminalClock() {
    const clockElement = document.getElementById('data-refresh-time');
    if (clockElement) {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      clockElement.textContent = `${hours}:${minutes}:${seconds}`;
    }
  }
  
  // Expose these functions globally for the onclick handlers
  window.toggleTerminal = function() {
    const terminal = document.getElementById('retro-terminal-bar');
    terminal.classList.toggle('collapsed');
    
    // Store state in localStorage
    localStorage.setItem('terminalCollapsed', terminal.classList.contains('collapsed'));
  };
  
  window.hideTerminal = function() {
    document.getElementById('retro-terminal-bar').style.display = 'none';
    
    // Create a show button that appears at the bottom right
    const showButton = document.createElement('button');
    showButton.id = 'show-terminal-button';
    showButton.textContent = 'Show Monitor';
    showButton.style.position = 'fixed';
    showButton.style.bottom = '10px';
    showButton.style.right = '10px';
    showButton.style.zIndex = '1000';
    showButton.style.backgroundColor = '#f7931a';
    showButton.style.color = '#000';
    showButton.style.border = 'none';
    showButton.style.padding = '8px 12px';
    showButton.style.cursor = 'pointer';
    showButton.style.fontFamily = "'VT323', monospace";
    showButton.style.fontSize = '14px';
    showButton.onclick = function() {
      document.getElementById('retro-terminal-bar').style.display = 'block';
      this.remove();
    };
    document.body.appendChild(showButton);
  };
  
  // Redirect original progress bar updates to our new floating bar
  // This Observer will listen for changes to the original #bitcoin-progress-inner
  // and replicate them to our new floating bar version
  const initProgressObserver = function() {
    // Setup a MutationObserver to watch for style changes on the original progress bar
    const originalProgressBar = document.querySelector('#refreshUptime #bitcoin-progress-inner');
    const newProgressBar = document.querySelector('#retro-terminal-bar #bitcoin-progress-inner');
    
    if (originalProgressBar && newProgressBar) {
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.attributeName === 'style') {
            // Get the width from the original progress bar
            const width = originalProgressBar.style.width;
            if (width) {
              // Apply it to our new progress bar
              newProgressBar.style.width = width;
              
              // Also copy any classes (like glow-effect)
              if (originalProgressBar.classList.contains('glow-effect') && 
                  !newProgressBar.classList.contains('glow-effect')) {
                newProgressBar.classList.add('glow-effect');
              } else if (!originalProgressBar.classList.contains('glow-effect') && 
                         newProgressBar.classList.contains('glow-effect')) {
                newProgressBar.classList.remove('glow-effect');
              }
              
              // Copy waiting-for-update class
              if (originalProgressBar.classList.contains('waiting-for-update') && 
                  !newProgressBar.classList.contains('waiting-for-update')) {
                newProgressBar.classList.add('waiting-for-update');
              } else if (!originalProgressBar.classList.contains('waiting-for-update') && 
                         newProgressBar.classList.contains('waiting-for-update')) {
                newProgressBar.classList.remove('waiting-for-update');
              }
            }
          }
        });
      });
      
      // Start observing
      observer.observe(originalProgressBar, { attributes: true });
    }
    
    // Also watch for changes to the progress text
    const originalProgressText = document.querySelector('#refreshUptime #progress-text');
    const newProgressText = document.querySelector('#retro-terminal-bar #progress-text');
    
    if (originalProgressText && newProgressText) {
      const textObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList') {
            // Update the text in our new bar
            newProgressText.textContent = originalProgressText.textContent;
          }
        });
      });
      
      // Start observing
      textObserver.observe(originalProgressText, { childList: true, subtree: true });
    }
    
    // Watch for changes to the uptime timer
    const originalUptimeTimer = document.querySelector('#refreshUptime #uptimeTimer');
    const newUptimeTimer = document.querySelector('#retro-terminal-bar #uptimeTimer');
    
    if (originalUptimeTimer && newUptimeTimer) {
      const uptimeObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList') {
            // Update the text in our new bar
            newUptimeTimer.innerHTML = originalUptimeTimer.innerHTML;
          }
        });
      });
      
      // Start observing
      uptimeObserver.observe(originalUptimeTimer, { childList: true, subtree: true });
    }
  };
  
  // Start the observer once the page is fully loaded
  window.addEventListener('load', function() {
    // Give a short delay to ensure all elements are rendered
    setTimeout(initProgressObserver, 500);
  });
})();