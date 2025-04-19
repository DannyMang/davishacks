import { GoogleGenAI } from "@google/genai";
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Get current file path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set in environment variables');
}

// Initialize the model
const genAI =  new GoogleGenAI({ apiKey: apiKey });

async function main() {
    try {
        // For text-only input, use the gemini-pro model
        const response = await genAI.models.generateContent({
            model: "gemini-2.0-flash",
            contents: "What is Windsurf?"
        })
        
        const result = await response.text
        console.log("Response:", result);
    } catch (error) {
        console.error("Error:", error);
    }
}

main();