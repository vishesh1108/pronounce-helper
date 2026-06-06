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

function getGroqApiKey(req) {
  const clientGroqKey = req.headers['x-groq-api-key'];
  const rawGroqKey = clientGroqKey || process.env.GROQ_API_KEY || '';
  return rawGroqKey.trim().replace(/[\r\n\s]+/g, "");
}

function getGeminiApiKey(req) {
  const clientGeminiKey = req.headers['x-gemini-api-key'];
  const rawGeminiKey = clientGeminiKey || process.env.GEMINI_API_KEY || '';
  return rawGeminiKey.trim().replace(/[\r\n\s]+/g, "");
}

// Check and evaluate pronunciation using Gemini 2.5 Flash if available, or fall back to Groq Whisper transcription
app.post('/api/pronunciation-check', async (req, res) => {
  const { audio, mimeType, targetSentence, targetWord } = req.body || {};
  if (!audio) {
    return res.status(400).json({ error: 'Audio data is required' });
  }

  const geminiApiKey = getGeminiApiKey(req);
  const groqApiKey = getGroqApiKey(req);

  if (!geminiApiKey && !groqApiKey) {
    return res.status(500).json({
      error: 'No API keys configured. Add GEMINI_API_KEY or GROQ_API_KEY to the server or pass it from client settings.'
    });
  }

  // 1. If Gemini API key is configured, evaluate pronunciation directly using Gemini 2.5 Flash
  if (geminiApiKey && targetSentence && targetWord) {
    try {
      console.log('Evaluating pronunciation directly with Gemini 2.5 Flash...');
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });

      // Clean the audio mimeType
      const cleanMimeType = (mimeType || 'audio/webm').split(';')[0]; // Gemini is strict on MIME type (no codecs parameter)

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              mimeType: cleanMimeType,
              data: audio
            }
          },
          `Analyze this audio recording of a user pronouncing the following English sentence:
"${targetSentence}"
Focus particularly on the target word: "${targetWord}"

Verify if the user spoke the sentence correctly, clearly, and in order.
Specifically:
1. Did the user mispronounce any words?
2. Did they skip any words or add extra words that alter the meaning/flow?
3. Did they pronounce the target word "${targetWord}" correctly? Be very precise and strict about correct pronunciation of "${targetWord}".

Return a JSON object with:
- "correct": true if the pronunciation is accurate and all words in the sentence were spoken correctly. false otherwise.
- "failedWords": a list of words from the target sentence that were mispronounced, skipped, or spoken incorrectly (specifically include "${targetWord}" in this list if it was not pronounced correctly).
- "hint": a short, helpful feedback message in Hindi/Hinglish (e.g. "Focus on pronouncing '${targetWord}' correctly", or "Say every word clearly, in order", or a friendly Hindi/Hinglish tip). Keep it supportive but precise.`
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              correct: { type: 'BOOLEAN' },
              failedWords: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
              hint: { type: 'STRING' }
            },
            required: ['correct', 'failedWords', 'hint']
          }
        }
      });

      console.log('Gemini pronunciation check response:', response.text);
      const evaluation = JSON.parse(response.text);
      return res.json({ evaluation });

    } catch (err) {
      console.warn('Gemini pronunciation evaluation failed; trying Groq Whisper fallback if available.', err.message);
      if (!groqApiKey) {
        return res.status(500).json({ error: 'Pronunciation evaluation failed', details: err.message });
      }
    }
  }

  // 2. Fall back to Groq Whisper transcription
  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    if (audioBuffer.length < 1000) {
      return res.status(400).json({ error: 'Audio recording was too short. Please try again.' });
    }

    const GroqSDK = require('groq-sdk');
    const Groq = GroqSDK.default || GroqSDK;
    const toFile = GroqSDK.toFile;
    const groq = new Groq({ apiKey: groqApiKey });

    const extension = (mimeType || '').includes('mp4') ? 'audio.mp4' : 'audio.webm';
    const file = await toFile(audioBuffer, extension, { type: mimeType || 'audio/webm' });

    const transcription = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'en',
      temperature: 0,
      response_format: 'json'
    });

    const transcript = String(transcription.text || '').trim();
    if (!transcript) {
      return res.status(422).json({ error: 'Could not detect any speech. Please speak clearly and try again.' });
    }

    console.log('Groq Whisper transcript:', transcript);
    res.json({ transcript });
  } catch (error) {
    console.error('Pronunciation transcription error:', error.message);
    res.status(500).json({ error: 'Failed to transcribe speech', details: error.message });
  }
});

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
  const clientGeminiKey = req.headers['x-gemini-api-key'];

  const groqApiKey = getGroqApiKey(req);
  const rawGeminiKey = clientGeminiKey || process.env.GEMINI_API_KEY || '';
  const geminiApiKey = rawGeminiKey.trim().replace(/[\r\n\s]+/g, "");

  try {
    let sentences = null;

    // 1. Try Groq if a key is available
    if (groqApiKey) {
      console.log('Using Groq API...');
      const GroqSDK = require('groq-sdk');
      const groq = new (GroqSDK.default || GroqSDK)({ apiKey: groqApiKey });
      
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
