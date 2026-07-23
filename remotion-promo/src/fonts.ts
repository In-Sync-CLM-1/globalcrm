import { loadFont as loadArchivo } from '@remotion/google-fonts/Archivo';
import { loadFont as loadSora } from '@remotion/google-fonts/Sora';

const archivo = loadArchivo('normal', { weights: ['400', '700', '800'], subsets: ['latin'] });
const sora = loadSora('normal', { weights: ['400', '600', '700'], subsets: ['latin'] });

export const DISPLAY = `${archivo.fontFamily}, system-ui, sans-serif`;
export const BODY = `${sora.fontFamily}, system-ui, sans-serif`;
