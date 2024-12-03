#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as commander from 'commander';
import * as glob from 'glob';
import * as blank from 'ts-blank-space';
import * as ts from 'typescript';

commander.program
	.option('--init', 'initialize minimal tsconfig.json', false)
	.option('-c, --config <path>', 'tsconfig.json path', './tsconfig.json')
	.option('-e, --extension <extension>', 'output extension', 'js')
	.option('-w, --watch', 'watch files for compilation', false)
	;

commander.program.parse();
const opts = commander.program.opts();

if (opts.init) {
	await init();
}

const config = ts.getParsedCommandLineOfConfigFile(opts.config, undefined, {
	fileExists: ts.sys.fileExists,
	getCurrentDirectory: ts.sys.getCurrentDirectory,
	readDirectory: ts.sys.readDirectory,
	readFile: ts.sys.readFile,
	useCaseSensitiveFileNames: true,
	onUnRecoverableConfigFileDiagnostic: diagnostic => console.error('config file error:', diagnostic.messageText),
});

if (!config) process.exit(1);

if (opts.watch) {
	await watch(config);
} else {
	await compile(config);
}

// Create or augment tsconfig.json
async function init () {
	let config: any;
	try {
		const text = await fs.readFile(opts.config, 'utf-8');
		config = JSON.parse(text);
	} catch (err) {
		config = {};
	}

	const compilerOptions = config.compilerOptions ||= {};
	compilerOptions.target = 'esnext';
	compilerOptions.useDefineForClassFields = true;
	compilerOptions.verbatimModuleSyntax = true;

	await fs.writeFile(opts.config, JSON.stringify(config, null, '\t'));

	process.exit(0);
}

async function emitBlank (sourceFile: ts.SourceFile) {
	let error = false;
	const blanked = blank.blankSourceFile(sourceFile, node => {
		error = true;
		const position = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
		console.error('unsupported ts-blank-space syntax at %s:%d:%d', sourceFile.fileName, position.line, position.character);
	});
	if (error) return;

	const outputPath = sourceFile.fileName.replace(/\.ts$/i, `.${opts.extension}`);
	console.log(path.relative('.', sourceFile.fileName), '->', path.relative('.', outputPath));
	await fs.writeFile(outputPath, blanked);
}

// Compile globbed files
async function compile (config: ts.ParsedCommandLine) {
	const host = ts.createCompilerHost(config.options);

	const inputPaths = glob.globSync(commander.program.args[0] || '**/*.ts', { ignore: ['**/*.d.ts', 'node_modules/**'] });

	const program = ts.createProgram(inputPaths, config.options, host);

	async function emitBlanks (config: ts.ParsedCommandLine) {
		if (config.options.noEmit || config.options.emitDeclarationOnly) return;

		await Promise.all(inputPaths.map(async inputPath => {
			const sourceFile = program.getSourceFile(inputPath);
			if (!sourceFile) return;

			await emitBlank(sourceFile);
		}));
	}

	function emitDeclarations (config: ts.ParsedCommandLine) {
		if (config.options.noEmit || !config.options.declaration) return;

		program.emit(undefined, undefined, undefined, true);
	}

	await Promise.all([
		emitBlanks(config),
		emitDeclarations(config),
	]);

	process.exit(0);
}

async function watch (config: ts.ParsedCommandLine) {
	const host = ts.createWatchCompilerHost(
		opts.config,
		config.options.declaration ? { emitDeclarationOnly : true } : { noEmit: true }, // Prevent emitting JS
		ts.sys,
		ts.createEmitAndSemanticDiagnosticsBuilderProgram,
	);

	const origAfterProgramCreate = host.afterProgramCreate;
	host.afterProgramCreate = async (program) => {
		while (true) {
			const emitted = program.emitNextAffectedFile(undefined, undefined, true);
			if (!emitted) break;

			if ((emitted.affected as any).kind !== ts.SyntaxKind.SourceFile) continue;
			const sourceFile = emitted.affected as ts.SourceFile;
			if (sourceFile.fileName.includes('node_modules') || sourceFile.fileName.endsWith('.d.ts')) continue;

			await emitBlank(sourceFile);
		}

		origAfterProgramCreate?.(program);
	};

	ts.createWatchProgram(host);
}
