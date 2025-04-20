import Parser, {Language, Tree, Query, SyntaxNode} from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import * as fs from 'fs';
import ignore from 'ignore';
import * as path from 'path';
import TypeScriptModule = require('tree-sitter-typescript');
const TypeScriptLang = TypeScriptModule.typescript;
const TSXLang = TypeScriptModule.tsx;
import * as crypto from 'crypto';
import {generateDocStrings} from './services/DocStringManager.js';

const IMPORTANT_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.py'];

// --- Define Serializable Structures ---

interface CodeItem {
	type: 'class' | 'method' | 'function';
	name: string;
	startLine: number;
	endLine: number;
	children?: CodeItem[]; // For methods within classes
}

interface FileStructure {
	type: 'file_structure';
	filePath: string; // Relative path from rootDir might be useful
	items: CodeItem[];
	file_hash: string;
}

// The main directory tree structure, can contain DirectoryTree or FileStructure
type DirectoryTree = {
	[name: string]: DirectoryTree | FileStructure;
};

// Store file hash cache for monitoring changes
interface CacheEntry {
	file_hash: string;
	lastParsed: number; // timestamp
}

interface ProjectCache {
	files: {[filePath: string]: CacheEntry};
	lastUpdated: number;
}

// --- Debug Logging ---
const DEBUG = true;
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'davishacks-debug.log');

const debugLog = (message: string) => {
	if (DEBUG) {
		if (!fs.existsSync(LOGS_DIR)) {
			try {
				fs.mkdirSync(LOGS_DIR, {recursive: true});
			} catch (error) {
				return; // Cannot log error, fail silently
			}
		}
		const timestamp = new Date().toISOString();
		const logMessage = `[${timestamp}] ${message}\n`;
		try {
			fs.appendFileSync(LOG_FILE, logMessage);
		} catch (error) {
			// Silently fail
		}
	}
};

// --- Language and Parsing ---

// Cache for compiled queries to avoid recompiling them repeatedly
const queryCache: {[langScheme: string]: Query} = {};

function getLanguageAndQueryScheme(
	filePath: string,
): {language: Language; scheme: string} | null {
	const extension = path.extname(filePath).toLowerCase();
	let language: Language | undefined;
	let scheme: string = 'default'; // Scheme identifier for query selection

	switch (extension) {
		case '.js':
			language = JavaScript as Language;
			scheme = 'javascript'; // Keep JS simple for now
			break;
		case '.jsx':
			language = JavaScript as Language; // Use JS parser for JSX
			scheme = 'jsx'; // Use dedicated JSX scheme
			break;
		case '.ts':
			language = TypeScriptLang as Language;
			scheme = 'typescript'; // Use dedicated TS scheme
			break;
		case '.tsx':
			language = TSXLang as Language; // Use TSX parser
			scheme = 'tsx'; // Use dedicated TSX scheme
			break;
		case '.py':
			language = Python as Language;
			scheme = 'python';
			break;
		default:
			return null;
	}
	return {language, scheme};
}

export function parseFile(
	filePath: string,
	parser: Parser,
): {
	tree: Tree;
	language: Language;
	scheme: string;
	fileContents: string;
} | null {
	try {
		const langInfo = getLanguageAndQueryScheme(filePath);
		if (!langInfo) {
			// debugLog(`Skipping file with unsupported extension for parsing: ${filePath}`);
			return null;
		}
		const {language, scheme} = langInfo;
		parser.setLanguage(language);
		debugLog(
			`Parser language set to: ${language.toString()} for scheme: ${scheme} file: ${filePath}`,
		);

		const fileContents = fs.readFileSync(filePath, {
			encoding: 'utf8',
			flag: 'r',
		});
		const tree = parser.parse(fileContents);
		// debugLog(`Successfully parsed file: ${filePath}`);
		return {tree, language, scheme, fileContents};
	} catch (error) {
		debugLog(`Error parsing file ${filePath}: ${error}`);
		return null;
	}
}

