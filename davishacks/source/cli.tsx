#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ davishacks

	Options
		--path  Path to the project directory (defaults to current directory)

	Examples
	  $ davishacks
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

render(<App path={cli.flags.path} />);
