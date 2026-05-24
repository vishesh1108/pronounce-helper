const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Hardened CORS policy: Allow only local dev server and your GitHub Pages domain
const allowedOrigins = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://vishesh1108.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl, mobile apps, or direct API tests)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.includes(origin) || 
                      origin.startsWith('https://vishesh1108.github.io');
                      
    if (!isAllowed) {
      return callback(new Error('CORS policy: Access denied for this origin.'), false);
    }
    return callback(null, true);
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'x-gemini-api-key', 'x-groq-api-key']
}));

app.use(express.json());

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

  try {
    let sentences = null;

    // Support client-passed API keys from request headers as overrides
    const clientGroqKey = req.headers['x-groq-api-key'];
    const clientGeminiKey = req.headers['x-gemini-api-key'];

    const groqApiKey = clientGroqKey || process.env.GROQ_API_KEY;
    const geminiApiKey = clientGeminiKey || process.env.GEMINI_API_KEY;

    // 1. Try Groq (Llama) if configured
    if (groqApiKey) {
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
    } 
    // 2. Try Gemini if configured (and Groq was not used)
    else if (geminiApiKey) {
      console.log('Using Gemini API...');
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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
    } 
    // 3. Neither key is configured
    else {
      console.error('No API keys configured on backend.');
      return res.status(500).json({ error: 'Server API keys not configured. Please supply a GEMINI_API_KEY or GROQ_API_KEY in the app URL or server environment.' });
    }

    if (!sentences || sentences.length < 5) {
      throw new Error('Failed to parse a valid list of 5 sentences from AI response.');
    }

    console.log('Successfully generated sentences!');
    res.json({ word: cleanWord, sentences });

  } catch (error) {
    console.error('Sentence generation error:', error.message);
    res.status(500).json({ error: 'Failed to generate sentences', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
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

app.listen(PORT, () => {
  console.log(`Pronounce Helper Backend listening on port ${PORT}`);
});
