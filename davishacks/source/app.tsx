import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import {FileTree} from './components/FileTree.js';
import * as fs from 'fs';
import * as path from 'path';
import {DocManager} from './services/DocManager.js';
import {generateDirectoryTreeJson} from './treesitter.js';
import Parser from 'tree-sitter';
import {LoadingCat} from './components/LoadingCat.js';

interface FileNode {
	name: string;
	type: 'file' | 'directory';
	children?: FileNode[];
	documentation?: string;
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

const getFilePreview = (filePath: string): string => {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n').slice(0, 5); // Get first 5 lines
		return lines.join('\n') + (lines.length >= 5 ? '\n...' : '');
	} catch {
		return 'Unable to read file content';
	}
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

interface AppProps {
	path?: string;
}

const App: React.FC<AppProps> = ({path: workspacePath = process.cwd()}) => {
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
		const normalizedPath = workspacePath.replace(/davishacks\/davishacks/, 'davishacks');
		return new DocManager(normalizedPath);
	});

	const parser = new Parser();

	useEffect(() => {
		generateDirectoryTreeJson(process.cwd(), parser);
		debugLog('=== Starting file scan ===');
		debugLog(`Current directory: ${process.cwd()}`);
		debugLog(`Target path: ${workspacePath}`);

		const initialize = async () => {
			try {
				debugLog('=== Starting initialization ===');
				debugLog(`Current directory: ${process.cwd()}`);
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

	// Helper function to update file preview in the structure
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
			<Box>
				<Text color="red">Error: {error}</Text>
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
									<Text dimColor>{selectedFileContent?.split('\n').slice(0, 5).join('\n')}</Text>
								</Box>
							</Box>
						</>
					)}
				</Box>
			</Box>
		</Box>
	);
};

// Helper function to get all files from the file structure
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
