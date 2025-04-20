import fs from 'node:fs';
import path from 'node:path';
import {simpleGit, SimpleGit} from 'simple-git';
import {GoogleGenAI} from '@google/genai';
import {FileDocumentation, ProjectDocumentation} from '../types/docs.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import {
	findFileInTree,
	generateHash,
	getTreeJsonPath,
	updateFileHashes,
} from '../treesitter.js';

const DEBUG = true;
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'davishacks-debug.log');

const treeJsonPath = getTreeJsonPath(process.cwd());
const treeJson = fs.readFileSync(treeJsonPath);

const apiKey = process.env['GOOGLE_API_KEY'];
const googleAi = new GoogleGenAI({apiKey: apiKey});

// Initialize logging
try {
	if (!fs.existsSync(LOGS_DIR)) {
		fs.mkdirSync(LOGS_DIR, {recursive: true});
	}
} catch (error) {
	console.error('Failed to initialize logging:', error);
}

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

export async function generateDocStrings(filePath: string) {
	const result = findFileInTree(treeJson, filePath);
	const fileContents = fs.readFileSync(filePath, {encoding: 'utf8', flag: 'r'});
	const isDiff = result && generateHash(fileContents) != result.file_hash;
	if (isDiff) {
		const docString = `
Please analyze the following source code and generate comprehensive docstrings for every function, class, method, and interface. The file type is "{fileType}" and requires language-appropriate documentation.

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

Maintain the existing code style and formatting. Only add or update docstrings—do not modify the actual code functionality. If an element already has partial documentation, enhance it rather than replacing it completely.

Focus especially on public exports and APIs that other developers would need to understand to use this code effectively.

Code:
${fileContents}

`;
		const response = await googleAi.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: docString,
		});
		fs.writeFileSync(filePath, response.text || fileContents);
		updateFileHashes(process.cwd(), [filePath]);
	}
}