export function generateHash(content: string) {
	return crypto.createHash('md5').update(content).digest('hex');
}

// --- File change detection and cache management ---

function getCachePath(rootDir: string): string {
	const rootDirName = path.basename(rootDir);
	const safeRootDirName = rootDirName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
	return path.join(rootDir, `.${safeRootDirName}.cache.json`);
}

export function getTreeJsonPath(rootDir: string): string {
	const rootDirName = path.basename(rootDir);
	const safeRootDirName = rootDirName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
	return path.join(rootDir, `${safeRootDirName}.tree.json`);
}

function loadCache(rootDir: string): ProjectCache {
	const cachePath = getCachePath(rootDir);
	if (fs.existsSync(cachePath)) {
		try {
			const cacheData = fs.readFileSync(cachePath, 'utf8');
			return JSON.parse(cacheData) as ProjectCache;
		} catch (error) {
			debugLog(`Error loading cache from ${cachePath}: ${error}`);
		}
	}
	return {files: {}, lastUpdated: 0};
}

function saveCache(rootDir: string, cache: ProjectCache): void {
	const cachePath = getCachePath(rootDir);
	try {
		const cacheData = JSON.stringify(cache, null, 2);
		fs.writeFileSync(cachePath, cacheData, 'utf8');
		debugLog(`Cache saved to ${cachePath}`);
	} catch (error) {
		debugLog(`Error saving cache to ${cachePath}: ${error}`);
	}
}

export function findFileInTree(
	tree: any,
	targetFile: string,
	exactMatch: boolean = false,
): FileStructure | null {
	// Helper function for recursive search
	function search(obj: any, currentPath: string = ''): FileStructure | null {
		// Base case: if this is a file structure
		if (obj && typeof obj === 'object' && obj.type === 'file_structure') {
			// Check if this is our target file
			if (exactMatch && obj.filePath === targetFile) {
				return obj;
			} else if (
				!exactMatch &&
				(obj.filePath.includes(targetFile) ||
					obj.filePath.endsWith('/' + targetFile))
			) {
				return obj;
			}
			return null;
		}
		// If this is a directory, search all its children
		if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
			for (const key in obj) {
				const result = search(obj[key], currentPath + '/' + key);
				if (result) return result;
			}
		}
		return null;
	}
	return search(tree);
}

export function updateFileInTree(
	tree: any,
	targetFile: string,
	updateFn: (fileStructure: any) => any,
): any {
	// Deep clone the tree to avoid mutation
	const clonedTree = JSON.parse(JSON.stringify(tree));

	// Helper function for recursive search and update
	function searchAndUpdate(obj: any, currentPath: string = ''): boolean {
		// Base case: if this is a file structure
		if (obj && typeof obj === 'object' && obj.type === 'file_structure') {
			// Check if this is our target file
			if (
				obj.filePath === targetFile ||
				obj.filePath.endsWith('/' + targetFile)
			) {
				// Update the object using the provided function
				Object.assign(obj, updateFn(obj));
				return true; // Found and updated
			}
			return false;
		}

		// If this is a directory, search all its children
		if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
			for (const key in obj) {
				if (searchAndUpdate(obj[key], currentPath + '/' + key)) {
					return true; // Propagate success upward
				}
			}
		}

		return false; // Not found in this branch
	}

	searchAndUpdate(clonedTree);
	return clonedTree;
}

function loadExistingTree(rootDir: string): DirectoryTree | null {
	const treePath = getTreeJsonPath(rootDir);
	if (fs.existsSync(treePath)) {
		try {
			const treeData = fs.readFileSync(treePath, 'utf8');
			return JSON.parse(treeData) as DirectoryTree;
		} catch (error) {
			debugLog(`Error loading existing tree from ${treePath}: ${error}`);
		}
	}
	return null;
}

