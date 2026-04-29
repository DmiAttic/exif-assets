// Polyfill for crypto.randomUUID if not available
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = function() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  };
}

// CDN config for site-specific assets (not /shared/)
const APP_DOMAINS = {
  'exifviewer.com': 'https://webby.io/exifviewer',
  'exifremover.com': 'https://webby.io/exifremover'
}
const R2_BASE = APP_DOMAINS[location.hostname] || ''
const useCdn = !!R2_BASE
const CDN_TIMEOUT = 5000

async function loadScript(path) {
  const src = `${path}?v=${window.APP_CONFIG.v}`
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = () => reject(new Error('Script load failed'))
    document.head.appendChild(script)
  })
}

async function loadModule(path) {
  return import(`${path}?v=${window.APP_CONFIG.v}`)
}

// Load module from CDN with timeout, fallback to local (only for /js/, not /shared/)
async function loadModuleCdn(path) {
  if (!useCdn || path.startsWith('/shared/')) {
    return loadModule(path)
  }
  try {
    return await Promise.race([
      import(`${R2_BASE}${path}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDN timeout')), CDN_TIMEOUT))
    ])
  } catch (e) {
    return loadModule(path)
  }
}

// Lazy-loaded worker for all operations (read and remove)
let worker = null

function isWasmCrashError(errorMessage) {
  return window.SharedUtils.isWasmCrashError(errorMessage)
}

// Recreate worker to get fresh WASM instance after crash
function recreateWorker() {
  reportError(new Error('WASM worker crashed, recreating'), { op: 'wasm-recovery' })
  if (worker) {
    worker.terminate()
  }
  worker = null
  // Next call to getWorker() will create fresh worker
}

function getWorker() {
  if (!worker) {
    // Worker must be same-origin, CDN logic is inside the worker
    worker = new Worker(`/shared/js/exiftool-worker.js?v=${window.APP_CONFIG.v}`, { type: 'module' })
    worker.onmessage = handleWorkerMessage
    worker.onerror = function(err) {
      const errorMsg = err.message || 'Worker error'
      if (isWasmCrashError(errorMsg)) {
        recreateWorker()
      }
    }
  }
  return worker
}

const files = new Map()
let selectedFileId = null

const { texts, errors, inputFormats, maxSize, maxFiles } = window.APP_CONFIG

const fileInput = document.getElementById('fileInput')
const filesContainer = document.getElementById('filesContainer')
const filesScroll = document.getElementById('filesScroll')
const clearBtn = document.getElementById('clearBtn')
const prevBtn = document.getElementById('prevBtn')
const nextBtn = document.getElementById('nextBtn')
const dropMessage = document.getElementById('dropMessage')
const settingsPanel = document.getElementById('settingsPanel')
const settingsFileName = document.getElementById('settingsFileName')
const settingsLoader = document.getElementById('settingsLoader')
const exifPanel = document.getElementById('exifPanel')
const exifTableBody = document.getElementById('exifTableBody')
const exifSearch = document.getElementById('exifSearch')
const noResults = document.getElementById('noResults')
const noResultsQuery = document.getElementById('noResultsQuery')
const noExifData = document.getElementById('noExifData')
const exifStatus = document.getElementById('exifStatus')
const removeExifBtn = document.getElementById('removeExifBtn')
const removeAllBtn = document.getElementById('removeAllBtn')
const downloadAllBtn = document.getElementById('downloadAllBtn')
const longSection = document.querySelector('.long')
const fileCardTemplate = document.getElementById('fileCardTemplate')

const shimmeredElements = new Set()

function shimmerHint(element) {
  if (element) window.SharedUtils.shimmerHint(element, shimmeredElements)
}

function generateId() {
  return Math.random().toString(36).substring(2, 15)
}

function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase()
}

function isValidFormat(filename) {
  const ext = getFileExtension(filename)
  return inputFormats.includes(ext)
}

function createFileCard(id, file) {
  const clone = fileCardTemplate.content.cloneNode(true)
  const li = clone.querySelector('.file')
  li.dataset.id = id
  li.classList.add('file_can-setting') // Clickable immediately
  li.querySelector('.file__title').textContent = file.name
  return clone
}

function setFileState(id, state) {
  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (!fileEl) return

  const states = fileEl.querySelectorAll('.file__state')
  states.forEach(s => s.classList.remove('file__state_visible'))

  const targetState = fileEl.querySelector(`.file__state_${state}`)
  if (targetState) {
    targetState.classList.add('file__state_visible')
  }
}

function setFileTagCount(id, count, originalCount = null) {
  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (!fileEl) return

  const tagsText = fileEl.querySelector('.file__state_ready .file__state-text_tags')
  if (tagsText) {
    if (originalCount !== null && originalCount !== count) {
      tagsText.innerHTML = `${count} (${originalCount})<br><span class="file__tags-label">${texts.tags}</span>`
    } else {
      tagsText.innerHTML = `${count}<br><span class="file__tags-label">${texts.tags}</span>`
    }
  }

  setFileState(id, 'ready')
}

function setFileHasDownload(id, hasDownload) {
  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (!fileEl) return
  fileEl.classList.toggle('file_has-download', hasDownload)
}

function setFileThumbnail(id, url) {
  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (!fileEl) return

  const img = fileEl.querySelector('.file__image')
  if (img && url) {
    img.src = url
    img.onload = () => img.classList.remove('file__image_hidden')
    img.onerror = () => {
      const fileData = files.get(id)
      if (fileData) {
        fileData.isCorrupt = true
        fileData.tags = []
      }
      setFileState(id, 'error')
      const detail = fileEl.querySelector('.file__state-detail')
      if (detail) detail.textContent = errors.corrupt || ''
      updateBottomButtons()
    }
  }
}

function selectFile(id) {
  if (selectedFileId) {
    const prevEl = filesContainer.querySelector(`[data-id="${selectedFileId}"]`)
    if (prevEl) prevEl.classList.remove('file_active')
  }

  selectedFileId = id
  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (fileEl) fileEl.classList.add('file_active')

  const fileData = files.get(id)
  if (!fileData) return

  settingsPanel.classList.add('settings_visible')
  longSection.style.display = 'none'
  settingsFileName.textContent = fileData.file.name

  displayExifData(fileData)
}

function displayExifData(fileData) {
  exifSearch.value = ''
  exifTableBody.innerHTML = ''
  noResults.style.display = 'none'
  exifStatus.textContent = ''

  // Still loading metadata
  if (fileData.tags === null) {
    exifPanel.style.display = 'none'
    noExifData.style.display = ''
    noExifData.classList.remove('exif-panel__empty_success')
    noExifData.innerHTML = `<p>${texts.reading}...</p>`
    removeExifBtn.disabled = true
    return
  }

  const tags = fileData.tags
  const removedCount = fileData.removedCount || 0
  const remainingCount = tags.length

  if (tags.length === 0 && removedCount === 0) {
    exifPanel.style.display = 'none'
    noExifData.style.display = ''
    noExifData.classList.remove('exif-panel__empty_success')
    noExifData.innerHTML = `<p>${texts.noData}</p>`
    removeExifBtn.disabled = true
    return
  }

  if (tags.length === 0 && removedCount > 0) {
    exifPanel.style.display = 'none'
    noExifData.style.display = ''
    noExifData.classList.add('exif-panel__empty_success')
    noExifData.innerHTML = `<p>${removedCount} ${texts.removed}</p>`
    removeExifBtn.disabled = true
    return
  }

  exifPanel.style.display = ''
  noExifData.style.display = 'none'

  if (fileData.wasRemovalAttempted) {
    if (remainingCount > 0) {
      exifStatus.textContent = `${removedCount} ${texts.statusRemoved}, ${remainingCount} ${texts.statusRemaining}`
    } else {
      exifStatus.textContent = `${removedCount} ${texts.statusRemoved}`
    }
    removeExifBtn.disabled = true
  } else {
    // Disable during bulk processing
    removeExifBtn.disabled = isProcessingQueue
  }

  for (const { name, value } of tags) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="exif-panel__td exif-panel__td_tag">${escapeHtml(name)}</td>
      <td class="exif-panel__td exif-panel__td_value">${escapeHtml(value)}</td>
    `
    exifTableBody.appendChild(tr)
  }
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function filterExifTable(query) {
  const rows = exifTableBody.querySelectorAll('tr')
  let visibleCount = 0
  const q = query.toLowerCase()

  rows.forEach(row => {
    const tag = row.cells[0].textContent.toLowerCase()
    const value = row.cells[1].textContent.toLowerCase()
    const match = !q || tag.includes(q) || value.includes(q)
    row.style.display = match ? '' : 'none'
    if (match) visibleCount++
  })

  if (q && visibleCount === 0) {
    noResults.style.display = ''
    noResultsQuery.textContent = query
  } else {
    noResults.style.display = 'none'
  }
}

function removeFile(id) {
  const fileData = files.get(id)
  if (fileData?.thumbnailUrl) {
    URL.revokeObjectURL(fileData.thumbnailUrl)
  }
  if (fileData?.cleanedUrl) {
    URL.revokeObjectURL(fileData.cleanedUrl)
  }

  files.delete(id)

  const fileEl = filesContainer.querySelector(`[data-id="${id}"]`)
  if (fileEl) fileEl.remove()

  if (selectedFileId === id) {
    selectedFileId = null
    const firstFile = files.keys().next().value
    if (firstFile) {
      selectFile(firstFile)
    } else {
      settingsPanel.classList.remove('settings_visible')
      longSection.style.display = ''
    }
  }

  updateUI()
}

function clearAllFiles() {
  const ids = Array.from(files.keys())
  for (const id of ids) {
    removeFile(id)
  }
}

function updateUI() {
  clearBtn.disabled = files.size === 0
  dropMessage.classList.toggle('drop-caption_hidden', files.size > 0)
  updateScrollButtons()
  updateBottomButtons()
}

function updateBottomButtons() {
  let removeCount = 0
  let downloadCount = 0
  let stillReading = false

  for (const [, fileData] of files) {
    // Check if any file is still being read
    if (fileData.tags === null) {
      stillReading = true
    }
    // Files with tags that haven't been cleaned yet
    if (fileData.tags && fileData.tags.length > 0 && !fileData.cleanedBlob) {
      removeCount++
    }
    // Files that have been cleaned but not yet downloaded
    if (fileData.cleanedBlob && !fileData.wasDownloaded) {
      downloadCount++
    }
  }

  // Remove button - show count of files that still need EXIF removal
  removeAllBtn.disabled = isProcessingQueue || stillReading || removeCount === 0
  const removeCounter = document.getElementById('removeAllCounter')
  if (removeCount > 0) {
    removeCounter.textContent = removeCount
    removeCounter.style.display = ''
    // Shimmer when button becomes active
    if (!removeAllBtn.disabled) {
      setTimeout(() => shimmerHint(removeAllBtn), 500)
    }
  } else {
    removeCounter.style.display = 'none'
  }

  // Download button - disabled during EXIF removal or download
  downloadAllBtn.disabled = isProcessingQueue || isDownloading || stillReading || downloadCount === 0
  const downloadCounter = document.getElementById('downloadAllCounter')
  if (downloadCount > 0) {
    downloadCounter.textContent = downloadCount
    downloadCounter.style.display = ''
  } else {
    downloadCounter.style.display = 'none'
  }
}

function updateScrollButtons() {
  const { scrollLeft, scrollWidth, clientWidth } = filesScroll
  prevBtn.disabled = scrollLeft <= 0
  nextBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 1
}

function scrollFiles(direction) {
  const scrollAmount = 200
  const amount = direction * scrollAmount
  const maxScroll = filesScroll.scrollWidth - filesScroll.clientWidth

  // Snap to start
  if (amount < 0 && filesScroll.scrollLeft < Math.abs(amount)) {
    filesScroll.scrollTo({ left: 0, behavior: 'smooth' })
    return
  }

  // Snap to end
  if (amount > 0 && filesScroll.scrollLeft + amount > maxScroll - 10) {
    filesScroll.scrollTo({ left: maxScroll, behavior: 'smooth' })
    return
  }

  filesScroll.scrollBy({ left: amount, behavior: 'smooth' })
}

async function processFiles(fileList) {
  const newFiles = Array.from(fileList).slice(0, maxFiles - files.size)
  let firstNewId = null

  for (const file of newFiles) {
    let ext = getFileExtension(file.name)

    const realFormat = await detectFormat(file)
    if (realFormat && inputFormats.includes(realFormat)) {
      ext = realFormat
    }

    if (!inputFormats.includes(ext)) {
      continue
    }

    if (file.size > maxSize) continue

    const id = generateId()
    if (!firstNewId) firstNewId = id

    const card = createFileCard(id, file)
    filesContainer.appendChild(card)

    const baseName = file.name.replace(/\.[^.]+$/, '')

    files.set(id, {
      id,
      file,
      realFormat: ext,
      downloadName: baseName + '.' + ext,
      tags: null,
      originalTagCount: 0,
      removedCount: 0,
      thumbnailUrl: null,
      cleanedBlob: null
    })

    createThumbnail(id, file, ext)
    readExifData(id, file)
  }

  if (!selectedFileId && firstNewId) {
    selectFile(firstNewId)
  }

  updateUI()
}

function createThumbnail(id, file, ext) {
  if (!ext) ext = getFileExtension(file.name)

  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    const url = URL.createObjectURL(file)
    const fileData = files.get(id)
    if (fileData) {
      fileData.thumbnailUrl = url
      setFileThumbnail(id, url)
    }
  } else if (['mp4', 'mov'].includes(ext)) {
    createVideoThumbnail(id, file)
  } else if (['heic', 'heif'].includes(ext)) {
    createHeicThumbnail(id, file)
  } else if (ext === 'pdf') {
    createPdfThumbnail(id, file)
  } else if (['tif', 'tiff'].includes(ext)) {
    createTiffThumbnail(id, file)
  } else if (ext === 'avif') {
    createImageThumbnail(id, file)
  }
}

async function createImageThumbnail(id, file) {
  try {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const maxSize = 400
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob(blob => {
        URL.revokeObjectURL(url)
        if (blob) {
          const thumbUrl = URL.createObjectURL(blob)
          const fileData = files.get(id)
          if (fileData) {
            fileData.thumbnailUrl = thumbUrl
            setFileThumbnail(id, thumbUrl)
          }
        }
      }, 'image/jpeg', 0.85)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
    }

    img.src = url
  } catch (e) {
    console.warn('Image thumbnail error:', e.message)
  }
}

let utifLib = null

async function loadUtif() {
  if (utifLib) return utifLib
  await loadScript('/shared/js/utif.js')
  utifLib = window.UTIF
  return utifLib
}

async function createTiffThumbnail(id, file) {
  try {
    const UTIF = await loadUtif()
    const arrayBuffer = await file.arrayBuffer()
    const ifds = UTIF.decode(arrayBuffer)
    if (!ifds || ifds.length === 0) return

    UTIF.decodeImage(arrayBuffer, ifds[0])
    const rgba = UTIF.toRGBA8(ifds[0])

    const w = ifds[0].width
    const h = ifds[0].height

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(w, h)
    imageData.data.set(rgba)
    ctx.putImageData(imageData, 0, 0)

    const maxSize = 400
    const scale = Math.min(maxSize / w, maxSize / h, 1)
    const tw = Math.round(w * scale)
    const th = Math.round(h * scale)

    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = tw
    thumbCanvas.height = th
    const thumbCtx = thumbCanvas.getContext('2d')
    thumbCtx.drawImage(canvas, 0, 0, tw, th)

    thumbCanvas.toBlob(blob => {
      if (blob) {
        const thumbUrl = URL.createObjectURL(blob)
        const fileData = files.get(id)
        if (fileData) {
          fileData.thumbnailUrl = thumbUrl
          setFileThumbnail(id, thumbUrl)
        }
      }
    }, 'image/jpeg', 0.85)
  } catch (e) {
    console.warn('TIFF thumbnail error:', e.message)
  }
}

let heicLib = null

async function loadHeic() {
  if (heicLib) return heicLib
  await loadScript('/shared/js/heic-to.js')
  heicLib = window.HeicTo
  return heicLib
}

async function createHeicThumbnail(id, file) {
  try {
    const HeicTo = await loadHeic()
    const jpegBlob = await HeicTo({
      blob: file,
      type: 'image/jpeg',
      quality: 0.5
    })

    const url = URL.createObjectURL(jpegBlob)
    const fileData = files.get(id)
    if (fileData) {
      fileData.thumbnailUrl = url
      setFileThumbnail(id, url)
    }
  } catch (e) {
    console.warn('HEIC thumbnail error:', e.message)
  }
}

let pdfjsLib = null

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib

  pdfjsLib = await loadModuleCdn('/js/pdf.min.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = useCdn
    ? `${R2_BASE}/js/pdf.worker.min.mjs`
    : `/js/pdf.worker.min.mjs?v=${window.APP_CONFIG.v}`
  return pdfjsLib
}

async function createPdfThumbnail(id, file) {
  try {
    const pdfjs = await loadPdfJs()
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)

    const viewport = page.getViewport({ scale: 1 })
    const scale = 200 / Math.max(viewport.width, viewport.height)
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height
    const ctx = canvas.getContext('2d')

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise

    canvas.toBlob(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob)
        const fileData = files.get(id)
        if (fileData) {
          fileData.thumbnailUrl = url
          setFileThumbnail(id, url)
        }
      }
    }, 'image/jpeg', 0.8)
  } catch (e) {
    console.warn('PDF thumbnail error:', e.message)
  }
}

