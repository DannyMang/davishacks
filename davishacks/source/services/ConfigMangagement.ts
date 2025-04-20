import {fileURLToPath} from 'url';
import path from 'path';
import * as fs from 'fs';

/**
 * Gets the project root directory from the current file
 *
 * @param levelsUp Number of directory levels to go up from current file
 * @returns Absolute path to the project root
 */
function getProjectRoot(levelsUp = 2): string {
	// For ESM modules
	if (typeof import.meta !== 'undefined') {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);
		return path.resolve(__dirname, ...Array(levelsUp).fill('..'));
	}

	// For CommonJS
	return path.resolve(__dirname, ...Array(levelsUp).fill('..'));
}

// Usage:
const projectRoot = getProjectRoot();
const configPath = path.join(projectRoot, 'davishacks.config.json');
export const apiKey = JSON.parse(
	fs.readFileSync(configPath, 'utf8'),
).google_api_key;

export function updateApiKey(key: string) {
	let configContents = fs.readFileSync(configPath, {encoding: 'utf8'});
	let configJson = JSON.parse(configContents);
	configJson.google_api_key = key;
	fs.writeFileSync(configPath, JSON.stringify(configJson));
}
