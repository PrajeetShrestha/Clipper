import path from 'path';
export const dataDir = process.env.DATA_DIR || '/opt/clipper/data';
export const sourceFile = (id: string) => path.join(dataDir, 'sources', `${id}.mp4`);
export const exportFile = (id: string) => path.join(dataDir, 'exports', `${id}.mp4`);
export const tempFile = (id: string, ext: string) => path.join(dataDir, 'tmp', `${id}.${ext}`);
