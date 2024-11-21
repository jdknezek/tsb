#!/usr/bin/env node

import * as fs from 'node:fs/promises';

import * as commander from 'commander';
import * as glob from 'glob';
import * as blank from 'ts-blank-space';
import * as ts from 'typescript';

commander.program
	.option('-c, --config <path>', 'tsconfig.json path', './tsconfig.json')
	.option('-e, --extension <extension>', 'output extension', 'js');

commander.program.parse();
const opts = commander.program.opts();

const config = ts.getParsedCommandLineOfConfigFile(opts.config, undefined, {
	fileExists: ts.sys.fileExists,
	getCurrentDirectory: ts.sys.getCurrentDirectory,
	readDirectory: ts.sys.readDirectory,
	readFile: ts.sys.readFile,
	useCaseSensitiveFileNames: true,
	onUnRecoverableConfigFileDiagnostic: diagnostic => console.error('config file error:', diagnostic),
});
if (!config) process.exit(1);

const host = ts.createCompilerHost(config.options);

const inputPaths = glob.globSync(commander.program.args, { ignore: 'node_modules/**' });

const program = ts.createProgram(inputPaths, config.options, host);

async function emitBlanked (config: ts.ParsedCommandLine) {
	if (config.options.noEmit || config.options.emitDeclarationOnly) return;

	await Promise.all(inputPaths.map(async inputPath => {
		const sourceFile = program.getSourceFile(inputPath);
		if (!sourceFile) return;

		let error = false;
		const blanked = blank.blankSourceFile(sourceFile, node => {
			error = true;
			const position = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
			console.error('unsupported ts-blank-space syntax at %s:%d:%d', inputPath, position.line, position.character);
		});
		if (error) return;

		const outputPath = inputPath.replace(/\.ts$/i, `.${opts.extension}`);
		console.log(inputPath, '->', outputPath);
		await fs.writeFile(outputPath, blanked);
	}));
}

function emitDeclarations (config: ts.ParsedCommandLine) {
	if (config.options.noEmit || !config.options.declaration) return;

	program.emit(undefined, undefined, undefined, true);
}

await Promise.all([
	emitBlanked(config),
	emitDeclarations(config),
]);
