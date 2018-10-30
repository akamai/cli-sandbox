var EdgeGrid = require('edgegrid');
import * as os from 'os';
var findJavaHome = require('find-java-home');
var path = require('path');

const _edge = null;
const edgeRcParams = {
  section: process.env.AKAMAI_EDGERC_SECTION || 'default',
  path: process.env.AKAMAI_EDGERC || path.resolve(os.homedir(), '.edgerc'),
  debug: false
};

export function getEdgeGrid() {
  if (_edge != null) {
    return _edge;
  }
  return new EdgeGrid(edgeRcParams);
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
  var home = await getJavaHome();
  return path.join(home, '/bin/java');
}

export async function getJavaVersion() {
  const javaFullPath = await getJavaExecutablePath();
  return new Promise(
    (resolve, reject) => {
      var spawn = require('child_process').spawn(javaFullPath, ['-version']);
      spawn.on('error', function (err) {
        reject(err);
      });
      spawn.stderr.on('data', function (data) {
        data = data.toString().split('\n')[0];
        var javaVersion = new RegExp('java version').test(data) ? data.split(' ')[2].replace(/"/g, '') : false;
        if (javaVersion != false) {
          // TODO: We have Java installed
          resolve(javaVersion);
        } else {
          reject(`unable to parse java version from data: ${data}`);
        }
      });
    });
}
