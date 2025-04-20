import React, {useState, useCallback} from 'react';
import {Box, Text, useInput, useApp} from 'ink';

// Define the structure for a message
interface Message {
	id: number;
	sender: 'user' | 'bot';
	text: string;
}

/**
 * A terminal-based chatbot interface component using Ink.
 */
export const ChatInterface: React.FC = () => {
	// State for the list of messages in the chat
	const [messages, setMessages] = useState<Message[]>([
		{
			id: 0,
			sender: 'bot',
			text: 'Welcome! Ask me anything about your codebase.',
		},
	]);
	// State for the current text entered by the user
	const [inputValue, setInputValue] = useState<string>('');
	// State to track if the bot is currently processing a response
	const [isLoading, setIsLoading] = useState<boolean>(false);
	// Access Ink's app context to allow exiting
	const {exit} = useApp();

	/**
	 * Simulates fetching a response from a bot.
	 * Replace this with your actual bot logic or API call.
	 */
	const getBotResponse = useCallback(
		async (userInput: string): Promise<string> => {
			// Simulate network delay and processing time
			await new Promise(resolve => setTimeout(resolve, 1200));

			// Simple echo response for demonstration
			return `You said: "${userInput}"`;
			// Example of potential error:
			// if (userInput.toLowerCase() === 'error') {
			//  throw new Error("Simulated bot error");
			// }
		},
		[],
	);

	/**
	 * Handles the submission of the user's input.
	 */
	const handleSubmit = useCallback(async () => {
		const textToSubmit = inputValue.trim();
		// Don't submit if input is empty or bot is already working
		if (!textToSubmit || isLoading) {
			return;
		}

		// Add the user's message to the chat
		const userMessage: Message = {
			id: Date.now(), // Use timestamp for a simple unique key during session
			sender: 'user',
			text: textToSubmit,
		};
		setMessages(prev => [...prev, userMessage]);

		// Clear the input field and set loading state
		setInputValue('');
		setIsLoading(true);

		try {
			// Get the bot's response
			const botText = await getBotResponse(textToSubmit);
			const botMessage: Message = {
				id: Date.now() + 1, // Ensure unique key
				sender: 'bot',
				text: botText,
			};
			setMessages(prev => [...prev, botMessage]);
		} catch (error) {
			// If bot interaction fails, show an error message
			console.error('Bot response error:', error);
			const errorMessage: Message = {
				id: Date.now() + 1,
				sender: 'bot',
				text: 'Sorry, I encountered an error. Please try again.',
			};
			setMessages(prev => [...prev, errorMessage]);
		} finally {
			// Reset loading state regardless of success or failure
			setIsLoading(false);
		}
	}, [inputValue, isLoading, getBotResponse]);

	// Use Ink's input hook to capture keyboard events
	useInput((input, key) => {
		// Ignore input while the bot is processing
		if (isLoading) return;

		if (key.return) {
			// Handle submission on Enter key
			handleSubmit();
		} else if (key.backspace || key.delete) {
			// Handle backspace/delete
			setInputValue(prev => prev.slice(0, -1));
		} else if (key.ctrl && input === 'c') {
			// Allow Ctrl+C to exit the application
			exit();
		} else if (!key.ctrl && !key.meta && !key.shift && input) {
			// Append printable characters to the input state
			// This check avoids adding control characters etc.
			setInputValue(prev => prev + input);
		}
		// Note: This basic input handling doesn't support cursor movement, selection, etc.
		// For a more advanced input field, consider `ink-text-input`.
	});

	// --- Rendering the UI ---
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			padding={1}
			width="100%" // Use full terminal width
		>
			{/* Message Display Area */}
			<Box flexGrow={1} flexDirection="column" marginBottom={1}>
				{/* Display Messages */}
				{messages.map(msg => (
					<Box key={msg.id} flexDirection="row">
						<Text bold color={msg.sender === 'user' ? 'blue' : 'green'}>
							{msg.sender === 'user' ? 'You: ' : 'Bot: '}
						</Text>
						<Text>{msg.text}</Text>
					</Box>
				))}
				{/* Display loading indicator when bot is working */}
				{isLoading && (
					<Box>
						<Text color="yellow">Bot is thinking...</Text>
					</Box>
				)}
			</Box>

			{/* Input Area Separator */}
			<Box borderStyle="single" borderColor="gray" />

			{/* Input Prompt and Display */}
			<Box marginTop={1}>
				<Text bold> {'>'} </Text>
				<Text>{inputValue}</Text>
				{/* Simulate a blinking cursor */}
				{!isLoading && <Text>_</Text>}
			</Box>
			<Text dimColor>(Type your message and press Enter. Ctrl+C to exit.)</Text>
		</Box>
	);
};

export default ChatInterface;

// --- To Render This Component ---
// You would typically have a separate entry file (e.g., `app.tsx` or `cli.tsx`)
// that uses Ink's `render` function like this:
/*
     import React from 'react';
     import { render } from 'ink';
     import ChatInterface from './ChatInterface'; // Adjust the path as necessary

     // Render the component to the terminal
     render(<ChatInterface />);
 */
