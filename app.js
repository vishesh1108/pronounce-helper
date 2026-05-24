/**
 * Pronounce Helper - Application Logic
 * Integrates Tesseract.js OCR, Web Speech API TTS, and lookup APIs (dictionary & translation)
 */

// Register Service Worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[Service Worker] Registered successfully:', reg.scope))
      .catch((err) => console.error('[Service Worker] Registration failed:', err));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // --- STATE & CACHE INITIALIZATION ---
  function getSafeArray(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return [];
      const parsed = JSON.parse(item);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn(`Failed to parse localStorage key "${key}"`, e);
      return [];
    }
  }

  function getSafeObject(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return {};
      const parsed = JSON.parse(item);
      return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
      console.warn(`Failed to parse localStorage key "${key}"`, e);
      return {};
    }
  }

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
    history: getSafeArray("ph_history"),
    bookmarks: getSafeArray("ph_bookmarks"),
    wordTaps: getSafeObject("ph_word_taps"),
    practiceSentences: getSafeObject("ph_word_sentences"),
    theme: localStorage.getItem("ph_theme") || "light",
    activeSidebarType: null,    // 'history' or 'bookmarks'
    isScanning: false
  };

  // API Caching: Local cache synced with localStorage
  const apiCache = getSafeObject("ph_api_cache");

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
    btnPractice: document.getElementById("btn-practice"),
    btnPracticeBack: document.getElementById("btn-practice-back"),
    
    // Screens
    screenWelcome: document.getElementById("screen-welcome"),
    screenScan: document.getElementById("screen-scan"),
    screenOnboarding: document.getElementById("screen-onboarding"),
    screenPractice: document.getElementById("screen-practice"),
    formOnboarding: document.getElementById("form-onboarding"),
    inputUsername: document.getElementById("input-username"),
    headerUserGreeting: document.getElementById("header-user-greeting"),
    
    // Install Modal
    installModal: document.getElementById("install-modal"),
    installBgOverlay: document.getElementById("install-bg-overlay"),
    btnInstallApp: document.getElementById("btn-install-app"),
    iosInstallGuide: document.getElementById("ios-install-guide"),
    btnCloseInstall: document.getElementById("btn-close-install"),
    
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
    
    // Practice Screen Dynamic bindings
    practiceEmptyState: document.getElementById("practice-empty-state"),
    practiceWordsList: document.getElementById("practice-words-list"),
    
    // Toast
    toastContainer: document.getElementById("toast-container")
  };

  // --- INITIALIZATION ---
  initTheme();
  importApiKeyFromUrl();
  setupEventListeners();
  initWorker(); // Pre-warm OCR worker in the background
  initOnboarding(); // Handle personalized onboarding

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
    
    // Capture PWA installation prompts
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('install') && !isRunningStandalone()) {
        showInstallPrompt();
      }
    });

    if (el.btnInstallApp) {
      el.btnInstallApp.addEventListener("click", handleInstallAppClick);
    }
    if (el.btnCloseInstall) {
      el.btnCloseInstall.addEventListener("click", () => el.installModal.classList.add("hidden"));
    }
    if (el.installBgOverlay) {
      el.installBgOverlay.addEventListener("click", () => el.installModal.classList.add("hidden"));
    }
    
    // Onboarding Form Submit
    if (el.formOnboarding) {
      el.formOnboarding.addEventListener("submit", handleOnboardingSubmit);
    }
    
    // Welcome / Inputs
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
      // Restore active processed image and overlays
      if (state.processedImageSrc) {
        el.sourceImage.src = state.processedImageSrc;
        // Reset sliders UI to actual state
        el.sliderContrast.value = state.filters.contrast;
        el.valContrast.innerText = `${state.filters.contrast}%`;
        el.sliderBrightness.value = state.filters.brightness;
        el.valBrightness.innerText = `${state.filters.brightness}%`;
        el.chkGrayscale.checked = state.filters.grayscale;
        el.sliderRotation.value = state.rotation;
        el.valRotation.innerText = `${state.rotation}°`;
        
        if (state.ocrWords.length > 0) {
          drawWordOverlays(state.ocrWords);
        }
      }
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
    el.btnPractice.addEventListener("click", () => switchScreen("practice"));
    el.btnPracticeBack.addEventListener("click", () => {
      if (state.originalImage) {
        switchScreen("scan");
      } else {
        switchScreen("welcome");
      }
    });
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

        // Generate resized images for OCR and live previews (upgraded to 2000px for high-accuracy text rendering)
        state.ocrSourceImage = await resizeImage(img, 2000);
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
    
    // Clear old overlays
    el.wordOverlayContainer.innerHTML = "";
    
    // Wait for the img to load in DOM before triggering OCR and calculating sizes
    el.sourceImage.onload = function() {
      // 3. Trigger Tesseract OCR
      executeOCR(processedDataUrl);
      // Remove onload handler to avoid infinite loops
      el.sourceImage.onload = null;
    };

    // 2. Set src of sourceImage
    el.sourceImage.src = processedDataUrl;
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
      ctx.filter = `contrast(${filters.contrast}%) brightness(${filters.brightness}%) ${filters.grayscale ? 'grayscale(100%)' : 'grayscale(0%)'} url(#svg-sharpen)`;
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
      "Welcome to the English Helper application.",
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
      
      // Set OCR optimization parameters to improve accuracy
      await tesseractWorker.setParameters({
        tessedit_enable_bigram_correction: '1',
        language_model_penalty_non_dict_word: '0.3',
        language_model_penalty_non_freq_dict_word: '0.2',
        tessedit_char_blacklist: '`|~[]{}'
      });
      
      console.log("OCR Engine warmed up and configured in background.");
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
      // Disable workspace actions while scanning
      el.btnRotateLeft.disabled = true;
      el.btnRotateRight.disabled = true;
      el.btnAdjustImage.disabled = true;
      el.btnUploadNew.disabled = true;
    } else {
      el.ocrLoadingPanel.classList.add("hidden");
      el.scannerLine.classList.add("hidden");
      // Re-enable actions after scanning completes
      el.btnRotateLeft.disabled = false;
      el.btnRotateRight.disabled = false;
      el.btnAdjustImage.disabled = false;
      el.btnUploadNew.disabled = false;
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

    // Track word taps for practice tab
    const lowerWord = cleanWord.toLowerCase();
    state.wordTaps[lowerWord] = (state.wordTaps[lowerWord] || 0) + 1;
    localStorage.setItem("ph_word_taps", JSON.stringify(state.wordTaps));

    if (state.wordTaps[lowerWord] === 2) {
      showToast(`"${cleanWord}" added to Practice!`);
    }

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

    // Small delay to allow the engine to cancel the previous utterance cleanly
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 50);
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
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    el.screenWelcome.classList.remove("active");
    el.screenScan.classList.remove("active");
    el.screenPractice.classList.remove("active");
    if (el.screenOnboarding) el.screenOnboarding.classList.remove("active");
    
    if (screenId === "welcome") {
      el.screenWelcome.classList.add("active");
    } else if (screenId === "scan") {
      el.screenScan.classList.add("active");
    } else if (screenId === "onboarding") {
      if (el.screenOnboarding) el.screenOnboarding.classList.add("active");
    } else if (screenId === "practice") {
      el.screenPractice.classList.add("active");
      renderPracticeScreen();
    }
  }

  // --- PERSONALIZATION & ONBOARDING ---
  function initOnboarding() {
    state.username = localStorage.getItem("ph_username") || "";
    
    // Check if user clicked a deep install link
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('install') && !isRunningStandalone()) {
      showInstallPrompt();
    }

    if (!state.username) {
      el.headerUserGreeting.innerText = "Welcome! 👋";
      switchScreen("onboarding");
    } else {
      updateGreetingHeader();
      switchScreen("welcome");
    }
  }

  function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || 
           window.navigator.standalone || 
           document.referrer.includes('android-app://');
  }

  function showInstallPrompt() {
    if (!el.installModal) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    el.installModal.classList.remove("hidden");
    if (isIOS) {
      el.btnInstallApp.classList.add("hidden");
      el.iosInstallGuide.classList.remove("hidden");
    } else {
      el.btnInstallApp.classList.remove("hidden");
      el.iosInstallGuide.classList.add("hidden");
    }
  }

  async function handleInstallAppClick() {
    if (!state.deferredPrompt) {
      showToast("Installation is ready in your browser's menu.");
      return;
    }
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    console.log(`[PWA] Install decision: ${outcome}`);
    state.deferredPrompt = null;
    el.installModal.classList.add("hidden");
  }

  function updateGreetingHeader() {
    if (state.username) {
      el.headerUserGreeting.innerText = `Hello, ${state.username}! 👋`;
    } else {
      el.headerUserGreeting.innerText = "Welcome! 👋";
    }
  }

  function handleOnboardingSubmit(e) {
    e.preventDefault();
    const enteredName = el.inputUsername.value.trim();
    if (!enteredName) return;

    state.username = enteredName;
    localStorage.setItem("ph_username", enteredName);
    
    updateGreetingHeader();
    triggerCelebration();

    // Fade out / exit animation
    const onboardingCard = el.screenOnboarding.querySelector(".onboarding-card");
    onboardingCard.classList.add("screen-exit");

    setTimeout(() => {
      switchScreen("welcome");
      onboardingCard.classList.remove("screen-exit");
      showToast(`Welcome, ${state.username}!`);
    }, 600);
  }

  function triggerCelebration() {
    const canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    const parent = document.querySelector(".app-container") || document.body;
    parent.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    
    function resizeCanvas() {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    resizeCanvas();

    const colors = ["#4f46e5", "#d97706", "#34d399", "#ef4444", "#f472b6", "#38bdf8"];
    const particles = [];
    const particleCount = 120;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height * 0.55,
        radius: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 16 - 6,
        gravity: 0.35,
        drag: 0.96,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12
      });
    }

    let animationFrameId;
    const startTime = Date.now();
    const duration = 2800; // 2.8 seconds

    function animate() {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        cancelAnimationFrame(animationFrameId);
        canvas.remove();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.vx *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.radius, -p.radius / 2, p.radius * 2, p.radius);
        ctx.restore();
      });

      animationFrameId = requestAnimationFrame(animate);
    }

    animate();
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

  function importApiKeyFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const queryKey = urlParams.get('key');
    if (queryKey) {
      localStorage.setItem('ph_gemini_api_key', queryKey);
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
      setTimeout(() => showToast('AI API Key configured successfully!'), 800);
    }
  }

  // --- PRACTICE MODE DYNAMIC GENERATION & SPEECH RECOGNITION ---
  const BACKEND_URL = "https://pronounce-helper-ginfxvceg-vishesh-chokhanis-projects.vercel.app"; // Set to your live vercel backend URL

  async function getPracticeSentences(word) {
    const lowerWord = word.toLowerCase();
    // Return from cache if we already generated sentences for this word
    if (state.practiceSentences[lowerWord] && state.practiceSentences[lowerWord].length === 5) {
      return state.practiceSentences[lowerWord];
    }

    // Try fetching from the cloud backend
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

      const response = await fetch(`${BACKEND_URL}/api/sentences?word=${encodeURIComponent(word)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.sentences && data.sentences.length === 5) {
          console.log(`[Practice Mode] Sentences successfully loaded from live AI API for: "${word}"`);
          state.practiceSentences[lowerWord] = data.sentences;
          localStorage.setItem("ph_word_sentences", JSON.stringify(state.practiceSentences));
          return data.sentences;
        }
      }
    } catch (err) {
      console.warn(`Backend generation failed or timed out for "${word}". Using local template engine fallback.`, err.message);
    }

    // Fallback: Use local offline sentence generator
    const fallbackSentences = generateLocalSentences(word);
    state.practiceSentences[lowerWord] = fallbackSentences;
    localStorage.setItem("ph_word_sentences", JSON.stringify(state.practiceSentences));
    return fallbackSentences;
  }

  function generateLocalSentences(word) {
    const lower = word.toLowerCase();
    
    // High-quality pre-baked overrides for common demo words (extremely simple)
    const overrides = {
      technology: [
        "We use technology at school.",
        "He likes this new technology.",
        "Is technology good or bad?",
        "She studies technology today.",
        "This is a simple technology."
      ],
      student: [
        "The student reads a book.",
        "He is a good student.",
        "I see a student there.",
        "The student writes on paper.",
        "We help the student learn."
      ],
      unbelievable: [
        "The view is unbelievable.",
        "She has an unbelievable dog.",
        "That story is unbelievable.",
        "He did an unbelievable job.",
        "It was an unbelievable day."
      ],
      pronunciation: [
        "I practice my pronunciation.",
        "His pronunciation is very clear.",
        "We hear the pronunciation.",
        "This is a hard pronunciation.",
        "She helps me with pronunciation."
      ]
    };

    if (overrides[lower]) return overrides[lower];

    // Smart contextual sentence templates for arbitrary words (extremely simple words)
    const templates = [
      "The {word} is on the desk.",
      "Can you show me the {word}?",
      "He likes to {word} a lot.",
      "Please try to {word} this.",
      "We will check the {word} today.",
      "{word} is very easy to learn.",
      "I want to {word} right now.",
      "She wants this {word} today.",
      "They speak about {word} now.",
      "Let us practice {word} together."
    ];

    // Shuffle and pick 5 templates
    const shuffled = [...templates].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5).map(t => t.replace(/{word}/g, word));
  }

  function renderPracticeScreen() {
    const listContainer = el.practiceWordsList;
    listContainer.innerHTML = "";

    // Load words tapped > 1 time, sorted by increasing difficulty (tap count)
    const practiceWords = Object.keys(state.wordTaps)
      .filter(w => state.wordTaps[w] > 1)
      .sort((a, b) => state.wordTaps[a] - state.wordTaps[b]);

    if (practiceWords.length === 0) {
      el.practiceEmptyState.classList.remove("hidden");
      return;
    }

    el.practiceEmptyState.classList.add("hidden");

    practiceWords.forEach(word => {
      const card = document.createElement("div");
      card.className = "practice-card";
      card.dataset.word = word;

      const taps = state.wordTaps[word];

      card.innerHTML = `
        <div class="practice-card-header">
          <div class="word-info">
            <h3>${word}</h3>
            <span class="tap-badge">Tapped ${taps} times</span>
          </div>
          <div class="action-buttons">
            <button class="speak-word-btn" title="Pronounce Word">
              <i class="fa-solid fa-volume-high"></i>
            </button>
            <button class="toggle-sentences-btn" title="Show Sentences">
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
        </div>
        <div class="practice-sentences-panel hidden">
          <div class="sentences-loading" style="padding: 12px; font-size: 0.85rem; color: var(--text-secondary);">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Loading practice sentences...
          </div>
        </div>
      `;

      const header = card.querySelector(".practice-card-header");
      const toggleBtn = card.querySelector(".toggle-sentences-btn");
      const panel = card.querySelector(".practice-sentences-panel");
      const speakBtn = card.querySelector(".speak-word-btn");

      const collapsePanel = () => {
        panel.classList.add("hidden");
        toggleBtn.classList.remove("expanded");
        panel.querySelectorAll(".sentence-item").forEach(item => {
          if (item._vocalWidget) {
            item._vocalWidget.destroy();
            item._vocalWidget = null;
          }
          const widgetContainer = item.querySelector(".vocal-widget-container");
          if (widgetContainer) {
            widgetContainer.classList.add("hidden");
            widgetContainer.innerHTML = "";
          }
        });
      };

      // Header click expands panels
      header.addEventListener("click", async (e) => {
        if (e.target.closest("button")) return; // skip if clicking buttons
        
        const isHidden = panel.classList.contains("hidden");
        if (isHidden) {
          panel.classList.remove("hidden");
          toggleBtn.classList.add("expanded");
          await populateSentences(word, panel);
        } else {
          collapsePanel();
        }
      });

      toggleBtn.addEventListener("click", async () => {
        const isHidden = panel.classList.contains("hidden");
        if (isHidden) {
          panel.classList.remove("hidden");
          toggleBtn.classList.add("expanded");
          await populateSentences(word, panel);
        } else {
          collapsePanel();
        }
      });

      speakBtn.addEventListener("click", () => speakWord(word));
      listContainer.appendChild(card);
    });
  }

  async function populateSentences(word, panelEl) {
    if (panelEl.querySelector(".sentence-item")) return; // already loaded

    const sentences = await getPracticeSentences(word);
    panelEl.innerHTML = "";

    sentences.forEach((sentence, idx) => {
      const item = document.createElement("div");
      item.className = "sentence-item";
      item.dataset.index = idx;

      // Highlight target word in sentence
      const regex = new RegExp(`\\b(${word})\\b`, "gi");
      const highlighted = sentence.replace(regex, "<strong>$1</strong>");

      item.innerHTML = `
        <p class="sentence-text">${highlighted}</p>
        <div class="sentence-row-layout">
          <div class="sentence-feedback hidden"></div>
          <div class="sentence-actions">
            <button class="record-speech-btn" title="Practice Speaking">
              <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="vocal-guide-btn hidden" title="Vocal Guide (Listen)">
              <i class="fa-solid fa-volume-high"></i>
            </button>
          </div>
        </div>
        <div class="vocal-widget-container hidden"></div>
      `;

      const recordBtn = item.querySelector(".record-speech-btn");
      const vocalBtn = item.querySelector(".vocal-guide-btn");
      const feedbackEl = item.querySelector(".sentence-feedback");
      const widgetContainer = item.querySelector(".vocal-widget-container");
      let vocalWidgetInstance = null;

      recordBtn.addEventListener("click", () => {
        // Stop and close vocal widget if open
        if (vocalWidgetInstance) {
          vocalWidgetInstance.destroy();
          vocalWidgetInstance = null;
          item._vocalWidget = null;
          widgetContainer.classList.add("hidden");
        }
        startSpeechRecognition(sentence, recordBtn, feedbackEl, vocalBtn, word);
      });

      vocalBtn.addEventListener("click", () => {
        const isHidden = widgetContainer.classList.contains("hidden");
        if (isHidden) {
          widgetContainer.classList.remove("hidden");
          vocalWidgetInstance = createVocalWidget(sentence, widgetContainer);
          item._vocalWidget = vocalWidgetInstance;
        } else {
          if (vocalWidgetInstance) {
            vocalWidgetInstance.destroy();
            vocalWidgetInstance = null;
            item._vocalWidget = null;
          }
          widgetContainer.classList.add("hidden");
        }
      });

      panelEl.appendChild(item);
    });
  }

  let speechRecognition = null;
  let activeRecognitionBtn = null;

  function startSpeechRecognition(targetSentence, buttonEl, feedbackEl, guideBtnEl, targetWord) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    if (speechRecognition) {
      speechRecognition.stop();
      if (activeRecognitionBtn === buttonEl) {
        return; // toggle off
      }
    }

    activeRecognitionBtn = buttonEl;
    buttonEl.className = "record-speech-btn recording";
    buttonEl.innerHTML = '<i class="fa-solid fa-microphone-lines"></i>';
    buttonEl.setAttribute("title", "Listening...");

    feedbackEl.classList.add("hidden");
    feedbackEl.innerHTML = "";

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'en-US';
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;

    speechRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript;
      console.log("Spoken sentence:", spokenText);

      const isCorrect = verifySpeech(targetSentence, spokenText, targetWord);

      if (isCorrect) {
        buttonEl.className = "record-speech-btn success";
        buttonEl.innerHTML = '<i class="fa-solid fa-check"></i>';
        buttonEl.setAttribute("title", "Pronounced Correctly!");

        const successMsgs = [
          "Muah! You nailed it! 💋",
          "Perfect pronunciation! 😘",
          "Awesome! Mwah! 💋",
          "Spot on! Beautiful! 💋"
        ];
        const msg = successMsgs[Math.floor(Math.random() * successMsgs.length)];
        feedbackEl.className = "sentence-feedback success";
        feedbackEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${msg}</span>`;
        feedbackEl.classList.remove("hidden");
        guideBtnEl.classList.add("hidden");
      } else {
        // Change button to a retry icon (circular arrow) as requested
        buttonEl.className = "record-speech-btn failed";
        buttonEl.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        buttonEl.setAttribute("title", "Retry Speaking");

        const retryMsgs = [
          "Retry! You got this! 💪",
          "Almost! Keep trying! 📣",
          "Don't give up! Try again! 🚀",
          "So close! Give it another go! 🌟"
        ];
        const msg = retryMsgs[Math.floor(Math.random() * retryMsgs.length)];
        feedbackEl.className = "sentence-feedback failed";
        feedbackEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${msg}</span>`;
        feedbackEl.classList.remove("hidden");
        guideBtnEl.classList.remove("hidden"); // reveal listen speaker
      }
    };

    speechRecognition.onerror = (e) => {
      console.error("Speech recognition error:", e);
      buttonEl.className = "record-speech-btn";
      buttonEl.innerHTML = '<i class="fa-solid fa-microphone"></i>';
      buttonEl.setAttribute("title", "Practice Speaking");
      if (e.error !== 'aborted') {
        showToast(`Speech recognition error: ${e.error}`);
      }
    };

    speechRecognition.onend = () => {
      speechRecognition = null;
      activeRecognitionBtn = null;
      if (buttonEl.className === "record-speech-btn recording") {
        buttonEl.className = "record-speech-btn";
        buttonEl.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        buttonEl.setAttribute("title", "Practice Speaking");
      }
    };

    speechRecognition.start();
  }

  function verifySpeech(target, spoken, targetWord) {
    const spokenLower = spoken.toLowerCase();
    const cleanTargetWord = targetWord.toLowerCase().replace(/[^\w\s]/g, "");

    const tWords = target.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
    const sWords = spokenLower.replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);

    if (tWords.length === 0) return false;

    // 1. Force check: The target practice word MUST be present in the spoken transcription!
    const hasTargetWord = sWords.some(w => {
      return w === cleanTargetWord || 
             w === cleanTargetWord + 's' || 
             (cleanTargetWord.endsWith('s') && w === cleanTargetWord.slice(0, -1)) ||
             (cleanTargetWord.length >= 4 && (w.startsWith(cleanTargetWord) || cleanTargetWord.startsWith(w)));
    });

    if (!hasTargetWord) {
      console.log(`Speech verification failed: Spoken text did not contain target word "${targetWord}".`);
      return false;
    }

    // 2. Sequence check for surrounding simple words
    let matchCount = 0;
    let sIdx = 0;

    for (let i = 0; i < tWords.length; i++) {
      const foundIdx = sWords.indexOf(tWords[i], sIdx);
      if (foundIdx !== -1) {
        matchCount++;
        sIdx = foundIdx + 1; // enforce chronological word order
      }
    }

    const ratio = matchCount / tWords.length;
    return ratio >= 0.85; // Slightly stricter 85% word match threshold
  }

  // --- DYNAMIC INTERACTIVE SENTENCE READER WITH REAL-TIME SPEECH SYNTHESIS WORD HIGHLIGHTING ---
  function createVocalWidget(sentence, containerEl) {
    containerEl.innerHTML = `
      <div class="vocal-widget-controls">
        <button class="vocal-play-btn" title="Play Guide"><i class="fa-solid fa-play"></i></button>
        <div class="vocal-speed-chips">
          <button class="vocal-speed-chip" data-speed="0.6">Very Slow</button>
          <button class="vocal-speed-chip active" data-speed="0.8">Slow</button>
          <button class="vocal-speed-chip" data-speed="1.0">Normal</button>
        </div>
      </div>
      <div class="vocal-sentence-display"></div>
    `;

    const playBtn = containerEl.querySelector(".vocal-play-btn");
    const speedChips = containerEl.querySelectorAll(".vocal-speed-chip");
    const displayEl = containerEl.querySelector(".vocal-sentence-display");

    // Track word spans with start and end character indexes in target text
    const words = [];
    let currentIndex = 0;
    sentence.split(/(\s+)/).forEach(part => {
      if (part.trim().length > 0) {
        words.push({
          text: part,
          start: currentIndex,
          end: currentIndex + part.length
        });
      }
      currentIndex += part.length;
    });

    // Render words wrapped in spans
    displayEl.innerHTML = "";
    const wordSpans = words.map(w => {
      const span = document.createElement("span");
      span.className = "vocal-word-span";
      span.innerText = w.text;
      displayEl.appendChild(span);
      // Append space
      const space = document.createTextNode(" ");
      displayEl.appendChild(space);
      return span;
    });

    let utterance = null;
    let isSpeaking = false;
    let currentSpeed = 0.8;
    let checkBoundaryTimeout = null;
    let fallbackInterval = null;
    let speakTimeout = null;

    speedChips.forEach(chip => {
      chip.addEventListener("click", () => {
        speedChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        currentSpeed = parseFloat(chip.dataset.speed);
        
        if (isSpeaking) {
          stopSpeech();
          // Small delay before restarting speech to let cancel settle
          speakTimeout = setTimeout(() => {
            startSpeech();
          }, 150);
        }
      });
    });

    function startSpeech() {
      if (!window.speechSynthesis) return;

      // Cancel any active speech synthesis and clear pending timeouts
      if (speakTimeout) clearTimeout(speakTimeout);
      if (checkBoundaryTimeout) clearTimeout(checkBoundaryTimeout);
      if (fallbackInterval) clearTimeout(fallbackInterval);
      window.speechSynthesis.cancel();

      utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = "en-US";
      utterance.rate = currentSpeed;

      const voices = window.speechSynthesis.getVoices();
      // Prioritize local English voices to ensure onboundary fires reliably
      const engVoice = voices.find(v => v.localService && v.lang.startsWith("en-IN")) ||
                       voices.find(v => v.localService && v.lang.startsWith("en-US")) ||
                       voices.find(v => v.localService && v.lang.startsWith("en")) ||
                       voices.find(v => v.lang.startsWith("en-IN")) ||
                       voices.find(v => v.lang.startsWith("en-US")) ||
                       voices.find(v => v.lang.startsWith("en"));
      if (engVoice) utterance.voice = engVoice;

      // Save a global reference to prevent aggressive garbage collection on Chrome
      window.activeUtterance = utterance;

      let hasFiredBoundary = false;

      utterance.onboundary = (event) => {
        if (event.name === "word") {
          hasFiredBoundary = true;
          
          // Clear fallback timer if it was running since native boundaries are now working
          if (fallbackInterval) {
            clearTimeout(fallbackInterval);
            fallbackInterval = null;
          }

          const charIndex = event.charIndex;
          
          // Find the word with the largest start index <= charIndex
          let activeIdx = -1;
          for (let i = 0; i < words.length; i++) {
            if (charIndex >= words[i].start) {
              activeIdx = i;
            } else {
              break;
            }
          }
          
          wordSpans.forEach(s => s.classList.remove("highlight-active"));
          if (activeIdx !== -1 && wordSpans[activeIdx]) {
            wordSpans[activeIdx].classList.add("highlight-active");
          }
        }
      };

      utterance.onstart = () => {
        // Start fallback highlighting immediately if native boundaries haven't already fired
        if (!hasFiredBoundary && isSpeaking) {
          startFallbackHighlighting();
        }
      };

      utterance.onend = () => {
        stopSpeech();
      };

      utterance.onerror = (e) => {
        console.error("SpeechSynthesis error:", e);
        stopSpeech();
      };

      isSpeaking = true;
      playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
      
      // Delay speak to allow cancel to settle
      speakTimeout = setTimeout(() => {
        window.speechSynthesis.speak(utterance);
      }, 150);
    }

    function startFallbackHighlighting() {
      if (fallbackInterval) clearTimeout(fallbackInterval);
      
      let wordIdx = 0;
      
      function highlightNext() {
        if (wordIdx >= words.length || !isSpeaking) {
          if (fallbackInterval) clearTimeout(fallbackInterval);
          fallbackInterval = null;
          return;
        }
        
        wordSpans.forEach(s => s.classList.remove("highlight-active"));
        if (wordSpans[wordIdx]) {
          wordSpans[wordIdx].classList.add("highlight-active");
        }
        
        // Estimate word duration with baseline pause (60ms per char + 80ms baseline)
        const wordText = words[wordIdx].text;
        const wordCharCount = wordText.replace(/[^\w]/g, "").length || 1;
        const wordDuration = (wordCharCount * 60 + 80) / currentSpeed;
        
        wordIdx++;
        fallbackInterval = setTimeout(highlightNext, wordDuration);
      }
      
      highlightNext();
    }

    function stopSpeech() {
      if (speakTimeout) clearTimeout(speakTimeout);
      speakTimeout = null;

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      isSpeaking = false;
      playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
      
      // Clear all timers
      if (checkBoundaryTimeout) clearTimeout(checkBoundaryTimeout);
      if (fallbackInterval) clearTimeout(fallbackInterval);
      checkBoundaryTimeout = null;
      fallbackInterval = null;

      wordSpans.forEach(s => s.classList.remove("highlight-active"));
    }

    playBtn.addEventListener("click", () => {
      if (isSpeaking) {
        stopSpeech();
      } else {
        startSpeech();
      }
    });

    return {
      destroy: () => stopSpeech()
    };
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
