import { parse, ParsedNode } from 'jest-editor-support';
import { CodeLens, CodeLensProvider, Range, TextDocument, workspace } from 'vscode';
import * as vscode from 'vscode';
import * as _ from 'lodash';
import { findFullTestName, escapeRegExp } from './util';
import { jestRunnerLoader } from './jestRunnerLoader';

async function getTestsBlocks(parsedNode: ParsedNode, parseResults: ParsedNode[]): Promise<CodeLens[]> {
  const codeLens: CodeLens[] = [];

  // parsedNode.children?.forEach(subNode => {
  //   codeLens.push(...getTestsBlocks(subNode, parseResults));
  // });
  await Promise.all(_.get(parsedNode, 'children', []).map(async (subNode) => {
    const lens = await getTestsBlocks(subNode, parseResults)
    codeLens.push(...lens);
  }));

  const range = new Range(
    parsedNode.start.line - 1,
    parsedNode.start.column,
    parsedNode.end.line - 1,
    parsedNode.end.column
  );

  if (parsedNode.type === 'expect') {
    return [];
  }

  const fullTestName = escapeRegExp(findFullTestName(parsedNode.start.line, parseResults));

  codeLens.push(
    new CodeLens(range, {
      arguments: [fullTestName],
      command: 'extension.runJest',
      title: 'Run'
    }),
    new CodeLens(range, {
      arguments: [fullTestName],
      command: 'extension.debugJest',
      title: 'Debug'
    })
  );

  try {
    const mod = await jestRunnerLoader();
    // normalize mod
    const lenOptions = _.get(mod, 'lenOptions', []);
    const lens = _.map(lenOptions, (lenOpt) => {
      const name = _.get(lenOpt, 'name');
      const title = _.get(lenOpt, 'title', name);
      const command = _.get(lenOpt, 'command', 'extension.runJestLen');
      return new CodeLens(range, {
        arguments: [name],
        command,
        title,
      });
    });
    codeLens.push(...lens);
  } catch (err) {
    vscode.window.showWarningMessage(`err: ${JSON.stringify(err)}`);
  }

  return codeLens;
}

export class JestRunnerCodeLensProvider implements CodeLensProvider {
  public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const parseResults = parse(document.fileName, document.getText()).root.children;

    const codeLens = [];
    // parseResults.forEach(parseResult => codeLens.push(...getTestsBlocks(parseResult, parseResults)));
    await Promise.all(_.map(parseResults, async (parseResult) => {
      const lens = await getTestsBlocks(parseResult, parseResults);
      codeLens.push(...lens);
    }))
    return codeLens;
  }
}
