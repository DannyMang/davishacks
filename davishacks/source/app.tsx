import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {FileTree} from './components/FileTree.js';
import * as fs from 'fs';
import * as path from 'path';
import {DocManager} from './services/DocManager.js';
import {generateDirectoryTreeJson} from './treesitter.js';
import Parser from 'tree-sitter';
import {LoadingCat} from './components/LoadingCat.js';
import {Menu, MenuOption} from './components/Menu.js';
import {updateApiKey} from './services/ConfigMangagement.js';
import ChatInterface from './components/ChatInterface.js';

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

// File extensions we're interested in
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
	'.md',
	'.txt',
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
 * Retrieves a preview of a file's content by reading the first 5 lines.
 * @param {string} filePath - The path to the file.
 * @returns {string} A string containing the first 5 lines of the file, or an error message if the file cannot be read.
 */
const getFilePreview = (filePath: string): string => {
	try {
		debugLog(`Attempting to read file: ${filePath}`);
		if (!fs.existsSync(filePath)) {
			debugLog(`File does not exist: ${filePath}`);
			return 'File does not exist';
		}
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n').slice(0, 5); // Get first 5 lines
		return lines.join('\n') + (lines.length >= 5 ? '\n...' : '');
	} catch (error: any) {
		debugLog(`Error reading file ${filePath}: ${error}`);
		return `Unable to read file content: ${error?.message || 'Unknown error'}`;
	}
};

const isCommonFile = (filename: string): boolean => {
	const ext = path.extname(filename).toLowerCase();
	const basename = path.basename(filename);
	return COMMON_FILES.has(ext) || COMMON_FILES.has(basename);
};

