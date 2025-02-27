import { parse } from 'jest-editor-support';
import * as vscode from 'vscode';
import * as _ from 'lodash';
import { JestRunnerConfig } from './jestRunnerConfig';
import {
  escapePlusSign,
  escapeRegExp,
  escapeSingleQuotes,
  findFullTestName,
  normalizePath,
  pushMany,
  quote,
  unquote,
} from './util';

import { jestRunnerLoader } from './jestRunnerLoader';

interface DebugCommand {
  documentUri: vscode.Uri;
  config: vscode.DebugConfiguration;
}

export class JestRunner {
  private previousCommand: string | DebugCommand;

  private terminal: vscode.Terminal;

  private readonly config = new JestRunnerConfig();

  constructor() {
    this.setup();
  }

  //
  // public methods
  //

  public async runCurrentTest(currentTestName?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const testName = currentTestName || this.findCurrentTestName(editor);
    const command = this.buildJestCommand(filePath, testName);

    this.previousCommand = command;

    await this.goToProjectDirectory();
    await this.runTerminalCommand(command);
  }

  public async runJestLen(args?: object, ...rest: []) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const testName = this.findCurrentTestName(editor);

    let options = [];
    for(let key in args) {
      if(key === 'options') {
        if(Array.isArray(args[key])) {
          options = args[key];
        } else if(typeof args[key] === 'string') {
          options = [args[key]];
        }
      }
    }
    const command = this.buildJestCommand(filePath, testName, options);

    const jestRunnerConfig = await jestRunnerLoader();
    const lenOptions = _.get(jestRunnerConfig, 'lenOptions', []);
    const lenOpt = _.find(lenOptions, { name: args });

    if(lenOpt) {
      // checkfor runner cb
      const runner = _.get(lenOpt, 'runner');
      if(_.isFunction(runner)) {
        const runnerCtx = {
          vscode,
          jestrunner: this,
          jestRunnerConfig,
          args: {
            testName,
            filePath,
            options,
            command,
          }
        };
        await runner(runnerCtx);
      }
    }
  }

  public async runCurrentTestEx(args?: object) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const testName = this.findCurrentTestName(editor);
    let options = [];
    for(let key in args) {
      if(key === 'options') {
        if(Array.isArray(args[key])) {
          options = args[key];
        } else if(typeof args[key] === 'string') {
          options = [args[key]];
        }
      }
    }
    const command = this.buildJestCommand(filePath, testName, options);

    this.previousCommand = command;

    await this.goToProjectDirectory();
    await this.runTerminalCommand(command);
  }

  public async runCurrentFile(options?: string[]) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const filePath = editor.document.fileName;
    const command = this.buildJestCommand(filePath, undefined, options);

    this.previousCommand = command;

    await this.goToProjectDirectory();
    await this.runTerminalCommand(command);
  }

  public async runPreviousTest() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    if (typeof this.previousCommand === 'string') {
      await this.goToProjectDirectory();
      await this.runTerminalCommand(this.previousCommand);
    } else {
      this.executeDebugCommand(this.previousCommand);
    }
  }

  public async debugCurrentTest(currentTestName?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    await editor.document.save();

    const debugCommand = this.getDebugCommand(editor, currentTestName);

    this.executeDebugCommand(debugCommand);
  }

  //
  // private methods
  //

  private executeDebugCommand(debugCommand: DebugCommand) {
    vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(debugCommand.documentUri), debugCommand.config);

    this.previousCommand = debugCommand;
  }

  private getDebugCommand(editor: vscode.TextEditor, currentTestName?: string): DebugCommand {
    const config: vscode.DebugConfiguration = {
      console: 'integratedTerminal',
      internalConsoleOptions: 'neverOpen',
      name: 'Debug Jest Tests',
      program: this.config.jestBinPath,
      request: 'launch',
      type: 'node',
      cwd: this.config.projectPath,
      ...this.config.debugOptions
    };
    if (this.config.isYarnPnpSupportEnabled) {
      config.runtimeArgs = [
        '--require',
        '${workspaceFolder}/.pnp.js',
      ];
    }
    if (this.config.isDetectYarnPnpJestBin) {
      config.program = this.config.yarnPnpJestBinPath;
    }
    config.args = config.args ? config.args.slice() : [];

    const filePath = editor.document.fileName;
    const testName = currentTestName || this.findCurrentTestName(editor);

    const standardArgs = this.buildJestArgs(filePath, testName, false);
    pushMany(config.args, standardArgs);

    config.args.push('--runInBand');

    return {
      config,
      documentUri: editor.document.uri
    };
  }

  private findCurrentTestName(editor: vscode.TextEditor): string | undefined {
    // from selection
    const { selection, document } = editor;
    if (!selection.isEmpty) {
      return unquote(document.getText(selection));
    }

    const selectedLine = selection.active.line + 1;
    const filePath = editor.document.fileName;
    const testFile = parse(filePath);

    const fullTestName = findFullTestName(selectedLine, testFile.root.children);
    return fullTestName ? escapeRegExp(fullTestName) : undefined;
  }

  private buildJestCommand(filePath: string, testName?: string, options?: string[]): string {
    const args = this.buildJestArgs(filePath, testName, true, options);
    return `${this.config.jestCommand} ${args.join(' ')}`;
  }

  private buildJestArgs(filePath: string, testName: string, withQuotes: boolean, options: string[] = []): string[] {
    const args: string[] = [];
    const quoter = withQuotes ? quote : str => str;

    args.push(quoter(normalizePath(escapePlusSign(filePath))));

    if (this.config.jestConfigPath) {
      args.push('-c');
      args.push(quoter(normalizePath(this.config.jestConfigPath)));
    }

    if (testName) {
      args.push('-t');
      args.push(quoter(escapeSingleQuotes(testName)));
    }

    const setOptions = new Set(options);

    if (this.config.runOptions) {
      this.config.runOptions.forEach(option => setOptions.add(option));
    }

    args.push(...setOptions);

    return args;
  }

  private async goToProjectDirectory() {
    await this.runTerminalCommand(`cd ${quote(this.config.projectPath)}`);
  }

  private async runTerminalCommand(command: string) {
    if (!this.terminal) {
      const terminalName = 'jestRunner';
      // find opening terminals
      const terminals = _.get(vscode.window, 'terminals');
      let terminal = _.find(terminals, { name: terminalName });
      if(!terminal) {
        terminal = vscode.window.createTerminal(terminalName);
      }
      this.terminal = terminal;
    }
    this.terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.clear');
    this.terminal.sendText(command);
  }

  private setup() {
    vscode.window.onDidCloseTerminal(() => {
      this.terminal = null;
    });
  }
}
