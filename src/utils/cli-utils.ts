import inquirer from "inquirer";
import { Spinner } from "cli-spinner";

export function logWithBorder(str, type = 'log') {
  const t: string = `--- ${str} ---`;
  const border = Array(t.length).fill('-').join('');
  log(border, type);
  log(t, type);
  log(border, type);
}

function log(txt, type = 'log') {
  if (type === 'log') {
    console.log(txt);
  } else if (type === 'err') {
    console.error(txt);
  } else {
    throw `bad args: ${type}`;
  }
}

export function logAndExit(exitCode: number, msg: string) {
  if (exitCode === 0) {
    console.log(msg);
  } else {
    logError(msg);
  }
  process.exit(exitCode);
}

export function logError(msg: string) {
  console.error('ERROR: ' + msg);
}

export async function confirm(msg: string) {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      message: msg,
      name: 'result'
    }
  ]);
  return answer.result;
}

export async function spinner(func, userMsg: string = '') {
  const spinner = new Spinner({
    text: `${userMsg} %s`,
    stream: process.stderr,
  });
  spinner.setSpinnerString('|/-\\');
  spinner.start();
  try {
    return await func;
  } finally {
    spinner.stop(true);
  }
}

export function toJsonPretty(obj) {
  return JSON.stringify(obj, undefined, 2);
}

export function toJsonPrettySorted(obj) {
  return JSON.stringify(sortKeys(obj), undefined, 2);
}

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((result: any, key) => {
        result[key] = sortKeys(obj[key]);
        return result;
      }, {});
  } else {
    return obj;
  }
}

export function dateToString(date){
  const options = {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
    timeZone: 'UTC',
    timeZoneName: 'short'
  } as const;
  return new Intl.DateTimeFormat('en-US', options).format(date)
}
