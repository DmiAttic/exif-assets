/**
 * Shared utility functions for image-tools apps
 */

/**
 * Generate a random ID string
 * @returns {string} Random 8-character string
 */
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Truncate filename while preserving extension
 * @param {string} name - Filename to truncate
 * @param {number} maxLength - Maximum length (default: 12)
 * @returns {string} Truncated filename
 */
function truncateName(name, maxLength = 12) {
  if (name.length <= maxLength) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext <= 5) {
    const base = name.substring(0, ext);
    const extension = name.substring(ext);
    const available = maxLength - extension.length - 1;
    if (available > 3) {
      return base.substring(0, available) + 'вЂ¦' + extension;
    }
  }
  return name.substring(0, maxLength - 1) + 'вЂ¦';
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
function formatFileSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Get file extension, normalizing common variants
 * @param {string} filename - Filename to extract extension from
 * @returns {string} Normalized lowercase extension
 */
function getFileExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'heif') return 'heic';
  return ext;
}

/**
 * Calculate percentage savings between original and compressed size
 * @param {number} original - Original size in bytes
 * @param {number} compressed - Compressed size in bytes
 * @returns {number} Percentage saved (negative if larger)
 */
function calculateSavings(original, compressed) {
  if (!original || original === 0) return 0;
  return Math.round((1 - compressed / original) * 100);
}

/**
 * Apply shimmer hint animation to an element (once per element)
 * @param {HTMLElement} element - Element to animate
 * @param {Set} shimmeredElements - Set to track already shimmered elements
 */
function shimmerHint(element, shimmeredElements) {
  if (!element || shimmeredElements.has(element)) return;
  shimmeredElements.add(element);
  element.classList.remove('hint-shimmer');
  void element.offsetWidth; // Force reflow
  element.classList.add('hint-shimmer');
  element.addEventListener('animationend', () => {
    element.classList.remove('hint-shimmer');
  }, { once: true });
}

/**
 * Create drag-drop handlers for file upload
 * @param {HTMLElement} dropZone - Drop zone element
 * @param {Function} onFiles - Callback when files are dropped
 * @returns {Object} Event handlers
 */
function createDragDropHandlers(dropZone, onFiles) {
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('files__list-outer_dragover');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('files__list-outer_dragover');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('files__list-outer_dragover');
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      onFiles(droppedFiles);
    }
  }

  return { handleDragOver, handleDragLeave, handleDrop };
}

/**
 * Create scroll control handlers for horizontal file list
 * @param {HTMLElement} scrollContainer - Scrollable container
 * @param {HTMLElement} prevBtn - Previous button
 * @param {HTMLElement} nextBtn - Next button
 * @param {number} scrollAmount - Amount to scroll (default: 200)
 * @returns {Object} Control functions
 */
function createScrollControls(scrollContainer, prevBtn, nextBtn, scrollAmount = 200) {
  function updateScrollButtons() {
    if (!scrollContainer) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
    const canScrollLeft = scrollLeft > 0;
    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
    if (prevBtn) prevBtn.disabled = !canScrollLeft;
    if (nextBtn) nextBtn.disabled = !canScrollRight;
  }

  function scrollToEnd() {
    if (!scrollContainer) return;
    setTimeout(() => {
      scrollContainer.scrollTo({
        left: scrollContainer.scrollWidth,
        behavior: 'smooth'
      });
    }, 100);
  }

  function scrollBy(amount) {
    if (!scrollContainer) return;

    const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;

    // If scrolling left and close to start, snap to 0
    if (amount < 0 && scrollContainer.scrollLeft < Math.abs(amount)) {
      scrollContainer.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }

    // If scrolling right and close to end, snap to max
    if (amount > 0 && scrollContainer.scrollLeft + amount > maxScroll - 10) {
      scrollContainer.scrollTo({ left: maxScroll, behavior: 'smooth' });
      return;
    }

    scrollContainer.scrollBy({
      left: amount,
      behavior: 'smooth'
    });
  }

  // Bind events
  if (prevBtn) prevBtn.addEventListener('click', () => scrollBy(-scrollAmount));
  if (nextBtn) nextBtn.addEventListener('click', () => scrollBy(scrollAmount));
  if (scrollContainer) scrollContainer.addEventListener('scroll', updateScrollButtons);

  return { updateScrollButtons, scrollToEnd, scrollBy };
}

/**
 * Download a file via temporary anchor element
 * @param {string} url - Object URL to download
 * @param {string} filename - Download filename
 */
