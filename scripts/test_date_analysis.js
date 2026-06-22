const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { generateLinkedInPost } = require('../services/gemini');

(async () => {
  try {
    const context = "I am uploading my old AWS Certified Solutions Architect certificate from 2023. I didn't mention any project.";
    const intent = "achievement";
    const tone = "professional";
    
    // Simulate passing the current date as something much later (2026)
    const currentDate = "Monday, June 22, 2026";
    
    console.log("Mocking API Call with current date:", currentDate);
    console.log("Context:", context);
    
    const result = await generateLinkedInPost([], context, intent, tone, currentDate);
    
    console.log("\n--- RESULT ---");
    console.log("POST TEXT:\n", result.postText);
    console.log("\nHASHTAGS:\n", result.hashtags);
  } catch (err) {
    console.error("Test failed:", err.message);
  }
})();