function hasFileChanged(
	filePath: string,
	cache: ProjectCache,
): {changed: boolean; hash: string} {
	try {
		const fileContent = fs.readFileSync(filePath, 'utf8');
		const currentHash = generateHash(fileContent);
		const cacheEntry = cache.files[filePath];

		if (!cacheEntry || cacheEntry.file_hash !== currentHash) {
			return {changed: true, hash: currentHash};
		}
		return {changed: false, hash: currentHash};
	} catch (error) {
		debugLog(`Error checking if file changed ${filePath}: ${error}`);
		return {changed: true, hash: ''}; // Default to changed if we can't check
	}
}

// --- Structure Extraction ---

// Define Tree-sitter queries for different languages

// Radically Simplified Base Query (removing exports)
const TS_BASE_QUERY_SIMPLIFIED = `
  ; Standard Declarations
  (class_declaration) @class.definition
  (method_definition) @method.definition
  (function_declaration) @function.definition

  ; Arrow function assignments
  (lexical_declaration
    (variable_declarator
      name: (identifier) @function.name ; Capture name
      value: (arrow_function))) @function.definition
`;

// TSX just uses the simplified base for now
const TSX_QUERY_SIMPLIFIED = TS_BASE_QUERY_SIMPLIFIED;

// Radically Simplified JS Base Query (removing exports)
const JS_BASE_QUERY_SIMPLIFIED = `
  ; Standard Declarations
  (class_declaration) @class.definition
  (method_definition) @method.definition
  (function_declaration) @function.definition

  ; Arrow function assignments
  (variable_declaration
    (variable_declarator
      name: (identifier) @function.name
      value: (arrow_function))) @function.definition

  ; Functions assigned via assignment expression
  (expression_statement
    (assignment_expression
      left: [(identifier) @function.name (member_expression property: (property_identifier) @function.name)]
      right: [(arrow_function) (function)])) @function.definition
`;

// JSX just uses the simplified base for now
const JSX_QUERY_SIMPLIFIED = JS_BASE_QUERY_SIMPLIFIED;

const QUERIES: {[scheme: string]: string} = {
	typescript: TS_BASE_QUERY_SIMPLIFIED,
	tsx: TSX_QUERY_SIMPLIFIED, // Start simple for TSX too
	javascript: JS_BASE_QUERY_SIMPLIFIED,
	jsx: JSX_QUERY_SIMPLIFIED, // Start simple for JSX too
	python: `
      (class_definition name: (identifier) @class.name) @class.definition
      (function_definition name: (identifier) @function.name) @function.definition
    `, // Put python names back
};

function getQueryForLanguage(language: Language, scheme: string): Query | null {
	// Clear cache during debug
	delete queryCache[scheme];

	if (queryCache[scheme]) {
		return queryCache[scheme];
	}

	const queryString = QUERIES[scheme];
	if (!queryString) {
		debugLog(`No query string defined for scheme: ${scheme}`);
		return null;
	}

	try {
		const query = new Query(language, queryString);
		// queryCache[scheme] = query; // Don't cache during debug
		debugLog(`Compiled query for scheme: ${scheme}`);
		return query;
	} catch (error) {
		debugLog(
			`FATAL: Error compiling query for scheme ${scheme} using language ${language.toString()}: ${error}\nQuery:\n${queryString}`,
		);
		console.error(
			`FATAL: Error compiling query for scheme ${scheme} using language ${language.toString()}:`,
			error,
		);
		console.error(`Query String:\n${queryString}`);
		return null;
	}
}

