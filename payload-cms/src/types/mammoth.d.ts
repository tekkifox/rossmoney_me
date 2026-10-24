declare module 'mammoth' {
  export interface MammothElement {
    type: string
    children?: MammothElement[]
  }

  export interface MammothRun extends MammothElement {
    type: 'run'
    font: string | undefined
    fontSize: number | null
    styleId: string | null
    styleName: string | null
    isBold: boolean
    isUnderline: boolean
  }

  export interface MammothOptions {
    styleMap?: string[]
    transformDocument?: (document: MammothElement) => MammothElement
  }

  export const transforms: {
    run: (transform: (run: MammothRun) => MammothRun) =>
      (document: MammothElement) => MammothElement
  }

  /**
   * Convert a DOCX (ArrayBuffer or object) to HTML.
   * The real mammoth API returns an object with `value` (string HTML) and `messages` (array).
   */
  export function convertToHtml(
    input: any,
    options?: MammothOptions,
  ): Promise<{ value: string; messages?: any[] }>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    transforms: typeof transforms
  }

  export default mammoth
}

declare module 'mammoth/lib/unzip' {
  export interface MammothZip {
    read(path: string, encoding?: string): Promise<string>
    write(path: string, contents: string): void
    toArrayBuffer(): Promise<ArrayBuffer>
  }

  export function openZip(options: {
    arrayBuffer: ArrayBuffer
    buffer: ArrayBuffer
  }): Promise<MammothZip>
}
