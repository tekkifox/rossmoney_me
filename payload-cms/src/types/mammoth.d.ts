declare module 'mammoth' {
  /**
   * Convert a DOCX (ArrayBuffer or object) to HTML.
   * The real mammoth API returns an object with `value` (string HTML) and `messages` (array).
   */
  export function convertToHtml(input: any): Promise<{ value: string; messages?: any[] }>

  const mammoth: {
    convertToHtml: typeof convertToHtml
  }

  export default mammoth
}
