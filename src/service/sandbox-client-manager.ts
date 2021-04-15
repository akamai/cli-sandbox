import {SandboxDatastore} from './sandbox-datastore';
import {SandboxRecord} from './sandbox-record';
import {SandboxConfig} from './sandbox-config';
import * as envUtils from '../utils/env-utils';
import * as cliUtils from '../utils/cli-utils';

const fs = require('fs');
const unzipper = require('unzipper');
const path = require('path');
const shell = require('shelljs');
const fsExtra = require('fs-extra');
const download = require('download');

const CONNECTOR_VERSION = '1.4.0';
const DOWNLOAD_PATH: string = `https://github.com/akamai/sandbox-client/releases/download/${CONNECTOR_VERSION}/`;
const DOWNLOAD_FILE: string = `sandbox-client-${CONNECTOR_VERSION}-RELEASE-default.zip`;
const DOWNLOAD_URL = DOWNLOAD_PATH + DOWNLOAD_FILE;
const CONNECTOR_FOLDER_NAME = `sandbox-client-${CONNECTOR_VERSION}-RELEASE`;
const JAR_FILE_NAME = `sandbox-client-${CONNECTOR_VERSION}-RELEASE.jar`;

const CLI_CACHE_PATH: string = process.env.AKAMAI_CLI_CACHE_PATH;
const SANDBOX_CLI_HOME = path.join(CLI_CACHE_PATH, '/sandbox-cli/');
const DOWNLOAD_DIR = path.join(CLI_CACHE_PATH, '/sandbox-cli/downloads/');
const SANDBOXES_DIR = path.join(SANDBOX_CLI_HOME, '/sandboxes/');
const CONNECTOR_DOWNLOAD_LOCATION = path.join(DOWNLOAD_DIR, DOWNLOAD_FILE);
const CLIENT_INSTALL_PATH = path.join(SANDBOX_CLI_HOME, CONNECTOR_FOLDER_NAME);

const JAR_FILE_PATH = path.join(CLIENT_INSTALL_PATH, path.join('/lib', JAR_FILE_NAME));
const LOG_CONFIG_FILE = path.join(CLIENT_INSTALL_PATH, '/conf/logback.xml');

const DATASTORE_FILE_PATH = path.join(SANDBOX_CLI_HOME + '.datastore');

if (!fs.existsSync(SANDBOX_CLI_HOME)) {
  fs.mkdirSync(SANDBOX_CLI_HOME);
}
if (!fs.existsSync(SANDBOXES_DIR)) {
  fs.mkdirSync(SANDBOXES_DIR);
}

const datastore = new SandboxDatastore(DATASTORE_FILE_PATH);

export async function downloadClient() {
  console.log('Downloading sandbox client...');
  await download(DOWNLOAD_URL, DOWNLOAD_DIR);

  if (!fs.existsSync(CONNECTOR_DOWNLOAD_LOCATION)) {
    cliUtils.logAndExit(1, 'sandbox client was not downloaded successfully.')
  }
  console.log(`installing to ${CLIENT_INSTALL_PATH}`);
  await unzipClient();
  console.log('done');
}

function unzipClient() {
  return new Promise(
    (resolve, reject) => {
      fs.createReadStream(CONNECTOR_DOWNLOAD_LOCATION)
        .pipe(unzipper.Extract({path: SANDBOX_CLI_HOME}))
        .on('finish', function(err) {
          if (err) {
            reject(err);
          } else {
            resolve("ok");
          }
        });
    });
}

export function isAlreadyInstalled() {
  return fs.existsSync(JAR_FILE_PATH);
}

function createSandboxConfig(jwt: string, name: string, origins: Array<string>, clientConfig, passThrough: boolean) {
  let config = new SandboxConfig(SANDBOXES_DIR, name);
  if (clientConfig) {
    config.useClientConfig(clientConfig);
  }
  return config.create(jwt, origins, passThrough);
}

export function registerNewSandbox(sandboxid: string, jwt: string, name: string, origins: Array<string>, clientConfig = null, passThrough: boolean) {
  const sandboxConfig = createSandboxConfig(jwt, name, origins, clientConfig, passThrough);
  const sandboxRecord = new SandboxRecord(sandboxid, name, true, name, jwt);

  datastore.save(sandboxRecord);
  console.log(`sandbox-id: ${sandboxid} ${name} is now active`);
  return sandboxConfig;
}

export function searchLocalSandboxes(str: string) {
  return getAllSandboxes().filter(sb => {
    if (sb.sandboxId.indexOf(str) >= 0 || sb.name.indexOf(str) >= 0) {
      return true;
    }
  })
}

export function makeCurrent(sandboxId: string) {
  datastore.makeCurrent(sandboxId);
}