function createVideoThumbnail(id, file) {
  const video = document.createElement('video')
  const url = URL.createObjectURL(file)
  video.src = url
  video.muted = true
  video.preload = 'metadata'

  video.onloadeddata = () => {
    video.currentTime = 0.1
  }

  video.onseeked = () => {
    const maxSize = 400
    const scale = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight)
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    ctx.drawImage(video, 0, 0, w, h)

    canvas.toBlob(blob => {
      URL.revokeObjectURL(url)
      if (blob) {
        const thumbUrl = URL.createObjectURL(blob)
        const fileData = files.get(id)
        if (fileData) {
          fileData.thumbnailUrl = thumbUrl
          setFileThumbnail(id, thumbUrl)
        }
      }
    }, 'image/jpeg', 0.8)
  }

  video.onerror = () => {
    URL.revokeObjectURL(url)
  }
}

function readExifData(id, file) {
  const fileData = files.get(id)
  const filename = (fileData && fileData.downloadName) || file.name
  file.arrayBuffer().then(buffer => {
    getWorker().postMessage({
      type: 'read',
      id,
      buffer,
      filename
    }, [buffer])
  }).catch(() => {
    setFileState(id, 'error')
  })
}

function removeExif(id) {
  const fileData = files.get(id)
  if (!fileData) return

  removeExifBtn.disabled = true
  removeExifBtn.querySelector('.button__text').textContent = texts.removing
  settingsLoader.classList.remove('loader_hidden')

  const ext = fileData.realFormat || getFileExtension(fileData.file.name)

  // PDF: use pdf-lib (ExifTool WASM can't write to PDF)
  if (ext === 'pdf') {
    removePdfMetadata(id, fileData)
    return
  }

  const filename = fileData.downloadName || fileData.file.name
  fileData.file.arrayBuffer().then(buffer => {
    getWorker().postMessage({ type: 'remove', id, buffer, filename, isBatch: false }, [buffer])
  }).catch(() => {
    removeExifBtn.disabled = false
    removeExifBtn.querySelector('.button__text').textContent = texts.removeBtn
    settingsLoader.classList.add('loader_hidden')
  })
}

