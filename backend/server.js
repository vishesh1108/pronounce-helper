const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend communication
app.use(cors());
app.use(express.json());

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
Return ONLY a valid JSON array of strings containing the 5 sentences. Do not include markdown code blocks, do not write "here is the json", and do not include extra explanations.
Example output format:
["Sentence 1 with word", "Sentence 2 with word", "Sentence 3 with word", "Sentence 4 with word", "Sentence 5 with word"]`;

  try {
    let sentences = null;

    // 1. Try Groq (Llama) if GROQ_API_KEY is configured
    if (process.env.GROQ_API_KEY) {
      console.log('Using Groq API...');
      const Groq = require('@groq/sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant', // fast, cheap, high-quality open-source model
        temperature: 0.5,
        max_tokens: 300,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      sentences = parseJsonArray(responseText);
    } 
    // 2. Try Gemini if GEMINI_API_KEY is configured (and Groq was not used)
    else if (process.env.GEMINI_API_KEY) {
      console.log('Using Gemini API...');
      const { GoogleGenAI } = require('@google/generative-ai');
      const { GoogleGenAI: GenAI } = require('@google/generative-ai');
      // Using standard package initialization
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      sentences = parseJsonArray(responseText);
    } 
    // 3. Neither key is configured
    else {
      console.error('No API keys configured on backend.');
      return res.status(500).json({ error: 'Server API keys not configured. Add GROQ_API_KEY or GEMINI_API_KEY to server environment.' });
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
