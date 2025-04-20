import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import {FileTree} from './components/FileTree.js';
import * as fs from 'fs';
import * as path from 'path';
import {DocManager} from './services/DocManager.js';
import {generateDirectoryTreeJson} from './treesitter.js';
import Parser from 'tree-sitter';

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
	const [docManager] = useState(() => new DocManager(workspacePath));

	const parser = new Parser();

	useEffect(() => {
		generateDirectoryTreeJson(process.cwd(), parser);
		debugLog('=== Starting file scan ===');
		debugLog(`Current directory: ${process.cwd()}`);
		debugLog(`Target path: ${workspacePath}`);

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
	}, [workspacePath]);

	const handleFileSelect = async (filePath: string) => {
		setSelectedFile(filePath);
		try {
			// Normalize the file path
			const normalizedPath = filePath.replace(
				/davishacks\/davishacks/,
				'davishacks',
			);

			// Get or generate documentation
			let doc = docManager.getDocumentation(normalizedPath);
			if (!doc) {
				doc = await docManager.generateDocumentation(normalizedPath);
				await docManager.generateHtml(); // Update HTML docs
			}
			setSelectedFileContent(doc.content);
			setSelectedFileDocs(doc.summary);
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : 'Failed to generate documentation';
			debugLog(`Error generating documentation: ${errorMsg}`);
			setError(errorMsg);
		}
	};

	if (error) {
		return (
			<Box>
				<Text color="red">Error: {error}</Text>
			</Box>
		);
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
									<Text>{selectedFileContent || 'No preview available'}</Text>
								</Box>
							</Box>
						</>
					)}
				</Box>
			</Box>
		</Box>
	);
};

export default App;
