var findJavaHome = require('find-java-home');
var path = require('path');

var debugMode: boolean = false;

export function setDebugMode(debug: boolean) {
  debugMode = debug;
}

export function isDebugMode() {
  return debugMode;
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
