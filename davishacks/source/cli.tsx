#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {DocManager} from './services/DocManager.js';

/**
 * Represents the CLI configuration using meow.
 */
const cli = meow(
	`
	Usage
	  $ davishacks [command]

	Commands
		browse          Browse and generate documentation interactively (default)
		generate        Generate documentation for changed files

	Options
		--path  Path to the project directory (defaults to current directory)

	Examples
	  $ davishacks                    # Browse files interactively
	  $ davishacks generate          # Generate docs for changed files
	  $ davishacks --path=/path/to/project
`,
	{
		importMeta: import.meta,
		flags: {
			path: {
				type: 'string',
				default: process.cwd(),
			},
		},
	},
);

/**
 * The command to execute, defaulting to 'browse'.
 */
const [command = 'browse'] = cli.input;

/**
 * Generates documentation for changed files in a given workspace path.
 *
 * @param {string} workspacePath - The path to the project directory.
 * @returns {Promise<void>}
 */
async function generateDocs(workspacePath: string) {
	try {
		const docManager = new DocManager(workspacePath);
		const changedFiles = await docManager.getChangedFiles();

		if (changedFiles.length === 0) {
			return;
		}

		for (const file of changedFiles) {
			await docManager.generateDocumentation(file);
		}

		await docManager.generateHtml();
	} catch (error) {
		console.error('Error generating documentation:', error);
		process.exit(1);
	}
}

if (command === 'generate') {
	generateDocs(cli.flags.path);
} else {
	render(<App path={cli.flags.path} />);
}
