import { createHash } from 'node:crypto';
import { HttpError, maxImages } from './common.mjs';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { one } from './db.mjs';

const imageLimit = 2 * 1024 * 1024;
const formats = {
  'image/png': { extension: 'png', matches: data => data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  'image/jpeg': { extension: 'jpg', matches: data => data.subarray(0, 3).toString('hex') === 'ffd8ff' },
  'image/gif': { extension: 'gif', matches: data => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')) },
  'image/webp': { extension: 'webp', matches: data =>
    data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP' },
};

const replyImageLimit = 12 * 1024 * 1024;
const videoLimit = 8 * 1024 * 1024;
export const videoExtensions = new Map([['video/mp4', 'mp4'], ['video/quicktime', 'mov'], ['video/webm', 'webm']]);

function imageType(content) {
  return Object.entries(formats).find(([, format]) => format.matches(content))?.[0];
}

export function decodeReplyImage(encoded) {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(replyImageLimit / 3) * 4) return;
  const content = Buffer.from(encoded, 'base64');
  if (content.length > replyImageLimit || content.toString('base64') !== encoded) return;
  const mediaType = imageType(content);
  if (mediaType) return { content, mediaType };
}

export async function readReplyImage(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return;
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > replyImageLimit) return;
    const content = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(content, 0, content.length, 0);
    if (bytesRead !== content.length) return;
    const mediaType = imageType(content);
    if (mediaType) return { content, mediaType };
  } finally { await handle.close(); }
}

export function addAttachment(connection, session, message, image, position, ignoreDuplicate = false) {
  return connection.query(`INSERT INTO attachments(id,session,message,name,media_type,content,position)
    VALUES ($1,$2,$3,$4,$5,COALESCE($6,zeroblob(0)),$7)${ignoreDuplicate ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
  [image.id, session, message, image.name, image.mediaType, image.content, position]);
}

function hasImageLink(text, path) {
  for (const link of text.matchAll(/\]\([ \t]*(?:<([^>\r\n]+)>|([^\s<>()]+))(?:[ \t]+["'][^\r\n]*?["'])?[ \t]*\)/g)) {
    const target = link[1] ?? link[2];
    if (target === path) return true;
    try { if (decodeURIComponent(target) === path) return true; } catch { /* Invalid escapes cannot match. */ }
  }
  return false;
}

export async function readLinkedReplyImage(db, sessionId, path) {
  if (!isAbsolute(path) || path.length > 4096 || !/\.(png|jpe?g|gif|webp)$/i.test(path)) {
    throw new HttpError(404, 'Image not found.');
  }
  const hash = createHash('sha256').update('reply-image\0' + sessionId + '\0' + path).digest('hex').slice(0, 32);
  const id = hash.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const saved = await one(db, 'SELECT content,media_type AS "mediaType" FROM attachments WHERE session=$1 AND id=$2', [sessionId, id]);
  if (saved) return saved;

  const filename = basename(path);
  const contains = value => '%' + value.replace(/[!%_]/g, '!$&') + '%';
  const { rows } = await db.query(`SELECT id,text FROM messages WHERE session=$1 AND role='agent'
    AND (text LIKE $2 ESCAPE '!' OR text LIKE $3 ESCAPE '!' OR text LIKE $4 ESCAPE '!') ORDER BY position DESC`,
    [sessionId, contains(filename), contains(encodeURI(filename)), contains(encodeURIComponent(filename))]);
  const message = rows.find(row => hasImageLink(row.text, path));
  if (!message) throw new HttpError(404, 'Image not found.');
  const image = await readReplyImage(resolve(path));
  if (!image) throw new HttpError(404, 'The original image is no longer available.');
  await addAttachment(db, sessionId, message.id, { ...image, id, name: filename }, 0, true);
  return image;
}

export function readImages(value = []) {
  if (!Array.isArray(value) || value.length > maxImages) throw new HttpError(400, 'Up to ' + maxImages + ' images per message.');
  return value.map(image => {
    const format = Object.hasOwn(formats, image?.mediaType) && formats[image.mediaType];
    if (!format || typeof image.data !== 'string' || !image.data || image.data.length > Math.ceil(imageLimit / 3) * 4) {
      throw new HttpError(400, 'Upload PNG, JPG, GIF, or WebP images up to 2 MiB.');
    }
    const content = Buffer.from(image.data, 'base64');
    if (content.length > imageLimit || content.toString('base64') !== image.data || !format.matches(content)) {
      throw new HttpError(400, 'The image data does not match its file type.');
    }
    const name = typeof image.name === 'string' && image.name.trim() ? image.name.replace(/[\x00-\x1f/\\]/g, '').trim().slice(0, 120) : '';
    return { name: name || 'image.' + format.extension, mediaType: image.mediaType, extension: format.extension, content };
  });
}

export const fileMediaType = 'application/octet-stream';

export function readFiles(items, videoBytes = 0) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > 6) throw new HttpError(400, 'Attach up to 6 files per message.');
  let remaining = videoLimit - videoBytes;
  return items.map(item => {
    if (typeof item?.name !== 'string' || typeof item.data !== 'string' ||
        item.data.length > Math.ceil(remaining / 3) * 4) throw new HttpError(400, 'Invalid file or files exceed 8 MiB.');
    const content = Buffer.from(item.data, 'base64');
    if (content.length > remaining || content.toString('base64') !== item.data) throw new HttpError(400, 'Invalid file or files exceed 8 MiB.');
    remaining -= content.length;
    const leaf = item.name.split(/[\\/]/).pop().toWellFormed().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_');
    const name = [...leaf].slice(0, 120).join('').replace(/[. ]+$/, '');
    if (!name || Buffer.byteLength(name) > 240 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) {
      throw new HttpError(400, 'Choose a valid filename.');
    }
    return { name, mediaType: fileMediaType, content };
  });
}

export function readVideo(video) {
  if (video === undefined) return;
  const extension = videoExtensions.get(video?.mediaType);
  if (!extension || typeof video.data !== 'string' || !video.data || video.data.length > Math.ceil(videoLimit / 3) * 4) {
    throw new HttpError(400, 'Choose an MP4, MOV, or WebM video up to 8 MiB.');
  }
  const content = Buffer.from(video.data, 'base64');
  const matches = extension === 'webm' ? content.subarray(0, 4).toString('hex') === '1a45dfa3'
    : /^(ftyp|moov|mdat|wide)$/.test(content.subarray(4, 8).toString('ascii'));
  if (!matches || content.length > videoLimit || content.toString('base64') !== video.data) {
    throw new HttpError(400, 'The video data does not match its file type.');
  }
  const name = typeof video.name === 'string' ? video.name.replace(/[\x00-\x1f/\\]/g, '').trim().slice(0, 120) : '';
  return { name: name || 'video.' + extension, mediaType: video.mediaType, extension, content };
}
