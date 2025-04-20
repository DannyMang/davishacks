import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import TextInput from 'ink-text-input';
import {FileTree} from './components/FileTree.js';
import * as fs from 'fs';
import * as path from 'path';
import {DocManager} from './services/DocManager.js';
import {LoadingCat} from './components/LoadingCat.js';
import {Menu, MenuOption} from './components/Menu.js';
import {updateApiKey} from './services/ConfigMangagement.js';
import ChatInterface from './components/ChatInterface.js'; // Adjusted import path based on potential structure
import clipboard from 'clipboardy'; // Import a clipboard library
import {generateDirectoryTreeJson} from './treesitter.js';
import Parser from 'tree-sitter';

/**
 * Interface representing a node in the file tree.
 */
interface FileNode {
	/**
	 * The name of the file or directory.
	 */
	name: string;
	/**
	 * The type of the node, either 'file' or 'directory'.
	 */
	type: 'file' | 'directory';
	/**
	 * An optional array of child nodes if the node is a directory.
	 */
	children?: FileNode[];
	/**
	 * Optional documentation string associated with the file.
	 */
	documentation?: string;
	/**
	 * Optional preview of the file's content.
	 */
	preview?: string;
}

// Directories to ignore
const IGNORED_DIRS = new Set([
	'node_modules',
	'dist',
	'.git',
	'coverage',
	'.next',
	'.cache',
]);

// File extensions we're interested in (used by getAllFilesFromStructure)
const INTERESTING_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.py',
	'.rb',
	'.java',
	'.go',
	'.cpp',
	'.c',
	'.h',
	'.hpp',
	// '.md', // Generally don't auto-document markdown itself
	// '.txt', // Generally don't auto-document text files
]);

const COMMON_FILES = new Set([
	'.json',
	'.log',
	'.md',
	'.txt',
	'.yml',
	'.yaml',
	'.env',
	'.gitignore',
	'LICENSE',
	'README',
]);

const DEBUG = true;
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'davishacks-debug.log');

// Initialize logging first
try {
	// Create logs directory if it doesn't exist
	if (!fs.existsSync(LOGS_DIR)) {
		fs.mkdirSync(LOGS_DIR, {recursive: true});
	}
	// Clear/create the log file
	fs.writeFileSync(
		LOG_FILE,
		`=== New Session Started at ${new Date().toISOString()} ===\n`,
	);
} catch (error) {
	console.error('Failed to initialize logging:', error);
}

/**
 * Logs a debug message to the log file if DEBUG is true.
 * @param {string} message - The message to log.
 * @returns {void}
 */
const debugLog = (message: string) => {
	if (DEBUG) {
		const timestamp = new Date().toISOString();
		const logMessage = `[${timestamp}] ${message}\n`;
		try {
			fs.appendFileSync(LOG_FILE, logMessage);
		} catch (error) {
			// Silently fail as we can't use console.log during Ink rendering
		}
	}
};

debugLog('Logging system initialized');

/**
 * Retrieves a preview of a file's content by reading the first N lines.
 * @param {string} filePath - The path to the file.
 * @param {number} [lines=10] - Max number of lines to preview.
 * @returns {string} A string containing the first N lines of the file, or an error message.
 */
const getFilePreview = (filePath: string, maxLines: number = 10): string => {
	try {
		// Use absolute path for reading
		const absolutePath = path.resolve(filePath);
		debugLog(`Attempting to read file preview: ${absolutePath}`);
		if (!fs.existsSync(absolutePath)) {
			debugLog(`File does not exist: ${absolutePath}`);
			return 'File does not exist';
		}
		const content = fs.readFileSync(absolutePath, 'utf-8');
		const lines = content.split('\n').slice(0, maxLines); // Get first N lines
		return lines.join('\n') + (lines.length >= maxLines ? '\n...' : '');
	} catch (error: any) {
		debugLog(
			`Error reading file ${filePath} (resolved: ${path.resolve(
				filePath,
			)}): ${error}`,
		);
		return `Unable to read file content: ${error?.message || 'Unknown error'}`;
	}
};

const isCommonFile = (filename: string): boolean => {
	const ext = path.extname(filename).toLowerCase();
	const basename = path.basename(filename);
	return COMMON_FILES.has(ext) || COMMON_FILES.has(basename);
};

