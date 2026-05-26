const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Manual CORS middleware configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow the origin if it matches any of these patterns:
  // - Any localhost/127.0.0.1 port (for development)
  // - Any Vercel preview deployment URL for this project
  // - The GitHub Pages deployment
  const isAllowed = origin && (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/pronounce-helper.*\.vercel\.app$/.test(origin) ||
    origin === 'https://vishesh1108.github.io'
  );
  
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST, PUT, DELETE, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gemini-api-key, x-groq-api-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(express.json());

// Serve static frontend files from the parent directory
app.use(express.static(path.join(__dirname, '../')));

// Rate Limiter: Prevent API key abuse by limiting IPs to 60 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each IP to 60 requests per window
  message: { error: 'Too many requests. Please try again in 15 minutes.' }
});

// Apply rate limiter to the sentence generation API
app.use('/api/', apiLimiter);

// Main endpoint to generate sentences
app.get('/api/sentences', async (req, res) => {
  const word = req.query.word;
  if (!word) {
    return res.status(400).json({ error: 'Word parameter is required' });
  }

  const cleanWord = word.trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
  if (!cleanWord) {
    return res.status(400).json({ error: 'Invalid word format' });
  }

  console.log(`Generating sentences for word: "${cleanWord}"...`);

  // Prompt configuration
  const prompt = `Generate exactly 5 distinct, practical, and natural English sentences using the word "${cleanWord}".
Each sentence must integrate the word naturally in a different scenario (casual conversation, business/work, academic/study, shopping/travel, technology).
Ensure all other words in the sentences (except the word "${cleanWord}") are extremely simple, beginner-friendly, and very easy to spell and pronounce so the student can focus entirely on "${cleanWord}".
Vary the position of the target word "${cleanWord}" across the 5 sentences (e.g., place it at the beginning of some sentences, in the middle of others, or at the end). Do not always place it at the end of the sentences so it does not look monotonous.
Return ONLY a valid JSON array of strings containing the 5 sentences. Do not include markdown code blocks, do not write "here is the json", and do not include extra explanations.
Example output format:
["Sentence 1 with word", "Sentence 2 with word", "Sentence 3 with word", "Sentence 4 with word", "Sentence 5 with word"]`;

  const errors = [];

  try {
    let sentences = null;

    // Support client-passed API keys from request headers as overrides
    const clientGroqKey = req.headers['x-groq-api-key'];
    const clientGeminiKey = req.headers['x-gemini-api-key'];

    const rawGroqKey = clientGroqKey || process.env.GROQ_API_KEY || process.env.GROK_API_KEY || '';
    const rawGeminiKey = clientGeminiKey || process.env.GEMINI_API_KEY || '';

    // Clean keys defensively: strip out spaces, newlines, and carriage returns
    const groqApiKey = rawGroqKey.trim().replace(/[\r\n\s]+/g, "");
    const geminiApiKey = rawGeminiKey.trim().replace(/[\r\n\s]+/g, "");

    // 1. Try Groq or xAI (Grok) if configured
    if (groqApiKey) {
      try {
        if (groqApiKey.startsWith('xai-') || groqApiKey.startsWith('xAI-')) {
          console.log('Using xAI (Grok) API...');
          
          const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
              messages: [{ role: 'user', content: prompt }],
              model: 'grok-3-mini',
              temperature: 0.5,
              stream: false
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`xAI Error status ${response.status}: ${errText}`);
          }

          const data = await response.json();
          const responseText = data.choices[0]?.message?.content || '';
          sentences = parseJsonArray(responseText);
          if (!sentences || sentences.length < 5) {
            throw new Error('Failed to parse 5 sentences from xAI (Grok) response.');
          }
        } else {
          console.log('Using Groq API...');
          const Groq = require('groq-sdk');
          const groq = new Groq({ apiKey: groqApiKey });
          
          const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.1-8b-instant', // fast, cheap, high-quality open-source model
            temperature: 0.5,
            max_tokens: 300,
          });

          const responseText = completion.choices[0]?.message?.content || '';
          sentences = parseJsonArray(responseText);
          if (!sentences || sentences.length < 5) {
            throw new Error('Failed to parse 5 sentences from Groq response.');
          }
        }
      } catch (groqError) {
        console.warn('Groq/xAI API call failed:', groqError.message);
        errors.push(`Groq/xAI Failed: ${groqError.message}`);
      }
    } else {
      errors.push('Groq/xAI skipped: No GROQ_API_KEY or GROK_API_KEY configured');
    }

    // 2. Try Gemini if configured (and Groq was not used or failed)
    if (!sentences && geminiApiKey) {
      try {
        console.log('Using Gemini API...');
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });

        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            temperature: 0.5,
            maxOutputTokens: 300,
          },
        });

        const responseText = result.text;
        console.log('Gemini raw response:', responseText);
        sentences = parseJsonArray(responseText);
        if (!sentences || sentences.length < 5) {
          throw new Error('Failed to parse 5 sentences from Gemini response.');
        }
      } catch (geminiError) {
        console.warn('Gemini API call failed:', geminiError.message);
        errors.push(`Gemini Failed: ${geminiError.message}`);
      }
    } else if (!sentences) {
      errors.push('Gemini skipped: No GEMINI_API_KEY configured');
    }

    // 3. Neither key is configured or both failed
    if (!sentences) {
      throw new Error(`All configured AI providers failed. Details: [${errors.join(' | ')}]`);
    }

    console.log('Successfully generated sentences!');
    res.json({ word: cleanWord, sentences });

  } catch (error) {
    console.error('Sentence generation error:', error.message);
    res.status(500).json({ 
      error: `Failed to generate sentences: ${error.message}`, 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Root endpoint to prevent "Cannot GET /" errors on Vercel deployment
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Pronounce Helper Backend API is running successfully.',
    frontendUrl: 'https://vishesh1108.github.io/pronounce-helper/',
    endpoints: {
      healthCheck: '/health',
      sentenceGeneration: '/api/sentences?word=welcome'
    }
  });
});

// Robust JSON array parsing helper
function parseJsonArray(text) {
  try {
    let clean = text.trim();
    // Strip markdown JSON wrappers if present
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5);
    }
  } catch (e) {
    console.warn('JSON parse failed, attempting regex extraction...', e.message);
  }

  // Regex fallback: extract anything inside double quotes
  const sentences = [];
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const s = match[1].trim();
    if (s.length > 10) { // filter out short fragments
      sentences.push(s);
    }
  }
  if (sentences.length >= 5) {
    return sentences.slice(0, 5);
  }
  return null;
}

// For local development (only listen if run directly)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pronounce Helper Backend listening on port ${PORT}`);
  });
}

module.exports = app;