let pdfLib = null

async function loadPdfLib() {
  if (pdfLib) return pdfLib
  const module = await loadModule('/shared/js/pdf-lib.min.js')
  pdfLib = module
  return pdfLib
}

// Pending PDF cleanups waiting for verification
const pendingPdfCleanups = new Map()

async function removePdfMetadata(id, fileData) {
  try {
    const { PDFDocument } = await loadPdfLib()
    const arrayBuffer = await fileData.file.arrayBuffer()
    const pdfDoc = await PDFDocument.load(arrayBuffer)

    // Delete ALL keys from Info dictionary
    const infoRef = pdfDoc.context.trailerInfo.Info
    if (infoRef) {
      const infoDict = pdfDoc.context.lookup(infoRef)
      if (infoDict && infoDict.dict) {
        const allKeys = Array.from(infoDict.dict.keys())
        for (const key of allKeys) {
          infoDict.dict.delete(key)
        }
      }
    }

    // Remove XMP metadata
    const catalog = pdfDoc.catalog
    if (catalog.get(pdfDoc.context.obj('/Metadata'))) {
      catalog.delete(pdfDoc.context.obj('/Metadata'))
    }

    const cleanedBytes = await pdfDoc.save()

    // Store cleaned bytes and send to worker for verification
    pendingPdfCleanups.set(id, { cleanedBytes, isBatch: false })
    const buffer = cleanedBytes.buffer.slice(cleanedBytes.byteOffset, cleanedBytes.byteOffset + cleanedBytes.byteLength)
    getWorker().postMessage({ type: 'verify', id, buffer, filename: fileData.downloadName || fileData.file.name, isBatch: false }, [buffer])
  } catch (e) {
    console.error('PDF metadata removal error:', e)
    reportError(e, { op: 'pdf-metadata-remove' })
    removeExifBtn.disabled = false
    removeExifBtn.querySelector('.button__text').textContent = texts.removeBtn
    settingsLoader.classList.add('loader_hidden')
  }
}

