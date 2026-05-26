const fs = require('fs');
const path = require('path');

// Load original syllables.js content
const filePath = 'C:/Users/chokh/Documents/antigravity/adventurous-hopper/syllables.js';
let syllablesContent = fs.readFileSync(filePath, 'utf8');

// Helper to prepare the code for sandbox running
function sandboxify(code, patchSplitWord) {
  let lines = code.split('\n');
  // Replace the first line containing the IIFE start
  let firstLineIdx = lines.findIndex(l => l.includes('(function (global)'));
  if (firstLineIdx !== -1) {
    lines[firstLineIdx] = 'function run(global) {';
  }
  // Replace the last line containing the IIFE end
  let lastLineIdx = lines.findLastIndex(l => l.includes('})(typeof window'));
  if (lastLineIdx !== -1) {
    lines[lastLineIdx] = '}';
  }
  
  let prepared = lines.join('\n');
  
  if (patchSplitWord) {
    // Inject the new function and updated splitWord
    prepared = prepared.replace('function splitWord(word) {', `
  function reconstructOriginal(originalWord, syllableList) {
    const result = [];
    let originalIdx = 0;
    
    for (let i = 0; i < syllableList.length; i++) {
      const syl = syllableList[i];
      let restoredSyl = "";
      let lettersMatched = 0;
      const lettersNeeded = syl.replace(/[^a-zA-Z]/g, "").length;
      
      while (lettersMatched < lettersNeeded && originalIdx < originalWord.length) {
        const char = originalWord[originalIdx];
        restoredSyl += char;
        originalIdx++;
        if (/[a-zA-Z]/.test(char)) {
          lettersMatched++;
        }
      }
      result.push(restoredSyl);
    }
    
    if (originalIdx < originalWord.length) {
      result[result.length - 1] += originalWord.substring(originalIdx);
    }
    
    return result;
  }

  function splitWord(word) {
    if (!word || typeof word !== "string") return "";
    if (!/[a-zA-Z]/.test(word)) return word;
    `);
    
    prepared = prepared.replace('return prefix + parts.join(" · ") + suffix;', `
    const alignedParts = reconstructOriginal(coreWord, parts);
    return prefix + alignedParts.join(" · ") + suffix;
    `);
  }
  
  return prepared;
}

// 1. Original
const sandbox1 = {};
const code1 = sandboxify(syllablesContent, false);
eval(code1 + '\nrun(sandbox1);');
const originalSplit = sandbox1.SyllableHelper.split;

// 2. Updated
const sandbox2 = {};
const code2 = sandboxify(syllablesContent, true);
eval(code2 + '\nrun(sandbox2);');
const updatedSplit = sandbox2.SyllableHelper.split;

const testCases = [
  "1234",
  "don't",
  "self-esteem",
  "technology",
  "Hello!",
  "state-of-the-art",
  "1st",
  "3D",
  "-@#",
  "wednesday",
  "comfortable",
  "Business-oriented"
];

console.log("=== COMPARISON TEST ===");
console.log("WORD".padEnd(20) + " | " + "ORIGINAL".padEnd(30) + " | " + "UPDATED".padEnd(30));
console.log("-".repeat(90));

for (const tc of testCases) {
  const orig = originalSplit(tc);
  const upd = updatedSplit(tc);
  console.log(tc.padEnd(20) + " | " + orig.padEnd(30) + " | " + upd.padEnd(30));
}