const readDirectory = (dirPath: string, level = 0): FileNode => {
	const indent = '  '.repeat(level);
	const name = path.basename(dirPath);
	debugLog(`${indent}Reading: ${dirPath}`);

	try {
		const stats = fs.statSync(dirPath);

		// Handle directories
		if (stats.isDirectory()) {
			if (IGNORED_DIRS.has(name)) {
				debugLog(`${indent}Skipping ignored directory: ${name}`);
				return {
					name,
					type: 'directory',
					children: [],
				};
			}

			debugLog(`${indent}Processing directory: ${name}`);
			const items = fs.readdirSync(dirPath);
			debugLog(`${indent}Found ${items.length} items in ${name}`);

			const children = items
				.filter(item => !item.startsWith('.'))
				.map(item => {
					const fullPath = path.join(dirPath, item);
					return readDirectory(fullPath, level + 1);
				})
				.filter(child => {
					if (
						child.type === 'directory' &&
						(!child.children || child.children.length === 0)
					) {
						debugLog(`${indent}  Skipping empty directory: ${child.name}`);
						return false;
					}
					return true;
				});

			debugLog(
				`${indent}Directory ${name} has ${children.length} valid children`,
			);
			return {
				name,
				type: 'directory',
				children,
			};
		}

		// Handle files
		const ext = path.extname(name).toLowerCase();
		if (!INTERESTING_EXTENSIONS.has(ext)) {
			debugLog(`${indent}Skipping uninteresting file: ${name} (${ext})`);
			// If it's a common file type, include it with just a preview
			if (isCommonFile(name)) {
				return {
					name,
					type: 'file',
					preview: getFilePreview(dirPath),
					documentation: 'Common file type - preview only',
				};
			}
			return {
				name,
				type: 'file',
				documentation: 'Not a supported file type',
			};
		}

		debugLog(`${indent}Including file: ${name}`);
		return {
			name,
			type: 'file',
			documentation: 'Documentation will be generated here',
			preview: getFilePreview(dirPath),
		};
	} catch (error) {
		debugLog(`${indent}Error processing ${dirPath}: ${error}`);
		return {
			name,
			type: 'file',
			documentation: `Error: ${error}`,
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
	const [docManager] = useState(() => {
		// Remove any duplicate davishacks from the workspace path
		const normalizedPath = workspacePath.replace(
			/davishacks\/davishacks/,
			'davishacks',
		);
		return new DocManager(normalizedPath);
	});
	const [copySuccess, setCopySuccess] = useState<boolean>(false);

	const parser = new Parser();

	useInput((input, key) => {
		if (key.ctrl && input.toLowerCase() === 'b') {
			onBack();
		}
	});

	useEffect(() => {
		async function process() {
			generateDirectoryTreeJson(workspacePath, parser, true, true);
		}
		process();
		debugLog('=== Starting file scan ===');
		debugLog(`Current directory: ${workspacePath}`);
		debugLog(`Target path: ${workspacePath}`);

		const initialize = async () => {
			try {
				debugLog('=== Starting initialization ===');
				debugLog(`Current directory: ${workspacePath}`);
				debugLog(`Target path: ${workspacePath}`);

				// Normalize the workspace path
				const normalizedPath = workspacePath.replace(
					/davishacks\/davishacks/,
					'davishacks',
				);
				const structure = readDirectory(normalizedPath);
				debugLog('File scan completed successfully');
				setFileStructure(structure);

				// Get all files that need documentation
				const filesToDocument = getAllFilesFromStructure(structure);
				setLoadingMessage(
					`Generating documentation for ${filesToDocument.length} files...`,
				);

				// Generate documentation for all files
				await docManager.generateAllDocumentation(filesToDocument);

				setIsLoading(false);
				debugLog('Initialization complete');
			} catch (err) {
				const errorMsg =
					err instanceof Error ? err.message : 'Failed to initialize';
				debugLog(`Error during initialization: ${errorMsg}`);
				setError(errorMsg);
				setIsLoading(false);
			}
		};

		initialize();

		try {
			// Normalize the workspace path to handle nested davishacks directory
			const normalizedPath = workspacePath.replace(
				/davishacks\/davishacks/,
				'davishacks',
			);
			const structure = readDirectory(normalizedPath);
			debugLog('File scan completed successfully');
			setFileStructure(structure);
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : 'Failed to read directory';
			debugLog(`Error during file scan: ${errorMsg}`);
			setError(errorMsg);
		}
	}, [workspacePath, docManager]);

	useEffect(() => {
		if (copySuccess) {
			const timer = setTimeout(() => setCopySuccess(false), 2000);
			return () => clearTimeout(timer);
		}
		return () => {};
	}, [copySuccess]);

	const handleFileSelect = async (filePath: string) => {
		setSelectedFile(filePath);
		try {
			const fileName = path.basename(filePath);
			// Handle common files differently
			if (isCommonFile(fileName)) {
				// Use absolute path resolution
				const absolutePath = path.join(workspacePath, filePath);
				debugLog(`Reading common file: ${absolutePath}`);
				const preview = getFilePreview(absolutePath);
				setSelectedFileContent(preview);
				setSelectedFileDocs('Common file type - preview only');
				return;
			}

			// Get existing documentation
			const doc = docManager.getDocumentation(filePath);
			if (doc) {
				setSelectedFileContent(doc.content);
				setSelectedFileDocs(doc.summary);

				// Update the file structure with the preview
				setFileStructure(prevStructure => {
					if (!prevStructure) return null;
					return updateFilePreview(prevStructure, filePath, doc.preview);
				});
			}
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : 'Failed to load documentation';
			debugLog(`Error loading documentation: ${errorMsg}`);
			setError(errorMsg);
			setSelectedFileContent('Error loading preview');
			setSelectedFileDocs('Error loading documentation');
		}
	};

	/**
	 * Helper function to update the file preview in the file structure.
	 * @param {FileNode} node - The current node in the file structure.
	 * @param {string} targetPath - The path to the file to update.
	 * @param {string} preview - The new preview content for the file.
	 * @returns {FileNode} The updated FileNode.
	 */
	const updateFilePreview = (
		node: FileNode,
		targetPath: string,
		preview: string,
	): FileNode => {
		if (node.type === 'file' && node.name === path.basename(targetPath)) {
			return {
				...node,
				preview,
			};
		}

		if (node.type === 'directory' && node.children) {
			return {
				...node,
				children: node.children.map(child =>
					updateFilePreview(child, targetPath, preview),
				),
			};
		}

		return node;
	};

	// Add clipboard handler
	const handleCopy = async () => {
		if (selectedFileDocs) {
			try {
				await navigator.clipboard.writeText(selectedFileDocs);
				setCopySuccess(true);
			} catch (err) {
				debugLog(`Error copying to clipboard: ${err}`);
			}
		}
	};

	// Add key handler for copying
	useEffect(() => {
		const handleKeyPress = (key: Buffer) => {
			// Check for Ctrl+C (3) or Cmd+C (3)
			if (key[0] === 3 && selectedFileDocs) {
				handleCopy();
			}
		};

		process.stdin.on('data', handleKeyPress);
		return () => {
			process.stdin.removeListener('data', handleKeyPress);
		};
	}, [selectedFileDocs]);

	if (error) {
		return (
			<Box flexDirection="column">
				<Text color="red">Error: {error}</Text>
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
				<Text>Loading...</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Documentation Browser - {workspacePath}</Text>
				<Text> (Press Ctrl+B to go back to menu)</Text>
				{copySuccess && <Text color="green"> ✓ Copied to clipboard!</Text>}
			</Box>
			<Box>
				<Box width="50%" marginRight={2}>
					<FileTree
						files={fileStructure}
						onSelect={handleFileSelect}
						selectedFile={selectedFile}
					/>
				</Box>
				<Box width="50%" flexDirection="column">
					{selectedFile && (
						<>
							<Text bold>File: {selectedFile.split('/').pop()}</Text>
							{selectedFileDocs && (
								<Box marginTop={1} flexDirection="column">
									<Text bold>Documentation:</Text>
									<Box marginLeft={1} marginTop={1}>
										<Text>{selectedFileDocs}</Text>
										<Text dimColor> (Press Cmd/Ctrl+C to copy)</Text>
									</Box>
								</Box>
							)}
							<Box marginTop={1} flexDirection="column">
								<Text bold>Preview:</Text>
								<Box marginLeft={1} marginTop={1}>
									<Text dimColor>
										{selectedFileContent?.split('\n').slice(0, 5).join('\n')}
									</Text>
								</Box>
							</Box>
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

	return (
		// <Box flexDirection="column">
		// 	<Box marginBottom={1}>
		// 		<Text bold>Chat with Codebase</Text>
		// 		<Text> (Press Ctrl+B to go back to menu)</Text>
		// 	</Box>
		// 	<Text>Chat feature coming soon...</Text>
		// </Box>
		<ChatInterface />
	);
};

// Function to handle config
const ConfigMode: React.FC<{onBack: () => void}> = ({onBack}) => {
	const [apiKey, setApiKey] = useState('');
	const [isEditing, setIsEditing] = useState(true);
	const [message, setMessage] = useState<string | null>(null);

	useInput((input, key) => {
		// Check for Alt+B instead of just B
		if (key.ctrl && input.toLowerCase() === 'b') {
			if (!isEditing) {
				onBack();
			}
		} else if (input === 'e' && !isEditing) {
			// Allow editing again with 'e'
			setIsEditing(true);
		}
	});

	const handleSubmit = (value: string) => {
		setApiKey(value);
		setIsEditing(false);
		// Display success message
		updateApiKey(value);

		setMessage('API key saved successfully! Press Ctrl+B to go back to menu.');
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold>Configuration</Text>
				<Text>
					{' '}
					({isEditing ? 'Enter to save' : 'Press Ctrl+B to go back to menu'})
				</Text>
			</Box>

			<Box marginY={1}>
				<Text>Google API Key: </Text>
				{isEditing ? (
					<TextInput
						value={apiKey}
						onChange={setApiKey}
						onSubmit={handleSubmit}
						placeholder="Enter your Google API key"
						showCursor
					/>
				) : (
					<Text color="green">
						{apiKey.substring(0, 4)}...{apiKey.substring(apiKey.length - 4)}
					</Text>
				)}
			</Box>

			{!isEditing && (
				<Box marginTop={1}>
					<Text color="cyan">Press 'e' to edit API key again</Text>
				</Box>
			)}

			{message && (
				<Box marginTop={1}>
					<Text color="green">{message}</Text>
				</Box>
			)}

			<Box marginTop={2}>
				<Text dimColor>
					Your API key will be used for code analysis and generating
					documentation.
				</Text>
			</Box>
		</Box>
	);
};

/**
 * Main application component that displays a file tree and documentation for selected files.
 * @param {AppProps} props - The props for the component, including the workspace path.
 * @returns {JSX.Element} The rendered component.
 */
const App: React.FC<AppProps> = ({path: workspacePath = process.cwd()}) => {
	const [activeMode, setActiveMode] = useState<MenuOption | null>(null);

	const handleMenuSelect = (option: MenuOption) => {
		setActiveMode(option);
	};

	const handleBack = () => {
		setActiveMode(null);
	};

	useInput((input, key) => {
		if (key.ctrl && input.toLowerCase() === 'b') {
			handleBack();
		}
	});

	if (activeMode === null) {
		return <Menu onSelect={handleMenuSelect} />;
	}

	switch (activeMode) {
		case 'generate':
			return <GenerateMode workspacePath={workspacePath} onBack={handleBack} />;
		case 'chat':
			return <ChatMode onBack={handleBack} />;
		case 'config':
			return <ConfigMode onBack={handleBack} />;
		default:
			return <Menu onSelect={handleMenuSelect} />;
	}
};

/**
 * Helper function to get all files from the file structure.
 * @param {FileNode} node - The root node of the file structure.
 * @param {string} [currentPath=''] - The current path being traversed.
 * @returns {string[]} An array of file paths.
 */
const getAllFilesFromStructure = (
	node: FileNode,
	currentPath = '',
): string[] => {
	const path = currentPath ? `${currentPath}/${node.name}` : node.name;

	if (node.type === 'file') {
		return [path];
	}

	if (node.type === 'directory' && node.children) {
		return node.children.flatMap(child =>
			getAllFilesFromStructure(child, path),
		);
	}

	return []; // Return empty array for any other case (like directory without children)
};

export default App;