function downloadFile(id) {
  const fileData = files.get(id)
  if (!fileData || !fileData.cleanedBlob) return

  fileData.cleanedBlob.arrayBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileData.downloadName || fileData.file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)

    // Mark as downloaded and hide download button
    fileData.wasDownloaded = true
    setFileHasDownload(id, false)
    updateBottomButtons()
  })
}

function handleWorkerMessage(e) {
  const { type, id, tags, error, blob, remainingTags } = e.data

  if (type === 'read-result') {
    const fileData = files.get(id)
    if (fileData) {
      if (fileData.isCorrupt) return
      fileData.tags = tags
      fileData.originalTagCount = tags.length
      setFileTagCount(id, tags.length)

      // Files with no metadata - make original available for download
      if (tags.length === 0) {
        fileData.cleanedBlob = fileData.file
        setFileHasDownload(id, true)
      }

      if (selectedFileId === id) {
        displayExifData(fileData)
      }

      updateBottomButtons()
    }
  } else if (type === 'read-error') {
    console.error('Read error:', error)
    reportError(error, { op: 'exif-read' })
    const fileData = files.get(id)
    if (fileData) fileData.tags = []
    setFileState(id, 'error')
    const errEl = filesContainer.querySelector(`[data-id="${id}"] .file__state-detail`)
    if (errEl) errEl.textContent = errors.corrupt || ''
    updateBottomButtons()
    if (isWasmCrashError(error)) {
      recreateWorker()
    }
  } else if (type === 'remove-result') {
    const fileData = files.get(id)
    if (fileData) {
      fileData.removedCount = fileData.originalTagCount - remainingTags.length
      fileData.cleanedBlob = blob
      fileData.tags = remainingTags
      fileData.wasRemovalAttempted = true
      setFileTagCount(id, remainingTags.length, fileData.originalTagCount)
      setFileHasDownload(id, true)

      if (selectedFileId === id) {
        displayExifData(fileData)
      }

      if (e.data.isBatch) {
        processNextInQueue()
      } else {
        removeExifBtn.querySelector('.button__text').textContent = texts.removeBtn
        settingsLoader.classList.add('loader_hidden')
      }

      updateBottomButtons()
    }
  } else if (type === 'remove-error') {
    console.error('Remove error:', error)
    reportError(error, { op: 'exif-remove' })
    if (isWasmCrashError(error)) {
      recreateWorker()
    }
    if (e.data.isBatch) {
      processNextInQueue()
    } else {
      removeExifBtn.disabled = false
      removeExifBtn.querySelector('.button__text').textContent = texts.removeBtn
      settingsLoader.classList.add('loader_hidden')
    }
  } else if (type === 'verify-result') {
    // PDF verification complete
    const pending = pendingPdfCleanups.get(id)
    if (pending) {
      pendingPdfCleanups.delete(id)
      const fileData = files.get(id)
      if (fileData) {
        const blob = new Blob([pending.cleanedBytes], { type: 'application/octet-stream' })
        fileData.removedCount = fileData.originalTagCount - remainingTags.length
        fileData.cleanedBlob = blob
        fileData.tags = remainingTags
        fileData.wasRemovalAttempted = true
        setFileTagCount(id, remainingTags.length, fileData.originalTagCount)
        setFileHasDownload(id, true)

        if (selectedFileId === id) {
          displayExifData(fileData)
        }

        updateBottomButtons()
      }

      if (pending.isBatch) {
        processNextInQueue()
      } else {
        removeExifBtn.querySelector('.button__text').textContent = texts.removeBtn
        settingsLoader.classList.add('loader_hidden')
      }
    }
  }
}

