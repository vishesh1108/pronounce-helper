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
  }
}));

app.use(express.json({ limit: '20mb' }));

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

  // Support client-passed API keys from request headers as overrides
  const clientGroqKey = req.headers['x-groq-api-key'];
  const clientGeminiKey = req.headers['x-gemini-api-key'];

  const rawGroqKey = clientGroqKey || process.env.GROQ_API_KEY || '';
  const rawGeminiKey = clientGeminiKey || process.env.GEMINI_API_KEY || '';

  const groqApiKey = rawGroqKey.trim().replace(/[\r\n\s]+/g, "");
  const geminiApiKey = rawGeminiKey.trim().replace(/[\r\n\s]+/g, "");

  try {
    let sentences = null;

    // 1. Try Groq if a key is available
    if (groqApiKey) {
      console.log('Using Groq API...');
      const Groq = require('@groq/sdk');
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
    // 2. Try Gemini if a key is available (and Groq was not used)
    else if (geminiApiKey) {
      console.log('Using Gemini API (via @google/genai)...');
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });
      sentences = parseJsonArray(response.text);
    } 
    // 3. Neither key is configured
    else {
      console.error('No API keys configured.');
      return res.status(500).json({ error: 'No API keys configured. Please add GROQ_API_KEY or GEMINI_API_KEY to Vercel environment or in client settings.' });
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
// AI OCR endpoint (Gemini 2.5 Flash multimodal)
app.post('/api/ocr', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required' });
  }

  const clientGeminiKey = req.headers['x-gemini-api-key'];
  const rawKey = clientGeminiKey || process.env.GEMINI_API_KEY;
  if (!rawKey) {
    return res.status(500).json({ error: 'Gemini API key is not configured.' });
  }
  const geminiApiKey = rawKey.trim().replace(/[\r\n\s]+/g, "");

  try {
    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid base64 image format' });
    }
    const mimeType = match[1];
    const base64Data = match[2];

    console.log('Sending image to Gemini for OCR...');
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        },
        'Analyze this document page. Locate and transcribe every single English word. For each word, return a JSON object with its "text" and its bounding box normalized to a 0-1000 coordinate system in the format [ymin, xmin, ymax, xmax]. Ensure the coordinate points are very precise. Do not group words; return them individually. Do not skip any words.'
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            words: {
              type: 'ARRAY',
              description: 'List of detected individual words and their bounding boxes.',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING', description: 'The exact word text.' },
                  box_2d: {
                    type: 'ARRAY',
                    items: { type: 'INTEGER' },
                    description: 'The bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000.'
                  }
                },
                required: ['text', 'box_2d']
              }
            }
          },
          required: ['words']
        }
      }
    });

    console.log('Gemini OCR API success!');
    res.json(JSON.parse(response.text));

  } catch (error) {
    console.error('Gemini OCR error:', error.message);
    res.status(500).json({ error: 'Failed to perform AI OCR', details: error.message });
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