// This function provides the structure for the FileTree UI component
// It does NOT use tree-sitter and doesn't include detailed code items or hashes.
const readDirectoryForUI = (dirPath: string, level = 0): FileNode => {
	const indent = '  '.repeat(level);
	// Use the resolved absolute path internally for consistency
	const absoluteDirPath = path.resolve(dirPath);
	const name = path.basename(absoluteDirPath);
	// debugLog(`${indent}Reading UI structure for: ${absoluteDirPath}`);

	try {
		const stats = fs.statSync(absoluteDirPath); // Use absolute path

		if (stats.isDirectory()) {
			if (IGNORED_DIRS.has(name) || name === '.git') {
				return {name, type: 'directory', children: []};
			}

			const items = fs.readdirSync(absoluteDirPath); // Use absolute path
			const children = items
				.map(item => {
					// Construct the full path using resolve to ensure it's absolute
					const fullPath = path.resolve(absoluteDirPath, item);
					if (item.startsWith('.')) return null; // Skip hidden files/dirs
					// Recursive call MUST use the correctly resolved fullPath
					return readDirectoryForUI(fullPath, level + 1);
				})
				.filter((child): child is FileNode => {
					// Filter logic remains the same
					if (child === null) return false;
					if (child.type === 'file') return true;
					if (child.type === 'directory') {
						return Array.isArray(child.children) && child.children.length > 0;
					}
					return false;
				});

			return {name, type: 'directory', children};
		} else if (stats.isFile()) {
			return {name, type: 'file'};
		} else {
			return {name: `${name} (unsupported type)`, type: 'file'};
		}
	} catch (error) {
		// Log the absolute path that failed
		debugLog(
			`${indent}Error reading UI structure for ${absoluteDirPath}: ${error}`,
		);
		// Include the absolute path in the error node documentation for clarity
		return {
			name: `${name} (error)`,
			type: 'file',
			documentation: `Error accessing ${absoluteDirPath}: ${error}`,
		};
	}
};

/**
 * Interface defining the props for the App component.
 */
interface AppProps {
	/**
	 * The workspace path to display documentation for. Defaults to the current working directory.
	 */
	path?: string;
}