fileInput.addEventListener('change', (e) => {
  processFiles(e.target.files)
  e.target.value = ''
})

filesContainer.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.file__close')
  if (closeBtn) {
    const fileEl = closeBtn.closest('.file')
    if (fileEl) removeFile(fileEl.dataset.id)
    return
  }

  const downloadBtn = e.target.closest('.file__download')
  if (downloadBtn) {
    const fileEl = downloadBtn.closest('.file')
    if (fileEl) downloadFile(fileEl.dataset.id)
    return
  }

  const fileEl = e.target.closest('.file')
  if (fileEl && fileEl.classList.contains('file_can-setting')) {
    selectFile(fileEl.dataset.id)
  }
})

clearBtn.addEventListener('click', clearAllFiles)
prevBtn.addEventListener('click', () => scrollFiles(-1))
nextBtn.addEventListener('click', () => scrollFiles(1))
filesScroll.addEventListener('scroll', updateScrollButtons)

exifSearch.addEventListener('input', (e) => {
  filterExifTable(e.target.value)
})

document.getElementById('exifSearchClear').addEventListener('click', () => {
  exifSearch.value = ''
  filterExifTable('')
  exifSearch.focus()
})

removeExifBtn.addEventListener('click', () => {
  if (selectedFileId) removeExif(selectedFileId)
})

