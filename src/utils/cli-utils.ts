const inquirer = require('inquirer');
const Spinner = require('cli-spinner').Spinner;

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
    console.error(msg);
  }
  process.exit(exitCode);
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

export async function progress(func, userMsg: string = '') {
  console.log(userMsg);
  let written: number = 0;
  const interval = setInterval(function () {
    process.stdout.write(".");
    written++;
  }, 1000);
  try {
    return await func;
  } finally {
    clearInterval(interval);
    if (written > 0) {
      process.stdout.write("\n");
    }
  }
}
