declare module "fit-file-parser" {
  type FitParserOptions = {
    force?: boolean;
    speedUnit?: string;
    lengthUnit?: string;
    temperatureUnit?: string;
  };

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(buffer: ArrayBuffer | Buffer | Uint8Array, callback: (error: unknown, data: unknown) => void): void;
  }
}
