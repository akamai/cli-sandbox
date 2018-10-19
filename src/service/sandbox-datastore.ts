import * as fs from 'fs';
import * as cliUtils from '../utils/cli-utils';
import {SandboxRecord} from "./sandbox-record";

export class SandboxDatastore {
  private data: object;
  private datafile: string;

  constructor(datafile: string) {
    this.datafile = datafile;
    if (!fs.existsSync(datafile)) {
      this.data = {};
    } else {
      var str = fs.readFileSync(datafile).toString();
      this.data = JSON.parse(str);
    }
  }

  private getJsonStrPretty() {
    return cliUtils.toJsonPretty(this.data);
  }

  private clearCurrent() {
    let keysLst = Object.keys(this.data);
    var ds = this;
    keysLst.forEach(k => {
      ds.data[k].current = false;
    })
  }

  private getDataArray(): Array<SandboxRecord> {
    let keysLst = Object.keys(this.data);
    var ds = this;
    var r = [];
    keysLst.forEach(k => {
      r.push(ds.data[k]);
    });
    return r;
  }

  private flushToFile() {
    fs.writeFileSync(this.datafile, this.getJsonStrPretty());
  }

  private makeCurrentHelper(sandboxId: string, flush: boolean) {
    this.clearCurrent();
    this.getRecord(sandboxId).current = true;
    if (flush) {
      this.flushToFile();
    }
  }

  makeCurrent(sandboxId: string) {
    this.makeCurrentHelper(sandboxId, true);
  }

  save(rec: SandboxRecord) {
    this.data[rec.sandboxId] = rec;
    if (rec.current) {
      this.makeCurrentHelper(rec.sandboxId, false);
    }
    this.flushToFile();
  }

  getRecord(sandboxId: string): SandboxRecord {
    return this.data[sandboxId];
  }

  deleteRecord(sandboxId: string) {
    delete this.data[sandboxId];
    this.flushToFile();
  }

  getAllRecords(): Array<SandboxRecord> {
    return this.getDataArray();
  }

  getCurrent() {
    return this.getDataArray().find(sb => sb.current)
  }
}
