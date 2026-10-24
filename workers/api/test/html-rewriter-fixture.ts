/** A small HTMLRewriter dependency fixture; it does not claim browser/parser qualification. */
export class FixtureHTMLRewriter {
  private handlers: Array<{
    selector: string;
    handler: { element(element: { getAttribute(name: string): string | null }): void };
  }> = [];
  on(
    selector: string,
    handler: { element(element: { getAttribute(name: string): string | null }): void }
  ) {
    this.handlers.push({ selector, handler });
    return this;
  }
  transform(response: Response) {
    return {
      arrayBuffer: async () => {
        const html = await response.text();
        for (const { selector, handler } of this.handlers) {
          let scope = html;
          if (selector === 'li.category-articles a') {
            scope = [
              ...html.matchAll(
                /<li\b[^>]*class="[^"]*category-articles[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
              ),
            ]
              .map((match) => match[1])
              .join('');
          }
          const tag = selector === 'link' ? 'link' : 'a';
          for (const match of scope.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))) {
            handler.element({
              getAttribute(name) {
                return new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(match[1])?.[1] ?? null;
              },
            });
          }
        }
        return new ArrayBuffer(0);
      },
    };
  }
}
