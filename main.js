import * as fs from 'node:fs/promises';

import * as commander from 'commander';
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

const program = ts.createProgram(commander.program.args, config.options, host);

async function emitBlanked (config                      ) {
	if (config.options.noEmit || config.options.emitDeclarationOnly) return;

	await Promise.all(config.fileNames.map(async fileName => {
		const sourceFile = program.getSourceFile(fileName);
		if (!sourceFile) return;

		const blanked = blank.blankSourceFile(sourceFile, node => {
			const start = node.getStart();
			const position = ts.getLineAndCharacterOfPosition(sourceFile, start);
			console.error('unsupported ts-blank-space syntax at %s:%s:%s:\n%s', fileName, position.line, position.character, node.getText());
		});

		const outputName = fileName.replace(/\.ts$/i, `.${opts.extension}`);
		await fs.writeFile(outputName, blanked);
	}));
}

function emitDeclarations (config                      ) {
	if (config.options.noEmit || !config.options.declaration) return;

	program.emit(undefined, undefined, undefined, true);
}

await Promise.all([
	emitBlanked(config),
	emitDeclarations(config),
]);
