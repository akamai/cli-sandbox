import {SandboxDatastore} from './sandbox-datastore';
import {SandboxRecord} from "./sandbox-record";
import * as envUtils from '../utils/env-utils';
import * as cliUtils from '../utils/cli-utils';

const fs = require('fs');
const unzipper = require('unzipper');
const path = require('path');
const appRoot = require('app-root-path');
const shell = require('shelljs');
const fsExtra = require('fs-extra');
const download = require('download');

const CONNECTOR_VERSION = '1.1.0';
const DOWNLOAD_PATH: string = `https://github.com/akamai/devpops-client/releases/download/${CONNECTOR_VERSION}/`;
const DOWNLOAD_FILE: string = `sandbox-connector-${CONNECTOR_VERSION}-RELEASE-default.zip`;
const DOWNLOAD_URL = DOWNLOAD_PATH + DOWNLOAD_FILE;
const CONNECTOR_FOLDER_NAME = `sandbox-connector-${CONNECTOR_VERSION}-RELEASE`;
const JAR_FILE_NAME = `sandbox-connector-${CONNECTOR_VERSION}-RELEASE.jar`;

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

const DEFAULT_ORIGIN_TARGET = {
  secure: false,
  port: 80,
  host: '<target hostname>'
};

export async function downloadClient() {
  console.log("downloading sandbox client...");
  await download(DOWNLOAD_URL, DOWNLOAD_DIR);

  if (!fs.existsSync(CONNECTOR_DOWNLOAD_LOCATION)) {
    console.log("ERROR: file not successfully downloaded");
    process.exit();
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
        .on('finish', function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
    });
}

export function isAlreadyInstalled() {
  return fs.existsSync(JAR_FILE_PATH);
}

function getClientTemplatePath() {
  return path.resolve(appRoot.path, 'src/template/client-config.json');
}

function buildClientConfig(origins: Array<string>, passThrough: boolean) {
  var template: string = fs.readFileSync(getClientTemplatePath()).toString();
  var clientConfig = JSON.parse(template);
  if (!origins || origins.length == 0) {
    clientConfig.originMappings.push({
      from: '<ORIGIN HOSTNAME>',
      to: DEFAULT_ORIGIN_TARGET
    });
  } else {
   origins.forEach(o => {
     clientConfig.originMappings.push({
       from: o,
       to: passThrough ? "pass-through" : DEFAULT_ORIGIN_TARGET
     });
   });
  }
  return clientConfig;
}

function mergeOrigins(clientConfig, origins: Array<string>, passThrough: boolean) {
  if (origins == null || origins.length == 0) {
    return;
  }
  var inCc = new Set();
  clientConfig.originMappings.forEach(om => inCc.add(om.from.trim()));

  origins.forEach(o => {
    if (!inCc.has(o)) {
      clientConfig.originMappings.push({
        from: o,
        to: passThrough ? "pass-through" : DEFAULT_ORIGIN_TARGET
      });
    }
  })
}

export function registerNewSandbox(sandboxid: string, jwt: string, name: string, origins: Array<string>, clientConfig = null, passThrough: boolean) {
  const folderName = name;
  const sandboxDir = path.join(SANDBOXES_DIR, folderName);
  fs.mkdirSync(sandboxDir);

  let cc: any = null;
  if (!clientConfig) {
    cc = buildClientConfig(origins, passThrough);
  } else {
    cc = clientConfig;
    mergeOrigins(clientConfig, origins, passThrough);
  }
  cc.jwt = jwt;

  var generatedConfig = cliUtils.toJsonPretty(cc);

  const configPath = path.join(sandboxDir, '/config.json');
  fs.writeFileSync(configPath, generatedConfig);

  var record = new SandboxRecord(sandboxid, folderName, true, name, jwt);
  datastore.save(record);
  console.log(`sandbox_id: ${sandboxid} ${name} is now active`);
  return {
    configPath
  }
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
  var rec = datastore.getRecord(sandboxId);
  return path.join(SANDBOXES_DIR, rec.folder);
}

function getCurrentSandboxFolder() {
  return getSandboxFolder(datastore.getCurrent().sandboxId);
}

export function getSandboxLocalData(sandboxId: string) {
  var rec = datastore.getRecord(sandboxId);
  if (!rec) {
    return null;
  }
  return {
    isCurrent: rec.current,
    sandboxFolder: getSandboxFolder(sandboxId),
  }
}

function getLogPath() {
  return path.join(getCurrentSandboxFolder(), '/logs')
}

export function flushLocalSandbox(sandboxId: string) {
  var sb = datastore.getRecord(sandboxId);
  var folderPath = path.join(SANDBOXES_DIR, sb.folder);
  fsExtra.removeSync(folderPath);
  datastore.deleteRecord(sandboxId);
}

export function getCurrentSandboxId() {
  var c = datastore.getCurrent();
  if (!c) {
    return null;
  }
  return c.sandboxId;
}

export function hasCurrent() {
  return !!getCurrentSandboxId();
}

export async function executeSandboxClient() {
  var args = [
    await envUtils.getJavaExecutablePath(),
    `-Dlogging.path="${getLogPath()}"`,
    `-Dlogging.config="${LOG_CONFIG_FILE}"`,
    `-jar "${JAR_FILE_PATH}"`,
    `--config="${path.join(getCurrentSandboxFolder(), 'config.json')}"`
  ];
  var cmd = args.join(' ');
  console.log('launching client with command: ' + cmd);
  shell.exec(cmd);
}
