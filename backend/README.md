# Pronounce Helper Backend Deployment Guide

This backend server runs 24/7 in the cloud to generate custom, high-quality contextual sentences for the **Practice Mode** of your Pronounce Helper app using open-source models (via Groq/Llama 3 or Gemini 2.5 Flash).

Follow these simple steps to deploy this server for free in under 5 minutes:

---

## Step 1: Create a GitHub Repository for the Backend

1. Go to **[GitHub](https://github.com)** and create a new **public** or **private** repository named `pronounce-helper-backend`.
2. Do **not** initialize it with a README or `.gitignore`.
3. In a separate command prompt or terminal on your computer, navigate to this `backend` directory:
   ```bash
   cd C:\Users\chokh\Documents\antigravity\adventurous-hopper\backend
   ```
4. Run the following commands to upload (push) the backend files to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Deploy backend"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/pronounce-helper-backend.git
   git push -u origin main
   ```
   *(Be sure to replace `YOUR_GITHUB_USERNAME` with your actual GitHub username!)*

---

## Step 2: Deploy to Render (100% Free)

1. Open your browser and sign in to **[Render](https://render.com)** (you can sign in with your GitHub account).
2. From the Render Dashboard, click **New +** (top right) and select **Web Service**.
3. Select **Connect repository** and connect your newly created `pronounce-helper-backend` repository.
4. Fill in the following details:
   - **Name**: `pronounce-helper-backend`
   - **Region**: Select any region close to you
   - **Branch**: `main`
   - **Root Directory**: Leave blank (keep it empty)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Scroll down to **Environment Variables** (or click Advanced) and add your AI API key:
   - **To use Llama 3 (Groq)**:
     - Key: `GROQ_API_KEY`
     - Value: *Your Groq API Key*
   - **To use Gemini 2.5 Flash (Google)**:
     - Key: `GEMINI_API_KEY`
     - Value: *Your Gemini API Key*
   *(The server will automatically detect whichever key you choose to add!)*
6. Click **Deploy Web Service** at the bottom of the page.

---

## Step 3: Connect Frontend to Backend

1. Once Render finishes deploying, copy the live URL of your backend service (found at the top left of the Render project dashboard, e.g. `https://pronounce-helper-backend-xxxx.onrender.com`).
2. Open the frontend file **[app.js](file:///C:/Users/chokh/Documents/antigravity/adventurous-hopper/app.js)** on your computer.
3. Locate the `BACKEND_URL` constant near the top of the file:
   ```javascript
   const BACKEND_URL = "https://your-backend-url.onrender.com";
   ```
4. Replace the placeholder URL with your live Render backend URL:
   ```javascript
   const BACKEND_URL = "https://pronounce-helper-backend-xxxx.onrender.com";
   ```
5. Commit and push the frontend changes to your main GitHub repository so the live GitHub Pages app gets updated!
   ```bash
   git add app.js
   git commit -m "Link frontend to live cloud backend"
   git push
   ```

---

## Technical Details

- **Port**: Auto-binds to `process.env.PORT` (configured automatically by Render).
- **CORS**: Fully configured to allow cross-origin requests, so your GitHub Pages site (`.github.io`) can query it without issues.
- **Sleep Behavior**: Render's free tier spins down if inactive. When a student opens the practice tab after some time, it might take 30-50 seconds to boot up. The frontend contains a **built-in 3-second timeout fallback** that automatically switches to offline templates so the student never experiences any lag.
