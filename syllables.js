/**
 * Syllable Division Engine for Pronounce Helper
 * Combines a curated dictionary of complex English words with a
 * rule-based phonetic hyphenation algorithm for unseen words.
 */

(function (global) {
  // A lookup dictionary for common and complex English words to ensure 100% accuracy.
  const syllableDictionary = {
    // Basic Pronunciation / App words
    "pronounce": ["pro", "nounce"],
    "helper": ["help", "er"],
    "syllable": ["syl", "la", "ble"],
    "difficult": ["dif", "fi", "cult"],
    "english": ["eng", "lish"],
    "student": ["stu", "dent"],
    "identify": ["i", "den", "ti", "fy"],
    "optional": ["op", "tion", "al"],
    "meaning": ["mean", "ing"],
    "phonetic": ["pho", "net", "ic"],
    "translation": ["trans", "la", "tion"],
    "definition": ["def", "i", "ni", "tion"],
    "history": ["his", "to", "ry"],
    "bookmark": ["book", "mark"],
    "camera": ["cam", "er", "a"],
    "capture": ["cap", "ture"],
    "extract": ["ex", "tract"],
    "overlay": ["o", "ver", "lay"],
    "speech": ["speech"],
    
    // Academic & Educational Words
    "education": ["ed", "u", "ca", "tion"],
    "university": ["u", "ni", "ver", "si", "ty"],
    "computer": ["com", "pu", "ter"],
    "science": ["sci", "ence"],
    "technology": ["tech", "nol", "o", "gy"],
    "information": ["in", "for", "ma", "tion"],
    "vocabulary": ["vo", "cab", "u", "lar", "y"],
    "grammar": ["gram", "mar"],
    "sentence": ["sen", "tence"],
    "paragraph": ["par", "a", "graph"],
    "literature": ["lit", "er", "a", "ture"],
    "understand": ["un", "der", "stand"],
    "comprehension": ["com", "pre", "hen", "sion"],
    "knowledge": ["knowl", "edge"],
    "learn": ["learn"],
    "reading": ["read", "ing"],
    "writing": ["writ", "ing"],
    
    // General Words with tricky divisions
    "about": ["a", "bout"],
    "above": ["a", "bove"],
    "beautiful": ["beau", "ti", "ful"],
    "business": ["busi", "ness"],
    "different": ["dif", "fer", "ent"],
    "important": ["im", "por", "tant"],
    "interesting": ["in", "ter", "est", "ing"],
    "people": ["peo", "ple"],
    "together": ["to", "geth", "er"],
    "government": ["gov", "ern", "ment"],
    "environment": ["en", "vi", "ron", "ment"],
    "development": ["de", "vel", "op", "ment"],
    "activity": ["ac", "tiv", "i", "ty"],
    "community": ["com", "mu", "ni", "ty"],
    "family": ["fam", "i", "ly"],
    "system": ["sys", "tem"],
    "program": ["pro", "gram"],
    "question": ["ques", "tion"],
    "problem": ["prob", "lem"],
    "example": ["ex", "am", "ple"],
    "experience": ["ex", "pe", "ri", "ence"],
    "remember": ["re", "mem", "ber"],
    "something": ["some", "thing"],
    "everything": ["ev", "ery", "thing"],
    "understandable": ["un", "der", "stand", "a", "ble"],
    "dictionary": ["dic", "tion", "ar", "y"],
    "pronunciation": ["pro", "nun", "ci", "a", "tion"],
    "restaurant": ["res", "tau", "rant"],
    "chocolate": ["choc", "o", "late"],
    "vegetable": ["veg", "e", "ta", "ble"],
    "temperature": ["tem", "per", "a", "ture"],
    "comfortable": ["com", "fort", "a", "ble"],
    "library": ["li", "brar", "y"],
    "wednesday": ["wednes", "day"],
    "february": ["feb", "ru", "ar", "y"]
  };

  // Consonant digraphs/blends that should not be split
  const consonantBlends = new Set([
    "ch", "sh", "th", "ph", "wh", "gh", "ng", "qu",
    "cl", "fl", "gl", "pl", "sl", "bl",
    "cr", "dr", "fr", "gr", "pr", "tr", "br",
    "sc", "sk", "sm", "sn", "sp", "st", "sw"
  ]);

  // Vowels list
  const vowels = new Set(["a", "e", "i", "o", "u", "y", "A", "E", "I", "O", "U", "Y"]);

  function isVowel(char) {
    return vowels.has(char);
  }

  /**
   * Rule-based syllable division algorithm (fallback)
   */
  function splitSyllablesAlgorithmic(word) {
    const cleanWord = word.trim().replace(/[^a-zA-Z]/g, "");
    if (cleanWord.length <= 3) return [cleanWord];

    const len = cleanWord.length;
    const lowerWord = cleanWord.toLowerCase();
    
    // Check local lookup dictionary first (case-insensitive)
    if (syllableDictionary[lowerWord]) {
      // Reconstruct with original casing
      return reconstructCasing(cleanWord, syllableDictionary[lowerWord]);
    }

    // Step 1: Find vowel cluster positions and build indices
    // A vowel cluster is one or more consecutive vowels (e.g. "eau" in beautiful, "oo" in look)
    const vowelClusters = [];
    let inCluster = false;
    let clusterStart = 0;

    for (let i = 0; i < len; i++) {
      const char = cleanWord[i];
      const isV = isVowel(char);

      if (isV) {
        if (!inCluster) {
          clusterStart = i;
          inCluster = true;
        }
      } else {
        if (inCluster) {
          vowelClusters.push({
            start: clusterStart,
            end: i - 1,
            text: cleanWord.substring(clusterStart, i)
          });
          inCluster = false;
        }
      }
    }
    // End of word cluster
    if (inCluster) {
      vowelClusters.push({
        start: clusterStart,
        end: len - 1,
        text: cleanWord.substring(clusterStart, len)
      });
    }

    // Adjust for silent 'e' at the end of the word
    if (vowelClusters.length > 1) {
      const lastCluster = vowelClusters[vowelClusters.length - 1];
      if (lastCluster.text === "e" && lastCluster.start === len - 1) {
        // Silent 'e' rule: if preceded by 'l' and a consonant (e.g. -ble, -tle, -dle), it counts as a syllable.
        // Otherwise, it is silent and merged into the previous syllable.
        const precedingChar = cleanWord[len - 2];
        const precedingPrecedingChar = len >= 3 ? cleanWord[len - 3] : "";
        
        const isLeSuffix = precedingChar === "l" && !isVowel(precedingPrecedingChar);
        if (!isLeSuffix) {
          vowelClusters.pop(); // Remove silent e cluster from count
        }
      }
    }

    // If we only have 1 vowel cluster (after silent 'e' removal), it's a monosyllable word
    if (vowelClusters.length <= 1) {
      return [cleanWord];
    }

    // Step 2: Divide between vowel clusters based on consonants between them
    const syllables = [];
    let lastCutIndex = 0;

    for (let k = 0; k < vowelClusters.length - 1; k++) {
      const currentVowel = vowelClusters[k];
      const nextVowel = vowelClusters[k + 1];
      
      const gapStart = currentVowel.end + 1;
      const gapEnd = nextVowel.start - 1;
      const gapLength = gapEnd - gapStart + 1;
      
      let cutIndex = gapStart; // default fallback

      if (gapLength === 1) {
        // V-C-V pattern: divide before the consonant (e.g., po-ta-to, fa-mous)
        // Except if the consonant is 'x' or the vowel is short (hard to determine algorithmically,
        // so we divide before the consonant by default).
        cutIndex = gapStart;
      } else if (gapLength === 2) {
        // V-C-C-V pattern: divide between consonants (e.g., doc-tor, sil-ly)
        // Unless it's a consonant blend (e.g., fa-ther, phone-tics)
        const blend = lowerWord.substring(gapStart, gapStart + 2);
        if (consonantBlends.has(blend)) {
          cutIndex = gapStart; // Keep blend together on the right side
        } else {
          cutIndex = gapStart + 1; // Split between them
        }
      } else if (gapLength >= 3) {
        // V-C-C-C-V pattern: usually split after the first consonant (e.g., mon-ster, pump-kin)
        // or check for blends
        const firstTwo = lowerWord.substring(gapStart, gapStart + 2);
        const secondTwo = lowerWord.substring(gapStart + 1, gapStart + 3);
        
        if (consonantBlends.has(secondTwo)) {
          cutIndex = gapStart + 1; // Split before the blend: mon-ster
        } else if (consonantBlends.has(firstTwo)) {
          cutIndex = gapStart + 2; // Keep the first blend together: e.g., ath-lete
        } else {
          cutIndex = gapStart + 1; // Default split after first consonant
        }
      } else if (gapLength === 0) {
        // V-V pattern: divide between vowels if they don't form a cluster
        // Since we grouped vowel letters into clusters, a gapLength of 0 shouldn't happen
        // unless they are separate syllables. For example, "idea" -> i-de-a.
        // We handle this during cluster creation or default split.
        cutIndex = gapStart;
      }

      syllables.push(cleanWord.substring(lastCutIndex, cutIndex));
      lastCutIndex = cutIndex;
    }

    // Add the final syllable
    syllables.push(cleanWord.substring(lastCutIndex));

    return syllables;
  }

  // Helper to preserve original uppercase/lowercase casing from the dictionary lookup
  function reconstructCasing(originalWord, syllableList) {
    const result = [];
    let originalIdx = 0;
    
    for (let i = 0; i < syllableList.length; i++) {
      const syl = syllableList[i];
      let restoredSyl = "";
      for (let j = 0; j < syl.length; j++) {
        if (originalIdx < originalWord.length) {
          restoredSyl += originalWord[originalIdx];
          originalIdx++;
        }
      }
      result.push(restoredSyl);
    }
    
    // Append any trailing leftovers (e.g. punctuation, plural s)
    if (originalIdx < originalWord.length) {
      result[result.length - 1] += originalWord.substring(originalIdx);
    }
    
    return result;
  }

  /**
   * Main split function
   * @param {string} word - The word to split
   * @returns {string} - Hyphenated word, e.g. "in-for-ma-tion"
   */
  function splitWord(word) {
    if (!word || typeof word !== "string") return "";
    
    // Strip trailing punctuation from word for analysis, but keep track of it
    const matchStart = word.match(/^[^a-zA-Z]*/);
    const matchEnd = word.match(/[^a-zA-Z]*$/);
    
    const prefix = matchStart ? matchStart[0] : "";
    const suffix = matchEnd ? matchEnd[0] : "";
    
    const coreWord = word.substring(prefix.length, word.length - suffix.length);
    if (coreWord.length === 0) return word;

    const parts = splitSyllablesAlgorithmic(coreWord);
    return prefix + parts.join(" · ") + suffix;
  }

  // Export to global scope
  global.SyllableHelper = {
    split: splitWord,
    splitAsArray: splitSyllablesAlgorithmic
  };

})(typeof window !== "undefined" ? window : global);
