import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {FileTree} from './components/FileTree.js';
import * as fs from 'fs';
import * as path from 'path';
import {DocManager} from './services/DocManager.js';
import {generateDirectoryTreeJson} from './treesitter.js';
import Parser from 'tree-sitter';
import {LoadingCat} from './components/LoadingCat.js';
import {Menu, MenuOption} from './components/Menu.js';

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
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n').slice(0, 5); // Get first 5 lines
		return lines.join('\n') + (lines.length >= 5 ? '\n...' : '');
	} catch {
		return 'Unable to read file content';
	}
};

/**
 * Recursively reads a directory and its subdirectories to create a file tree structure.
 * @param {string} dirPath - The path to the directory to read.
 * @param {number} [level=0] - The current level of recursion (used for indentation).
 * @returns {FileNode} A FileNode object representing the directory and its contents.
 */
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

	const parser = new Parser();

	useInput(input => {
		if (input === 'b' || input === 'B') {
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

	/**
	 * Handles the selection of a file in the file tree, loading its content and documentation.
	 * @param {string} filePath - The path to the selected file.
	 * @returns {Promise<void>}
	 */
	const handleFileSelect = async (filePath: string) => {
		setSelectedFile(filePath);
		try {
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

	if (error) {
		return (
			<Box flexDirection="column">
				<Text color="red">Error: {error}</Text>
				<Box marginTop={1}>
					<Text>Press 'b' to go back to the menu</Text>
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
				<Text> (Press 'b' to go back to menu)</Text>
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
	useInput(input => {
		if (input === 'b' || input === 'B') {
			onBack();
		}
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Chat with Codebase</Text>
				<Text> (Press 'b' to go back to menu)</Text>
			</Box>
			<Text>Chat feature coming soon...</Text>
		</Box>
	);
};

// Function to handle config
const ConfigMode: React.FC<{onBack: () => void}> = ({onBack}) => {
	useInput(input => {
		if (input === 'b' || input === 'B') {
			onBack();
		}
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Configuration</Text>
				<Text> (Press 'b' to go back to menu)</Text>
			</Box>
			<Text>Configuration feature coming soon...</Text>
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

	useInput(input => {
		if ((input === 'b' || input === 'B') && activeMode !== null) {
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

	return [];
};

export default App;