export function updateFileHashes(
	rootDir: string,
	changedFiles: string[],
): void {
	// Get the tree JSON path and load it
	const treeJsonPath = getTreeJsonPath(rootDir);

	try {
		// Read and parse the existing tree
		const treeJsonContent = fs.readFileSync(treeJsonPath, 'utf8');
		let treeJson = JSON.parse(treeJsonContent);

		console.log(`Updating hashes for ${changedFiles.length} changed files`);

		// Process each changed file
		for (const filePath of changedFiles) {
			try {
				// Read current file content
				const fullPath = path.join(rootDir, filePath);
				const content = fs.readFileSync(fullPath, 'utf8');
				const newHash = generateHash(content);

				// Update the file structure in the tree
				treeJson = updateFileInTree(treeJson, filePath, fileStructure => {
					console.log(`Updating hash for ${filePath}`);
					return {
						...fileStructure,
						file_hash: newHash,
					};
				});
			} catch (error) {
				console.error(`Error updating hash for ${filePath}: ${error}`);
			}
		}

		// Write the updated tree back to file
		fs.writeFileSync(treeJsonPath, JSON.stringify(treeJson, null, 2));
		console.log(`Updated tree JSON saved to ${treeJsonPath}`);
	} catch (error) {
		console.error(`Error updating file hashes: ${error}`);
	}
}

