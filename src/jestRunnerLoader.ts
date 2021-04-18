import * as vscode from 'vscode';
import * as _ from 'lodash';
import * as path from 'path';
import * as fs from 'fs';

const fileEval = require('file-eval');

const findConfigFile = (configFile = 'jestrunner.config.js') => {
  if(!vscode.window.activeTextEditor) {
    return;
  }

  const filePath = vscode.window.activeTextEditor.document.fileName;

  const wsFolder = _.get(vscode.workspace.workspaceFolders, 0);
  const wsFolderPath = _.get(wsFolder, 'uri.path');
  const relPath = path.relative(wsFolderPath, path.dirname(filePath));
  const relPathLevels = relPath.split(path.sep);

  for(let index = relPathLevels.length - 1; index >= 0; index--) {
    const levels = relPathLevels.slice(0, index);
    const configFilePath = path.join(wsFolderPath, ...levels, configFile);
    if (fs.existsSync(configFilePath)) {
      return configFilePath;
    }  
  }
  return;
}


export const jestRunnerLoader = async () => {
  // const configPath = `/Volumes/Data/Unitz-test/appium-boilerplate/jestrunner.config.js`;
  
  try {
    const configPath = findConfigFile();
    if(configPath) {

      const config = await fileEval(configPath);
      // normalize mod
      return config;
    }
  } catch (err) {
    vscode.window.showWarningMessage(`err: ${JSON.stringify(err)}`);
  }
  return null;
};
