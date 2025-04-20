import React, {useState} from 'react';
import {Box, Text} from 'ink';
import {useFocus, useInput} from 'ink';
import clipboardy from 'clipboardy';

interface FileNode {
	name: string;
	type: 'file' | 'directory';
	children?: FileNode[];
	documentation?: string;
	preview?: string;
}

interface FileTreeProps {
	files: FileNode;
	selectedFile: string | null;
	onSelect: (path: string) => void;
	level?: number;
	parentPath?: string;
}

export const copyToClipboard = async (text: string): Promise<void> => {
	try {
		await clipboardy.write(text);
		return Promise.resolve();
	} catch (error) {
		console.error('Failed to copy to clipboard:', error);
		return Promise.reject(error);
	}
};

// Flatten the file tree into a list for easier navigation
const flattenTree = (
	node: FileNode,
	parentPath = '',
	level = 0,
): Array<{node: FileNode; path: string; level: number}> => {
	const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
	const result = [{node, path: currentPath, level}];

	if (node.type === 'directory' && node.children) {
		node.children.forEach(child => {
			result.push(...flattenTree(child, currentPath, level + 1));
		});
	}

	return result;
};

export const FileTree: React.FC<FileTreeProps> = ({
	files,
	selectedFile,
	onSelect,
	level = 0,
}) => {
	const [focusedIndex, setFocusedIndex] = useState(0);
	const {isFocused} = useFocus({autoFocus: level === 0});
	const flattenedFiles = flattenTree(files);

	useInput(async (input, key) => {
		if (!isFocused) return;

		if (key.upArrow) {
			setFocusedIndex(prev => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setFocusedIndex(prev => Math.min(flattenedFiles.length - 1, prev + 1));
		} else if (key.return || input === ' ') {
			const focusedItem = flattenedFiles[focusedIndex];
			if (focusedItem && focusedItem.node.type === 'file') {
				onSelect(focusedItem.path);
			}
		} else if (input == 'c') {
			const focusedItem = flattenedFiles[focusedIndex];
			if (focusedItem && focusedItem.node.type === 'file') {
				await copyToClipboard(focusedItem.node.documentation || '');
			}
		}
	});

    const renderItem = (item: {node: FileNode; path: string; level: number}, index: number) => {
        const prefix = '  '.repeat(item.level);
        const isCommonFile = item.node.documentation === 'Common file type - preview only';
        const icon = item.node.type === 'directory' ? '📁' : isCommonFile ? '📝' : '📄';
        const isSelected = selectedFile === item.path;
        const isFocusedItem = index === focusedIndex && isFocused;

		return (
			<Box key={item.path}>
				<Text
					color={isFocusedItem ? 'blue' : isSelected ? 'green' : undefined}
					bold={isSelected || isFocusedItem}
					dimColor={!isFocusedItem && !isSelected}
				>
					{prefix}
					{icon} {item.node.name}
					{isFocusedItem && item.node.type === 'file'
						? ' (Press Enter or Space)'
						: ''}
				</Text>
			</Box>
		);
	};

	return (
		<Box flexDirection="column">
			{flattenedFiles.map((item, index) => renderItem(item, index))}
		</Box>
	);
};