// Function to handle generation of documentation
const GenerateMode: React.FC<{
	workspacePath: string;
	onBack: () => void;
}> = ({workspacePath, onBack}) => {
	const [fileStructure, setFileStructure] = useState<FileNode | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [selectedFileContent, setSelectedFileContent] = useState<string | null>(
		null,
	);
	const [selectedFileDocs, setSelectedFileDocs] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadingMessage, setLoadingMessage] = useState('Initializing...');
	// Initialize DocManager with the absolute workspacePath passed as prop
	const [docManager] = useState(() => new DocManager(workspacePath));
	const [copySuccess, setCopySuccess] = useState<boolean>(false);

	// Add clipboard handler using a Node.js library
	const handleCopy = useCallback(async () => {
		if (selectedFileDocs) {
			try {
				await clipboard.write(selectedFileDocs); // Use clipboardy
				setCopySuccess(true);
			} catch (err) {
				debugLog(`Error copying to clipboard: ${err}`);
				setCopySuccess(false);
			}
		}
	}, [selectedFileDocs]);

	useInput((input, key) => {
		// Handle going back
		if (key.ctrl && input.toLowerCase() === 'b') {
			onBack();
		}
		// Handle copying documentation with Shift+C
		else if (key.shift && input.toUpperCase() === 'C') {
			if (
				selectedFileDocs &&
				selectedFileDocs !== '(Common file type - preview only)' &&
				selectedFileDocs !== '(No documentation generated yet)'
			) {
				handleCopy();
			}
		}
		// TODO: Add a keybind here to trigger documentation generation manually?
		// else if (key.shift && input.toUpperCase() === 'G') {
		//    triggerDocumentationGeneration(); // Need to implement this function
		// }
	});

	// This useEffect now only initializes the UI state and loads existing data
	// It should NOT modify source files.
	useEffect(() => {
		async function initializeUI() {
			setIsLoading(true);
			setError(null);
			setFileStructure(null);
			setLoadingMessage('Scanning project files...');
			debugLog('=== Initializing GenerateMode UI ===');
			// workspacePath prop is already resolved to absolute in App component
			debugLog(`Using workspace path: ${workspacePath}`);

			try {
				// Directly call readDirectoryForUI and check its result
				const uiStructure = readDirectoryForUI(workspacePath); // Pass the absolute path

				// Check if the root operation itself failed within readDirectoryForUI
				if (uiStructure.name.includes('(error)')) {
					// Extract the more detailed error from the node if available
					throw new Error(
						`Failed to read workspace root: ${
							uiStructure.documentation ||
							'Unknown error reading directory structure'
						}`,
					);
				}

				// Check if the structure is empty (might be valid, but good to log)
				if (
					uiStructure.type === 'directory' &&
					(!uiStructure.children || uiStructure.children.length === 0)
				) {
					debugLog(
						`Workspace scan resulted in an empty directory structure for ${workspacePath}`,
					);
				} else {
					debugLog(`File scan for UI completed successfully.`);
				}

				setFileStructure(uiStructure); // Set UI state
			} catch (err) {
				// This catch block will catch errors explicitly thrown above,
				// or potentially unexpected errors from deep within fs calls.
				const errorMsg =
					err instanceof Error ? err.message : 'Failed to scan workspace';
				// Format the error clearly for the UI
				const finalError = `Initialization Error: ${errorMsg}`;
				debugLog(`Error during UI initialization: ${err}`); // Log the full error object/stack
				setError(finalError); // Set the formatted error for display
			} finally {
				setIsLoading(false);
				setLoadingMessage(''); // Clear loading message
				debugLog('=== GenerateMode UI Initialization finished ===');
			}
		}

		// Ensure workspacePath is valid before initializing
		if (workspacePath && fs.existsSync(workspacePath)) {
			initializeUI();
		} else {
			setError(
				`Initialization Error: Workspace path not found or invalid: ${workspacePath}`,
			);
			setIsLoading(false);
		}
	}, [workspacePath]); // Only depends on workspacePath

	useEffect(() => {
		if (copySuccess) {
			const timer = setTimeout(() => setCopySuccess(false), 2000);
			return () => clearTimeout(timer);
		}
		return () => {};
	}, [copySuccess]);

	const handleFileSelect = useCallback(
		async (filePath: string) => {
			// filePath received from FileTree is relative to the root displayed by FileTree
			setSelectedFile(filePath);
			setCopySuccess(false);
			setError(null); // Clear previous file-specific errors
			setSelectedFileContent(null);
			setSelectedFileDocs(null);

			// Fix path resolution issues by examining if the filePath overlaps with workspacePath
			let absolutePath;
			const workspaceBaseName = path.basename(workspacePath);

			// Check if filePath already contains the workspace base directory
			if (filePath.startsWith(workspaceBaseName + '/')) {
				// If the relative path already includes the workspace name, resolve from the parent directory
				absolutePath = path.resolve(path.dirname(workspacePath), filePath);
			} else {
				// Normal case - resolve directly from workspace path
				absolutePath = path.resolve(workspacePath, filePath);
			}
			debugLog(
				`File selected: Relative='${filePath}', Absolute='${absolutePath}'`,
			);

			try {
				// Basic check if the resolved path exists before reading
				if (!fs.existsSync(absolutePath)) {
					debugLog(`Selected file path does not exist: ${absolutePath}`);
					setError(`File not found: ${filePath}`); // Show relative path in error
					return;
				}

				const fileName = path.basename(filePath);

				// Handle common files - show preview
				if (isCommonFile(fileName)) {
					debugLog(`Reading common file preview: ${absolutePath}`);
					const preview = getFilePreview(absolutePath, 20);
					setSelectedFileContent(preview);
					setSelectedFileDocs('(Common file type - preview only)');
					return;
				}

				// For other files, try to get docs from DocManager using relative path
				debugLog(`Getting documentation for relative path: ${filePath}`);
				const doc = docManager.getDocumentation(filePath); // Use relative path

				if (doc && doc.summary) {
					debugLog(`Documentation found for: ${filePath}`);
					setSelectedFileContent(
						doc.content || doc.preview || 'No content available',
					);
					setSelectedFileDocs(doc.summary);
				} else {
					debugLog(
						`No cached documentation for: ${filePath}. Showing file preview.`,
					);
					const preview = getFilePreview(absolutePath, 15); // Use absolute path
					setSelectedFileContent(preview);
					setSelectedFileDocs('(No documentation generated yet)');
				}
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Failed to load file details';
				debugLog(
					`Error during file selection processing for ${absolutePath}: ${err}`,
				);
				setError(`Error loading details for ${filePath}: ${errorMsg}`); // Show relative path in error
			}
		},
		[workspacePath, docManager], // Dependencies
	);

	if (error && !isLoading) {
		// Only show root initialization error if not loading
		return (
			<Box flexDirection="column">
				{/* Display the formatted error from state */}
				<Text color="red">{error}</Text>
				<Box marginTop={1}>
					<Text>Press Ctrl+B to go back to menu</Text>
				</Box>
			</Box>
		);
	}

	if (isLoading) {
		return <LoadingCat message={loadingMessage} />;
	}

	if (!fileStructure) {
		return (
			<Box>
				<Text color="yellow">Workspace scan failed or directory is empty.</Text>
				<Box marginTop={1}>
					<Text>Press Ctrl+B to go back to menu</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Documentation Browser - {workspacePath}</Text>
				<Text> (Press Ctrl+B to go back)</Text>
				{copySuccess && <Text color="green"> ✓ Copied to clipboard!</Text>}
			</Box>
			<Box>
				<Box width="50%" marginRight={2}>
					<FileTree
						files={fileStructure} // Pass the root FileNode
						onSelect={handleFileSelect}
						selectedFile={selectedFile} // Pass relative path string
					/>
				</Box>
				<Box width="50%" flexDirection="column">
					{/* Right Pane Logic */}
					{!selectedFile && (
						<Text>Select a file from the tree to view details.</Text>
					)}
					{/* Show loading specifically when a file is selected but details aren't loaded yet */}
					{selectedFile && !selectedFileDocs && !error && (
						<Text color="gray">
							Loading details for {path.basename(selectedFile)}...
						</Text>
					)}
					{/* Show file-specific error if one occurred during handleFileSelect */}
					{selectedFile && error && <Text color="red">{error}</Text>}
					{/* Show details only if docs are loaded (implies content is also potentially loaded) */}
					{selectedFile && selectedFileDocs && !error && (
						<>
							<Text bold>File: {path.basename(selectedFile)}</Text>
							{/* Documentation Section */}
							<Box marginTop={1} flexDirection="column">
								<Text bold>Documentation:</Text>
								<Box
									borderStyle="round"
									borderColor="gray"
									paddingX={1}
									marginY={1}
								>
									<Text>{selectedFileDocs}</Text>
								</Box>
								{selectedFileDocs && !selectedFileDocs.startsWith('(') && (
									<Text dimColor> (Press Shift+C to copy)</Text>
								)}
							</Box>
							{/* Preview/Content Section */}
							{selectedFileContent && (
								<Box marginTop={1} flexDirection="column">
									<Text bold>Preview/Content:</Text>
									<Box
										borderStyle="round"
										borderColor="gray"
										paddingX={1}
										marginY={1}
										height={15} // Use fixed height
										overflowY="hidden"
									>
										<Text dimColor>{selectedFileContent}</Text>
									</Box>
								</Box>
							)}
						</>
					)}
				</Box>
			</Box>
		</Box>
	);
};

