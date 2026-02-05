import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfTeXEngine } from './SwiftLatexEngine';

export interface CompileOutcome {
  pdf: Uint8Array;
  log: string;
  status: number;
  engine: 'swiftlatex' | 'mock' | 'tectonic';
}

export interface LatexEngine {
  name: 'swiftlatex' | 'mock';
  load(): Promise<void>;
  compile(files: Record<string, string | Uint8Array>, mainFile: string): Promise<CompileOutcome>;
}

class SwiftLatexAdapter implements LatexEngine {
  name: 'swiftlatex' = 'swiftlatex';
  private engine = new PdfTeXEngine();
  private ready = false;
  private texliveEndpoint: string;

  constructor(texliveEndpoint?: string) {
    this.texliveEndpoint = texliveEndpoint || 'https://texlive.swiftlatex.com';
  }

  async load(): Promise<void> {
    if (this.ready) return;
    await this.engine.loadEngine();
    this.engine.setTexliveEndpoint(this.texliveEndpoint);
    this.ready = true;
  }

  async compile(files: Record<string, string | Uint8Array>, mainFile: string): Promise<CompileOutcome> {
    if (!this.ready) {
      await this.load();
    }
    this.engine.flushCache();

    // 收集所有需要创建的目录
    const dirs = new Set<string>();
    for (const filePath of Object.keys(files)) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (dir) {
          dirs.add(dir);
        }
      }
    }

    // 按深度排序并创建目录
    const sortedDirs = Array.from(dirs).sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      return depthA - depthB;
    });

    for (const dir of sortedDirs) {
      try {
        this.engine.makeMemFSFolder(dir);
      } catch (err) {
        console.warn(`Failed to create directory ${dir}:`, err);
      }
    }

    // 写入文件
    for (const filePath of Object.keys(files)) {
      this.engine.writeMemFSFile(filePath, files[filePath]);
    }

    this.engine.setEngineMainFile(mainFile);
    const result = await this.engine.compileLaTeX();
    return {
      pdf: result.pdf || new Uint8Array(),
      log: result.log || '',
      status: result.status ?? 0,
      engine: 'swiftlatex'
    };
  }
}

class MockLatexEngine implements LatexEngine {
  name: 'mock' = 'mock';

  async load(): Promise<void> {
    return;
  }

  async compile(): Promise<CompileOutcome> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('SwiftLaTeX assets not found.', { x: 60, y: 760, size: 18, font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Place build outputs in public/latex to enable real compile.', { x: 60, y: 730, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
    const bytes = await pdf.save();
    return {
      pdf: bytes,
      log: 'SwiftLaTeX not loaded. Using mock engine.',
      status: 0,
      engine: 'mock'
    };
  }
}

export async function createLatexEngine(texliveEndpoint?: string): Promise<LatexEngine> {
  const swift = new SwiftLatexAdapter(texliveEndpoint);
  try {
    await swift.load();
    return swift;
  } catch {
    const mock = new MockLatexEngine();
    await mock.load();
    return mock;
  }
}