removeAllBtn.addEventListener('click', () => {
  removeAllTags()
})

downloadAllBtn.addEventListener('click', () => {
  downloadAllFiles()
})

let processingQueue = []
let isProcessingQueue = false
let isDownloading = false

function removeAllTags() {
  if (isProcessingQueue) return

  processingQueue = []
  for (const [id, fileData] of files) {
    // Only process files that have tags and haven't been cleaned
    if (fileData.tags && fileData.tags.length > 0 && !fileData.cleanedBlob) {
      processingQueue.push(id)
    }
  }

  if (processingQueue.length > 0) {
    isProcessingQueue = true
    removeAllBtn.disabled = true
    downloadAllBtn.disabled = true
    removeExifBtn.disabled = true
    processNextInQueue()
  }
}

function downloadAllFiles() {
  if (isDownloading) return

  const toDownload = []
  for (const [id, fileData] of files) {
    if (fileData.cleanedBlob && !fileData.wasDownloaded) {
      toDownload.push(id)
    }
  }

  if (toDownload.length === 0) return

  isDownloading = true
  downloadAllBtn.disabled = true

  let completed = 0
  const total = toDownload.length

  toDownload.forEach((id, index) => {
    setTimeout(() => {
      downloadFile(id)
      completed++
      if (completed >= total) {
        isDownloading = false
        updateBottomButtons()
      }
    }, index * 100)
  })
}