function downloadBlob(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download multiple files with staggered timing
 * @param {Array} files - Array of {url, filename} objects
 * @param {number} delay - Delay between downloads in ms (default: 100)
 * @returns {Promise} Resolves when all downloads started
 */
function downloadMultiple(files, delay = 100) {
  return new Promise((resolve) => {
    let completed = 0;
    files.forEach((file, index) => {
      setTimeout(() => {
        downloadBlob(file.url, file.filename);
        completed++;
        if (completed >= files.length) {
          resolve();
        }
      }, index * delay);
    });
  });
}

/**
 * Report a client-side error to the server
 * @param {Error|string} error - Error object or message
 * @param {Object} context - Additional context (op, format, fileSize, etc.)
 */
function reportError(error, context = {}) {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const config = window.APP_CONFIG || {};

    const payload = JSON.stringify({
      error: err.message,
      stack: err.stack || '',
      context,
      site: config.siteKey || '',
      ua: navigator.userAgent,
      url: location.pathname
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/error', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch (_) {}
}

function reportSuccess(context = {}) {
  try {
    const config = window.APP_CONFIG || {};
    if (!config.trackSuccess) return;

    const payload = JSON.stringify({
      site: config.siteKey || '',
      context,
      url: location.pathname
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/success', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/success', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Detect actual file format by magic bytes (first 16 bytes)
 * Returns lowercase format string (e.g. 'jpg', 'png') or null if unknown
 * @param {File} file - File object
 * @returns {Promise<string|null>} Detected format or null
 */
async function detectFormat(file) {
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b.length < 4) return null;

    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    // PNG: 89 50 4E 47
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    // GIF: GIF8
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
    // BMP: BM
    if (b[0] === 0x42 && b[1] === 0x4D) return 'bmp';
    // TIFF: II* (little-endian) or MM* (big-endian)
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00) ||
        (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A)) return 'tiff';
    // PDF: %PDF
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    // PSD: 8BPS
    if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) return 'psd';
    // WebP: RIFF....WEBP
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    // HEIC/HEIF/AVIF: ftyp at offset 4
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand === 'avif' || brand === 'avis') return 'avif';
      return 'heic';
    }

    // SVG: text-based, check first 256 bytes for <svg or <?xml
    const textBuf = await file.slice(0, 256).arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(textBuf));
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<svg') || (trimmed.startsWith('<?xml') && text.includes('<svg'))) return 'svg';

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect WASM crash errors that corrupt the worker's WASM instance
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if the error indicates a WASM crash
 */
function isWasmCrashError(errorMessage) {
  if (!errorMessage) return false;
  const msg = String(errorMessage).toLowerCase();
  return msg.includes('memory access out of bounds') ||
    msg.includes('out of bounds memory access') ||
    msg.includes('exit(1)') ||
    msg.includes('abort(') ||
    msg.includes('unreachable') ||
    msg.includes('runtimeerror');
}

/**
 * Classify error message for user-facing tooltip
 * @param {string} msg - Error message
 * @param {Object} errors - Error message map from APP_CONFIG
 * @returns {string} User-facing error description
 */
function classifyError(msg, errors) {
  if (!errors) errors = {};
  if (!msg) return errors.processing || '';
  const m = msg.toLowerCase();
  if (m.includes('could not be decoded') || m.includes('cannot decode') || m.includes('size of offscreencanvas is zero') || m.includes('readback') || m.includes('createimagebitmap') || m.includes('encoding') || m.includes('invalid image') || m.includes('not a valid') || m.includes('invalid state')) return errors.corrupt || '';
  if (m.includes('memory access') || m.includes('out of memory') || m.includes('abort(') || m.includes('exit(1)') || m.includes('unreachable') || m.includes('wasm worker crashed')) return errors.tooLarge || '';
  if (m.includes('failed to fetch') || m.includes('dynamically imported module') || m.includes('load failed')) return errors.loading || '';
  if (m.includes('max buffer length') || m.includes('non-whitespace before first tag') || m.includes('invalid svg')) return errors.svg || '';
  return errors.processing || '';
}

// Export to window for browser usage
window.SharedUtils = {
  generateId,
  truncateName,
  formatFileSize,
  getFileExtension,
  calculateSavings,
  shimmerHint,
  createDragDropHandlers,
  createScrollControls,
  downloadBlob,
  downloadMultiple,
  reportError,
  reportSuccess,
  detectFormat,
  isWasmCrashError,
  classifyError
};

// Also export individual functions for convenience
window.generateId = generateId;
window.truncateName = truncateName;
window.formatFileSize = formatFileSize;
window.getFileExtension = getFileExtension;
window.calculateSavings = calculateSavings;
window.reportError = reportError;
window.reportSuccess = reportSuccess;
window.detectFormat = detectFormat;
window.isWasmCrashError = isWasmCrashError;
window.classifyError = classifyError;