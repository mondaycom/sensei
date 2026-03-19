#!/usr/bin/env node
/**
 * @mondaycom/sensei-cli — CLI for Sensei agent qualification engine
 */
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { registerRunCommand } from './commands/run.js';
import { registerInitCommand } from './commands/init.js';
import { registerReportCommand } from './commands/report.js';
import { registerValidateCommand } from './commands/validate.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('sensei')
  .description('Sensei — AI agent qualification engine')
  .version(version)
  .option('--verbose', 'Show detailed execution logs', false)
  .option('--output <path>', 'Write output to file')
  .option('--format <format>', 'Output format: json, terminal, html', 'terminal')
  .option('--no-color', 'Disable color output');

registerRunCommand(program);
registerInitCommand(program);
registerReportCommand(program);
registerValidateCommand(program);

program.parse(process.argv);
