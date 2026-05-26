/**
 * Pronounce Helper - Document Scanner & Perspective Warper Module
 * Provides fully automatic corner detection, manual draggable 4-corner adjustment UI,
 * perspective flattening (homography), and auto-deskewing.
 */

window.ScannerWarper = (() => {
  
  // 1. SOLVE HOMOGRAPHY MATRIX (Gaussian Elimination)
  function solveHomography(src, dst) {
    // Maps Target Rect [dst] back to Source Quad [src] for backward pixel mapping
    const A = [];
    const B = [];

    for (let i = 0; i < 4; i++) {
      const sx = src[i].x;
      const sy = src[i].y;
      const dx = dst[i].x;
      const dy = dst[i].y;

      // Equation for X: a*dx + b*dy + c - g*dx*sx - h*dy*sx = sx
      A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
      B.push(sx);

      // Equation for Y: d*dx + e*dy + f - g*dx*sy - h*dy*sy = sy
      A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
      B.push(sy);
    }

    // Solve M * H = B using Gaussian elimination
    const n = 8;
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[j][i]) > Math.abs(A[maxRow][i])) {
          maxRow = j;
        }
      }
      const tempA = A[i]; A[i] = A[maxRow]; A[maxRow] = tempA;
      const tempB = B[i]; B[i] = B[maxRow]; B[maxRow] = tempB;

      const pivot = A[i][i];
      if (Math.abs(pivot) < 1e-10) return null; // Singular matrix

      for (let j = i; j < n; j++) A[i][j] /= pivot;
      B[i] /= pivot;

      for (let j = 0; j < n; j++) {
        if (j !== i) {
          const factor = A[j][i];
          for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
          B[j] -= factor * B[i];
        }
      }
    }
    return B; // Coefficients [a, b, c, d, e, f, g, h]
  }

  // 2. PERSPECTIVE WARP (Bilinear Interpolation)
  function warpPerspective(srcImg, corners, targetWidth, targetHeight) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = srcImg.naturalWidth || srcImg.width;
    tempCanvas.height = srcImg.naturalHeight || srcImg.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(srcImg, 0, 0);

    const srcWidth = tempCanvas.width;
    const srcHeight = tempCanvas.height;
    const srcData = tempCtx.getImageData(0, 0, srcWidth, srcHeight).data;

    const destCanvas = document.createElement("canvas");
    destCanvas.width = targetWidth;
    destCanvas.height = targetHeight;
    const destCtx = destCanvas.getContext("2d");
    const destImgData = destCtx.createImageData(targetWidth, targetHeight);
    const destData = destImgData.data;

    // Target coordinates: clockwise from top-left
    const dstCorners = [
      { x: 0, y: 0 },
      { x: targetWidth, y: 0 },
      { x: targetWidth, y: targetHeight },
      { x: 0, y: targetHeight }
    ];

    const h = solveHomography(corners, dstCorners);
    if (!h) {
      console.warn("Homography solution failed, returning default copy");
      return tempCanvas;
    }

    const [a, b, c, d, e, f, g, hh] = h;

    for (let y = 0; y < targetHeight; y++) {
      const rowOffset = y * targetWidth;
      for (let x = 0; x < targetWidth; x++) {
        const destIdx = (rowOffset + x) * 4;

        // Apply homography backward mapping
        const wVal = g * x + hh * y + 1;
        const srcX = (a * x + b * y + c) / wVal;
        const srcY = (d * x + e * y + f) / wVal;

        if (srcX < 0 || srcX >= srcWidth - 1 || srcY < 0 || srcY >= srcHeight - 1) {
          // Out of bounds: write white background
          destData[destIdx] = 255;
          destData[destIdx + 1] = 255;
          destData[destIdx + 2] = 255;
          destData[destIdx + 3] = 255;
          continue;
        }

        // Bilinear Interpolation
        const xf = Math.floor(srcX);
        const yf = Math.floor(srcY);
        const dx = srcX - xf;
        const dy = srcY - yf;

        const idx00 = (yf * srcWidth + xf) * 4;
        const idx10 = (yf * srcWidth + (xf + 1)) * 4;
        const idx01 = ((yf + 1) * srcWidth + xf) * 4;
        const idx11 = ((yf + 1) * srcWidth + (xf + 1)) * 4;

        const w00 = (1 - dx) * (1 - dy);
        const w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy;
        const w11 = dx * dy;

        destData[destIdx]     = w00 * srcData[idx00]     + w10 * srcData[idx10]     + w01 * srcData[idx01]     + w11 * srcData[idx11];
        destData[destIdx + 1] = w00 * srcData[idx00 + 1] + w10 * srcData[idx10 + 1] + w01 * srcData[idx01 + 1] + w11 * srcData[idx11 + 1];
        destData[destIdx + 2] = w00 * srcData[idx00 + 2] + w10 * srcData[idx10 + 2] + w01 * srcData[idx01 + 2] + w11 * srcData[idx11 + 2];
        destData[destIdx + 3] = 255;
      }
    }

    destCtx.putImageData(destImgData, 0, 0);
    return destCanvas;
  }

  // 3. AUTOMATIC CORNER DETECTION (Inward Edge-Scan Heuristic)
  function detectPageCorners(imgEl) {
    const workWidth = 300;
    const workHeight = 400;

    const canvas = document.createElement("canvas");
    canvas.width = workWidth;
    canvas.height = workHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgEl, 0, 0, workWidth, workHeight);

    const imgData = ctx.getImageData(0, 0, workWidth, workHeight);
    const data = imgData.data;

    // Grayscale
    const gray = new Uint8Array(workWidth * workHeight);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }

    // 2D Gradient filter (Sobel approximation)
    const grad = new Float32Array(workWidth * workHeight);
    let gradSum = 0;
    for (let y = 1; y < workHeight - 1; y++) {
      const rowOffset = y * workWidth;
      for (let x = 1; x < workWidth - 1; x++) {
        const val = rowOffset + x;
        const gx = gray[val + 1] - gray[val - 1];
        const gy = gray[val + workWidth] - gray[val - workWidth];
        const mag = Math.sqrt(gx * gx + gy * gy);
        grad[val] = mag;
        gradSum += mag;
      }
    }

    // Average gradient threshold
    const avgGrad = gradSum / (workWidth * workHeight);
    const threshold = avgGrad * 1.5;

    // Inward Search quadrants
    const midX = workWidth / 2;
    const midY = workHeight / 2;

    const corners = [
      { x: 0, y: 0 },         // Top-Left
      { x: workWidth - 1, y: 0 }, // Top-Right
      { x: workWidth - 1, y: workHeight - 1 }, // Bottom-Right
      { x: 0, y: workHeight - 1 }  // Bottom-Left
    ];

    // Find Top-Left: minimizes (x + y)
    let minTL = Infinity;
    for (let y = 5; y < midY; y++) {
      const rowOffset = y * workWidth;
      for (let x = 5; x < midX; x++) {
        if (grad[rowOffset + x] > threshold) {
          const score = x + y;
          if (score < minTL) {
            minTL = score;
            corners[0] = { x, y };
          }
        }
      }
    }

    // Find Top-Right: minimizes ((width - 1 - x) + y)
    let minTR = Infinity;
    for (let y = 5; y < midY; y++) {
      const rowOffset = y * workWidth;
      for (let x = midX; x < workWidth - 5; x++) {
        if (grad[rowOffset + x] > threshold) {
          const score = (workWidth - 1 - x) + y;
          if (score < minTR) {
            minTR = score;
            corners[1] = { x, y };
          }
        }
      }
    }

    // Find Bottom-Right: minimizes ((width - 1 - x) + (height - 1 - y))
    let minBR = Infinity;
    for (let y = midY; y < workHeight - 5; y++) {
      const rowOffset = y * workWidth;
      for (let x = midX; x < workWidth - 5; x++) {
        if (grad[rowOffset + x] > threshold) {
          const score = (workWidth - 1 - x) + (workHeight - 1 - y);
          if (score < minBR) {
            minBR = score;
            corners[2] = { x, y };
          }
        }
      }
    }

    // Find Bottom-Left: minimizes (x + (height - 1 - y))
    let minBL = Infinity;
    for (let y = midY; y < workHeight - 5; y++) {
      const rowOffset = y * workWidth;
      for (let x = 5; x < midX; x++) {
        if (grad[rowOffset + x] > threshold) {
          const score = x + (workHeight - 1 - y);
          if (score < minBL) {
            minBL = score;
            corners[3] = { x, y };
          }
        }
      }
    }

    // Validation check: if detected quad is too small (e.g. noise), fallback to 8% padding
    const naturalWidth = imgEl.naturalWidth || imgEl.width;
    const naturalHeight = imgEl.naturalHeight || imgEl.height;

    const scaleX = naturalWidth / workWidth;
    const scaleY = naturalHeight / workHeight;

    const mappedCorners = corners.map(c => ({
      x: Math.round(c.x * scaleX),
      y: Math.round(c.y * scaleY)
    }));

    // Check width and height of quadrilateral bounds
    const minPageW = naturalWidth * 0.35;
    const minPageH = naturalHeight * 0.35;
    const actualW = Math.max(mappedCorners[1].x - mappedCorners[0].x, mappedCorners[2].x - mappedCorners[3].x);
    const actualH = Math.max(mappedCorners[3].y - mappedCorners[0].y, mappedCorners[2].y - mappedCorners[1].y);

    if (actualW < minPageW || actualH < minPageH) {
      // Default: centered cropbox with 8% padding
      const padX = Math.round(naturalWidth * 0.08);
      const padY = Math.round(naturalHeight * 0.08);
      return [
        { x: padX, y: padY },
        { x: naturalWidth - padX, y: padY },
        { x: naturalWidth - padX, y: naturalHeight - padY },
        { x: padX, y: naturalHeight - padY }
      ];
    }

    return mappedCorners;
  }

  // 4. AUTO-DESKEWING (Projection Profile Variance Optimization)
  function autoDeskew(srcCanvas) {
    const workWidth = 250;
    const workHeight = 350;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = workWidth;
    tempCanvas.height = workHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(srcCanvas, 0, 0, workWidth, workHeight);

    const imgData = tempCtx.getImageData(0, 0, workWidth, workHeight);
    const data = imgData.data;

    // Convert to thresholded binary (1 for text, 0 for white background)
    const bin = new Uint8Array(workWidth * workHeight);
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      bin[i / 4] = gray < 135 ? 1 : 0;
    }

    // Coarse to fine angle search
    let bestAngle = 0;
    let maxVariance = -1;

    // Coarse scan: -10 to +10 degrees in steps of 2
    for (let a = -10; a <= 10; a += 2) {
      const variance = getProjectionVariance(bin, workWidth, workHeight, a);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = a;
      }
    }

    // Fine scan: bestCoarseAngle - 1.5 to + 1.5 degrees in steps of 0.5
    const bestCoarse = bestAngle;
    for (let a = bestCoarse - 1.5; a <= bestCoarse + 1.5; a += 0.5) {
      if (a === bestCoarse) continue;
      const variance = getProjectionVariance(bin, workWidth, workHeight, a);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = a;
      }
    }

    // Apply rotation to target canvas if angle is non-trivial
    if (Math.abs(bestAngle) < 0.2) {
      return srcCanvas; // straight enough
    }

    console.log(`Auto-Deskewing: rotating text by ${bestAngle}°`);
    const rotatedCanvas = document.createElement("canvas");
    const rCtx = rotatedCanvas.getContext("2d");

    const angleRad = (bestAngle * Math.PI) / 180;
    const cosVal = Math.abs(Math.cos(angleRad));
    const sinVal = Math.abs(Math.sin(angleRad));

    const w = srcCanvas.width;
    const h = srcCanvas.height;

    // Rotate bounds to fit full image
    const rotW = w * cosVal + h * sinVal;
    const rotH = w * sinVal + h * cosVal;

    rotatedCanvas.width = rotW;
    rotatedCanvas.height = rotH;

    // Draw rotated image on white background
    rCtx.fillStyle = "#ffffff";
    rCtx.fillRect(0, 0, rotW, rotH);
    rCtx.translate(rotW / 2, rotH / 2);
    rCtx.rotate(angleRad);
    rCtx.drawImage(srcCanvas, -w / 2, -h / 2);

    return rotatedCanvas;
  }

  function getProjectionVariance(bin, width, height, angleDegrees) {
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cosVal = Math.cos(angleRad);
    const sinVal = Math.sin(angleRad);

    const centerY = height / 2;
    const centerX = width / 2;
    const profile = new Int32Array(height);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      const dy = y - centerY;
      for (let x = 0; x < width; x++) {
        if (bin[rowOffset + x] === 1) {
          const dx = x - centerX;
          const projY = Math.round(dy * cosVal - dx * sinVal + centerY);
          if (projY >= 0 && projY < height) {
            profile[projY]++;
          }
        }
      }
    }

    // Variance calculation
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < height; i++) {
      const val = profile[i];
      sum += val;
      sumSq += val * val;
    }
    const mean = sum / height;
    return (sumSq / height) - (mean * mean);
  }

  // 5. INTERACTIVE SCANNER OVERLAY
  function initScannerUI(imgEl, onComplete) {
    // 1. Create or clear overlay element
    let overlay = document.getElementById("scanner-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "scanner-overlay";
      overlay.className = "scanner-overlay-container";
      document.body.appendChild(overlay);
    }
    overlay.classList.remove("hidden");

    overlay.innerHTML = `
      <div class="scanner-card">
        <div class="scanner-header">
          <h3><i class="fa-solid fa-expand"></i> Page Boundary Scanner</h3>
          <p>Align the corner handles to the edges of your page.</p>
        </div>
        <div class="scanner-body">
          <div class="scanner-canvas-wrap">
            <canvas id="scanner-draw-canvas"></canvas>
          </div>
        </div>
        <div class="scanner-actions">
          <button id="btn-scanner-flatten" class="primary-btn scanner-btn">
            <i class="fa-solid fa-file-invoice"></i> Flatten & Scan Page
          </button>
          <button id="btn-scanner-cancel" class="secondary-btn scanner-btn-cancel">Cancel</button>
        </div>
      </div>
    `;

    const canvas = document.getElementById("scanner-draw-canvas");
    const ctx = canvas.getContext("2d");
    
    // Auto-detect corner locations
    const originalCorners = detectPageCorners(imgEl);

    // Deep copy pins
    const pins = originalCorners.map(p => ({ ...p }));

    // Fit canvas sizing based on viewport and image aspect ratio
    const container = canvas.parentElement;
    const maxViewW = Math.min(container.clientWidth, window.innerWidth - 60);
    const maxViewH = Math.min(window.innerHeight - 300, 400);

    const naturalWidth = imgEl.naturalWidth || imgEl.width;
    const naturalHeight = imgEl.naturalHeight || imgEl.height;

    let scale = 1;
    if (naturalWidth / maxViewW > naturalHeight / maxViewH) {
      scale = maxViewW / naturalWidth;
    } else {
      scale = maxViewH / naturalHeight;
    }

    canvas.width = naturalWidth * scale;
    canvas.height = naturalHeight * scale;

    let draggedPinIndex = null;

    // Convert coordinates to scaled canvas space
    const canvasPins = pins.map(p => ({ x: p.x * scale, y: p.y * scale }));

    function draw() {
      // Clear canvas and draw source image
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);

      // Draw quad borders with premium neon glow effect
      ctx.save();
      ctx.strokeStyle = "rgba(99, 102, 241, 0.85)"; // indigo
      ctx.lineWidth = 3;
      ctx.shadowBlur = 8;
      ctx.shadowColor = "#6366f1";
      ctx.beginPath();
      ctx.moveTo(canvasPins[0].x, canvasPins[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(canvasPins[i].x, canvasPins[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Draw draggable pins as premium glassmorphic target markers
      canvasPins.forEach((pin, idx) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 14, 0, Math.PI * 2);
        
        // Semi-transparent center fill
        ctx.fillStyle = idx === draggedPinIndex ? "rgba(99, 102, 241, 0.4)" : "rgba(255, 255, 255, 0.25)";
        ctx.fill();

        // Neon outer ring
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 3;
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#6366f1";
        ctx.stroke();

        // Inner solid dot
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
      });

      // PREMIUM ENHANCEMENT: Magnifier glass during drag (shows pixel-exact details)
      if (draggedPinIndex !== null) {
        const activePin = canvasPins[draggedPinIndex];
        ctx.save();
        
        // Determine magnifier position offset to keep it visible
        const magX = activePin.x + (activePin.x < canvas.width / 2 ? 80 : -80);
        const magY = activePin.y - 80 < 30 ? activePin.y + 80 : activePin.y - 80;
        const magRadius = 45;

        // Circular clipping mask
        ctx.beginPath();
        ctx.arc(magX, magY, magRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#6366f1";
        ctx.stroke();
        ctx.clip();

        // Draw zoomed area from the source image
        // 40x40 source rect maps to magnifier (2.25x zoom)
        ctx.drawImage(
          imgEl,
          (activePin.x / scale) - 20, (activePin.y / scale) - 20, 40, 40,
          magX - magRadius, magY - magRadius, magRadius * 2, magRadius * 2
        );

        // Draw crosshair
        ctx.strokeStyle = "rgba(239, 68, 68, 0.85)"; // red crosshair
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(magX - 12, magY);
        ctx.lineTo(magX + 12, magY);
        ctx.moveTo(magX, magY - 12);
        ctx.lineTo(magX, magY + 12);
        ctx.stroke();

        ctx.restore();
      }
    }

    // DRAG EVENT HANDLERS (Mouse & Touch compatible)
    function getMousePos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function onStart(e) {
      e.preventDefault();
      const pos = getMousePos(e);
      let closestIdx = -1;
      let minDist = 30; // click radius threshold

      canvasPins.forEach((pin, idx) => {
        const dist = Math.hypot(pin.x - pos.x, pin.y - pos.y);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });

      if (closestIdx !== -1) {
        draggedPinIndex = closestIdx;
        draw();
      }
    }

    function onMove(e) {
      if (draggedPinIndex === null) return;
      e.preventDefault();
      const pos = getMousePos(e);
      
      // Keep pins within bounds
      const px = Math.max(0, Math.min(canvas.width, pos.x));
      const py = Math.max(0, Math.min(canvas.height, pos.y));
      
      canvasPins[draggedPinIndex] = { x: px, y: py };
      draw();
    }

    function onEnd() {
      if (draggedPinIndex !== null) {
        draggedPinIndex = null;
        draw();
      }
    }

    canvas.addEventListener("mousedown", onStart);
    canvas.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);

    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);

    draw();

    // ACTION TRIGGER: Flatten quadrilateral
    document.getElementById("btn-scanner-flatten").addEventListener("click", () => {
      // Clean up event listeners
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);

      // Re-map scale points back to full image dimensions
      const finalCorners = canvasPins.map(p => ({
        x: p.x / scale,
        y: p.y / scale
      }));

      // Flatten perspective: targeting standard aspect ratio (e.g. 1200x1600 page)
      const pageW = 1200;
      const pageH = 1600;
      overlay.classList.add("hidden");
      
      const flatCanvas = warpPerspective(imgEl, finalCorners, pageW, pageH);
      
      // Auto-deskew
      const deskewedCanvas = autoDeskew(flatCanvas);

      onComplete(deskewedCanvas);
    });

    document.getElementById("btn-scanner-cancel").addEventListener("click", () => {
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);
      overlay.classList.add("hidden");
    });
  }

  return {
    detectCorners: detectPageCorners,
    warpPerspective,
    autoDeskew,
    initScannerUI
  };

})();