function processNextInQueue() {
  if (processingQueue.length === 0) {
    isProcessingQueue = false
    updateBottomButtons()
    // Re-enable Remove button for currently selected file if applicable
    if (selectedFileId) {
      const fileData = files.get(selectedFileId)
      if (fileData) displayExifData(fileData)
    }
    return
  }

  const id = processingQueue.shift()
  const fileData = files.get(id)
  if (!fileData) {
    processNextInQueue()
    return
  }

  const ext = fileData.realFormat || getFileExtension(fileData.file.name)

  // PDF: use pdf-lib (ExifTool WASM can't write to PDF)
  if (ext === 'pdf') {
    removePdfMetadataAndContinue(id, fileData)
    return
  }

  const filename = fileData.downloadName || fileData.file.name
  fileData.file.arrayBuffer().then(buffer => {
    getWorker().postMessage({ type: 'remove', id, buffer, filename, isBatch: true }, [buffer])
  }).catch(() => {
    processNextInQueue()
  })
}

async function removePdfMetadataAndContinue(id, fileData) {
  try {
    const { PDFDocument } = await loadPdfLib()
    const arrayBuffer = await fileData.file.arrayBuffer()
    const pdfDoc = await PDFDocument.load(arrayBuffer)

    // Delete ALL keys from Info dictionary
    const infoRef = pdfDoc.context.trailerInfo.Info
    if (infoRef) {
      const infoDict = pdfDoc.context.lookup(infoRef)
      if (infoDict && infoDict.dict) {
        const allKeys = Array.from(infoDict.dict.keys())
        for (const key of allKeys) {
          infoDict.dict.delete(key)
        }
      }
    }

    // Remove XMP metadata
    const catalog = pdfDoc.catalog
    if (catalog.get(pdfDoc.context.obj('/Metadata'))) {
      catalog.delete(pdfDoc.context.obj('/Metadata'))
    }

    const cleanedBytes = await pdfDoc.save()

    // Store cleaned bytes and send to worker for verification
    pendingPdfCleanups.set(id, { cleanedBytes, isBatch: true })
    const buffer = cleanedBytes.buffer.slice(cleanedBytes.byteOffset, cleanedBytes.byteOffset + cleanedBytes.byteLength)
    getWorker().postMessage({ type: 'verify', id, buffer, filename: fileData.downloadName || fileData.file.name, isBatch: true }, [buffer])
  } catch (e) {
    console.error('PDF metadata removal error:', e)
    processNextInQueue()
  }
}

let dragCounter = 0

document.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragCounter++
  dropMessage.classList.remove('drop-caption_hidden')
})

document.addEventListener('dragleave', (e) => {
  e.preventDefault()
  dragCounter--
  if (dragCounter === 0 && files.size > 0) {
    dropMessage.classList.add('drop-caption_hidden')
  }
})

document.addEventListener('dragover', (e) => {
  e.preventDefault()
})

document.addEventListener('drop', (e) => {
  e.preventDefault()
  dragCounter = 0
  if (files.size > 0) {
    dropMessage.classList.add('drop-caption_hidden')
  }
  if (e.dataTransfer.files.length) {
    processFiles(e.dataTransfer.files)
  }
})

document.addEventListener('paste', (e) => {
  if (e.clipboardData.files.length) {
    processFiles(e.clipboardData.files)
  }
})