// Extracts the simplified structure from a parsed file (No changes needed in this function for now)
function extractStructure(
	tree: Tree,
	language: Language,
	scheme: string,
	filePath: string,
	fileHash: string = '',
): FileStructure | null {
	const query = getQueryForLanguage(language, scheme);
	if (!query) {
		debugLog(
			`Cannot extract structure for ${filePath}, query compilation failed or missing for scheme ${scheme}.`,
		);
		return null;
	}

	try {
		const captures = query.captures(tree.rootNode);
		// debugLog(`  File: ${filePath} - Found ${captures.length} captures using scheme ${scheme}.`);

		const items: CodeItem[] = [];
		const itemMap = new Map<SyntaxNode, CodeItem>();
		const processedNodeIds = new Set<number>();

		// --- First Pass: Create items ---
		for (const {name: captureName, node} of captures) {
			if (processedNodeIds.has(node.id)) {
				continue;
			}

			let itemType: CodeItem['type'] | null = null;
			let definitionNode = node;
			let isDefaultExport = false; // Keep track even if queries don't handle it now

			// Handle captures specifically tagging a name (e.g., @function.name)
			if (captureName.endsWith('.name')) {
				let ownerNode = node.parent;
				while (ownerNode && !itemMap.has(ownerNode)) {
					if (!ownerNode.parent || ownerNode.parent.id === ownerNode.id) break;
					ownerNode = ownerNode.parent;
				}
				if (ownerNode && itemMap.has(ownerNode)) {
					const ownerItem = itemMap.get(ownerNode);
					// Allow name capture to override 'anonymous' or defaultExport name
					if (
						ownerItem &&
						(ownerItem.name === 'anonymous' ||
							ownerItem.name.startsWith('defaultExport'))
					) {
						ownerItem.name = node.text;
					}
				}
				continue;
			}

			// Process definition captures
			// Simplified: Assume captures ending in .definition are what we want for now
			if (captureName.endsWith('.definition')) {
				// Avoid processing the same underlying definition node twice
				if (processedNodeIds.has(definitionNode.id)) {
					continue;
				}

				// Determine item type based on the *actual* definitionNode
				switch (definitionNode.type) {
					case 'class_declaration':
					case 'class_definition': // Python
						itemType = 'class';
						break;
					case 'method_definition':
						itemType = 'method';
						break;
					case 'function_declaration':
					case 'function_definition': // Python
					case 'arrow_function': // Treat captured arrow functions as functions
						itemType = 'function';
						break;
					// Cases for assignments captured by @function.definition
					case 'lexical_declaration': // TS/JS var/let/const
					case 'variable_declaration': // JS var
					case 'expression_statement': // JS assignment
						// Check if query intended this capture as a function
						if (captureName.startsWith('function')) {
							itemType = 'function';
							// If it's an assignment, the actual 'function' node might be deeper
							// Let's try to find the arrow function within
							const assignedFunc =
								definitionNode.descendantsOfType('arrow_function')[0];
							if (assignedFunc) definitionNode = assignedFunc; // Use the arrow function node itself
						}
						break;
				}

				if (itemType) {
					// --- Find the name node ---
					let nameNode: SyntaxNode | null = null;

					// Check the parent if the definition node is the value (e.g. arrow function)
					if (definitionNode.parent?.type === 'variable_declarator') {
						nameNode = definitionNode.parent.childForFieldName('name');
					}
					// Check the definition node itself (e.g., class_declaration, function_declaration)
					else {
						nameNode = definitionNode.childForFieldName('name');
					}

					// Fallbacks if name wasn't found directly
					if (!nameNode) {
						if (
							definitionNode.type === 'lexical_declaration' ||
							definitionNode.type === 'variable_declaration'
						) {
							const declarator = definitionNode.descendantsOfType(
								'variable_declarator',
							)[0];
							if (declarator) nameNode = declarator.childForFieldName('name');
						} else if (
							definitionNode.parent?.type === 'assignment_expression'
						) {
							const left = definitionNode.parent.childForFieldName('left');
							if (left?.type === 'identifier') nameNode = left;
							else if (left?.type === 'member_expression')
								nameNode = left.childForFieldName('property');
						}
					}

					const name = nameNode ? nameNode.text : 'anonymous';
					const finalName =
						name === 'anonymous' && isDefaultExport // isDefaultExport won't be true with current queries
							? `defaultExport (${path.basename(filePath)})`
							: name;

					const codeItem: CodeItem = {
						type: itemType,
						name: finalName,
						startLine: definitionNode.startPosition.row + 1,
						endLine: definitionNode.endPosition.row + 1,
						...(itemType === 'class' ? {children: []} : {}),
					};

					items.push(codeItem);
					itemMap.set(definitionNode, codeItem); // Map the node we used for type/lines/name finding
					processedNodeIds.add(definitionNode.id); // Mark this node ID as processed
					// debugLog(`  [+] Created ${codeItem.type} item: ${codeItem.name} [${codeItem.startLine}-${codeItem.endLine}] (from ${definitionNode.type})`);
				}
			} // end if .definition
		} // end for captures loop

		// --- Second Pass for Nesting ---
		const rootItems: CodeItem[] = [];
		const nestedNodeIds = new Set<number>();

		items.forEach(item => {
			const definitionNodeEntry = [...itemMap.entries()].find(
				([, i]) => i === item,
			);
			if (!definitionNodeEntry) return;
			const definitionNode = definitionNodeEntry[0];

			let parentNode = definitionNode.parent;
			let parentItem: CodeItem | undefined = undefined;

			while (parentNode) {
				if (itemMap.has(parentNode)) {
					// Check if parent node is a mapped definition
					const potentialParent = itemMap.get(parentNode);
					if (potentialParent?.type === 'class') {
						parentItem = potentialParent;
						break;
					}
				}
				if (!parentNode.parent || parentNode.parent.id === parentNode.id) break;
				parentNode = parentNode.parent;
			}

			if (parentItem) {
				if (item.type === 'function' && scheme === 'python')
					item.type = 'method';

				if (item.type === 'method' || item.type === 'function') {
					parentItem.children = parentItem.children || [];
					parentItem.children.push(item);
					nestedNodeIds.add(definitionNode.id);
					// debugLog(`  [*] Nested ${item.type} ${item.name} under class ${parentItem.name}`);
				}
			}
		});

		items.forEach(item => {
			const definitionNodeEntry = [...itemMap.entries()].find(
				([, i]) => i === item,
			);
			if (
				definitionNodeEntry &&
				!nestedNodeIds.has(definitionNodeEntry[0].id)
			) {
				rootItems.push(item);
			}
		});

		// Use the provided hash or generate a new one
		const actualHash =
			fileHash ||
			generateHash(fs.readFileSync(filePath, {encoding: 'utf8', flag: 'r'}));

		return {
			type: 'file_structure',
			filePath: filePath,
			items: rootItems,
			file_hash: actualHash,
		};
	} catch (error) {
		debugLog(
			`Error during structure extraction for ${filePath} using scheme ${scheme}: ${error}`,
		);
		console.error(`Error extracting structure for ${filePath}:`, error);
		return null;
	}
}

