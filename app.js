/**
 * Pronounce Helper - Application Logic
 * Integrates Tesseract.js OCR, Web Speech API TTS, and lookup APIs (dictionary & translation)
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- STATE ---
  const state = {
    originalImage: null,        // Original Image element (pre-processed)
    ocrSourceImage: null,       // Scaled down image for OCR (max 1200px)
    previewSourceImage: null,   // Scaled down image for quick live preview (max 600px)
    processedImageSrc: null,    // Data URL of current rotated/filtered image
    rotation: 0,                // 0, 90, 180, 270
    filters: {
      contrast: 100,            // 50 to 200
      brightness: 100,          // 50 to 150
      grayscale: false
    },
    ocrWords: [],               // Words extracted from OCR
    selectedWord: null,         // Currently selected word string
    speechSpeed: 0.8,           // Speed of TTS (0.6, 0.8, 1.0)
    history: JSON.parse(localStorage.getItem("ph_history")) || [],
    bookmarks: JSON.parse(localStorage.getItem("ph_bookmarks")) || [],
    theme: localStorage.getItem("ph_theme") || "light",
    activeSidebarType: null,    // 'history' or 'bookmarks'
    isScanning: false
  };

  // API Caching: Local cache synced with localStorage
  const apiCache = JSON.parse(localStorage.getItem("ph_api_cache")) || {};

  function saveCache() {
    try {
      localStorage.setItem("ph_api_cache", JSON.stringify(apiCache));
    } catch (e) {
      console.warn("Failed to save api cache to localStorage", e);
    }
  }

  // --- DOM ELEMENTS ---
  const el = {
    body: document.body,
    btnThemeToggle: document.getElementById("btn-theme-toggle"),
    btnHistory: document.getElementById("btn-history"),
    btnBookmarks: document.getElementById("btn-bookmarks"),
    
    // Screens
    screenWelcome: document.getElementById("screen-welcome"),
    screenScan: document.getElementById("screen-scan"),
    
    // File inputs & buttons
    cameraInput: document.getElementById("camera-input"),
    fileInput: document.getElementById("file-input"),
    btnDemo: document.getElementById("btn-demo"),
    btnUploadNew: document.getElementById("btn-upload-new"),
    
    // OCR & Workspace
    ocrLoadingPanel: document.getElementById("ocr-loading-panel"),
    ocrStatusText: document.getElementById("ocr-status-text"),
    ocrProgressBar: document.getElementById("ocr-progress-bar"),
    ocrProgressPct: document.getElementById("ocr-progress-pct"),
    sourceImage: document.getElementById("source-image"),
    scannerLine: document.getElementById("scanner-line"),
    wordOverlayContainer: document.getElementById("word-overlay-container"),
    imageWrap: document.getElementById("image-wrap"),
    
    // Image Adjustment controls
    btnAdjustImage: document.getElementById("btn-adjust-image"),
    imageAdjustmentsPanel: document.getElementById("image-adjustments-panel"),
    btnCloseAdjustments: document.getElementById("btn-close-adjustments"),
    btnApplyFilters: document.getElementById("btn-apply-filters"),
    sliderRotation: document.getElementById("slider-rotation"),
    sliderContrast: document.getElementById("slider-contrast"),
    sliderBrightness: document.getElementById("slider-brightness"),
    chkGrayscale: document.getElementById("chk-grayscale"),
    valRotation: document.getElementById("val-rotation"),
    valContrast: document.getElementById("val-contrast"),
    valBrightness: document.getElementById("val-brightness"),
    btnRotateLeft: document.getElementById("btn-rotate-left"),
    btnRotateRight: document.getElementById("btn-rotate-right"),
    
    // Bottom Detail Drawer
    wordDetailDrawer: document.getElementById("word-detail-drawer"),
    drawerBgOverlay: document.getElementById("drawer-bg-overlay"),
    btnCloseDrawer: document.getElementById("btn-close-drawer"),
    detailWord: document.getElementById("detail-word"),
    btnSpeak: document.getElementById("btn-speak"),
    btnBookmarkWord: document.getElementById("btn-bookmark-word"),
    detailSyllables: document.getElementById("detail-syllables"),
    detailPhonetics: document.getElementById("detail-phonetics"),
    detailDefinition: document.getElementById("detail-definition"),
    speedChips: document.querySelectorAll(".speed-btn-chip"),
    
    // Sidebar Drawer
    sidebarDrawer: document.getElementById("sidebar-drawer"),
    sidebarBgOverlay: document.getElementById("sidebar-bg-overlay"),
    btnCloseSidebar: document.getElementById("btn-close-sidebar"),
    sidebarTitle: document.getElementById("sidebar-title"),
    sidebarEmpty: document.getElementById("sidebar-empty"),
    sidebarList: document.getElementById("sidebar-list"),
    btnClearList: document.getElementById("btn-clear-list"),
    
    // Toast
    toastContainer: document.getElementById("toast-container")
  };

  // --- INITIALIZATION ---
  initTheme();
  setupEventListeners();
  initWorker(); // Pre-warm OCR worker in the background

  // Load custom fonts and ensure they are active
  document.fonts.ready.then(() => {
    console.log("Fonts loaded.");
  });

  // --- THEME ---
  function initTheme() {
    el.body.className = `theme-${state.theme}`;
    updateThemeIcon();
  }

  function toggleTheme() {
    state.theme = state.theme === "light" ? "dark" : "light";
    localStorage.setItem("ph_theme", state.theme);
    el.body.className = `theme-${state.theme}`;
    updateThemeIcon();
    showToast(`Switched to ${state.theme} mode`);
  }

  function updateThemeIcon() {
    const icon = el.btnThemeToggle.querySelector("i");
    if (state.theme === "light") {
      icon.className = "fa-solid fa-moon";
    } else {
      icon.className = "fa-solid fa-sun";
    }
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${message}</span>`;
    el.toastContainer.appendChild(toast);
    
    // Remove toast after animation completes
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Theme toggle
    el.btnThemeToggle.addEventListener("click", toggleTheme);
    
    // Welcome / Inputs
    el.cameraInput.addEventListener("change", handleImageUpload);
    el.fileInput.addEventListener("change", handleImageUpload);
    el.btnDemo.addEventListener("click", loadDemoImage);
    el.btnUploadNew.addEventListener("click", resetToWelcome);
    
    // Rotation & Adjustment panels
    el.btnRotateLeft.addEventListener("click", () => rotateImage(-90));
    el.btnRotateRight.addEventListener("click", () => rotateImage(90));
    
    el.btnAdjustImage.addEventListener("click", () => {
      el.imageAdjustmentsPanel.classList.toggle("hidden");
    });
    el.btnCloseAdjustments.addEventListener("click", () => {
      el.imageAdjustmentsPanel.classList.add("hidden");
    });
    
    // Slider values updating
    el.sliderRotation.addEventListener("input", (e) => {
      el.valRotation.innerText = `${e.target.value}°`;
      updatePreviewOnly();
    });
    el.sliderContrast.addEventListener("input", (e) => {
      el.valContrast.innerText = `${e.target.value}%`;
      updatePreviewOnly();
    });
    el.sliderBrightness.addEventListener("input", (e) => {
      el.valBrightness.innerText = `${e.target.value}%`;
      updatePreviewOnly();
    });
    el.chkGrayscale.addEventListener("change", () => {
      updatePreviewOnly();
    });
    
    el.btnApplyFilters.addEventListener("click", () => {
      state.rotation = parseInt(el.sliderRotation.value);
      state.filters.contrast = parseInt(el.sliderContrast.value);
      state.filters.brightness = parseInt(el.sliderBrightness.value);
      state.filters.grayscale = el.chkGrayscale.checked;
      el.imageAdjustmentsPanel.classList.add("hidden");
      reprocessAndOCR();
    });

    // Word Detail Drawer controls
    el.btnCloseDrawer.addEventListener("click", closeWordDrawer);
    el.drawerBgOverlay.addEventListener("click", closeWordDrawer);
    
    el.btnSpeak.addEventListener("click", () => {
      if (state.selectedWord) speakWord(state.selectedWord);
    });
    
    el.btnBookmarkWord.addEventListener("click", toggleBookmarkWord);
    
    // Speed chips
    el.speedChips.forEach(chip => {
      chip.addEventListener("click", (e) => {
        el.speedChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        state.speechSpeed = parseFloat(chip.dataset.speed);
        if (state.selectedWord) speakWord(state.selectedWord);
      });
    });

    // History and Bookmark sidebar controls
    el.btnHistory.addEventListener("click", () => openSidebar("history"));
    el.btnBookmarks.addEventListener("click", () => openSidebar("bookmarks"));
    el.btnCloseSidebar.addEventListener("click", closeSidebar);
    el.sidebarBgOverlay.addEventListener("click", closeSidebar);
    el.btnClearList.addEventListener("click", clearSidebarList);
    
    // Responsive overlays scaling on window resize
    window.addEventListener("resize", debounce(() => {
      if (state.ocrWords.length > 0) {
        drawWordOverlays(state.ocrWords);
      }
    }, 150));

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateModalViewportPosition);
      window.visualViewport.addEventListener("scroll", updateModalViewportPosition);
    }
  }

  // --- IMAGE RESIZER UTILITY ---
  function resizeImage(imgElement, maxDim) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      
      let width = imgElement.naturalWidth || imgElement.width;
      let height = imgElement.naturalHeight || imgElement.height;
      
      if (width <= maxDim && height <= maxDim) {
        resolve(imgElement);
        return;
      }
      
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(imgElement, 0, 0, width, height);
      
      const resizedImg = new Image();
      resizedImg.onload = () => resolve(resizedImg);
      resizedImg.src = canvas.toDataURL("image/jpeg", 0.9);
    });
  }

  // --- IMAGE PROCESSING & ROTATION ---
  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    state.rotation = 0; // reset
    resetFiltersUI();

    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = async function() {
        state.originalImage = img;
        
        switchScreen("scan");
        showOCRLoading(true);
        updateOCRProgress("Optimizing image size...", 0.05);

        // Generate resized images for OCR and live previews
        state.ocrSourceImage = await resizeImage(img, 1200);
        state.previewSourceImage = await resizeImage(img, 600);

        runOCRProcessing(state.ocrSourceImage);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function resetFiltersUI() {
    state.filters = { contrast: 100, brightness: 100, grayscale: false };
    el.sliderContrast.value = 100;
    el.valContrast.innerText = "100%";
    el.sliderBrightness.value = 100;
    el.valBrightness.innerText = "100%";
    el.chkGrayscale.checked = false;
    el.sliderRotation.value = 0;
    el.valRotation.innerText = "0°";
  }

  function rotateImage(degrees) {
    if (!state.ocrSourceImage) return;
    let newRot = state.rotation + degrees;
    // Bound to -180 and 180 degrees
    if (newRot > 180) newRot -= 360;
    if (newRot <= -180) newRot += 360;
    state.rotation = newRot;
    el.sliderRotation.value = newRot;
    el.valRotation.innerText = `${newRot}°`;
    reprocessAndOCR();
  }

  function updatePreviewOnly() {
    if (!state.previewSourceImage) return;
    const tempRotation = parseInt(el.sliderRotation.value);
    const tempFilters = {
      contrast: parseInt(el.sliderContrast.value),
      brightness: parseInt(el.sliderBrightness.value),
      grayscale: el.chkGrayscale.checked
    };
    // Use previewSourceImage for fast 60fps adjustments
    const previewDataUrl = applyImageAdjustments(state.previewSourceImage, tempRotation, tempFilters);
    el.sourceImage.src = previewDataUrl;
    el.wordOverlayContainer.innerHTML = ""; // Clear overlays during preview adjust
  }

  function reprocessAndOCR() {
    if (!state.ocrSourceImage) return;
    runOCRProcessing(state.ocrSourceImage);
  }

  /**
   * Helper that draws rotation and filter values onto an offline canvas,
   * then updates the HTML img and executes OCR
   */
  function runOCRProcessing(imageEl) {
    state.isScanning = true;
    switchScreen("scan");
    showOCRLoading(true);
    
    // 1. Process image on canvas
    const processedDataUrl = applyImageAdjustments(imageEl, state.rotation, state.filters);
    state.processedImageSrc = processedDataUrl;
    
    // 2. Set src of sourceImage
    el.sourceImage.src = processedDataUrl;
    
    // Clear old overlays
    el.wordOverlayContainer.innerHTML = "";
    
    // Wait for the img to load in DOM before triggering OCR and calculating sizes
    el.sourceImage.onload = function() {
      // 3. Trigger Tesseract OCR
      executeOCR(processedDataUrl);
      // Remove onload handler to avoid infinite loops
      el.sourceImage.onload = null;
    };
  }

  function applyImageAdjustments(imageEl, rotationAngle, filters) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const angleRad = (rotationAngle * Math.PI) / 180;
    const cosVal = Math.abs(Math.cos(angleRad));
    const sinVal = Math.abs(Math.sin(angleRad));

    const originalWidth = imageEl.naturalWidth || imageEl.width;
    const originalHeight = imageEl.naturalHeight || imageEl.height;

    // Bounding dimensions calculation for arbitrary rotation (prevent cropping)
    const width = originalWidth * cosVal + originalHeight * sinVal;
    const height = originalWidth * sinVal + originalHeight * cosVal;

    canvas.width = width;
    canvas.height = height;

    // Apply transformations (rotate about center)
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angleRad);

    // Apply hardware-accelerated canvas filter if supported (GPU-bound)
    if (typeof ctx.filter === "string") {
      ctx.filter = `contrast(${filters.contrast}%) brightness(${filters.brightness}%) ${filters.grayscale ? 'grayscale(100%)' : 'grayscale(0%)'}`;
      ctx.drawImage(imageEl, -originalWidth / 2, -originalHeight / 2);
      ctx.filter = "none";
    } else {
      // Fallback: draw image, then do pixel processing (CPU-bound)
      ctx.drawImage(imageEl, -originalWidth / 2, -originalHeight / 2);
      try {
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const contrastFactor = (filters.contrast + 100) / 200; // range mapping
        const brightnessFactor = filters.brightness / 100;

        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i + 1];
          let b = data[i + 2];

          // Grayscale
          if (filters.grayscale) {
            const v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = g = b = v;
          }

          // Brightness
          r *= brightnessFactor;
          g *= brightnessFactor;
          b *= brightnessFactor;

          // Contrast
          r = ((r - 128) * contrastFactor) + 128;
          g = ((g - 128) * contrastFactor) + 128;
          b = ((b - 128) * contrastFactor) + 128;

          // Clamp
          data[i] = Math.min(255, Math.max(0, r));
          data[i + 1] = Math.min(255, Math.max(0, g));
          data[i + 2] = Math.min(255, Math.max(0, b));
        }

        ctx.putImageData(imgData, 0, 0);
      } catch (err) {
        console.error("Failed to apply pixel filters on canvas", err);
      }
    }

    return canvas.toDataURL("image/jpeg", 0.85);
  }

  // --- DEMO PAGE CREATION ---
  function loadDemoImage() {
    state.rotation = 0;
    resetFiltersUI();
    
    // Draw synthetic paper book page with text to let user test OCR instantly
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");

    // Paper background texture
    ctx.fillStyle = "#faf6eb"; // warm book paper color
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw book margins / details
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);
    
    // Title header
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 20px 'Outfit', sans-serif";
    ctx.fillText("CHAPTER 3: READING OUT LOUD", 80, 80);

    // Book lines of text
    ctx.fillStyle = "#1e293b";
    ctx.font = "30px 'Inter', Georgia, serif";
    
    const lines = [
      "Welcome to the Pronounce Helper application.",
      "This tools assists English students with reading.",
      "English reading can sometimes feel like a steep",
      "hill to climb. However, breaking down complex",
      "vocabulary into syllables makes pronunciation",
      "much easier to master.",
      "",
      "When you study phonetics, you learn to identify",
      "the sounds of languages. Helpful features in this",
      "software, like speech synthesis, make it easy to",
      "learn pronunciation and definitions of words.",
      "",
      "Try tapping on words like technology, student,",
      "unbelievable, or pronunciation to hear them now."
    ];

    let startY = 160;
    const lineHeight = 48;
    for (let line of lines) {
      if (line !== "") {
        ctx.fillText(line, 80, startY);
      }
      startY += lineHeight;
    }

    // Page number
    ctx.font = "italic 18px serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Page 45", canvas.width / 2 - 25, canvas.height - 60);

    const img = new Image();
    img.onload = async function() {
      state.originalImage = img;
      
      switchScreen("scan");
      showOCRLoading(true);
      updateOCRProgress("Loading demo page...", 0.05);

      state.ocrSourceImage = img; // 800x1000 is small enough for direct OCR
      state.previewSourceImage = await resizeImage(img, 600);
      
      runOCRProcessing(state.ocrSourceImage);
    };
    img.src = canvas.toDataURL();
  }

  // --- OCR ENGINE (TESSERACT.JS) ---
  let tesseractWorker = null;

  async function initWorker() {
    if (tesseractWorker) return;
    try {
      tesseractWorker = await Tesseract.createWorker("eng", 1, {
        logger: m => {
          if (!state.isScanning) return;
          if (m.status === "recognizing text") {
            updateOCRProgress(`Reading book page...`, m.progress);
          } else {
            updateOCRProgress(`${m.status}...`, 0.2);
          }
        }
      });
      console.log("OCR Engine warmed up in background.");
    } catch (e) {
      console.error("Failed to initialize background OCR worker", e);
    }
  }

  async function executeOCR(imageSrc) {
    try {
      if (!tesseractWorker) {
        updateOCRProgress("Initializing OCR engine...", 0.1);
        await initWorker();
      }
      
      updateOCRProgress("Analyzing structure...", 0.9);
      // Reuse the pre-warmed background worker instead of spinning one up on-demand!
      const result = await tesseractWorker.recognize(imageSrc);
      
      state.ocrWords = result.data.words.filter(w => {
        // Filter out punctuation-only strings and words with confidence < 20%
        const hasLetter = /[a-zA-Z]/.test(w.text);
        return hasLetter && w.confidence > 25;
      });

      showOCRLoading(false);
      state.isScanning = false;
      
      if (state.ocrWords.length === 0) {
        showToast("No readable English words found. Adjust contrast or rotate.");
      } else {
        showToast(`Scan complete! Found ${state.ocrWords.length} words.`);
        drawWordOverlays(state.ocrWords);
      }
    } catch (err) {
      console.error(err);
      showOCRLoading(false);
      state.isScanning = false;
      showToast("OCR Error. Please try again.");
    }
  }

  function showOCRLoading(show) {
    if (show) {
      el.ocrLoadingPanel.classList.remove("hidden");
      el.scannerLine.classList.remove("hidden");
    } else {
      el.ocrLoadingPanel.classList.add("hidden");
      el.scannerLine.classList.add("hidden");
    }
  }

  function updateOCRProgress(statusText, progressVal) {
    el.ocrStatusText.innerText = statusText;
    const pct = Math.round(progressVal * 100);
    el.ocrProgressBar.style.width = `${pct}%`;
    el.ocrProgressPct.innerText = `${pct}%`;
  }

  // --- DRAW OVERLAY NODES ---
  function drawWordOverlays(words) {
    el.wordOverlayContainer.innerHTML = "";
    
    const displayWidth = el.sourceImage.clientWidth;
    const displayHeight = el.sourceImage.clientHeight;
    const naturalWidth = el.sourceImage.naturalWidth;
    const naturalHeight = el.sourceImage.naturalHeight;

    if (!displayWidth || !displayHeight || !naturalWidth || !naturalHeight) {
      // Re-trigger layout after a brief delay if image isn't fully drawn in viewport
      setTimeout(() => drawWordOverlays(words), 100);
      return;
    }

    const scaleX = displayWidth / naturalWidth;
    const scaleY = displayHeight / naturalHeight;

    words.forEach((word, idx) => {
      const bbox = word.bbox;
      const left = bbox.x0 * scaleX;
      const top = bbox.y0 * scaleY;
      const width = (bbox.x1 - bbox.x0) * scaleX;
      const height = (bbox.y1 - bbox.y0) * scaleY;

      // Add a slight margin/padding to nodes for easier tap targets
      const padding = 2;

      const node = document.createElement("button");
      node.className = "word-node";
      node.style.left = `${left - padding}px`;
      node.style.top = `${top - padding}px`;
      node.style.width = `${width + (padding * 2)}px`;
      node.style.height = `${height + (padding * 2)}px`;
      node.dataset.index = idx;
      node.setAttribute("aria-label", `Word: ${word.text}`);

      node.addEventListener("click", () => handleWordTap(word, node));

      el.wordOverlayContainer.appendChild(node);
    });
  }

  // --- WORD SELECTION & API INTEGRATION ---
  function setLoadingSkeleton() {
    el.detailPhonetics.innerText = "Loading guide...";
    el.detailDefinition.innerText = "Loading definition from dictionary...";
    
    el.detailPhonetics.classList.add("skeleton-text");
    el.detailDefinition.classList.add("skeleton-text");
  }

  function loadWordData(cleanWord) {
    const lowerWord = cleanWord.toLowerCase();
    state.selectedWord = cleanWord;
    
    el.detailWord.innerText = cleanWord;
    
    const syllablesSplit = window.SyllableHelper.split(cleanWord);
    el.detailSyllables.innerText = syllablesSplit;

    updateBookmarkButtonUI(cleanWord);
    openWordDrawer();

    if (apiCache[lowerWord]) {
      const cached = apiCache[lowerWord];
      
      el.detailPhonetics.classList.remove("skeleton-text");
      el.detailDefinition.classList.remove("skeleton-text");

      el.detailPhonetics.innerText = cached.phonetics || "No phonetic guide";
      el.detailDefinition.innerText = cached.definition || "No definition found.";
    } else {
      setLoadingSkeleton();
      
      fetchDictionaryData(cleanWord).then(dictData => {
        apiCache[lowerWord] = {
          phonetics: dictData.phonetics,
          definition: dictData.definition
        };
        saveCache();
      }).catch(err => {
        console.warn("Failed to fetch dictionary data", err);
      });
    }
  }

  function handleWordTap(wordObj, nodeEl) {
    document.querySelectorAll(".word-node").forEach(n => n.classList.remove("active-selection"));
    nodeEl.classList.add("active-selection");

    const rawWord = wordObj.text;
    const cleanWord = rawWord.trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
    if (!cleanWord) return;

    speakWord(cleanWord);
    addToHistory(cleanWord);
    loadWordData(cleanWord);
  }


  async function fetchDictionaryData(word) {
    const result = { phonetics: "", definition: "No definition found." };
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
      if (!response.ok) throw new Error("Word not found");
      const data = await response.json();
      
      const entry = data[0];
      
      let phoneticText = "";
      if (entry.phonetic) {
        phoneticText = entry.phonetic;
      } else if (entry.phonetics && entry.phonetics.length > 0) {
        const pt = entry.phonetics.find(p => p.text);
        phoneticText = pt ? pt.text : "";
      }
      
      result.phonetics = phoneticText;

      let definition = "No definition found.";
      if (entry.meanings && entry.meanings.length > 0) {
        const meaning = entry.meanings[0];
        if (meaning.definitions && meaning.definitions.length > 0) {
          definition = meaning.definitions[0].definition;
        }
      }
      result.definition = definition;

    } catch (err) {
      console.warn("Dictionary API failed", err);
      result.phonetics = "Unavailable";
      result.definition = "Definition unavailable offline.";
    }

    if (state.selectedWord && state.selectedWord.toLowerCase() === word.toLowerCase()) {
      el.detailPhonetics.classList.remove("skeleton-text");
      el.detailDefinition.classList.remove("skeleton-text");
      el.detailPhonetics.innerText = result.phonetics || "No phonetic guide";
      el.detailDefinition.innerText = result.definition;
    }
    return result;
  }

  // Translation API removed

  // --- TEXT-TO-SPEECH (TTS) ---
  function speakWord(word) {
    if (!window.speechSynthesis) {
      showToast("Speech synthesis not supported in this browser.");
      return;
    }

    // Cancel current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-IN";
    utterance.rate = state.speechSpeed;

    // Get English Voice, prioritizing Indian English accent
    const voices = window.speechSynthesis.getVoices();
    const indianVoice = voices.find(v => v.lang === "en-IN" || v.lang === "en_IN") ||
                        voices.find(v => v.lang.startsWith("en-IN")) ||
                        voices.find(v => v.lang.startsWith("en-GB") || v.lang === "en_GB") ||
                        voices.find(v => v.lang.startsWith("en-US") || v.lang === "en_US") ||
                        voices.find(v => v.lang.startsWith("en")) || 
                        voices[0];
    
    if (indianVoice) {
      utterance.voice = indianVoice;
      utterance.lang = indianVoice.lang;
    }

    window.speechSynthesis.speak(utterance);
  }

  // Speak voice list update triggers
  if (window.speechSynthesis) {
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        // Pre-fetch voices to load caches
        window.speechSynthesis.getVoices();
      };
    }
  }

  // --- BOTTOM DRAWER CONTROLS ---
  function updateModalViewportPosition() {
    if (!window.visualViewport) return;
    const viewport = window.visualViewport;
    const drawer = el.wordDetailDrawer;
    if (!drawer || drawer.classList.contains("hidden")) return;

    drawer.style.position = "absolute";
    drawer.style.left = `${viewport.offsetLeft}px`;
    drawer.style.top = `${viewport.offsetTop}px`;
    drawer.style.width = `${viewport.width}px`;
    drawer.style.height = `${viewport.height}px`;

    const scaleWrapper = document.getElementById("drawer-scale-wrapper");
    if (scaleWrapper) {
      scaleWrapper.style.transform = `scale(${1 / viewport.scale})`;
    }
  }

  function openWordDrawer() {
    el.wordDetailDrawer.classList.remove("hidden");
    updateModalViewportPosition();
  }

  function closeWordDrawer() {
    el.wordDetailDrawer.classList.add("hidden");
    document.querySelectorAll(".word-node").forEach(n => n.classList.remove("active-selection"));
  }

  // --- HISTORY & BOOKMARKS DATA MANAGEMENT ---
  function addToHistory(word) {
    // Add to top, enforce unique elements, limit size to 50
    state.history = [word, ...state.history.filter(w => w !== word)].slice(0, 50);
    localStorage.setItem("ph_history", JSON.stringify(state.history));
  }

  function toggleBookmarkWord() {
    if (!state.selectedWord) return;
    
    const word = state.selectedWord;
    const isBookmarked = state.bookmarks.includes(word);
    
    if (isBookmarked) {
      state.bookmarks = state.bookmarks.filter(w => w !== word);
      showToast(`Removed "${word}" from Saved Words`);
    } else {
      state.bookmarks = [word, ...state.bookmarks];
      showToast(`Saved "${word}"`);
    }

    localStorage.setItem("ph_bookmarks", JSON.stringify(state.bookmarks));
    updateBookmarkButtonUI(word);
  }

  function updateBookmarkButtonUI(word) {
    const isBookmarked = state.bookmarks.includes(word);
    const icon = el.btnBookmarkWord.querySelector("i");
    if (isBookmarked) {
      icon.className = "fa-solid fa-bookmark";
      el.btnBookmarkWord.style.color = "var(--color-primary)";
    } else {
      icon.className = "fa-regular fa-bookmark";
      el.btnBookmarkWord.style.color = "";
    }
  }

  // --- SIDEBAR DRAWER ---
  function openSidebar(type) {
    state.activeSidebarType = type;
    el.sidebarTitle.innerText = type === "history" ? "Lookup History" : "Saved Words";
    el.sidebarDrawer.classList.remove("hidden");
    renderSidebarList();
  }

  function closeSidebar() {
    el.sidebarDrawer.classList.add("hidden");
  }

  function renderSidebarList() {
    el.sidebarList.innerHTML = "";
    const list = state.activeSidebarType === "history" ? state.history : state.bookmarks;
    
    if (list.length === 0) {
      el.sidebarEmpty.classList.remove("hidden");
      el.btnClearList.classList.add("hidden");
      return;
    }

    el.sidebarEmpty.classList.add("hidden");
    el.btnClearList.classList.remove("hidden");

    list.forEach(word => {
      const item = document.createElement("li");
      item.className = "word-list-item";
      
      const textSpan = document.createElement("span");
      textSpan.className = "word-txt";
      textSpan.innerText = word;
      
      const divActions = document.createElement("div");
      divActions.className = "actions";

      // TTS Play button
      const playBtn = document.createElement("button");
      playBtn.className = "play-item-btn";
      playBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakWord(word);
      });

      // Delete Button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-item-btn";
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSidebarItem(word);
      });

      divActions.appendChild(playBtn);
      divActions.appendChild(deleteBtn);

      item.appendChild(textSpan);
      item.appendChild(divActions);

      // Tap on row opens details
      item.addEventListener("click", () => {
        closeSidebar();
        speakWord(word);
        loadWordData(word);
      });

      el.sidebarList.appendChild(item);
    });
  }

  function deleteSidebarItem(word) {
    if (state.activeSidebarType === "history") {
      state.history = state.history.filter(w => w !== word);
      localStorage.setItem("ph_history", JSON.stringify(state.history));
    } else {
      state.bookmarks = state.bookmarks.filter(w => w !== word);
      localStorage.setItem("ph_bookmarks", JSON.stringify(state.bookmarks));
    }
    renderSidebarList();
    showToast(`Removed "${word}"`);
  }

  function clearSidebarList() {
    const listName = state.activeSidebarType === "history" ? "History" : "Saved Words";
    if (confirm(`Are you sure you want to clear your entire ${listName}?`)) {
      if (state.activeSidebarType === "history") {
        state.history = [];
        localStorage.setItem("ph_history", "[]");
      } else {
        state.bookmarks = [];
        localStorage.setItem("ph_bookmarks", "[]");
      }
      renderSidebarList();
      showToast(`Cleared ${listName}`);
    }
  }

  // --- SCREEN NAVIGATION ---
  function switchScreen(screenId) {
    el.screenWelcome.classList.remove("active");
    el.screenScan.classList.remove("active");
    
    if (screenId === "welcome") {
      el.screenWelcome.classList.add("active");
    } else {
      el.screenScan.classList.add("active");
    }
  }

  function resetToWelcome() {
    state.originalImage = null;
    state.ocrSourceImage = null;
    state.previewSourceImage = null;
    state.processedImageSrc = null;
    state.ocrWords = [];
    el.sourceImage.src = "";
    el.wordOverlayContainer.innerHTML = "";
    switchScreen("welcome");
  }

  // --- UTILS ---
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
});
