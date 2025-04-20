import path from 'node:path';
import {GoogleGenAI} from '@google/genai';
import * as fs from 'fs';
import {
	findFileInTree,
	generateHash,
	getTreeJsonPath,
	updateFileHashes,
} from '../treesitter.js';
import {apiKey} from './ConfigMangagement.js';

const DEBUG = true;
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'davishacks-debug.log');

// Move these inside the function to avoid startup errors
// const treeJsonPath = getTreeJsonPath(process.cwd());
// const treeJson = fs.readFileSync(treeJsonPath);

const googleAi = new GoogleGenAI({apiKey: apiKey});

// Initialize logging
try {
	if (!fs.existsSync(LOGS_DIR)) {
		fs.mkdirSync(LOGS_DIR, {recursive: true});
	}
} catch (error) {
	console.error('Failed to initialize logging:', error);
}

// Intentionally unused for now, keeping for future debugging
// @ts-ignore
const debugLog = (message: string) => {
	if (DEBUG) {
		const timestamp = new Date().toISOString();
		const logMessage = `[${timestamp}] ${message}\n`;
		try {
			fs.appendFileSync(LOG_FILE, logMessage);
		} catch (error) {
			// Silently fail as we can't use console.log during operations
		}
	}
};

/**
 * Generates docstrings for a file if it has changed or is not yet documented
 *
 * @param filePath - Path to the file to document
 * @returns Promise that resolves to true if docstrings were generated, false otherwise
 */
export async function generateDocStrings(filePath: string): Promise<boolean> {
	// Only try to read the tree when the function is called
	const treeJsonPath = getTreeJsonPath(process.cwd());

	// Check if the tree.json file exists
	if (!fs.existsSync(treeJsonPath)) {
		console.log(
			`Tree file not found at ${treeJsonPath}. Generating docstrings without tree comparison.`,
		);
		// Just generate docstrings without checking hash
		return await generateDocstringsForFile(filePath);
	}

	// File exists, proceed with tree comparison
	const treeJson = JSON.parse(fs.readFileSync(treeJsonPath, 'utf8'));
	const result = findFileInTree(treeJson, filePath);
	const fileContents = fs.readFileSync(filePath, {encoding: 'utf8', flag: 'r'});

	// If file not in tree or hash is different, generate docstrings
	const currentHash = generateHash(fileContents);
	const isDiff = !result || currentHash !== result.file_hash;

	if (isDiff) {
		const success = await generateDocstringsForFile(filePath);
		// Update the hash in the tree
		updateFileHashes(process.cwd(), [filePath]);
		return success;
	}

	// No changes detected, no docstrings needed
	console.log(
		`No changes detected for ${filePath}, skipping docstring generation`,
	);
	return false;
}

/**
 * Internal helper to generate docstrings for a file
 *
 * @param filePath - Path to the file to document
 * @returns Promise that resolves to true if docstrings were generated, false otherwise
 */
async function generateDocstringsForFile(filePath: string): Promise<boolean> {
	try {
		const fileContents = fs.readFileSync(filePath, {
			encoding: 'utf8',
			flag: 'r',
		});
		const fileExt = path.extname(filePath).substring(1); // Remove the dot
		const fileType =
			fileExt === 'ts'
				? 'TypeScript'
				: fileExt === 'tsx'
				? 'TSX'
				: fileExt === 'js'
				? 'JavaScript'
				: fileExt === 'jsx'
				? 'JSX'
				: fileExt === 'py'
				? 'Python'
				: 'Unknown';

		// Update the prompt to specifically ask for raw code without Markdown formatting
		const docString = `
 Please analyze the following source code and generate comprehensive docstrings for every function, class, method, and interface. The file type is "${fileType}" and requires language-appropriate documentation.

 For each element that needs documentation:
 1. Create a descriptive summary of what it does
 2. Document all parameters, including their types and purpose
 3. Document return values with their types and descriptions
 4. Document any errors or exceptions that might be thrown
 5. Include examples where helpful to demonstrate usage

 For TypeScript/TSX files:
 - Use JSDoc-style comments with /** ... */
 - Document parameters with @param {type} name - description
 - Document returns with @returns {type} description
 - Document interfaces, types and their properties
 - Note any generics or type constraints

 For JavaScript/JSX files:
 - Use JSDoc-style comments with /** ... */
 - Document parameters with @param {type} name - description
 - Document returns with @returns description
 - Include type hints where possible

 For Python files:
 - Use Google-style docstrings with triple quotes """
 - Format parameters as "Args:" followed by indented parameter descriptions
 - Format return values as "Returns:" followed by indented descriptions
 - Document exceptions with "Raises:" section
 - Follow PEP 257 conventions

 IMPORTANT: Return the complete source code with added docstrings. DO NOT wrap the code in markdown code blocks (do not use \`\`\` markers). Just return the actual code file itself with docstrings added.

 Maintain the existing code style and formatting. Only add or update docstrings—do not modify the actual code functionality. If an element already has partial documentation, enhance it rather than replacing it completely.

 Focus especially on public exports and APIs that other developers would need to understand to use this code effectively.

 Code:
 ${fileContents}
 `;
		const response = await googleAi.models.generateContent({
			model: 'gemini-2.5-pro',
			contents: docString,
		});

		if (response.text) {
			// Process the response to remove markdown code blocks if present
			let processedText = response.text;

			// Check if the response is wrapped in code fence blocks
			const codeBlockRegex = /^```(?:tsx?|jsx?|python|py)?\n([\s\S]*?)```$/s;
			const match = processedText.match(codeBlockRegex);

			if (match && match[1]) {
				// Extract just the code from between the code fences
				processedText = match[1];
				debugLog(`Removed code fence markers from response for ${filePath}`);
			}

			// Check if there are multiple code blocks or other formatting issues
			const multiBlockRegex = /```(?:tsx?|jsx?|python|py)?|```/g;
			if (multiBlockRegex.test(processedText)) {
				// Complex case with multiple code blocks - perform more aggressive cleaning
				processedText = processedText.replace(multiBlockRegex, '');
				debugLog(
					`Cleaned multiple code fence markers from response for ${filePath}`,
				);
			}

			fs.writeFileSync(filePath, processedText);
			console.log(`Generated docstrings for ${filePath}`);
			return true;
		} else {
			console.log(`No docstrings generated for ${filePath} - empty response`);
			return false;
		}
	} catch (error) {
		console.error(`Error generating docstrings for ${filePath}:`, error);
		return false;
	}
}
