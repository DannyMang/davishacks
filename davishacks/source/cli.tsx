#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import { DocManager } from './services/DocManager.js';

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
				default: process.cwd()
			}
		}
	}
);

const [command = 'browse'] = cli.input;

async function generateDocs(workspacePath: string) {
	try {
		console.log('Generating documentation for changed files...');
		const docManager = new DocManager(workspacePath);
		const changedFiles = await docManager.getChangedFiles();
		
		if (changedFiles.length === 0) {
			console.log('No changed files found.');
			return;
		}

		console.log(`Found ${changedFiles.length} changed files.`);
		for (const file of changedFiles) {
			console.log(`Processing ${file}...`);
			await docManager.generateDocumentation(file);
		}

		await docManager.generateHtml();
		console.log('Documentation generated successfully!');
		console.log('You can view the HTML documentation in docs/html/index.html');
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