// Function to handle chat
const ChatMode: React.FC<{onBack: () => void}> = ({onBack}) => {
	useInput((input, key) => {
		if (key.ctrl && input.toLowerCase() === 'b') {
			onBack();
		}
	});
	return <ChatInterface />;
};

// Function to handle config
const ConfigMode: React.FC<{onBack: () => void}> = ({onBack}) => {
	const [apiKey, setApiKey] = useState('');
	const [isEditing, setIsEditing] = useState(true);
	const [message, setMessage] = useState<string | null>(null);

	useInput((input, key) => {
		if (key.ctrl && input.toLowerCase() === 'b') {
			if (!isEditing) {
				onBack();
			}
		} else if (input.toLowerCase() === 'e' && !isEditing) {
			setIsEditing(true);
			setMessage(null);
		}
	});

	const handleSubmit = (value: string) => {
		const trimmedValue = value.trim();
		if (trimmedValue) {
			setApiKey(trimmedValue);
			setIsEditing(false);
			updateApiKey(trimmedValue);
			setMessage(
				'API key saved successfully! Press Ctrl+B to go back to menu.',
			);
		} else {
			setMessage('API key cannot be empty.');
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold>Configuration</Text>
				<Text>
					{' '}
					(
					{isEditing
						? 'Enter to save, Ctrl+C to cancel edit'
						: 'Press Ctrl+B to go back, E to edit'}
					)
				</Text>
			</Box>

			<Box marginY={1} flexDirection="row">
				<Text>Google API Key: </Text>
				{isEditing ? (
					<TextInput
						value={apiKey}
						onChange={setApiKey}
						onSubmit={handleSubmit}
						placeholder="Enter your Google API key here..."
						showCursor
					/>
				) : (
					<Text color="green">
						{apiKey.length > 8
							? `${apiKey.substring(0, 4)}...${apiKey.substring(
									apiKey.length - 4,
							  )}`
							: '****'}
					</Text>
				)}
			</Box>

			{message && (
				<Box marginTop={1}>
					<Text color={message.includes('successfully') ? 'green' : 'yellow'}>
						{message}
					</Text>
				</Box>
			)}

			<Box marginTop={2}>
				<Text dimColor>
					Your API key will be used for code analysis and generating
					documentation.
				</Text>
				<Text dimColor>It is stored locally in your configuration.</Text>
			</Box>
		</Box>
	);
};

/**
 * Main application component that displays a file tree and documentation for selected files.
 * @param {AppProps} props - The props for the component, including the workspace path.
 * @returns {JSX.Element} The rendered component.
 */
const App: React.FC<AppProps> = ({path: initialPath = process.cwd()}) => {
	// Resolve the initial path to an absolute path ONCE.
	const workspacePath = path.resolve(initialPath);
	debugLog(`Resolved workspace path: ${workspacePath}`);

	const [activeMode, setActiveMode] = useState<MenuOption | null>(null);
	const {exit} = useApp();

	useEffect(() => {
		const parser = new Parser();
		generateDirectoryTreeJson(initialPath, parser);
	}, [initialPath]);

	const handleMenuSelect = (option: MenuOption) => {
		setActiveMode(option);
	};

	const handleBack = () => {
		setActiveMode(null);
	};

	useInput((input, key) => {
		if (activeMode === null && key.ctrl && input.toLowerCase() === 'c') {
			exit();
		}
	});

	if (activeMode === null) {
		return <Menu onSelect={handleMenuSelect} />;
	}

	switch (activeMode) {
		case 'generate':
			// Pass the consistently resolved absolute path
			return <GenerateMode workspacePath={workspacePath} onBack={handleBack} />;
		case 'chat':
			return <ChatMode onBack={handleBack} />;
		case 'config':
			return <ConfigMode onBack={handleBack} />;
		default:
			debugLog(`Invalid mode encountered: ${activeMode}. Returning to menu.`);
			setActiveMode(null);
			return <Menu onSelect={handleMenuSelect} />;
	}
};

/**
 * Helper function to get all files from the file structure recursively.
 * Returns relative paths based on the initial node.
 */
const getAllFilesFromStructure = (
	node: FileNode,
	currentRelativePath = '', // Start with empty relative path
): string[] => {
	// Build the relative path for the current node
	const nodePath = currentRelativePath
		? path.join(currentRelativePath, node.name)
		: node.name;

	if (node.type === 'file') {
		// Only return the path if it's likely a code file we can document
		// This prevents trying to document things like LICENSE, .json, etc.
		const ext = path.extname(node.name).toLowerCase();
		if (
			INTERESTING_EXTENSIONS.has(ext) &&
			!COMMON_FILES.has(ext) &&
			!COMMON_FILES.has(node.name) &&
			!node.name.startsWith('.')
		) {
			return [nodePath]; // Return the relative path
		} else {
			return []; // Don't include non-documentable files
		}
	}

	if (node.type === 'directory' && node.children) {
		// Recursively call for children, passing the current node's relative path
		return node.children.flatMap(child =>
			getAllFilesFromStructure(child, nodePath),
		);
	}

	return []; // Return empty array for empty directories or other cases
};

export default App;
