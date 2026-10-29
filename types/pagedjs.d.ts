declare module 'pagedjs' {
  export class Previewer {
    constructor(options?: unknown)
    preview(content?: Node | string, stylesheets?: unknown[], renderTo?: HTMLElement): Promise<unknown>
  }
}
