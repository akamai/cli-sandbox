const EdgeGrid = require('edgegrid');
const untildify = require('untildify');
const path = require('path');
const fs = require('fs');
import * as os from 'os';
import * as cliUtils from './cli-utils';

const findJavaHome = require('find-java-home');

const edgeRcParams = {
  section: process.env.AKAMAI_EDGERC_SECTION || 'default',
  path: process.env.AKAMAI_EDGERC || path.resolve(os.homedir(), '.edgerc'),
  debug: false
};

export function getEdgeGrid() {

  if (!fs.existsSync(untildify(edgeRcParams.path))) {
    cliUtils.logAndExit(1, `Could not find .edgerc to authenticate Akamai API calls. Expected at: ${edgeRcParams.path}`);
  }

  try {
    return new EdgeGrid({
      path: untildify(edgeRcParams.path),
      section: edgeRcParams.section,
      debug: edgeRcParams.debug
    });
  } catch (e) {
    cliUtils.logAndExit(1, e.message);
  }
}

export function setDebugMode(debug: boolean) {
  edgeRcParams.debug = debug;
}

export function setEdgeRcSection(section: string) {
  edgeRcParams.section = section;
}

export function setEdgeRcFilePath(path: string) {
  edgeRcParams.path = path;
}

export function isDebugMode() {
  return edgeRcParams.debug;
}

export function getNodeVersion() {
  return parseInt(process.versions["node"].split('.')[0]);
}

export function getJavaHome() {
  return new Promise(
    (resolve, reject) => {
      findJavaHome(function (err, home) {
        if (err) {
          reject('could not find Java. Please set JAVA_HOME');
        } else {
          resolve(home);
        }
      });
    });
}

export async function getJavaExecutablePath() {
  const home = await getJavaHome();
  return path.join(home, '/bin/java');
}

export async function getJavaVersion() {
  const javaFullPath = await getJavaExecutablePath();
  return new Promise(
    (resolve, reject) => {
      const spawn = require('child_process').spawn(javaFullPath, ['-version']);
      spawn.on('error', function (err) {
        reject(err);
      });
      spawn.stderr.on('data', function (data) {
        data = data.toString().split('\n')[0];
        const javaVersion = new RegExp('java version').test(data) ? data.split(' ')[2].replace(/"/g, '') : false;
        if (javaVersion != false) {
          // TODO: We have Java installed
          resolve(javaVersion);
        } else {
          reject(`unable to parse java version from data: ${data}`);
        }
      });
    });
}
