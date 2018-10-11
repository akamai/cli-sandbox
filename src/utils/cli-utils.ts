const inquirer = require('inquirer');
const Spinner = require('cli-spinner').Spinner;

export function logWithBorder(str) {
  var t: string = `--- ${str} ---`;
  var border = Array(t.length).fill('-').join('');
  console.log(border);
  console.log(t);
  console.log(border);
}

export async function confirm(msg: string) {
  var answer = await inquirer.prompt([
    {
      type: 'confirm',
      message: msg,
      name: 'result'
    }
  ]);
  return answer.result;
}

export async function spinner(func, userMsg: string = '') {
  const spinner = new Spinner(`${userMsg} %s`);
  spinner.setSpinnerString('|/-\\');
  spinner.start();
  try {
    return await func;
  } finally {
    spinner.stop(true);
  }
}

export async function progress(func, userMsg: string = '') {
  console.log(userMsg);
  var written: number = 0;
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
