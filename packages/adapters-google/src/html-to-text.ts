import { convert } from 'html-to-text';

/** Convierte HTML de correo a texto plano: sin ajuste de línea, sin imágenes y con enlaces sólo como texto. */
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
}
