export enum EngineStatus {
  Init = 1,
  Ready,
  Busy,
  Error
}

const ENGINE_PATH = '/latex/swiftlatexpdftex.js';

export class CompileResult {
  pdf: Uint8Array | undefined = undefined;
  status = -254;
  log = 'No log';
}

export class PdfTeXEngine {
  private latexWorker: Worker | undefined = undefined;
  public latexWorkerStatus: EngineStatus = EngineStatus.Init;

  public async loadEngine(): Promise<void> {
    if (this.latexWorker !== undefined) {
      throw new Error('Other instance is running, abort()');
    }
    this.latexWorkerStatus = EngineStatus.Init;
    await new Promise<void>((resolve, reject) => {
      this.latexWorker = new Worker(ENGINE_PATH, { type: 'classic' });
      this.latexWorker.onmessage = (ev: MessageEvent) => {
        const data = ev.data as Record<string, unknown>;
        const cmd = data['result'] as string;
        if (cmd === 'ok') {
          this.latexWorkerStatus = EngineStatus.Ready;
          resolve();
        } else {
          this.latexWorkerStatus = EngineStatus.Error;
          reject(new Error('Engine failed to initialize'));
        }
      };
      this.latexWorker.onerror = () => {
        this.latexWorkerStatus = EngineStatus.Error;
        reject(new Error('Engine worker error'));
      };
    });
    this.latexWorker.onmessage = () => {};
    this.latexWorker.onerror = () => {};
  }

  public isReady(): boolean {
    return this.latexWorkerStatus === EngineStatus.Ready;
  }

  private checkEngineStatus(): void {
    if (!this.isReady()) {
      throw new Error('Engine is not ready');
    }
  }

  public async compileLaTeX(): Promise<CompileResult> {
    this.checkEngineStatus();
    this.latexWorkerStatus = EngineStatus.Busy;
    const res: CompileResult = await new Promise((resolve) => {
      this.latexWorker!.onmessage = (ev: MessageEvent) => {
        const data = ev.data as Record<string, unknown>;
        const cmd = data['cmd'] as string;
        if (cmd !== 'compile') return;
        const result = data['result'] as string;
        const log = data['log'] as string;
        const status = data['status'] as number;
        this.latexWorkerStatus = EngineStatus.Ready;
        const niceReport = new CompileResult();
        niceReport.status = status;
        niceReport.log = log;
        if (result === 'ok') {
          const pdf = new Uint8Array(data['pdf'] as ArrayBuffer);
          niceReport.pdf = pdf;
        }
        resolve(niceReport);
      };
      this.latexWorker!.postMessage({ cmd: 'compilelatex' });
    });
    this.latexWorker!.onmessage = () => {};
    return res;
  }

  public setEngineMainFile(filename: string): void {
    this.checkEngineStatus();
    this.latexWorker?.postMessage({ cmd: 'setmainfile', url: filename });
  }

  public writeMemFSFile(filename: string, srccode: string | Uint8Array): void {
    this.checkEngineStatus();
    this.latexWorker?.postMessage({ cmd: 'writefile', url: filename, src: srccode });
  }

  public makeMemFSFolder(folder: string): void {
    this.checkEngineStatus();
    if (!folder || folder === '/') return;
    this.latexWorker?.postMessage({ cmd: 'mkdir', url: folder });
  }

  public flushCache(): void {
    this.checkEngineStatus();
    this.latexWorker?.postMessage({ cmd: 'flushcache' });
  }

  public setTexliveEndpoint(url: string): void {
    this.latexWorker?.postMessage({ cmd: 'settexliveurl', url });
  }

  public closeWorker(): void {
    this.latexWorker?.postMessage({ cmd: 'grace' });
    this.latexWorker = undefined;
  }
}