export function getAllSandboxes(): Array<SandboxRecord> {
  return datastore.getAllRecords();
}

function getSandboxFolder(sandboxId: string) {
  const rec = datastore.getRecord(sandboxId);
  return path.join(SANDBOXES_DIR, rec.folder);
}

function getCurrentSandboxFolder() {
  return getSandboxFolder(datastore.getCurrent().sandboxId);
}

export function updateJWT(sandboxId: string, newJwt: string) {
  const sandboxRecord: SandboxRecord = datastore.getRecord(sandboxId);
  if (!sandboxRecord) {
    cliUtils.logAndExit(1,
      `Unable to set the new JWT into local configuration for sandbox-id: ${sandboxId}\nThe new token: ${newJwt}`
    );
    return;
  }
  sandboxRecord.jwt = newJwt;
  const sandboxConfig = new SandboxConfig(SANDBOXES_DIR, sandboxRecord.name);

  datastore.save(sandboxRecord);
  sandboxConfig.updateJwt(newJwt);
}

export function getSandboxLocalData(sandboxId: string) {
  const rec = datastore.getRecord(sandboxId);
  if (!rec) {
    return null;
  }
  return {
    isCurrent: rec.current,
    jwt: rec.jwt,
    sandboxFolder: getSandboxFolder(sandboxId),
  }
}

function getLogPath() {
  return path.join(getCurrentSandboxFolder(), '/logs')
}

export function flushLocalSandbox(sandboxId: string) {
  if (!datastore.hasRecord(sandboxId)) {
    return;
  }

  console.log('removing local files');
  const sb = datastore.getRecord(sandboxId);
  const folderPath = path.join(SANDBOXES_DIR, sb.folder);
  fsExtra.removeSync(folderPath);
  datastore.deleteRecord(sandboxId);
}

export function getCurrentSandboxId() {
  const c = datastore.getCurrent();
  if (!c) {
    return null;
  }
  return c.sandboxId;
}

export function getCurrentSandboxName() {
  const c = datastore.getCurrent();
  if (!c) {
    return null;
  }
  return c.name;
}

export function hasCurrent() {
  return !!getCurrentSandboxId();
}

export async function hasSandboxFolder(sandboxName) {
  const files = fs.readdirSync(SANDBOXES_DIR);
  return files.some(fileItem => fileItem.toLowerCase() === sandboxName.toLowerCase());
}


function versionToNumber(version) {
  return version.split('.').map(s => parseInt(s)).reduce((acc, value) => 100 * acc + value);
}

export async function executeSandboxClient(printLogs) {
  const loggingPath = getLogPath();
  const loggingFilePath = path.join(loggingPath, 'sandbox-client.log');
  const configPath = path.join(getCurrentSandboxFolder(), 'config.json');

  const springProfiles = [];
  if (printLogs) {
    springProfiles.push('print-logs')
  }

  const args = [
    `"${await envUtils.getJavaExecutablePath()}"`
  ];

  if (versionToNumber(CONNECTOR_VERSION) >= versionToNumber('1.3.1')) {
    args.push(`-DLOG_PATH="${loggingPath}"`);
    args.push(`-DLOGGING_CONFIG_FILE="${LOG_CONFIG_FILE}"`);
  } else {
    args.push(`-Dlogging.file.path="${loggingPath}"`);
    args.push(`-Dlogging.config="${LOG_CONFIG_FILE}"`);
  }

  args.push(`-jar "${JAR_FILE_PATH}"`);
  args.push(`--config="${configPath}"`);

  if (springProfiles.length > 0) {
    args.push(`--spring.profiles.active=${springProfiles.join()}`)
  }

  const cmd = args.join(' ');

  printStartupInfo(configPath, loggingPath, loggingFilePath, args);

  shell.exec(cmd, function(exitCode) {
    if (exitCode !== 0) {
      printStartupFailureInfo(springProfiles);
    }
  });
}

function printStartupFailureInfo(springProfiles: string[]) {
  if (springProfiles.includes('print-logs')) {
    cliUtils.logAndExit(1, 'Sandbox Client failed to start.');
  } else {
    cliUtils.logAndExit(1, 'Sandbox Client failed to start. Please check logs for more information or start client with --print-logs option.');
  }
}

function printStartupInfo(configPath: string, loggingPath: string, loggingFilePath: string, args) {
  console.log('Starting Sandbox Client with arguments:');
  console.log(`Config: ${configPath}`);
  console.log(`Logging path: ${loggingPath}`);
  console.log(`Logging file: ${loggingFilePath}`);
  console.log(`Logging config: ${LOG_CONFIG_FILE}\n`);
  console.log(`Arguments: ${args}\n`);
}