// Type guard to check if an object is a DirectoryTree
function isDirectoryTree(obj: any): obj is DirectoryTree {
	return obj !== null && typeof obj === 'object' && !('type' in obj);
}

// Type guard to check if an object is a FileStructure
function isFileStructure(obj: any): obj is FileStructure {
	return (
		obj !== null &&
		typeof obj === 'object' &&
		'type' in obj &&
		obj.type === 'file_structure'
	);
}

// Get a specific node from an existing tree by path
function getNodeFromExistingTree(
	existingTree: DirectoryTree | null,
	pathParts: string[],
): DirectoryTree | FileStructure | null {
	if (!existingTree || pathParts.length === 0) return null;

	let current: DirectoryTree | FileStructure | null = existingTree;

	for (let i = 0; i < pathParts.length; i++) {
		const part = pathParts[i];
		if (!part) return null;

		// Check if we're at a file structure (end node)
		if (isFileStructure(current)) {
			// We've reached a file but have more path parts
			if (i < pathParts.length - 1) return null;
			return current;
		}

		// Must be a directory tree to continue traversing
		if (!isDirectoryTree(current)) return null;

		// Check if the key exists in the directory
		if (!(part in current)) return null;

		// Continue traversing with explicit null check for the result
		const next: DirectoryTree | FileStructure | null = current[part] || null;
		if (next === undefined) return null;
		current = next;
	}

	return current;
}

// Recursive helper function - now with preserved existing structure
function buildTreeRecursive(
	currentPath: string,
	rootDir: string,
	parser: Parser,
	ig: ReturnType<typeof ignore>,
	cache: ProjectCache,
	existingTree: DirectoryTree | null,
	updatedPaths: Set<string> = new Set(), // Track changed files
): DirectoryTree {
	const directoryContent: DirectoryTree = {};
	let entries: fs.Dirent[];

	try {
		entries = fs.readdirSync(currentPath, {withFileTypes: true});
	} catch (error) {
		debugLog(
			`    [Error] Reading directory ${currentPath}: ${error}. Skipping.`,
		);
		return {};
	}

	const relDirPath = path.relative(rootDir, currentPath);
	const pathParts = relDirPath ? relDirPath.split(path.sep) : [];

	// Get existing subtree if available
	const existingSubtree = existingTree
		? getNodeFromExistingTree(existingTree, pathParts)
		: null;

	for (const entry of entries) {
		const fullPath = path.join(currentPath, entry.name);
		const relativePath = path.relative(rootDir, fullPath);
		const entryKey = entry.name;

		if (ig.ignores(relativePath)) continue;
		if (entry.isDirectory() && entry.name === '.git') continue;

		if (entry.isDirectory()) {
			// Recursive call to process subdirectory
			const subtree = buildTreeRecursive(
				fullPath,
				rootDir,
				parser,
				ig,
				cache,
				existingTree,
				updatedPaths,
			);

			if (Object.keys(subtree).length > 0) {
				directoryContent[entryKey] = subtree;
			}
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (IMPORTANT_EXTENSIONS.includes(ext)) {
				// Check if file has changed
				const {changed, hash} = hasFileChanged(fullPath, cache);

				// Update the cache entry for this file
				cache.files[fullPath] = {
					file_hash: hash,
					lastParsed: Date.now(),
				};

				// Get existing file structure if available
				let existingFileNode: FileStructure | null = null;

				if (isDirectoryTree(existingSubtree) && entryKey in existingSubtree) {
					const node = existingSubtree[entryKey];
					if (isFileStructure(node)) {
						existingFileNode = node;
					}
				}

				// Only process if file has changed or was never processed before
				if (changed) {
					const parseResult = parseFile(fullPath, parser);
					if (parseResult) {
						const {tree, language, scheme} = parseResult;
						const structure = extractStructure(
							tree,
							language,
							scheme,
							relativePath,
							hash, // Pass the hash to avoid recalculating it
						);

						if (structure && structure.items.length > 0) {
							directoryContent[entryKey] = structure;
							updatedPaths.add(relativePath);
							debugLog(
								`    [Updated Structure] For changed file: ${entryKey} (${structure.items.length} root items found)`,
							);
						}
					}
				} else if (existingFileNode) {
					// File hasn't changed - use existing structure
					directoryContent[entryKey] = existingFileNode;
					debugLog(
						`    [Preserved Unchanged] File: ${entryKey} (hash: ${hash.substring(
							0,
							8,
						)}...)`,
					);
				}
			}
		}
	}
	return directoryContent;
}

