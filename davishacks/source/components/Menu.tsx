import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export type MenuOption = 'generate' | 'chat' | 'config';

interface MenuProps {
	onSelect: (option: MenuOption) => void;
}

// Using cat frames from LoadingCat component
const CAT_FRAME = `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`;

// Different cat poses for each option
const OPTION_CATS = {
	generate: `
    /\\___/\\     📚
   (  o o  )
   (  =^=  ) ~
    (______)`,
	chat: `
    /\\___/\\     💬
   (  - o  )
   (  =^=  ) ~
    (______)`,
	config: `
    /\\___/\\     ⚙️
   (  o o  )
   (  =^=  ) 🔧
    (______)`,
};

export const Menu: React.FC<MenuProps> = ({onSelect}) => {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const options: {label: string; value: MenuOption}[] = [
		{label: 'Generate Documentation', value: 'generate'},
		{label: 'Chat with Codebase', value: 'chat'},
		{label: 'Configuration', value: 'config'},
	];

	useInput((_, key) => {
		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
		} else if (key.downArrow) {
			setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : prev));
		} else if (key.return) {
			// Add null check to avoid "possibly undefined" error
			const option = options[selectedIndex];
			if (option) {
				onSelect(option.value);
			}
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box flexDirection="column" marginBottom={1} alignItems="center">
				<Text color="magenta">{CAT_FRAME}</Text>
				<Text bold>Code Assistant</Text>
				<Text>Choose an option:</Text>
			</Box>
			{options.map((option, index) => (
				<Box key={option.value} marginY={1} flexDirection="column">
					<Box marginLeft={selectedIndex === index ? 2 : 0}>
						<Text color={index === selectedIndex ? 'green' : 'gray'}>
							{OPTION_CATS[option.value]}
						</Text>
					</Box>
					<Box marginLeft={4}>
						<Text
							color={index === selectedIndex ? 'green' : undefined}
							bold={index === selectedIndex}
						>
							{index === selectedIndex ? '› ' : '  '}
							{option.label}
						</Text>
					</Box>
				</Box>
			))}
			<Box marginTop={2} alignItems="center">
				<Text dimColor>Use arrow keys to navigate, Enter to select</Text>
			</Box>
		</Box>
	);
};
