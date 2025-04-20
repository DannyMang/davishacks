import Parser, {Language, Tree, Query, SyntaxNode} from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import * as fs from 'fs';
import ignore from 'ignore';
import * as path from 'path';
import TypeScriptModule = require('tree-sitter-typescript');
const TypeScriptLang = TypeScriptModule.typescript;
const TSXLang = TypeScriptModule.tsx;

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
}

// The main directory tree structure, can contain DirectoryTree or FileStructure
type DirectoryTree = {
	[name: string]: DirectoryTree | FileStructure;
};

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
): {tree: Tree; language: Language; scheme: string} | null {
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
		return {tree, language, scheme};
	} catch (error) {
		debugLog(`Error parsing file ${filePath}: ${error}`);
		return null;
	}
}

// --- Structure Extraction ---

// ... (keep imports and other code above) ...

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

// Extracts the simplified structure from a parsed file (No changes needed in this function for now)
function extractStructure(
	tree: Tree,
	language: Language,
	scheme: string,
	filePath: string,
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

		return {
			type: 'file_structure',
			filePath: filePath,
			items: rootItems,
		};
	} catch (error) {
		debugLog(
			`Error during structure extraction for ${filePath} using scheme ${scheme}: ${error}`,
		);
		console.error(`Error extracting structure for ${filePath}:`, error);
		return null;
	}
}

// ... (buildTreeRecursive and generateDirectoryTreeJson remain the same) ...
// Recursive helper function (no changes needed here)
function buildTreeRecursive(
	currentPath: string,
	rootDir: string,
	parser: Parser,
	ig: ReturnType<typeof ignore>,
): DirectoryTree {
	// debugLog(`--> Processing directory: ${path.relative(rootDir, currentPath) || '.'}`);
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

	for (const entry of entries) {
		const fullPath = path.join(currentPath, entry.name);
		const relativePath = path.relative(rootDir, fullPath);
		const entryKey = entry.name;

		if (ig.ignores(relativePath)) continue;
		if (entry.isDirectory() && entry.name === '.git') continue;

		if (entry.isDirectory()) {
			const subtree = buildTreeRecursive(fullPath, rootDir, parser, ig);
			if (Object.keys(subtree).length > 0) {
				directoryContent[entryKey] = subtree;
			}
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (IMPORTANT_EXTENSIONS.includes(ext)) {
				const parseResult = parseFile(fullPath, parser);
				if (parseResult) {
					const {tree, language, scheme} = parseResult;
					// debugLog(`Extracting structure for: ${relativePath} using scheme ${scheme}`);
					const structure = extractStructure(
						tree,
						language,
						scheme,
						relativePath,
					);
					if (structure && structure.items.length > 0) {
						directoryContent[entryKey] = structure;
						debugLog(
							`    [Added Structure] For file: ${entryKey} (${structure.items.length} root items found)`,
						);
					} else {
						// debugLog(`    [Skipped Empty Structure] For file: ${entryKey}`);
					}
				}
			}
		}
	}
	// debugLog(`<-- Finished processing directory: ${path.relative(rootDir, currentPath) || '.'}. Items found: ${Object.keys(directoryContent).length}`);
	return directoryContent;
}

// --- Main Function --- (no changes needed here)

/**
 * Builds a JSON representation of a directory's structure, including
 * simplified code structure (classes, methods, functions with line numbers)
 * for supported files, respecting .gitignore rules.
 * Writes the output to {directoryName}.tree.json in the root directory.
 *
 * @param rootDir The absolute path to the root directory to scan.
 * @param parser A Tree-sitter parser instance.
 */
export function generateDirectoryTreeJson(
	rootDir: string,
	parser: Parser,
): void {
	debugLog(`=== Starting directory scan for ${rootDir} ===`);

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
	ig.add(['node_modules', '.git', '*.tree.json', 'logs']);
	debugLog('Added implicit ignores: node_modules, .git, *.tree.json, logs');

	const treeContent = buildTreeRecursive(rootDir, rootDir, parser, ig);

	const rootDirName = path.basename(rootDir);
	const safeRootDirName = rootDirName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
	const finalOutput: DirectoryTree = {
		[safeRootDirName]: treeContent,
	};

	const outputFileName = `${safeRootDirName}.tree.json`;
	const outputFilePath = path.join(rootDir, outputFileName);

	debugLog(`Attempting to write directory tree JSON to: ${outputFilePath}`);

	try {
		const jsonContent = JSON.stringify(finalOutput, null, 2);
		fs.writeFileSync(outputFilePath, jsonContent, {encoding: 'utf8'});
		debugLog(`Successfully wrote directory tree JSON to: ${outputFilePath}`);
		console.log(`Successfully generated structure file: ${outputFilePath}`);
	} catch (error) {
		debugLog(
			`Error writing directory tree JSON file to ${outputFilePath}: ${error}`,
		);
		console.error(`Failed to write tree JSON for ${rootDir}: ${error}`);
	}

	debugLog(`=== Finished directory scan for ${rootDir} ===`);
}

// ... (Example usage) ...