// --- Main Function ---

/**
 * Builds a JSON representation of a directory's structure, including
 * simplified code structure (classes, methods, functions with line numbers)
 * for supported files, respecting .gitignore rules.
 * Writes the output to {directoryName}.tree.json in the root directory.
 *
 * @param rootDir The absolute path to the root directory to scan.
 * @param parser A Tree-sitter parser instance.
 * @param force Whether to force re-parsing of all files, ignoring the cache
 * @param generateDocs Whether to generate docstrings for changed files (default: false)
 */
export async function generateDirectoryTreeJson(
	rootDir: string,
	parser: Parser,
	force: boolean = false,
	generateDocs: boolean = false,
): Promise<{tree: DirectoryTree; updatedPaths: Set<string>}> {
	debugLog(
		`=== Starting directory scan for ${rootDir} ${
			force ? '(forced update)' : ''
		} ===`,
	);

	const ig = ignore();
	const gitignorePath = path.join(rootDir, '.gitignore');
	if (fs.existsSync(gitignorePath)) {
		try {
			const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
			ig.add(gitignoreContent);
			debugLog(`Loaded .gitignore rules from ${gitignorePath}`);
		} catch (error) {
			debugLog(`Error reading .gitignore file at ${gitignorePath}: ${error}`);
		}
	} else {
		debugLog('No .gitignore file found at root.');
	}
	ig.add(['node_modules', '.git', '*.tree.json', 'logs', '*.cache.json']);
	debugLog(
		'Added implicit ignores: node_modules, .git, *.tree.json, logs, *.cache.json',
	);

	// Load existing tree structure
	const existingTree = force ? null : loadExistingTree(rootDir);
	debugLog(
		`${existingTree ? 'Loaded' : 'Could not load'} existing tree structure`,
	);

	// Load cache to check which files have changed
	let cache = force ? {files: {}, lastUpdated: 0} : loadCache(rootDir);
	const updatedPaths = new Set<string>();

	const treeContent = buildTreeRecursive(
		rootDir,
		rootDir,
		parser,
		ig,
		cache,
		existingTree,
		updatedPaths,
	);

	// Save updated cache
	cache.lastUpdated = Date.now();
	saveCache(rootDir, cache);

	const rootDirName = path.basename(rootDir);
	const safeRootDirName = rootDirName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

	let finalOutput: DirectoryTree;

	// If we have an existing tree and there were no updates, use the existing tree
	if (existingTree && updatedPaths.size === 0) {
		finalOutput = existingTree;
		debugLog(`No changes detected, preserving existing tree structure`);
	} else {
		finalOutput = {
			[safeRootDirName]: treeContent,
		};
	}

	const outputFileName = `${safeRootDirName}.tree.json`;
	const outputFilePath = path.join(rootDir, outputFileName);

	debugLog(`Attempting to write directory tree JSON to: ${outputFilePath}`);

	try {
		const jsonContent = JSON.stringify(finalOutput, null, 2);
		fs.writeFileSync(outputFilePath, jsonContent, {encoding: 'utf8'});
		debugLog(`Successfully wrote directory tree JSON to: ${outputFilePath}`);
		console.log(`Successfully generated structure file: ${outputFilePath}`);
		console.log(`Updated ${updatedPaths.size} files`);

		// Generate docstrings for changed files if enabled
		if (generateDocs && updatedPaths.size > 0) {
			debugLog('Generating docstrings for updated files...');

			// Process each file that was updated
			for (const relativeFilePath of updatedPaths) {
				try {
					// Skip files we don't want to document
					const ext = path.extname(relativeFilePath).toLowerCase();
					if (
						['.js', '.jsx', '.ts', '.tsx', '.py'].includes(ext) &&
						!relativeFilePath.includes('.tree.json')
					) {
						const fullPath = path.join(rootDir, relativeFilePath);
						debugLog(`Generating docstrings for ${relativeFilePath}`);
						await generateDocStrings(fullPath);
					}
				} catch (error) {
					debugLog(
						`Error generating docstrings for ${relativeFilePath}: ${error}`,
					);
				}
			}

			debugLog('Docstring generation complete');
		}
	} catch (error) {
		debugLog(
			`Error writing directory tree JSON file to ${outputFilePath}: ${error}`,
		);
		console.error(`Failed to write tree JSON for ${rootDir}: ${error}`);
	}

	debugLog(`=== Finished directory scan for ${rootDir} ===`);
	return {tree: finalOutput, updatedPaths};
}

/**
 * Continuously monitors a directory for changes and regenerates the tree
 * structure when changes are detected.
 *
 * @param rootDir The directory to monitor
 * @param parser A Tree-sitter parser instance
 * @param intervalMs How often to check for changes (default: 5000ms)
 * @param callback Optional callback to run when changes are detected
 * @returns Function to stop monitoring
 */
export function monitorDirectoryChanges(
	rootDir: string,
	parser: Parser,
	intervalMs: number = 5000,
	callback?: (updatedFiles: string[]) => void,
	generateDocs: boolean = false,
): () => void {
	debugLog(
		`Starting continuous monitoring of ${rootDir} (interval: ${intervalMs}ms)`,
	);
	console.log(`Starting continuous monitoring of ${rootDir}`);
	console.log(`Docstring generation: ${generateDocs ? 'enabled' : 'disabled'}`);

	let isRunning = false;
	const interval = setInterval(async () => {
		if (isRunning) {
			debugLog('Skipping check as previous scan is still running');
			return;
		}

		isRunning = true;
		try {
			const result = await generateDirectoryTreeJson(
				rootDir,
				parser,
				false,
				generateDocs,
			);
			const updatedPaths = result.updatedPaths;

			if (updatedPaths.size > 0) {
				const updatedFiles = Array.from(updatedPaths) as string[];
				debugLog(`Detected changes in ${updatedPaths.size} files`);

				if (callback && typeof callback === 'function') {
					callback(updatedFiles);
				}
			}
		} catch (error) {
			debugLog(`Error during continuous monitoring: ${error}`);
		} finally {
			isRunning = false;
		}
	}, intervalMs);

	// Return a function to stop monitoring
	return () => {
		clearInterval(interval);
		debugLog('Stopped continuous monitoring');
		console.log('Stopped continuous monitoring');
	};
}

// Example usage:
// const parser = new Parser();
// generateDirectoryTreeJson('/path/to/project', parser);
//
// To monitor continuously:
// const stopMonitoring = monitorDirectoryChanges('/path/to/project', parser, 5000,
//   (updatedFiles) => console.log('Files updated:', updatedFiles));
//
// Later, to stop monitoring:
// stopMonitoring();
